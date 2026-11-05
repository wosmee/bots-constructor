// data.find/update/remove: SQL-префильтр по search_text + потолок сканирования.
// Фейковый D1 честно исполняет SQL из db.ts: LIKE → includes по search_text,
// ORDER BY created_at DESC, LIMIT, UPDATE/DELETE по id+bot_id, INSERT INTO logs.
// Без префильтра старый код (LIMIT 500 последних строк) не нашёл бы старую
// запись — тесты проверяют именно это отличие.
import { describe, expect, it } from 'vitest';
import { collectionFind, collectionUpdate, collectionRemove } from '../worker/src/db';
import { FIND_HARD_CAP } from '../shared/limits';

type Row = Record<string, unknown>;

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

// search_text mirrors searchTextOf для плоских строковых объектов:
// lowercased-конкатенация значений полей через пробел.
function searchTextOf(data: Row): string {
  return Object.values(data)
    .map((v) => String(v ?? ''))
    .join(' ')
    .trim()
    .toLowerCase();
}

interface ItemRow {
  id: string;
  collection_id: string;
  bot_id: string;
  user_id: number | null;
  data_json: string;
  search_text: string;
  created_at: number;
  updated_at: number;
}

function makeItem(id: string, createdAt: number, data: Row, botId = 'bot1', collectionId = 'col1'): ItemRow {
  return {
    id,
    collection_id: collectionId,
    bot_id: botId,
    user_id: null,
    data_json: JSON.stringify(data),
    search_text: searchTextOf(data),
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function makeScanDb(items: ItemRow[] = []) {
  const recorded: Array<{ sql: string; args: unknown[] }> = [];
  const logs: Array<{ bot_id: string; user_id: number | null; event: string; ts: number }> = [];
  const store: ItemRow[] = items;

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const s = norm(sql);
          return {
            async all<T>() {
              recorded.push({ sql: s, args });
              // SELECT <cols> FROM collection_items WHERE collection_id = ? AND bot_id = ?
              //   [AND search_text LIKE ?]... ORDER BY created_at DESC LIMIT ?
              const sel = s.match(/^SELECT (.+) FROM collection_items WHERE collection_id = \? AND bot_id = \?(.*?) ORDER BY created_at DESC LIMIT \?$/);
              if (!sel) return { results: [] } as { results: T[] };
              const cols = sel[1].split(',').map((c) => c.trim());
              const likeCount = (sel[2].match(/AND search_text LIKE \?/g) ?? []).length;
              // bind-порядок из db.ts: collectionId, botId, ...like-паттерны, limit
              const [collectionId, botId] = args;
              const patterns = args.slice(2, 2 + likeCount) as string[];
              const limit = Number(args[2 + likeCount]);
              let rows = store.filter((r) => r.collection_id === collectionId && r.bot_id === botId);
              for (const p of patterns) {
                // LIKE '%x%' → includes (search_text уже lowercased, паттерн тоже)
                const needle = p.replace(/^%/, '').replace(/%$/, '');
                rows = rows.filter((r) => r.search_text.includes(needle));
              }
              rows = rows.slice().sort((a, b) => b.created_at - a.created_at).slice(0, limit);
              const results = rows.map((r) => {
                const out: Row = {};
                for (const c of cols) out[c] = r[c];
                return out;
              });
              return { results } as { results: T[] };
            },
            async run() {
              recorded.push({ sql: s, args });
              if (s.startsWith('INSERT INTO logs')) {
                logs.push({ bot_id: args[0] as string, user_id: args[1] as number | null, event: args[2] as string, ts: args[3] as number });
                return { meta: { changes: 1 } };
              }
              // UPDATE collection_items SET data_json=?, updated_at=?, search_text=? WHERE id=? AND bot_id=?
              if (s.startsWith('UPDATE collection_items')) {
                const row = store.find((r) => r.id === args[3] && r.bot_id === args[4]);
                if (!row) return { meta: { changes: 0 } };
                row.data_json = args[0] as string;
                row.updated_at = args[1] as number;
                row.search_text = args[2] as string;
                return { meta: { changes: 1 } };
              }
              // DELETE FROM collection_items WHERE id = ? AND bot_id = ?
              if (s.startsWith('DELETE FROM collection_items')) {
                const i = store.findIndex((r) => r.id === args[0] && r.bot_id === args[1]);
                if (i < 0) return { meta: { changes: 0 } };
                store.splice(i, 1);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    // batch — соседний метод prepare; исполняет statement'ы по очереди (урок §18/19).
    async batch(stmts: Array<{ run: () => Promise<unknown> }> = []) {
      const out = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
    __recorded: recorded,
    __logs: logs,
    __store: store,
  };
  return db;
}

const selects = (db: ReturnType<typeof makeScanDb>) => db.__recorded.filter((r) => r.sql.startsWith('SELECT'));

describe('collectionFind: SQL-префильтр находит старые записи', () => {
  it('2000 строк, целевая — самая старая: находится через LIKE-префильтр', async () => {
    const items: ItemRow[] = [makeItem('target', 1, { name: 'target-ancient' })];
    for (let i = 2; i <= 2000; i++) items.push(makeItem(`r${i}`, i, { name: `row-${i}` }));
    const db = makeScanDb(items);

    const out = await collectionFind(db as any, 'bot1', 'col1', { name: 'target-ancient' }, 10);
    expect(out).toEqual([{ name: 'target-ancient' }]);

    // SELECT содержал префильтр и LIMIT-паттерн целился в саму строку.
    const sel = selects(db)[0];
    expect(sel.sql).toContain('AND search_text LIKE ?');
    expect(sel.args).toEqual(['col1', 'bot1', '%target-ancient%', expect.any(Number)]);
  });

  it('кросс-полевое ложное срабатывание отсеивается JS-проверкой', async () => {
    // search_text = 'foo bar' → LIKE '%bar%' матчит, но matches() по полю a — нет.
    const db = makeScanDb([makeItem('x', 1, { a: 'foo', b: 'bar' })]);
    const out = await collectionFind(db as any, 'bot1', 'col1', { a: 'bar' }, 10);
    expect(out).toEqual([]);
    // префильтр действительно был (строка грузилась, отсев случился в JS)
    expect(selects(db)[0].sql).toContain('AND search_text LIKE ?');
  });

  it('пустые значения where не добавляют префильтр', async () => {
    const db = makeScanDb([makeItem('x', 1, { a: 'foo' })]);
    await collectionFind(db as any, 'bot1', 'col1', { a: '  ' }, 10);
    const sel = selects(db)[0];
    expect(sel.sql).not.toContain('LIKE');
    expect(sel.args).toEqual(['col1', 'bot1', expect.any(Number)]);
  });

  it('публичный лимит выдачи не изменился: limit=100 → максимум 50', async () => {
    const items: ItemRow[] = [];
    for (let i = 0; i < 60; i++) items.push(makeItem(`r${i}`, i, { v: 'match-me' }));
    const db = makeScanDb(items);
    const out = await collectionFind(db as any, 'bot1', 'col1', { v: 'match-me' }, 100);
    expect(out).toHaveLength(50);
  });
});

describe('collectionUpdate / collectionRemove: префильтр трогает только совпавшие', () => {
  function mixedRows(): ItemRow[] {
    return [
      makeItem('m1', 10, { city: 'moscow' }),
      makeItem('m2', 20, { city: 'moscow' }),
      makeItem('cross', 30, { city: 'spb', note: 'moscow' }), // LIKE матчит, matches() по city — нет
      makeItem('other', 40, { city: 'kazan' }),
    ];
  }

  it('update патчит только строки, совпавшие по полю (не по search_text)', async () => {
    const db = makeScanDb(mixedRows());
    const n = await collectionUpdate(db as any, 'bot1', 'col1', { city: 'moscow' }, { status: 'ok' });
    expect(n).toBe(2);
    const byId = Object.fromEntries(db.__store.map((r) => [r.id, JSON.parse(r.data_json as string)]));
    expect(byId.m1.status).toBe('ok');
    expect(byId.m2.status).toBe('ok');
    expect(byId.cross.status).toBeUndefined();
    expect(byId.other.status).toBeUndefined();
    // префильтр в SELECT был один — по значению where
    expect(selects(db)[0].args).toEqual(['col1', 'bot1', '%moscow%', expect.any(Number)]);
  });

  it('remove удаляет только строки, совпавшие по полю', async () => {
    const db = makeScanDb(mixedRows());
    const n = await collectionRemove(db as any, 'bot1', 'col1', { city: 'moscow' });
    expect(n).toBe(2);
    expect(db.__store.map((r) => r.id).sort()).toEqual(['cross', 'other']);
  });
});

describe('FIND_HARD_CAP: capped-лог и ровно потолок строк в обработке', () => {
  // Все строки проходят SQL-префильтр (search_text содержит и 'dup', и 'marker'),
  // поэтому SELECT всегда возвращает 5001 строку и cap срабатывает. Различает их
  // только JS-проверка matches():
  //  - «истинное» совпадение {a:'dup', b:'marker'} проходит matches();
  //  - «ложное» {a:'dup marker', b:''} — кросс-полевое: LIKE матчит, matches() нет.
  const TRUE_MATCH = { a: 'dup', b: 'marker' };
  const FALSE_MATCH = { a: 'dup marker', b: '' };
  const WHERE = { a: 'dup', b: 'marker' };

  function cappedRows(trueMatchCreatedAt: number): ItemRow[] {
    const items: ItemRow[] = [];
    for (let i = 0; i <= FIND_HARD_CAP; i++) {
      // created_at 0..5000 → 5001 строка; DESC-сортировка: 5000, ..., 1, 0.
      // После cap остаются created_at 5000..1 (ровно FIND_HARD_CAP самых новых).
      items.push(makeItem(`r${i}`, i, i === trueMatchCreatedAt ? TRUE_MATCH : FALSE_MATCH));
    }
    return items;
  }

  it('5001 совпадение → лог data.scan.capped.5000, LIMIT грузит cap+1', async () => {
    const db = makeScanDb(cappedRows(-1)); // истинных совпадений нет вовсе
    const out = await collectionFind(db as any, 'bot1', 'col1', WHERE, 10);
    expect(out).toEqual([]);
    expect(db.__logs.filter((l) => l.event === `data.scan.capped.${FIND_HARD_CAP}`)).toHaveLength(1);
    // грузили на одну строку больше потолка
    expect(selects(db)[0].args.at(-1)).toBe(FIND_HARD_CAP + 1);
  });

  it('5001-я (самая старая) строка не обрабатывается — верхняя граница окна', async () => {
    // Истинное совпадение — у created_at=0 (самая старая, 5001-я по новизне).
    // Если бы cap не отбросил её, find вернул бы её; обработано ровно 5000 → [].
    const db = makeScanDb(cappedRows(0));
    const out = await collectionFind(db as any, 'bot1', 'col1', WHERE, 10);
    expect(out).toEqual([]);
    expect(db.__logs.some((l) => l.event === `data.scan.capped.${FIND_HARD_CAP}`)).toBe(true);
  });

  it('5000-я по новизне строка обрабатывается — нижняя граница окна', async () => {
    // Истинное совпадение — у created_at=1 (последняя из самых новых 5000 в окне).
    // Если бы окно было уже 5000, она была бы отброшена и find вернул [].
    const db = makeScanDb(cappedRows(1));
    const out = await collectionFind(db as any, 'bot1', 'col1', WHERE, 10);
    expect(out).toEqual([TRUE_MATCH]);
    expect(db.__logs.some((l) => l.event === `data.scan.capped.${FIND_HARD_CAP}`)).toBe(true);
  });
});
