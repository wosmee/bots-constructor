// Мини-аппы: db-слой (миграция 0025) на фейковом D1.
// better-sqlite3 в проекте нет, поэтому D1 подменяется in-memory моком
// (паттерн tests/db-sql.test.ts): prepare И batch — СОСЕДНИЕ методы объекта db,
// batch реально прогоняет statement'ы (урок разделов 18/19) — иначе проверки
// publish/delete были бы фиктивными. Мок исполняет ровно те запросы, которые
// шлёт db.ts: UNIQUE(bot_id, slug) эмулируется броском, COALESCE(MAX(revision),0)
// считается по строкам мини-хранилища.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMiniApp,
  getMiniApp,
  getMiniAppBySlug,
  listMiniAppsByBot,
  updateMiniAppDraft,
  publishMiniApp,
  listMiniAppVersions,
  getMiniAppVersion,
  deleteMiniApp,
  type MiniAppRow,
} from '../worker/src/db';

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

type Row = Record<string, unknown>;

function makeMiniDb(tables: Record<string, Row[]> = { mini_apps: [], mini_app_versions: [] }) {
  const recorded: Array<{ sql: string; args: unknown[]; kind: string }> = [];

  const colListOf = (sql: string) => (sql.match(/\(([^)]+)\)\s*VALUES/i)?.[1] ?? '').split(',').map((c) => c.trim());

  function first(s: string, args: unknown[]): Row | null {
    if (s === 'SELECT * FROM mini_apps WHERE id = ?') {
      return tables.mini_apps.find((r) => r.id === args[0]) ?? null;
    }
    if (s === 'SELECT * FROM mini_apps WHERE bot_id = ? AND slug = ?') {
      return tables.mini_apps.find((r) => r.bot_id === args[0] && r.slug === args[1]) ?? null;
    }
    if (s === 'SELECT id FROM mini_apps WHERE id = ?') {
      const row = tables.mini_apps.find((r) => r.id === args[0]);
      return row ? { id: row.id } : null;
    }
    if (s === 'SELECT COALESCE(MAX(revision), 0) AS rev FROM mini_app_versions WHERE mini_app_id = ?') {
      const revs = tables.mini_app_versions.filter((r) => r.mini_app_id === args[0]).map((r) => Number(r.revision));
      return { rev: revs.length ? Math.max(...revs) : 0 };
    }
    if (s === 'SELECT published_json FROM mini_app_versions WHERE mini_app_id = ? AND revision = ?') {
      const row = tables.mini_app_versions.find((r) => r.mini_app_id === args[0] && Number(r.revision) === Number(args[1]));
      return row ? { published_json: row.published_json } : null;
    }
    return null;
  }

  function all(s: string, args: unknown[]): Row[] {
    if (s === 'SELECT * FROM mini_apps WHERE bot_id = ? ORDER BY created_at DESC') {
      return tables.mini_apps
        .filter((r) => r.bot_id === args[0])
        .sort((a, b) => Number(b.created_at) - Number(a.created_at));
    }
    if (s === 'SELECT id, revision, created_at FROM mini_app_versions WHERE mini_app_id = ? ORDER BY revision DESC') {
      return tables.mini_app_versions
        .filter((r) => r.mini_app_id === args[0])
        .sort((a, b) => Number(b.revision) - Number(a.revision))
        .map((r) => ({ id: r.id, revision: r.revision, created_at: r.created_at }));
    }
    return [];
  }

  function run(s: string, args: unknown[]): Row {
    if (s.startsWith('INSERT INTO mini_apps ')) {
      const cols = colListOf(s);
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = args[i]));
      // UNIQUE(bot_id, slug) из миграции 0025.
      const dup = tables.mini_apps.find((r) => r.bot_id === row.bot_id && r.slug === row.slug);
      if (dup) throw new Error('D1_ERROR: UNIQUE constraint failed: mini_apps.bot_id, mini_apps.slug');
      tables.mini_apps.push(row);
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('INSERT INTO mini_app_versions ')) {
      const cols = colListOf(s);
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = args[i]));
      const dup = tables.mini_app_versions.find(
        (r) => r.mini_app_id === row.mini_app_id && Number(r.revision) === Number(row.revision)
      );
      if (dup) throw new Error('D1_ERROR: UNIQUE constraint failed: mini_app_versions.mini_app_id, mini_app_versions.revision');
      tables.mini_app_versions.push(row);
      return { meta: { changes: 1 } };
    }
    if (s === 'UPDATE mini_apps SET name = ?, draft_json = ?, updated_at = ? WHERE id = ?') {
      const row = tables.mini_apps.find((r) => r.id === args[3]);
      if (row) {
        row.name = args[0];
        row.draft_json = args[1];
        row.updated_at = args[2];
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (s === 'UPDATE mini_apps SET draft_json = ?, updated_at = ? WHERE id = ?') {
      const row = tables.mini_apps.find((r) => r.id === args[2]);
      if (row) {
        row.draft_json = args[0];
        row.updated_at = args[1];
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (s === 'UPDATE mini_apps SET published_json = ?, updated_at = ? WHERE id = ?') {
      const row = tables.mini_apps.find((r) => r.id === args[2]);
      if (row) {
        row.published_json = args[0];
        row.updated_at = args[1];
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (s === 'DELETE FROM mini_app_versions WHERE mini_app_id = ?') {
      const before = tables.mini_app_versions.length;
      tables.mini_app_versions = tables.mini_app_versions.filter((r) => r.mini_app_id !== args[0]);
      return { meta: { changes: before - tables.mini_app_versions.length } };
    }
    if (s === 'DELETE FROM mini_apps WHERE id = ?') {
      const before = tables.mini_apps.length;
      tables.mini_apps = tables.mini_apps.filter((r) => r.id !== args[0]);
      return { meta: { changes: before - tables.mini_apps.length } };
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

// Детерминированное время: updated_at обязан РАСТИ, а не полагаться на
// разные миллисекунды реального Date.now(). Спаем пересоздаётся на каждый
// тест: mockRestore() ОТЦЕПЛЯЕТ спаю от Date.now, и повторный
// mockReturnValue старого экземпляра уже не действует (наступлено здесь).
let nowValue = 1_000;
let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  nowValue = 1_000;
  nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowValue);
});

function tick(delta = 10): number {
  nowValue += delta;
  nowSpy.mockReturnValue(nowValue);
  return nowValue;
}

afterEach(() => {
  nowSpy.mockRestore();
});

function args(overrides: Partial<Parameters<typeof createMiniApp>[1]> = {}) {
  return {
    id: 'ma1',
    botId: 'bot1',
    ownerId: 'u1',
    name: 'Витрина',
    slug: 'shop',
    accessRuleJson: '{"kind":"all"}',
    draftJson: '{"version":1,"pages":[],"tabbar":{"enabled":false,"tabs":[]},"startPageId":"p1"}',
    ...overrides,
  };
}

describe('createMiniApp + getMiniApp', () => {
  it('созданный апп читается обратно по id со всеми колонками', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    const row = (await getMiniApp(db as any, 'ma1')) as MiniAppRow | null;
    expect(row).not.toBeNull();
    expect(row!.id).toBe('ma1');
    expect(row!.bot_id).toBe('bot1');
    expect(row!.owner_id).toBe('u1');
    expect(row!.name).toBe('Витрина');
    expect(row!.slug).toBe('shop');
    expect(row!.access_rule_json).toBe('{"kind":"all"}');
    expect(row!.draft_json).toContain('"startPageId":"p1"');
    expect(row!.published_json).toBeNull();
    expect(row!.created_at).toBe(nowValue);
    expect(row!.updated_at).toBe(nowValue);
  });

  it('неизвестный id → null', async () => {
    const db = makeMiniDb();
    await expect(getMiniApp(db as any, 'nope')).resolves.toBeNull();
  });

  it('getMiniAppBySlug ищет по паре bot_id+slug, чужой slug того же бота не отдаёт', async () => {
    const db = makeMiniDb();
    await createMiniApp(db as any, args());
    await createMiniApp(db as any, args({ id: 'ma2', slug: 'support' }));
    const bySlug = await getMiniAppBySlug(db as any, 'bot1', 'support');
    expect(bySlug?.id).toBe('ma2');
    await expect(getMiniAppBySlug(db as any, 'bot1', 'missing')).resolves.toBeNull();
    await expect(getMiniAppBySlug(db as any, 'bot2', 'support')).resolves.toBeNull();
  });

  it('listMiniAppsByBot возвращает только аппы своего бота', async () => {
    const db = makeMiniDb();
    await createMiniApp(db as any, args());
    await createMiniApp(db as any, args({ id: 'ma2', slug: 'support' }));
    await createMiniApp(db as any, args({ id: 'ma3', botId: 'bot2' }));
    const list = await listMiniAppsByBot(db as any, 'bot1');
    expect(list.map((r) => r.id).sort()).toEqual(['ma1', 'ma2']);
  });
});

describe('slug-уникальность', () => {
  it('вторая create с тем же bot_id+slug падает (UNIQUE constraint)', async () => {
    const db = makeMiniDb();
    await createMiniApp(db as any, args());
    await expect(createMiniApp(db as any, args({ id: 'ma2' }))).rejects.toThrow(/UNIQUE constraint/);
    expect(db.__tables.mini_apps).toHaveLength(1);
  });

  it('тот же slug у другого бота разрешён', async () => {
    const db = makeMiniDb();
    await createMiniApp(db as any, args());
    await expect(createMiniApp(db as any, args({ id: 'ma2', botId: 'bot2' }))).resolves.toBeUndefined();
    expect(db.__tables.mini_apps).toHaveLength(2);
  });
});

describe('updateMiniAppDraft', () => {
  it('меняет draft_json и поднимает updated_at', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    const t2 = tick();
    await updateMiniAppDraft(db as any, 'ma1', '{"version":1,"pages":[{"id":"p1"}]}');
    const row = (await getMiniApp(db as any, 'ma1')) as MiniAppRow;
    expect(row.draft_json).toBe('{"version":1,"pages":[{"id":"p1"}]}');
    expect(row.updated_at).toBe(t2);
    expect(row.updated_at).toBeGreaterThan(row.created_at);
    expect(row.name).toBe('Витрина'); // без name — имя не трогается
  });

  it('с name — обновляет и имя', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    tick();
    await updateMiniAppDraft(db as any, 'ma1', '{}', 'Магазин');
    const row = (await getMiniApp(db as any, 'ma1')) as MiniAppRow;
    expect(row.name).toBe('Магазин');
    expect(row.draft_json).toBe('{}');
  });
});

describe('publishMiniApp', () => {
  it('первый publish → revision 1: пишет published_json в апп и снапшот в версии', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    tick();
    const rev = await publishMiniApp(db as any, 'ma1', '{"v":"pub1"}');
    expect(rev).toBe(1);
    const row = (await getMiniApp(db as any, 'ma1')) as MiniAppRow;
    expect(row.published_json).toBe('{"v":"pub1"}');
    const versions = db.__tables.mini_app_versions;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: 'ma1:1',
      mini_app_id: 'ma1',
      revision: 1,
      published_json: '{"v":"pub1"}',
    });
  });

  it('второй publish растит revision и не перезаписывает историю', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    tick();
    expect(await publishMiniApp(db as any, 'ma1', '{"v":"pub1"}')).toBe(1);
    tick();
    expect(await publishMiniApp(db as any, 'ma1', '{"v":"pub2"}')).toBe(2);
    const row = (await getMiniApp(db as any, 'ma1')) as MiniAppRow;
    expect(row.published_json).toBe('{"v":"pub2"}');
    expect(db.__tables.mini_app_versions).toHaveLength(2);
    // Старый снапшот жив и читается по revision.
    await expect(getMiniAppVersion(db as any, 'ma1', 1)).resolves.toBe('{"v":"pub1"}');
    await expect(getMiniAppVersion(db as any, 'ma1', 2)).resolves.toBe('{"v":"pub2"}');
    await expect(getMiniAppVersion(db as any, 'ma1', 3)).resolves.toBeNull();
    await expect(getMiniAppVersion(db as any, 'other', 1)).resolves.toBeNull();
  });

  it('publish через batch: UPDATE и INSERT исполняются одним батчем', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    const before = db.__recorded.length;
    tick();
    await publishMiniApp(db as any, 'ma1', '{}');
    const stmts = db.__recorded.slice(before);
    // SELECT id (проверка существования), SELECT COALESCE(MAX), UPDATE, INSERT.
    expect(stmts.map((r) => r.kind)).toEqual(['first', 'first', 'run', 'run']);
    expect(stmts[2].sql).toMatch(/^UPDATE mini_apps SET published_json/);
    expect(stmts[3].sql).toMatch(/^INSERT INTO mini_app_versions/);
  });

  it('publish несуществующего аппа → ошибка, снапшотов нет', async () => {
    const db = makeMiniDb();
    await expect(publishMiniApp(db as any, 'ghost', '{}')).rejects.toThrow(/not found/);
    expect(db.__tables.mini_app_versions).toHaveLength(0);
  });

  it('listMiniAppVersions отдаёт id/revision/created_at свежая версия первой', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    tick();
    await publishMiniApp(db as any, 'ma1', '{"v":"pub1"}');
    const t2 = tick();
    await publishMiniApp(db as any, 'ma1', '{"v":"pub2"}');
    const versions = await listMiniAppVersions(db as any, 'ma1');
    expect(versions).toEqual([
      { id: 'ma1:2', revision: 2, created_at: t2 },
      { id: 'ma1:1', revision: 1, created_at: t2 - 10 },
    ]);
    // published_json в списке не светится (тяжёлое поле).
    expect(versions[0]).not.toHaveProperty('published_json');
  });
});

describe('deleteMiniApp', () => {
  it('удаляет апп и все его версии каскадом', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    await createMiniApp(db as any, args({ id: 'ma2', slug: 'support' }));
    tick();
    await publishMiniApp(db as any, 'ma1', '{"v":"pub1"}');
    await publishMiniApp(db as any, 'ma1', '{"v":"pub2"}');
    expect(db.__tables.mini_app_versions).toHaveLength(2);

    await deleteMiniApp(db as any, 'ma1');
    expect(db.__tables.mini_apps.map((r) => r.id)).toEqual(['ma2']);
    expect(db.__tables.mini_app_versions).toHaveLength(0);
    await expect(getMiniApp(db as any, 'ma1')).resolves.toBeNull();
    await expect(getMiniAppVersion(db as any, 'ma1', 1)).resolves.toBeNull();
  });

  it('версии другого аппа не трогаются', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    await createMiniApp(db as any, args({ id: 'ma2', slug: 'support' }));
    tick();
    await publishMiniApp(db as any, 'ma1', '{"v":"pub1"}');
    await publishMiniApp(db as any, 'ma2', '{"v":"other"}');
    await deleteMiniApp(db as any, 'ma1');
    expect(db.__tables.mini_app_versions.map((r) => r.mini_app_id)).toEqual(['ma2']);
  });

  it('delete — одним batch (DELETE версий + DELETE аппа)', async () => {
    const db = makeMiniDb();
    nowSpy.mockReturnValue(nowValue);
    await createMiniApp(db as any, args());
    const before = db.__recorded.length;
    await deleteMiniApp(db as any, 'ma1');
    const stmts = db.__recorded.slice(before);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toBe('DELETE FROM mini_app_versions WHERE mini_app_id = ?');
    expect(stmts[1].sql).toBe('DELETE FROM mini_apps WHERE id = ?');
    expect(stmts[0].args).toEqual(['ma1']);
    expect(stmts[1].args).toEqual(['ma1']);
  });
});
