// Волна 2 (F-041): функции mini_payments на РЕАЛЬНОМ SQLite (node:sqlite),
// паттерн tests/db-wave2.test.ts. UNIQUE payload/charge_id и идемпотентность
// markMiniPaymentPaid исполняются по-настоящему.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createMiniPayment,
  deleteMiniPayment,
  getMiniPaymentByPayload,
  getMiniPaymentByCharge,
  markMiniPaymentPaid,
} from '../worker/src/db';

const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');
const MIG_DIR = join(__dirname, '..', 'worker', 'migrations');

function makeDb(): any {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(MIG_DIR, f), 'utf8'));
  }
  return {
    __raw: raw,
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async run() {
          const r = raw.prepare(sql).run(...(args as any));
          return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
        async all() {
          return { results: raw.prepare(sql).all(...(args as any)), success: true };
        },
        async first() {
          return raw.prepare(sql).get(...(args as any)) ?? null;
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

function payRow(id: string, overrides: Partial<Parameters<typeof createMiniPayment>[1]> = {}) {
  return {
    id,
    bot_id: 'bot1',
    app_id: 'mini-1',
    user_id: 42,
    amount: 100,
    payload: `mini:${id}`,
    created_at: Date.now(),
    ...overrides,
  };
}

describe('F-041: mini_payments CRUD', () => {
  it('create → getMiniPaymentByPayload: pending, сумма, payload', async () => {
    const db = makeDb();
    await createMiniPayment(db, payRow('p1'));
    const row = await getMiniPaymentByPayload(db, 'mini:p1');
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.amount).toBe(100);
    expect(row!.bot_id).toBe('bot1');
    expect(row!.charge_id).toBeNull();
    expect(row!.paid_at).toBeNull();
  });

  it('дублирующий payload отклоняется (UNIQUE)', async () => {
    const db = makeDb();
    await createMiniPayment(db, payRow('p1'));
    await expect(createMiniPayment(db, payRow('p2', { payload: 'mini:p1' }))).rejects.toThrow(/UNIQUE/i);
  });

  it('markMiniPaymentPaid идемпотентна: первый вызов true, повтор false', async () => {
    const db = makeDb();
    await createMiniPayment(db, payRow('p1'));
    expect(await markMiniPaymentPaid(db, 'mini:p1', 'charge-1', Date.now())).toBe(true);
    const row = await getMiniPaymentByPayload(db, 'mini:p1');
    expect(row!.status).toBe('paid');
    expect(row!.charge_id).toBe('charge-1');
    expect(row!.paid_at).not.toBeNull();
    // Ретрай Telegram с тем же или другим charge_id — без повторного эффекта.
    expect(await markMiniPaymentPaid(db, 'mini:p1', 'charge-2', Date.now())).toBe(false);
    expect((await getMiniPaymentByPayload(db, 'mini:p1'))!.charge_id).toBe('charge-1');
  });

  it('неизвестный payload — mark false, get null', async () => {
    const db = makeDb();
    expect(await markMiniPaymentPaid(db, 'mini:ghost', 'c', Date.now())).toBe(false);
    expect(await getMiniPaymentByPayload(db, 'mini:ghost')).toBeNull();
  });

  it('getMiniPaymentByCharge находит paid-строку; пустой chargeId — null', async () => {
    const db = makeDb();
    await createMiniPayment(db, payRow('p1'));
    await markMiniPaymentPaid(db, 'mini:p1', 'charge-1', Date.now());
    const row = await getMiniPaymentByCharge(db, 'charge-1');
    expect(row!.id).toBe('p1');
    expect(await getMiniPaymentByCharge(db, '')).toBeNull();
  });

  it('deleteMiniPayment убирает строку (откат несостоявшегося счёта)', async () => {
    const db = makeDb();
    await createMiniPayment(db, payRow('p1'));
    await deleteMiniPayment(db, 'p1');
    expect(await getMiniPaymentByPayload(db, 'mini:p1')).toBeNull();
  });
});
