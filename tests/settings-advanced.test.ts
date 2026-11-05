// TASK 12: настройка advanced_blocks (миграция 0020) должна ходить на сервер и
// обратно без потерь: putSettings пишет её в D1, getSettings читает, а старые
// строки без колонки (до миграции) дают false — прежнее поведение палитры.
import { describe, expect, it } from 'vitest';
import { getSettings, putSettings, DEFAULT_SETTINGS } from '../worker/src/db';

type Row = Record<string, unknown>;

// Минимальный фейк D1: одна строка user_settings в памяти.
function fakeDb() {
  let row: Row | null = null;
  const db = {
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.args = args;
          return stmt;
        },
        async first<T>() {
          return (row ? ({ ...row } as T) : null) as T | null;
        },
        async run() {
          if (sql.includes('INSERT INTO user_settings')) {
            // Порядок биндингов — из SQL putSettings (db.ts).
            const [
              user_id,
              theme,
              hints_enabled,
              language,
              feature_whatif,
              feature_conflicts,
              feature_sleep,
              advanced_blocks,
              skill_level,
              palette_mode,
              skill_level_set_at,
              tour_done_at,
              updated_at,
            ] = stmt.args;
            row = {
              user_id,
              theme,
              hints_enabled,
              language,
              feature_whatif,
              feature_conflicts,
              feature_sleep,
              advanced_blocks,
              skill_level,
              palette_mode,
              skill_level_set_at,
              tour_done_at,
              updated_at,
            };
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return db as any;
}

describe('advanced_blocks: round-trip через putSettings/getSettings', () => {
  it('значение по умолчанию — false (прежнее поведение палитры)', () => {
    expect(DEFAULT_SETTINGS.advanced_blocks).toBe(false);
  });

  it('true доходит до базы и читается обратно', async () => {
    const db = fakeDb();
    const saved = await putSettings(db, 'u1', { advanced_blocks: true });
    expect(saved.advanced_blocks).toBe(true);
    const read = await getSettings(db, 'u1');
    expect(read.advanced_blocks).toBe(true);
  });

  it('false выключает флаг обратно, остальные настройки не трогает', async () => {
    const db = fakeDb();
    await putSettings(db, 'u1', { advanced_blocks: true, theme: 'light' });
    const off = await putSettings(db, 'u1', { advanced_blocks: false });
    expect(off.advanced_blocks).toBe(false);
    expect(off.theme).toBe('light'); // соседние поля переживают update
  });

  it('старая строка без колонки (до миграции 0020) читается как false', async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            // Строка без advanced_blocks — как до ALTER TABLE.
            return {
              user_id: 'u2',
              theme: 'dark',
              hints_enabled: 1,
              language: 'ru',
              feature_whatif: 1,
              feature_conflicts: 1,
              feature_sleep: 1,
              skill_level: '',
              palette_mode: 'accordion',
              skill_level_set_at: null,
              tour_done_at: null,
              updated_at: 1,
            };
          },
        };
      },
    } as any;
    const read = await getSettings(db, 'u2');
    expect(read.advanced_blocks).toBe(false);
  });

  it('пустая база — дефолты целиком (advanced_blocks=false)', async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return null;
          },
        };
      },
    } as any;
    const read = await getSettings(db, 'u3');
    expect(read.advanced_blocks).toBe(false);
    expect(read.theme).toBe(DEFAULT_SETTINGS.theme);
  });
});
