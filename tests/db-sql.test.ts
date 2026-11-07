// DH-03: db.ts — SQL-исполнение ключевых функций на фейковом D1.
// better-sqlite3 в проекте нет, поэтому D1 подменяется in-memory моком:
//  - round-trip insertAccount → getAccountByLogin исполняется по-настоящему
//    (мини-хранилище строк accounts, фильтр по bind-аргументу);
//  - createSupportTicket проверяется на факте исполнения обоих INSERT'ов
//    одним db.batch с правильными аргументами;
//  - deleteBotCascade / deleteAccountCascade — каскады без внешних ключей,
//    поэтому сверяем полный набор целевых таблиц и bind-параметры: без FK
//    пропущенная таблица = сироты в проде.
import { describe, expect, it } from 'vitest';
import {
  insertAccount,
  getAccountByLogin,
  createSupportTicket,
  deleteBotCascade,
  deleteAccountCascade,
  type AccountRow,
  type SupportMessageRow,
  type SupportTicketRow,
} from '../worker/src/db';

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

// Фейковый D1: записывает каждый statement и исполняет небольшой набор
// запросов к реальному in-memory хранилищу (таблицы передаются в tables).
type Row = Record<string, unknown>;

function makeSqlDb(tables: Record<string, Row[]> = {}) {
  const recorded: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const s = norm(sql);
          return {
            async first<T>() {
              recorded.push({ sql: s, args });
              // SELECT ... FROM accounts WHERE login = ? — честный фильтр строки.
              const accLogin = s.match(/^SELECT (.+) FROM accounts WHERE login = \?$/);
              if (accLogin) {
                const cols = accLogin[1].split(',').map((c) => c.trim());
                const row = (tables.accounts ?? []).find((r) => r.login === args[0]);
                if (!row) return null as T;
                const out: Row = {};
                for (const c of cols) out[c] = row[c];
                return out as T;
              }
              return null as T;
            },
            async all<T>() {
              recorded.push({ sql: s, args });
              return { results: [] } as { results: T[] };
            },
            async run() {
              recorded.push({ sql: s, args });
              // INSERT INTO accounts (id, login, pass_hash, created_at) VALUES (?,?,?,?)
              const accInsert = s.match(/^INSERT INTO accounts \(([^)]+)\) VALUES /);
              if (accInsert) {
                const cols = accInsert[1].split(',').map((c) => c.trim());
                const row: Row = {};
                cols.forEach((c, i) => (row[c] = args[i]));
                (tables.accounts ??= []).push(row);
                return { meta: { changes: 1 } };
              }
              // DELETE FROM <table> WHERE ... — физически убираем строки по bot_id
              // (или по id у bots), чтобы результат каскада был проверяем.
              const del = s.match(/^DELETE FROM (\w+) WHERE/);
              if (del) {
                const t = tables[del[1]] ?? [];
                const key = del[1] === 'bots' ? 'id' : 'bot_id';
                tables[del[1]] = t.filter((r) => r[key] !== args[0]);
                return { meta: { changes: t.length - tables[del[1]].length } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    // batch — сосед prepare; исполняет statement'ы по очереди (урок раздела 18/19).
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

describe('insertAccount + getAccountByLogin (round-trip)', () => {
  it('записанный аккаунт читается обратно по логину', async () => {
    const db = makeSqlDb();
    const acc: AccountRow = { id: 'u1', login: 'ivan', pass_hash: 'pbkdf2$100000$c2FsdA==$aGFzaA==', created_at: 1700000000000 };
    await insertAccount(db as any, acc);
    const read = await getAccountByLogin(db as any, 'ivan');
    expect(read).toEqual(acc);
  });

  it('чужой логин → null', async () => {
    const db = makeSqlDb();
    await insertAccount(db as any, { id: 'u1', login: 'ivan', pass_hash: 'h', created_at: 1 });
    await expect(getAccountByLogin(db as any, 'someone-else')).resolves.toBeNull();
  });

  it('INSERT bind-ит ровно четыре колонки схемы', async () => {
    const db = makeSqlDb();
    await insertAccount(db as any, { id: 'u2', login: 'mod', pass_hash: 'h2', created_at: 2 });
    const insert = db.__recorded.find((r) => r.sql.startsWith('INSERT INTO accounts'));
    expect(insert!.sql).toBe('INSERT INTO accounts (id, login, pass_hash, created_at) VALUES (?,?,?,?)');
    expect(insert!.args).toEqual(['u2', 'mod', 'h2', 2]);
  });
});

describe('createSupportTicket', () => {
  function ticket(overrides: Partial<SupportTicketRow> = {}): SupportTicketRow {
    return {
      id: 't1',
      author_user_id: 'u1',
      author_login: 'ivan',
      bot_id: null,
      kind: 'bug',
      subject: 'Не работает',
      status: 'new',
      assignee_user_id: null,
      created_at: 1000,
      updated_at: 1000,
      last_message_at: 1000,
      ...overrides,
    };
  }

  function message(ticketId: string): SupportMessageRow {
    return {
      id: 'm1',
      ticket_id: ticketId,
      author_role: 'user',
      author_user_id: 'u1',
      author_login: 'ivan',
      body: 'подробности',
      created_at: 1000,
    };
  }

  it('одним batch создаёт тикет И первое сообщение', async () => {
    const db = makeSqlDb();
    await createSupportTicket(db as any, ticket(), message('t1'));

    const ticketInsert = db.__recorded.find((r) => r.sql.includes('INSERT INTO support_tickets'));
    const msgInsert = db.__recorded.find((r) => r.sql.includes('INSERT INTO support_messages'));
    expect(ticketInsert).toBeTruthy();
    expect(msgInsert).toBeTruthy();
    expect(ticketInsert!.args).toEqual(['t1', 'u1', 'ivan', null, 'bug', 'Не работает', 'new', null, 1000, 1000, 1000]);
    expect(msgInsert!.args).toEqual(['m1', 't1', 'user', 'u1', 'ivan', 'подробности', 1000]);
  });

  it('номер выдаётся подзапросом MAX+1 внутри INSERT', async () => {
    const db = makeSqlDb();
    await createSupportTicket(db as any, ticket(), message('t1'));
    const ticketInsert = db.__recorded.find((r) => r.sql.includes('INSERT INTO support_tickets'));
    expect(ticketInsert!.sql).toContain('(SELECT COALESCE(MAX(number), 0) + 1 FROM support_tickets)');
  });
});

describe('deleteBotCascade', () => {
  it('чистит все дочерние таблицы и саму строку бота', async () => {
    const db = makeSqlDb();
    await deleteBotCascade(db as any, 'bot1');

    const deleted = db.__recorded
      .filter((r) => r.sql.startsWith('DELETE FROM'))
      .map((r) => ({ table: r.sql.match(/^DELETE FROM (\w+)/)![1], args: r.args }));

    // Полный список из db.ts: без FK пропуск любой таблицы = сироты.
    const childTables = [
      'scenarios',
      'sessions',
      'logs',
      'subscribers',
      'scheduled_sends',
      'referrals',
      'collections',
      'collection_items',
      'user_tags',
      'scenario_drafts',
      'payment_orders',
      'payment_connections',
      'scenario_builds',
      'mini_apps',
      'mini_app_usage',
      'mini_payments',
      'bot_webhooks',
    ];
    for (const t of childTables) {
      const hit = deleted.find((d) => d.table === t);
      expect(hit, `нет DELETE FROM ${t}`).toBeTruthy();
      expect(hit!.args).toEqual(['bot1']);
    }
    // mini_app_versions без bot_id — чистится подзапросом по mini_apps бота.
    const versions = deleted.find((d) => d.table === 'mini_app_versions');
    expect(versions, 'нет DELETE FROM mini_app_versions').toBeTruthy();
    expect(versions!.args).toEqual(['bot1']);
    // Строка бота — последним DELETE'ом по id (не по bot_id).
    const botDelete = deleted.find((d) => d.table === 'bots');
    expect(botDelete!.args).toEqual(['bot1']);
    expect(deleted[deleted.length - 1].table).toBe('bots');
  });

  it('мини-аппы: versions удаляются РАНЬШЕ mini_apps (подзапрос опирается на живые mini_apps)', async () => {
    const db = makeSqlDb();
    await deleteBotCascade(db as any, 'bot1');
    const deletes = db.__recorded.filter((r) => r.sql.startsWith('DELETE FROM')).map((r) => r.sql);
    const iVersions = deletes.findIndex((s) => s.startsWith('DELETE FROM mini_app_versions'));
    const iApps = deletes.findIndex((s) => s.startsWith('DELETE FROM mini_apps '));
    expect(iVersions).toBeGreaterThanOrEqual(0);
    expect(iApps).toBeGreaterThanOrEqual(0);
    expect(iVersions).toBeLessThan(iApps);
    expect(deletes[iVersions]).toContain('mini_app_id IN (SELECT id FROM mini_apps WHERE bot_id = ?)');
  });

  it('дочерние записи других ботов не трогаются', async () => {
    const db = makeSqlDb({
      sessions: [
        { bot_id: 'bot1', user_id: 1 },
        { bot_id: 'bot2', user_id: 2 },
      ],
      bots: [{ id: 'bot1' }, { id: 'bot2' }],
    });
    await deleteBotCascade(db as any, 'bot1');
    expect(db.__tables.sessions).toEqual([{ bot_id: 'bot2', user_id: 2 }]);
    expect(db.__tables.bots).toEqual([{ id: 'bot2' }]);
  });
});

describe('deleteAccountCascade', () => {
  it('одним batch удаляет всё дерево аккаунта', async () => {
    const db = makeSqlDb();
    await deleteAccountCascade(db as any, 'u1');

    const tables = db.__recorded
      .filter((r) => r.sql.startsWith('DELETE FROM'))
      .map((r) => r.sql.match(/^DELETE FROM (\w+)/)![1]);

    // Порядок важен: дочерние записи до родителей (FK нет, но DELETE по
    // подзапросу SELECT id FROM bots теряет смысл после удаления bots).
    const expected = [
      'support_messages',
      'support_tickets',
      'collection_items',
      'collections',
      'user_tags',
      'scenario_drafts',
      'scenario_builds',
      'payment_orders',
      'payment_connections',
      'sessions',
      'subscribers',
      'scheduled_sends',
      'logs',
      'scenarios',
      'referrals',
      'counters',
      'broadcast_counters',
      'referral_bonuses',
      'referral_payments',
      'referral_tournaments',
      'referral_tournament_entries',
      'bot_schedules',
      'mini_app_versions',
      'mini_apps',
      'mini_app_usage',
      'mini_payments',
      'bot_webhooks',
      'bots',
      'user_settings',
      'templates',
      'subflow_versions',
      'subflows',
      'accounts',
    ];
    expect(tables).toEqual(expected);
    // bots удаляется ПОСЛЕ всех таблиц, которые чистят по подзапросу
    // (SELECT id FROM bots WHERE owner_id = ?).
    expect(tables.indexOf('bots')).toBeGreaterThan(tables.indexOf('scenarios'));
    expect(tables.indexOf('bots')).toBeGreaterThan(tables.indexOf('sessions'));
  });

  it('все bind-параметры — userId (у referrals — трижды: боты + обе стороны связи)', async () => {
    const db = makeSqlDb();
    await deleteAccountCascade(db as any, 'u1');
    for (const r of db.__recorded.filter((x) => x.sql.startsWith('DELETE FROM'))) {
      expect(r.args.every((a) => a === 'u1'), `чужой аргумент в: ${r.sql}`).toBe(true);
    }
    const referrals = db.__recorded.find((r) => r.sql.startsWith('DELETE FROM referrals'));
    expect(referrals!.args).toEqual(['u1', 'u1', 'u1']);
  });

  it('подзапросы скоупятся по owner_id / author_user_id, а не по всей таблице', async () => {
    const db = makeSqlDb();
    await deleteAccountCascade(db as any, 'u9');
    const scenarios = db.__recorded.find((r) => r.sql.startsWith('DELETE FROM scenarios'));
    expect(scenarios!.sql).toContain('bot_id IN (SELECT id FROM bots WHERE owner_id = ?)');
    const tickets = db.__recorded.find((r) => r.sql.startsWith('DELETE FROM support_tickets'));
    expect(tickets!.sql).toContain('author_user_id = ?');
    // Мини-аппы и вебхуки (F-016) скоупятся так же — по ботам владельца.
    for (const t of ['mini_apps', 'mini_app_usage', 'mini_payments', 'bot_webhooks']) {
      const hit = db.__recorded.find((r) => r.sql.startsWith(`DELETE FROM ${t}`));
      expect(hit, `нет DELETE FROM ${t}`).toBeTruthy();
      expect(hit!.sql).toContain('bot_id IN (SELECT id FROM bots WHERE owner_id = ?)');
    }
    const versions = db.__recorded.find((r) => r.sql.startsWith('DELETE FROM mini_app_versions'));
    expect(versions!.sql).toContain('mini_app_id IN (SELECT id FROM mini_apps WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?))');
    // Все четыре — до DELETE FROM bots (после него подзапрос пуст).
    const all = db.__recorded.filter((r) => r.sql.startsWith('DELETE FROM')).map((r) => r.sql.match(/^DELETE FROM (\w+)/)![1]);
    const iBots = all.indexOf('bots');
    for (const t of ['mini_app_versions', 'mini_apps', 'mini_app_usage', 'mini_payments', 'bot_webhooks']) {
      expect(all.indexOf(t), `${t} должен идти до bots`).toBeLessThan(iBots);
    }
  });
});
