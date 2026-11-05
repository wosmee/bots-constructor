import { describe, expect, it, vi } from 'vitest';
import { deleteAccountCascade, deleteCollectionItem } from '../worker/src/db';
import { _testOnly } from '../worker/src/index';

type Statement = {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => Statement;
  run: () => Promise<{ meta: { changes: number } }>;
};

function recordingDb() {
  const statements: Statement[] = [];
  return {
    db: {
      prepare(sql: string) {
        const statement: Statement = {
          sql,
          args: [],
          bind(...args: unknown[]) {
            statement.args = args;
            return statement;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
        statements.push(statement);
        return statement;
      },
      async batch(batch: Statement[]) {
        statements.push(...batch.filter((statement) => !statements.includes(statement)));
        return [];
      },
    },
    statements,
  };
}

describe('backend remediation security helpers', () => {
  it.each(['http://[::1]/', 'http://[fd00::1]/', 'http://100.64.0.1/', 'http://169.254.169.254/', 'http://foo.internal/', 'http://foo.local/'])(
    'refuses unsafe scenario URL %s before fetch',
    async (url) => {
      const fetchMock = vi.fn();
      await expect(_testOnly.safeFetch(url, {}, { HTTP_ALLOWED_HOSTS: '' } as any, fetchMock)).rejects.toThrow('адрес недоступен');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('neutralizes formula-looking CSV headers and values before CSV quoting', () => {
    const csv = _testOnly.toCsv(['=header'], [['=1+1', '@SUM(1)', '+1', '-1', '\tfoo', '\rbar']]);
    expect(csv).toContain("'=header");
    for (const value of ['=1+1', '@SUM(1)', '+1', '-1', '\tfoo', '\rbar']) expect(csv).toContain(`'${value}`);
    expect(csv).not.toContain(';=1+1');
  });

  it('returns an empty AI reply on oversized or failed responses', async () => {
    const oversized = new Response('x'.repeat(32), { headers: { 'content-length': '262145' } });
    await expect(_testOnly.aiComplete({ AI_API_KEY: 'key' } as any, '', 'hello', '', async () => oversized)).resolves.toBe('');
    await expect(_testOnly.aiComplete({ AI_API_KEY: 'key' } as any, '', 'hello', '', async () => { throw new Error('offline'); })).resolves.toBe('');
  });
});

describe('backend remediation persistence', () => {
  it('scopes collection-item deletion to the owning bot in SQL', async () => {
    const { db, statements } = recordingDb();
    await deleteCollectionItem(db as any, 'bot-a', 'collection-a', 'item-a');
    expect(statements[0].sql).toContain('collections WHERE bot_id = ?');
    expect(statements[0].args).toEqual(['item-a', 'collection-a', 'bot-a']);
  });

  it('cascades account data in a single D1 batch before deleting the account', async () => {
    const { db, statements } = recordingDb();
    await deleteAccountCascade(db as any, 'user-a');
    expect(statements.at(-1)?.sql).toBe('DELETE FROM accounts WHERE id = ?');
    expect(statements.map((statement) => statement.sql).join('\n')).toContain('DELETE FROM support_messages');
    expect(statements.map((statement) => statement.sql).join('\n')).toContain('DELETE FROM collection_items');
  });
});
