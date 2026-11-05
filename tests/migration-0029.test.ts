// Миграция 0029 (аудит wave 2) на реальном SQLite: применяем цепочку 0001..0028,
// кладём данные в старую mini_app_usage, применяем 0029 и проверяем схему +
// перенос данных + идемпотентность индексов. Паттерн node:sqlite — из
// tmp/audit-2026-10-18/s2/repro (vite 5 не знает node:sqlite в builtins —
// берём модуль через process.getBuiltinModule).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');

const MIG_DIR = join(__dirname, '..', 'worker', 'migrations');

function makeDb() {
  return new DatabaseSync(':memory:');
}

function applyFiles(db: any, files: string[]) {
  for (const f of files) db.exec(readFileSync(join(MIG_DIR, f), 'utf8'));
}

function migrationFiles(upto?: string): string[] {
  const all = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  return upto ? all.slice(0, all.indexOf(upto)) : all;
}

describe('миграция 0029_audit_wave2.sql', () => {
  it('вся цепочка миграций применяется без ошибок', () => {
    const db = makeDb();
    expect(() => applyFiles(db, migrationFiles())).not.toThrow();
  });

  it('scheduled_sends получила claimed_at (nullable)', () => {
    const db = makeDb();
    applyFiles(db, migrationFiles());
    const cols = db.prepare('PRAGMA table_info(scheduled_sends)').all();
    const claimed = cols.find((c: any) => c.name === 'claimed_at');
    expect(claimed).toBeTruthy();
    expect(claimed.notnull).toBe(0);
  });

  it('mini_app_usage: PK (bot_id, user_id, date), старые данные перенесены в строку user_id=0', () => {
    const db = makeDb();
    applyFiles(db, migrationFiles('0029_audit_wave2.sql'));
    // Данные «прода» в старой схеме (миграция 0026): одна строка на бота.
    db.exec(`INSERT INTO mini_app_usage (bot_id, media_bytes, ai_count_date, ai_count, updated_at)
             VALUES ('bot1', 12345, '2026-10-18', 7, 111)`);
    applyFiles(db, ['0029_audit_wave2.sql']);
    const pk = db.prepare(`SELECT name FROM pragma_table_info('mini_app_usage') WHERE pk > 0 ORDER BY pk`).all();
    expect(pk.map((r: any) => r.name)).toEqual(['bot_id', 'user_id', 'date']);
    const row = db.prepare('SELECT * FROM mini_app_usage').get() as any;
    expect(row).toMatchObject({ bot_id: 'bot1', user_id: 0, date: '2026-10-18', media_bytes: 12345, ai_count: 7, updated_at: 111 });
  });

  it('mini_payments создана с UNIQUE payload/charge_id и индексом', () => {
    const db = makeDb();
    applyFiles(db, migrationFiles());
    const cols = db.prepare('PRAGMA table_info(mini_payments)').all().map((c: any) => c.name);
    expect(cols).toEqual(['id', 'bot_id', 'app_id', 'user_id', 'amount', 'payload', 'charge_id', 'status', 'created_at', 'paid_at']);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='mini_payments'`).all().map((r: any) => r.name);
    expect(idx).toContain('idx_mini_payments_bot');
    // payload UNIQUE: второй платёж с тем же payload отклоняется.
    db.prepare(`INSERT INTO mini_payments (id, bot_id, app_id, user_id, amount, payload, created_at) VALUES ('p1','b','a',1,100,'pay-x',1)`).run();
    expect(() =>
      db.prepare(`INSERT INTO mini_payments (id, bot_id, app_id, user_id, amount, payload, created_at) VALUES ('p2','b','a',1,100,'pay-x',2)`).run()
    ).toThrow(/UNIQUE/i);
  });

  it('F-010: составные индексы на bots и support_tickets созданы', () => {
    const db = makeDb();
    applyFiles(db, migrationFiles());
    const names = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all().map((r: any) => r.name);
    expect(names).toContain('idx_bots_owner_created');
    expect(names).toContain('idx_tickets_status_created');
  });

  it('upsert broadcast_counters с WHERE-условием капа работает на новой схеме', () => {
    // SQL из tryBumpBroadcastCounter (ES-10): проверка, что DO UPDATE ... WHERE
    // поддерживается и не двигает счётчик при превышении капа.
    const db = makeDb();
    applyFiles(db, migrationFiles());
    const sql = `INSERT INTO broadcast_counters (bot_id, day, sent, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(bot_id, day) DO UPDATE SET sent = sent + excluded.sent, updated_at = excluded.updated_at
       WHERE sent + excluded.sent <= ?`;
    db.prepare(sql).run('b', '2026-10-19', 5, 1, 10);
    let r = db.prepare(sql).run('b', '2026-10-19', 5, 2, 10);
    expect(Number(r.changes)).toBe(1); // ровно на границе — ещё можно
    r = db.prepare(sql).run('b', '2026-10-19', 1, 3, 10);
    expect(Number(r.changes)).toBe(0); // cap — строка не тронута
    const row = db.prepare(`SELECT sent FROM broadcast_counters WHERE bot_id='b'`).get() as any;
    expect(row.sent).toBe(10);
  });
});
