import { describe, expect, it } from 'vitest';
import {
  SUPPORT_KINDS,
  SUPPORT_STATUSES,
  normalizeTicketInput,
  canAccessTicket,
  nextTicketStatus,
} from '../worker/src/support';
import { createSupportTicket, listSupportTickets, type SupportMessageRow, type SupportTicketRow } from '../worker/src/db';

describe('support ticket rules', () => {
  it('accepts supported kinds and trims bounded ticket input', () => {
    expect(SUPPORT_KINDS).toEqual(['bug', 'question', 'idea', 'billing', 'abuse', 'other']);
    expect(normalizeTicketInput({ kind: 'bug', subject: '  Не работает  ', body: '  подробности  ' })).toEqual({
      kind: 'bug',
      subject: 'Не работает',
      body: 'подробности',
    });
  });

  it('rejects invalid kinds and out-of-range text', () => {
    expect(normalizeTicketInput({ kind: 'unknown', subject: 'abc', body: 'x' })).toEqual({ error: 'invalid kind' });
    expect(normalizeTicketInput({ kind: 'bug', subject: 'ab', body: 'x' })).toEqual({ error: 'subject length' });
    expect(normalizeTicketInput({ kind: 'bug', subject: 'abc', body: '' })).toEqual({ error: 'body length' });
  });

  it('allows only staff or the ticket author to access a ticket', () => {
    expect(canAccessTicket({ staff: false, actorId: 'u1', authorId: 'u1' })).toBe(true);
    expect(canAccessTicket({ staff: false, actorId: 'u2', authorId: 'u1' })).toBe(false);
    expect(canAccessTicket({ staff: true, actorId: 'u2', authorId: 'u1' })).toBe(true);
  });

  it('keeps status transitions explicit', () => {
    expect(SUPPORT_STATUSES).toEqual(['new', 'in_progress', 'closed']);
    expect(nextTicketStatus('closed', 'user', false)).toBe('new');
    expect(nextTicketStatus('new', 'staff', false)).toBe('in_progress');
    expect(nextTicketStatus('closed', 'staff', false)).toBe('closed');
  });
});

describe('support ticket persistence', () => {
  it('uses the same filters for count and page query', async () => {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            statements.push({ sql, args });
            return {
              first: async () => ({ n: 1 }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    } as any;
    await listSupportTickets(db, { status: 'new', q: 'foo' });
    expect(statements).toHaveLength(2);
    expect(statements[0].args).toEqual(statements[1].args.slice(0, -2));
  });
});

// ---------------- B3: сквозные номера обращений (миграция 0023) ----------------

function ticket(overrides: Partial<SupportTicketRow> = {}): SupportTicketRow {
  const now = Date.now();
  return {
    id: `t_${now}`,
    author_user_id: 'u1',
    author_login: 'ivan',
    bot_id: null,
    kind: 'question',
    subject: 'Тест',
    status: 'new',
    assignee_user_id: null,
    created_at: now,
    updated_at: now,
    last_message_at: now,
    ...overrides,
  };
}

function message(ticketId: string): SupportMessageRow {
  return {
    id: `m_${ticketId}`,
    ticket_id: ticketId,
    author_role: 'user',
    author_user_id: 'u1',
    author_login: 'ivan',
    body: 'текст',
    created_at: Date.now(),
  };
}

// Мини-SQLite на регулярках: понимает INSERT в support_tickets с подзапросом
// MAX+1, SELECT * FROM support_tickets и COUNT(*) — ровно то, что нужно, чтобы
// доказать монотонность нумерации и отказ уникального индекса на дубликат.
function makeNumberDb() {
  const rows: Array<SupportTicketRow & { number: number }> = [];
  let nextFailDuplicate = false;
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes('INSERT INTO support_tickets')) {
                // Номер считается как в настоящем SQL: MAX+1 на момент вставки.
                const num = rows.reduce((m, r) => Math.max(m, r.number), 0) + 1;
                if (rows.some((r) => r.number === num) || nextFailDuplicate) {
                  // Уникальный индекс idx_support_tickets_number отклоняет дубликат.
                  nextFailDuplicate = false;
                  throw new Error('D1_ERROR: UNIQUE constraint failed: support_tickets.number');
                }
                const [id, author_user_id, author_login, bot_id, kind, subject, status, assignee_user_id, created_at, updated_at, last_message_at] = args;
                rows.push({
                  id: String(id), author_user_id: String(author_user_id), author_login: String(author_login),
                  bot_id: bot_id == null ? null : String(bot_id), kind: String(kind), subject: String(subject),
                  status: status as any, assignee_user_id: assignee_user_id == null ? null : String(assignee_user_id),
                  created_at: Number(created_at), updated_at: Number(updated_at), last_message_at: Number(last_message_at),
                  number: num,
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              if (sql.includes('FROM support_tickets WHERE id = ?')) {
                return rows.find((r) => r.id === args[0]) ?? null;
              }
              return null;
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
    // db.batch получает уже связанные statement'ы — исполняем их по очереди.
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    __rows: rows,
    __failDuplicateOnce() { nextFailDuplicate = true; },
  };
  return db;
}

describe('номера обращений (B3)', () => {
  it('номер выдаётся атомарно внутри INSERT подзапросом MAX+1', async () => {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            statements.push({ sql, args });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
      // S5-04: batch исполняет statement'ы (запись идёт через bind(), который
      // уже фиксирует sql+args в statements — исполнение делает проверку честной).
      batch: async (stmts: any[]) => { const out = []; for (const s of stmts) out.push(await s?.run?.()); return out; },
    } as any;
    await createSupportTicket(db, ticket(), message('t_x'));
    const insert = statements.find((s) => s.sql.includes('INSERT INTO support_tickets'));
    expect(insert).toBeTruthy();
    expect(insert!.sql).toContain('number');
    expect(insert!.sql).toContain('(SELECT COALESCE(MAX(number), 0) + 1 FROM support_tickets)');
  });

  it('два тикета подряд получают последовательные номера', async () => {
    const db = makeNumberDb();
    const t1 = ticket({ id: 't_a' });
    const t2 = ticket({ id: 't_b' });
    await createSupportTicket(db as any, t1, message('t_a'));
    await createSupportTicket(db as any, t2, message('t_b'));
    expect(db.__rows.map((r) => r.number)).toEqual([1, 2]);
  });

  it('уникальный индекс отклоняет дубликат номера', async () => {
    const db = makeNumberDb();
    await createSupportTicket(db as any, ticket({ id: 't_a' }), message('t_a'));
    db.__failDuplicateOnce();
    await expect(createSupportTicket(db as any, ticket({ id: 't_b' }), message('t_b'))).rejects.toThrow(/UNIQUE/i);
  });

  it('«123» и «#123» в q матчат тикет 123, легаси-NULL — нет', async () => {
    for (const q of ['123', '#123']) {
      const statements: Array<{ sql: string; args: unknown[] }> = [];
      const db = {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              statements.push({ sql, args });
              return { first: async () => ({ n: 0 }), all: async () => ({ results: [] }) };
            },
          };
        },
      } as any;
      await listSupportTickets(db, { q });
      const pageQuery = statements.find((s) => s.sql.includes('ORDER BY t.last_message_at DESC'));
      expect(pageQuery, `q=${q}`).toBeTruthy();
      expect(pageQuery!.sql).toContain('t.number = ?');
      expect(pageQuery!.args).toContain(123);
    }
    // Обычный текст НЕ превращается в числовой матчер: LIKE-ветка как раньше.
    const statements2: Array<{ sql: string; args: unknown[] }> = [];
    const db2 = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            statements2.push({ sql, args });
            return { first: async () => ({ n: 0 }), all: async () => ({ results: [] }) };
          },
        };
      },
    } as any;
    await listSupportTickets(db2, { q: 'не работает кнопка' });
    const pageQuery = statements2.find((s) => s.sql.includes('ORDER BY t.last_message_at DESC'));
    expect(pageQuery!.sql).not.toContain('t.number = ?');
  });

  it('явный фильтр number=123 даёт точный матчер, number=abc — пустую выборку', async () => {
    const s1: Array<{ sql: string; args: unknown[] }> = [];
    const db1 = {
      prepare(sql: string) {
        return { bind(...args: unknown[]) { s1.push({ sql, args }); return { first: async () => ({ n: 0 }), all: async () => ({ results: [] }) }; } };
      },
    } as any;
    await listSupportTickets(db1, { number: '123' });
    expect(s1[0].sql).toContain('t.number = ?');
    expect(s1[0].args).toContain(123);

    const s2: Array<{ sql: string; args: unknown[] }> = [];
    const db2 = {
      prepare(sql: string) {
        return { bind(...args: unknown[]) { s2.push({ sql, args }); return { first: async () => ({ n: 0 }), all: async () => ({ results: [] }) }; } };
      },
    } as any;
    await listSupportTickets(db2, { number: 'abc' });
    expect(s2[0].sql).toContain('1 = 0');
  });

  it('легаси-тикет без номера: ticketLabel даёт короткий id, не пустой «#»', async () => {
    const { ticketLabel } = await import('../web/src/api');
    expect(ticketLabel({ id: 't_108a2092-81c3-40fd', number: null })).toBe('108a2092');
    expect(ticketLabel({ id: 't_ab12', number: undefined })).toBe('ab12');
    expect(ticketLabel({ id: 't_108a2092', number: 42 })).toBe('#42');
  });
});
