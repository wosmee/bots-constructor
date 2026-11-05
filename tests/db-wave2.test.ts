// Волна 2 аудита 2026-10-18: новые функции db.ts на РЕАЛЬНОМ SQLite
// (node:sqlite), а не на фейке — SQL-строки с ON CONFLICT/WHERE/LIKE исполняются
// по-настоящему. Покрывает:
//  - F-013: claimScheduledSend / dueScheduled с claimed_at (атомарный захват);
//  - F-002: getSessionCas / upsertSessionCas — cas, merged (два «параллельных»
//    persist сохраняют оба набора), insert;
//  - ES-10: tryBumpBroadcastCounter — атомарный cap одним SQL;
//  - F-038: collectionUpdate/collectionRemove/collectionFind по where={id}
//    (порт repro tmp/audit-2026-10-18/s2/repro/sqlite-scan.test.ts — там
//    проверки зафиксировали БАГ (removed=0); здесь — исправленное поведение);
//  - WS-15: listTemplates — %/_ в запросе больше не метасимволы.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  claimScheduledSend,
  dueScheduled,
  deleteScheduled,
  insertScheduled,
  SCHEDULED_CLAIM_STALE_MS,
  getSessionCas,
  upsertSessionCas,
  upsertSession,
  tryBumpBroadcastCounter,
  getBroadcastCounter,
  collectionAdd,
  collectionFind,
  collectionUpdate,
  collectionRemove,
  listTemplates,
  insertTemplate,
  type TemplateRow,
} from '../worker/src/db';

const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');

const MIG_DIR = join(__dirname, '..', 'worker', 'migrations');

// Полная схема проекта: все миграции по порядку (включая 0029).
function makeDb(): any {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(MIG_DIR, f), 'utf8'));
  }
  return wrap(raw);
}

// Обёртка DatabaseSync → D1-подобный prepare/bind/run/all/first/batch
// (паттерн tmp/audit-2026-10-18/s2/repro/sqlite-scan.test.ts; batch — СОСЕД
// prepare, исполняет statement'ы — урок §18/19).
function wrap(raw: any) {
  return {
    __raw: raw,
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
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

// ---------------- F-013: атомарный захват scheduled_sends ----------------

describe('F-013: claimScheduledSend + dueScheduled', () => {
  it('захват возвращает true один раз: второй претендент — false', async () => {
    const db = makeDb();
    await insertScheduled(db, 'bot1', 100, Date.now() - 1000, 'broadcast', '{}');
    const row = db.__raw.prepare('SELECT id FROM scheduled_sends').get() as any;
    const now = Date.now();
    expect(await claimScheduledSend(db, Number(row.id), now)).toBe(true);
    // Дублирующий тик крона (другой изолят) — проигрывает.
    expect(await claimScheduledSend(db, Number(row.id), now + 1)).toBe(false);
  });

  it('dueScheduled не возвращает захваченную строку до истечения stale-окна', async () => {
    const db = makeDb();
    const now = Date.now();
    await insertScheduled(db, 'bot1', 100, now - 1000, 'broadcast', '{}');
    const rows = await dueScheduled(db, now);
    expect(rows).toHaveLength(1);
    expect(await claimScheduledSend(db, rows[0].id, now)).toBe(true);
    // Свежий захват — строка скрыта от следующих тиков.
    expect(await dueScheduled(db, now + 1000)).toEqual([]);
    // Зависший захват (изолят умер) — строка снова видна после stale-окна.
    const later = now + SCHEDULED_CLAIM_STALE_MS + 1;
    const again = await dueScheduled(db, later);
    expect(again).toHaveLength(1);
    expect(await claimScheduledSend(db, again[0].id, later)).toBe(true);
  });

  it('незахваченные (claimed_at IS NULL) строки видны всегда', async () => {
    const db = makeDb();
    const now = Date.now();
    await insertScheduled(db, 'bot1', 100, now - 5000, 'broadcast', '{}');
    await insertScheduled(db, 'bot1', 101, now - 4000, 'broadcast', '{}');
    const rows = await dueScheduled(db, now);
    expect(rows).toHaveLength(2);
    // Захват одной не прячет вторую.
    await claimScheduledSend(db, rows[0].id, now);
    expect((await dueScheduled(db, now)).map((r) => r.id)).toEqual([rows[1].id]);
  });

  it('deleteScheduled убирает строку вместе с захватом', async () => {
    const db = makeDb();
    const now = Date.now();
    await insertScheduled(db, 'bot1', 100, now - 1000, 'broadcast', '{}');
    const rows = await dueScheduled(db, now);
    await claimScheduledSend(db, rows[0].id, now);
    await deleteScheduled(db, rows[0].id);
    expect(await dueScheduled(db, now + SCHEDULED_CLAIM_STALE_MS * 2)).toEqual([]);
  });
});

// ---------------- F-002: CAS-запись сессии ----------------

describe('F-002: upsertSessionCas', () => {
  const BOT = 'bot-cas';
  const USER = 42;

  it('сессии нет → status insert', async () => {
    const db = makeDb();
    const base = await getSessionCas(db, BOT, USER);
    expect(base).toBeNull();
    const r = await upsertSessionCas(db, {
      botId: BOT, userId: USER, currentBlock: 'b1',
      varsJson: JSON.stringify({ a: 1 }), baseVars: null, baseUpdatedAt: null,
    });
    expect(r.status).toBe('insert');
    const row = await getSessionCas(db, BOT, USER);
    expect(JSON.parse(row!.vars_json)).toEqual({ a: 1 });
  });

  it('строка не менялась с базового чтения → status cas, запись как есть', async () => {
    const db = makeDb();
    await upsertSession(db, BOT, USER, 'b0', JSON.stringify({ a: 1 }));
    const base = (await getSessionCas(db, BOT, USER))!;
    const r = await upsertSessionCas(db, {
      botId: BOT, userId: USER, currentBlock: 'b1',
      varsJson: JSON.stringify({ a: 2 }),
      baseVars: { a: 1 }, baseUpdatedAt: base.updated_at,
    });
    expect(r.status).toBe('cas');
    const row = await getSessionCas(db, BOT, USER);
    expect(JSON.parse(row!.vars_json)).toEqual({ a: 2 });
    expect(row!.current_block).toBe('b1');
  });

  it('ДВА «параллельных» persist (A→B1, A→B2) с разными ключами — merged сохраняет ОБА набора', async () => {
    const db = makeDb();
    // updated_at — миллисекунды: две записи в одну миллисекунду CAS не
    // различит (задокументированное ограничение). Разводим «параллельные»
    // ветки контролируемыми часами, как в жизни (разные изоляты/тик-и).
    let clock = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      // Состояние A: обе «ветки» прочитали одну базу.
      await upsertSession(db, BOT, USER, 'start', JSON.stringify({ ref: 'x' }));
      const base = (await getSessionCas(db, BOT, USER))!;
      const baseVars = JSON.parse(base.vars_json);

      // Ветка B1 завершилась первой: base не устарел → cas.
      clock += 10;
      const r1 = await upsertSessionCas(db, {
        botId: BOT, userId: USER, currentBlock: 'block-1',
        varsJson: JSON.stringify({ ref: 'x', city: 'Москва' }),
        baseVars, baseUpdatedAt: base.updated_at,
      });
      expect(r1.status).toBe('cas');

      // Ветка B2 приносит ДРУГОЙ ключ; её base устарел (B1 уже записала).
      clock += 10;
      const r2 = await upsertSessionCas(db, {
        botId: BOT, userId: USER, currentBlock: 'block-2',
        varsJson: JSON.stringify({ ref: 'x', phone: '+7' }),
        baseVars, baseUpdatedAt: base.updated_at,
      });
      expect(r2.status).toBe('merged');

      const row = await getSessionCas(db, BOT, USER);
      const vars = JSON.parse(row!.vars_json);
      // Оба набора на месте: чужая запись (city) не затёрта.
      expect(vars).toEqual({ ref: 'x', city: 'Москва', phone: '+7' });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('merged переносит УДАЛЕНИЕ ключа и изменение общего ключа', async () => {
    const db = makeDb();
    await upsertSession(db, BOT, USER, null, JSON.stringify({ a: 1, del: 'me', shared: 'old' }));
    const base = (await getSessionCas(db, BOT, USER))!;
    // Параллельная запись: меняет shared, добавляет own.
    await upsertSession(db, BOT, USER, null, JSON.stringify({ a: 1, del: 'me', shared: 'old', own: 'fresh', }));
    // Обновим shared параллельно ещё раз (имитация чужого прохода).
    db.__raw.prepare('UPDATE sessions SET vars_json = ?, updated_at = ? WHERE bot_id = ? AND user_id = ?')
      .run(JSON.stringify({ a: 1, del: 'me', shared: 'parallel', own: 'fresh' }), base.updated_at + 5, BOT, USER);
    // Наш запрос: удалил del, изменил shared.
    const r = await upsertSessionCas(db, {
      botId: BOT, userId: USER, currentBlock: null,
      varsJson: JSON.stringify({ a: 1, shared: 'mine' }),
      baseVars: { a: 1, del: 'me', shared: 'old' },
      baseUpdatedAt: base.updated_at,
    });
    expect(r.status).toBe('merged');
    const vars = JSON.parse((await getSessionCas(db, BOT, USER))!.vars_json);
    expect(vars).toEqual({ a: 1, shared: 'mine', own: 'fresh' }); // del удалён, own сохранён
  });

  it('merged не трогает ключи, которых наш запрос не менял', async () => {
    const db = makeDb();
    // updated_at — миллисекунды: разводим «параллельные» записи контролируемыми
    // часами, иначе в пределах одной миллисекунды CAS не отличит чужую запись.
    let clock = 2_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      await upsertSession(db, BOT, USER, null, JSON.stringify({ keep: 'base' }));
      const base = (await getSessionCas(db, BOT, USER))!;
      // Параллельно кто-то записал { keep: 'other' }; наш varsJson содержит то же
      // базовое значение keep — overlay пуст, чужая запись остаётся.
      clock += 10;
      await upsertSession(db, BOT, USER, null, JSON.stringify({ keep: 'other', extra: 1 }));
      const r = await upsertSessionCas(db, {
        botId: BOT, userId: USER, currentBlock: null,
        varsJson: JSON.stringify({ keep: 'base' }),
        baseVars: { keep: 'base' }, baseUpdatedAt: base.updated_at,
      });
      expect(r.status).toBe('merged');
      const vars = JSON.parse((await getSessionCas(db, BOT, USER))!.vars_json);
      expect(vars).toEqual({ keep: 'other', extra: 1 });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('search_text пересчитывается и на cas, и на merged', async () => {
    const db = makeDb();
    await upsertSession(db, BOT, USER, null, JSON.stringify({ city: 'Казань' }));
    const base = (await getSessionCas(db, BOT, USER))!;
    await upsertSessionCas(db, {
      botId: BOT, userId: USER, currentBlock: null,
      varsJson: JSON.stringify({ city: 'Тверь' }),
      baseVars: { city: 'Казань' }, baseUpdatedAt: base.updated_at,
    });
    const st = db.__raw.prepare('SELECT search_text FROM sessions WHERE bot_id = ? AND user_id = ?').get(BOT, USER) as any;
    expect(String(st.search_text)).toContain('тверь');
    expect(String(st.search_text)).not.toContain('казань');
  });
});

// ---------------- ES-10: атомарный bump счётчика рассылки ----------------

describe('ES-10: tryBumpBroadcastCounter', () => {
  const BOT = 'bot-bc';
  const DAY = '2026-10-19';

  it('первый bump создаёт строку, ok=true, count = inc', async () => {
    const db = makeDb();
    const r = await tryBumpBroadcastCounter(db, BOT, DAY, 5, 10);
    expect(r).toEqual({ ok: true, count: 5 });
    expect(await getBroadcastCounter(db, BOT, DAY)).toBe(5);
  });

  it('ровно до капа — ok; следующий инкремент — ok=false и счётчик не двигается', async () => {
    const db = makeDb();
    expect(await tryBumpBroadcastCounter(db, BOT, DAY, 8, 10)).toEqual({ ok: true, count: 8 });
    expect(await tryBumpBroadcastCounter(db, BOT, DAY, 2, 10)).toEqual({ ok: true, count: 10 });
    const over = await tryBumpBroadcastCounter(db, BOT, DAY, 1, 10);
    expect(over.ok).toBe(false);
    expect(await getBroadcastCounter(db, BOT, DAY)).toBe(10);
  });

  it('первый же inc выше капа — ok=false, строка откатывается', async () => {
    const db = makeDb();
    const r = await tryBumpBroadcastCounter(db, BOT, DAY, 20, 10);
    expect(r.ok).toBe(false);
    expect(await getBroadcastCounter(db, BOT, DAY)).toBe(0);
  });

  it('inc <= 0 не принимается', async () => {
    const db = makeDb();
    expect((await tryBumpBroadcastCounter(db, BOT, DAY, 0, 10)).ok).toBe(false);
    expect((await tryBumpBroadcastCounter(db, BOT, DAY, -5, 10)).ok).toBe(false);
    expect(await getBroadcastCounter(db, BOT, DAY)).toBe(0);
  });

  it('последовательные «параллельные» запросы не превышают cap (read-then-bump гонка закрыта)', async () => {
    const db = makeDb();
    // Имитация двух enqueue по 6 при cap 10: старый путь дал бы 12.
    const r1 = await tryBumpBroadcastCounter(db, BOT, DAY, 6, 10);
    const r2 = await tryBumpBroadcastCounter(db, BOT, DAY, 6, 10);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(await getBroadcastCounter(db, BOT, DAY)).toBe(6);
  });
});

// ---------------- F-038: record_form update/delete по where={id} ----------------
// Порт repro tmp/audit-2026-10-18/s2/repro/sqlite-scan.test.ts: там проверки
// фиксировали баг (removed=0, строка жива); здесь — исправленное поведение.

describe('F-038: collection* по where={id} (PRIMARY KEY, мимо search_text)', () => {
  const BOT = 'bot-s2';
  const COL = 'col-orders';

  it('collectionRemove(where={id}) удаляет строку, у которой НЕТ поля id в данных', async () => {
    const db = makeDb();
    await collectionAdd(db, BOT, COL, 7, { phone: '+79990000000', note: 'секрет клиента' });
    const row = db.__raw.prepare('SELECT id FROM collection_items').get() as any;
    const removed = await collectionRemove(db, BOT, COL, { id: String(row.id) });
    expect(removed).toBe(1);
    const n = db.__raw.prepare('SELECT COUNT(*) AS n FROM collection_items').get() as any;
    expect(Number(n.n)).toBe(0);
  });

  it('collectionUpdate(where={id}) реально меняет данные (репро «Сохранено ✓» без сохранения)', async () => {
    const db = makeDb();
    await collectionAdd(db, BOT, COL, 7, { phone: '+79990000000', note: 'старое' });
    const row = db.__raw.prepare('SELECT id FROM collection_items').get() as any;
    const n = await collectionUpdate(db, BOT, COL, { id: String(row.id) }, { note: 'новое' });
    expect(n).toBe(1);
    const after = db.__raw.prepare('SELECT data_json FROM collection_items WHERE id = ?').get(String(row.id)) as any;
    expect(JSON.parse(String(after.data_json))).toEqual({ phone: '+79990000000', note: 'новое' });
    // search_text пересчитан
    const st = db.__raw.prepare('SELECT search_text FROM collection_items WHERE id = ?').get(String(row.id)) as any;
    expect(String(st.search_text)).toContain('новое');
  });

  it('collectionFind(where={id}) находит строку без поля id в данных', async () => {
    const db = makeDb();
    const id = await collectionAdd(db, BOT, COL, 7, { phone: '123' });
    const found = await collectionFind(db, BOT, COL, { id: id! }, 10);
    expect(found).toEqual([{ phone: '123' }]);
  });

  it('обратная совместимость: авторское поле id ВНУТРИ данных по-прежнему матчится', async () => {
    const db = makeDb();
    // Блок «Данные» мог писать своё поле id — старый путь искал его через search_text.
    await collectionAdd(db, BOT, COL, 7, { id: 'custom-key', v: 1 });
    const found = await collectionFind(db, BOT, COL, { id: 'custom-key' }, 10);
    expect(found).toHaveLength(1);
    const n = await collectionRemove(db, BOT, COL, { id: 'custom-key' });
    expect(n).toBe(1);
  });

  it('чужой bot_id не удаляется (scope по боту сохранён)', async () => {
    const db = makeDb();
    const id = await collectionAdd(db, BOT, COL, 7, { a: 1 });
    const removed = await collectionRemove(db, 'bot-other', COL, { id: id! });
    expect(removed).toBe(0);
  });

  it('where по обычному полю работает как раньше', async () => {
    const db = makeDb();
    await collectionAdd(db, BOT, COL, 7, { phone: '+79990000000', note: 'y' });
    const removed = await collectionRemove(db, BOT, COL, { phone: '+79990000000' });
    expect(removed).toBe(1);
  });
});

// ---------------- WS-15: LIKE-экранирование в listTemplates ----------------

describe('WS-15: listTemplates экранирует % и _', () => {
  function tpl(id: string, title: string): TemplateRow {
    return {
      id, author_user_id: 'u1', title, description: '', tags: '[]',
      scenario_json: '{}', created_at: 1, uses_count: 0, likes_count: 0,
    };
  }

  it('шаблон с «%» в названии находится только буквальным запросом', async () => {
    const db = makeDb();
    await insertTemplate(db, tpl('t1', 'Скидка 50% сегодня'));
    await insertTemplate(db, tpl('t2', 'Обычный шаблон'));
    // Буквальный запрос находит нужный.
    const literal = await listTemplates(db, { q: '50%' });
    expect(literal.map((t) => t.id)).toEqual(['t1']);
    // ГОЛЫЙ «%» больше не wildcard: шаблонов с литералом «%» в названии нет
    // кроме t1 — но запрос «%» обязан матчить только его, а не все строки.
    const wildcard = await listTemplates(db, { q: '%' });
    expect(wildcard.map((t) => t.id)).toEqual(['t1']);
  });

  it('«_» в запросе — литерал, а не односимвольный wildcard', async () => {
    const db = makeDb();
    await insertTemplate(db, tpl('t1', 'a_b'));
    await insertTemplate(db, tpl('t2', 'axb'));
    const found = await listTemplates(db, { q: 'a_b' });
    expect(found.map((t) => t.id)).toEqual(['t1']);
  });

  it('обычный поиск не сломан (подстрока, регистр)', async () => {
    const db = makeDb();
    await insertTemplate(db, tpl('t1', 'Магазин ногтей'));
    await insertTemplate(db, tpl('t2', 'Бронирование'));
    expect((await listTemplates(db, { q: 'ногт' })).map((t) => t.id)).toEqual(['t1']);
    expect((await listTemplates(db, {}))).toHaveLength(2);
  });
});
