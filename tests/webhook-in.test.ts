// webhook_in (набор 2026-10): разложение тела вебхука в wh.-переменные,
// нормализация имён полей и db-слой bot_webhooks (миграция 0028).
// Фейковый D1 по правилам репозитория: prepare и batch — СОСЕДНИЕ методы
// объекта db, batch реально прогоняет statement'ы (урок разделов 18/19);
// SQL-строки сверены с webhookin/db.ts дословно.
import { describe, expect, it } from 'vitest';

import { extractWebhookVars, normalizeWebhookField } from '../worker/src/blocks/webhookin/runtime';
import {
  createWebhookHook,
  getWebhookHookByToken,
  listWebhookHooks,
  deleteWebhookHooksForBot,
} from '../worker/src/blocks/webhookin/db';
import { WH_PREFIX } from '../shared/types';

describe('extractWebhookVars', () => {
  it('без fields: тело-объект целиком в wh.body как JSON', () => {
    const body = { name: 'Илья', age: 30, tags: ['a', 'b'] };
    expect(extractWebhookVars(undefined, body)).toEqual({ 'wh.body': JSON.stringify(body) });
    expect(extractWebhookVars([], body)).toEqual({ 'wh.body': JSON.stringify(body) });
  });

  it('тело-скаляр без fields → wh.body стрингуется как есть', () => {
    expect(extractWebhookVars(undefined, 'привет')).toEqual({ 'wh.body': '"привет"' });
    expect(extractWebhookVars(undefined, 42)).toEqual({ 'wh.body': '42' });
    expect(extractWebhookVars(undefined, true)).toEqual({ 'wh.body': 'true' });
    expect(extractWebhookVars(undefined, null)).toEqual({ 'wh.body': 'null' });
  });

  it('массив без fields → JSON массива', () => {
    expect(extractWebhookVars(undefined, [1, 2])).toEqual({ 'wh.body': '[1,2]' });
  });

  it('с fields: скаляр, объект, отсутствующее поле', () => {
    const body = { name: 'Илья', meta: { city: 'M' }, list: [1, 2], flag: false, zero: 0 };
    const out = extractWebhookVars(['name', 'meta', 'list', 'flag', 'zero', 'absent'], body);
    expect(out).toEqual({
      [`${WH_PREFIX}name`]: 'Илья',
      [`${WH_PREFIX}meta`]: '{"city":"M"}',
      [`${WH_PREFIX}list`]: '[1,2]',
      [`${WH_PREFIX}flag`]: 'false',
      [`${WH_PREFIX}zero`]: '0',
    });
    // Отсутствующее поле ключ не создаёт.
    expect(`${WH_PREFIX}absent` in out).toBe(false);
  });

  it('с fields и тело-скаляр → ключей нет', () => {
    expect(extractWebhookVars(['a'], 'строка')).toEqual({});
    expect(extractWebhookVars(['a'], null)).toEqual({});
    expect(extractWebhookVars(['a'], undefined)).toEqual({});
  });

  it('value: null в теле — скаляр, становится "null"', () => {
    expect(extractWebhookVars(['a'], { a: null })).toEqual({ [`${WH_PREFIX}a`]: 'null' });
  });
});

describe('normalizeWebhookField', () => {
  it('пробелы и спецсимволы → _, повторы схлопываются', () => {
    expect(normalizeWebhookField('My Field!')).toBe('My_Field');
    expect(normalizeWebhookField('  order   id  ')).toBe('order_id');
    expect(normalizeWebhookField('a--b__c')).toBe('a_b_c');
    expect(normalizeWebhookField('user.name')).toBe('user_name');
  });

  it('кириллица вычищается', () => {
    expect(normalizeWebhookField('Заказ №5')).toBe('5');
    expect(normalizeWebhookField('!!!')).toBe('');
    expect(normalizeWebhookField('')).toBe('');
    expect(normalizeWebhookField('   ')).toBe('');
  });

  it('обрезка до 64', () => {
    const long = 'x'.repeat(100);
    expect(normalizeWebhookField(long)).toHaveLength(64);
    const mixed = 'a'.repeat(80) + '!'.repeat(20);
    expect(normalizeWebhookField(mixed).length).toBeLessThanOrEqual(64);
  });

  it('валидное имя не меняется', () => {
    expect(normalizeWebhookField('order_id')).toBe('order_id');
    expect(normalizeWebhookField('Field1')).toBe('Field1');
  });
});

// ------------------------------------------------------------------- db-слой

type Row = Record<string, unknown>;

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function makeHooksDb(tables: Record<string, Row[]> = { bot_webhooks: [] }) {
  const recorded: Array<{ sql: string; args: unknown[]; kind: string }> = [];
  const colListOf = (sql: string) => (sql.match(/\(([^)]+)\)\s*VALUES/i)?.[1] ?? '').split(',').map((c) => c.trim());

  function first(s: string, args: unknown[]): Row | null {
    if (s === 'SELECT * FROM bot_webhooks WHERE token = ?') {
      return tables.bot_webhooks.find((r) => r.token === args[0]) ?? null;
    }
    return null;
  }

  function all(s: string, args: unknown[]): Row[] {
    if (s === 'SELECT * FROM bot_webhooks WHERE bot_id = ? ORDER BY created_at DESC') {
      return tables.bot_webhooks
        .filter((r) => r.bot_id === args[0])
        .sort((a, b) => Number(b.created_at) - Number(a.created_at));
    }
    return [];
  }

  function run(s: string, args: unknown[]): Row {
    if (s.startsWith('INSERT INTO bot_webhooks ')) {
      const cols = colListOf(s);
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = args[i]));
      // UNIQUE(token) из миграции 0028.
      const dup = tables.bot_webhooks.find((r) => r.token === row.token);
      if (dup) throw new Error('D1_ERROR: UNIQUE constraint failed: bot_webhooks.token');
      tables.bot_webhooks.push(row);
      return { meta: { changes: 1 } };
    }
    if (s === 'DELETE FROM bot_webhooks WHERE bot_id = ?') {
      const before = tables.bot_webhooks.length;
      tables.bot_webhooks = tables.bot_webhooks.filter((r) => r.bot_id !== args[0]);
      return { meta: { changes: before - tables.bot_webhooks.length } };
    }
    return { meta: { changes: 0 } };
  }

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const s = norm(sql);
          return {
            async first<T>() {
              recorded.push({ sql: s, args, kind: 'first' });
              return first(s, args) as T;
            },
            async all<T>() {
              recorded.push({ sql: s, args, kind: 'all' });
              return { results: all(s, args) } as { results: T[] };
            },
            async run() {
              recorded.push({ sql: s, args, kind: 'run' });
              return run(s, args);
            },
          };
        },
      };
    },
    // batch — СОСЕД prepare; исполняет statement'ы по очереди.
    async batch(stmts: Array<{ run: () => Promise<unknown> }> = []) {
      const out = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
    __recorded: recorded,
    __tables: tables,
  };
  return db;
}

describe('webhookin db', () => {
  it('созданный хук читается по token, fields распарсен', async () => {
    const db = makeHooksDb();
    await createWebhookHook(db as any, { id: 'wh1', botId: 'bot1', token: 'tok1', blockId: 'b1', fields: ['name', 'email'] });
    const row = await getWebhookHookByToken(db as any, 'tok1');
    expect(row).not.toBeNull();
    expect(row!.id).toBe('wh1');
    expect(row!.bot_id).toBe('bot1');
    expect(row!.scenario_block_id).toBe('b1');
    expect(row!.fields).toEqual(['name', 'email']);
    expect(row!.created_at).toBeGreaterThan(0);
  });

  it('неизвестный token → null', async () => {
    const db = makeHooksDb();
    await expect(getWebhookHookByToken(db as any, 'nope')).resolves.toBeNull();
  });

  it('пустой fields пишется как []', async () => {
    const db = makeHooksDb();
    await createWebhookHook(db as any, { id: 'wh2', botId: 'bot1', token: 'tok2', blockId: 'b2', fields: [] });
    expect(db.__tables.bot_webhooks[0].fields).toBe('[]');
    const row = await getWebhookHookByToken(db as any, 'tok2');
    expect(row!.fields).toEqual([]);
  });

  it('битый JSON в fields читается как []', async () => {
    const db = makeHooksDb({ bot_webhooks: [
      { id: 'x', bot_id: 'b', token: 't', scenario_block_id: 'blk', fields: '{сломано', created_at: 1 },
    ] });
    const row = await getWebhookHookByToken(db as any, 't');
    expect(row!.fields).toEqual([]);
  });

  it('listWebhookHooks возвращает строки бота с распарсенными fields', async () => {
    const db = makeHooksDb();
    await createWebhookHook(db as any, { id: 'a', botId: 'bot1', token: 'ta', blockId: 'b1', fields: ['x'] });
    await createWebhookHook(db as any, { id: 'b', botId: 'bot1', token: 'tb', blockId: 'b2', fields: [] });
    await createWebhookHook(db as any, { id: 'c', botId: 'bot2', token: 'tc', blockId: 'b3', fields: ['y'] });
    const rows = await listWebhookHooks(db as any, 'bot1');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(rows.find((r) => r.id === 'a')!.fields).toEqual(['x']);
    expect(rows.find((r) => r.id === 'b')!.fields).toEqual([]);
  });

  it('deleteWebhookHooksForBot удаляет только строки бота', async () => {
    const db = makeHooksDb();
    await createWebhookHook(db as any, { id: 'a', botId: 'bot1', token: 'ta', blockId: 'b1', fields: [] });
    await createWebhookHook(db as any, { id: 'c', botId: 'bot2', token: 'tc', blockId: 'b3', fields: [] });
    await deleteWebhookHooksForBot(db as any, 'bot1');
    expect(db.__tables.bot_webhooks).toHaveLength(1);
    expect(db.__tables.bot_webhooks[0].bot_id).toBe('bot2');
  });

  it('дубликат token отклоняется (UNIQUE)', async () => {
    const db = makeHooksDb();
    await createWebhookHook(db as any, { id: 'a', botId: 'bot1', token: 'same', blockId: 'b1', fields: [] });
    await expect(
      createWebhookHook(db as any, { id: 'z', botId: 'bot2', token: 'same', blockId: 'b2', fields: [] })
    ).rejects.toThrow(/UNIQUE/);
  });
});
