import { describe, expect, it } from 'vitest';
import { deleteScenarioVersion, deleteScenarioVersionsExcept, loadPublishedScenario } from '../worker/src/db';

type FakeStatement = {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => FakeStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta: { changes: number } }>;
};

function fakeDb(options: { first?: (sql: string, args: unknown[]) => unknown }): { db: any; statements: FakeStatement[] } {
  const statements: FakeStatement[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        sql,
        args: [],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        async first<T>() {
          return (options.first?.(sql, statement.args) as T | null | undefined) ?? null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      } satisfies FakeStatement;
      statements.push(statement);
      return statement;
    },
  };
  return { db, statements };
}

describe('worker live-version and deletion safety', () => {
  it('fails closed instead of serving the latest draft when no published pointer exists', async () => {
    const { db } = fakeDb({
      first: (sql) => {
        // Билд подсценариев (scenario_builds, 0021): его тоже нет — loader
        // обязан упасть в авторскую версию, а та не опубликована.
        if (sql.includes('FROM scenario_builds sb')) return null;
        if (sql.includes('SELECT s.flow_json')) return null;
        if (sql.includes('SELECT active, published_version')) return { active: 1, published_version: null };
        return { flow_json: '{"draft":true}', version: 7 };
      },
    });

    await expect(loadPublishedScenario(db, 'bot-1')).resolves.toBeNull();
  });

  it('runtime prefers the expanded build row when it exists', async () => {
    const { db } = fakeDb({
      first: (sql) => {
        if (sql.includes('FROM scenario_builds sb')) return { flow_json: '{"expanded":true}', version: 3 };
        return null;
      },
    });
    await expect(loadPublishedScenario(db, 'bot-1')).resolves.toEqual({ flow_json: '{"expanded":true}', version: 3 });
  });

  it('protects current and published versions in the delete statement itself', async () => {
    const { db, statements } = fakeDb({});

    await deleteScenarioVersion(db, 'bot-1', 3);
    await deleteScenarioVersionsExcept(db, 'bot-1', [7, 3]);

    expect(statements[0].sql).toContain('published_version');
    expect(statements[0].sql).toContain('ORDER BY version DESC');
    expect(statements[1].sql).toContain('published_version');
    expect(statements[1].sql).toContain('ORDER BY version DESC');
  });
});
