// Миграция 0030 (платформы) на реальном SQLite: цепочка 0001..0030 применяется
// без ошибок, новые колонки появляются с правильными дефолтами, существующие
// строки остаются 'telegram'. Паттерн node:sqlite — из tests/migration-0029.test.ts.
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

describe('миграция 0030_platform_vk.sql', () => {
  it('вся цепочка миграций 0001..0030 применяется без ошибок', () => {
    const db = makeDb();
    expect(() => applyFiles(db, migrationFiles())).not.toThrow();
  });

  it('колонки платформы существуют с нужными дефолтами; повторное применение не падает', () => {
    const db = makeDb();
    applyFiles(db, migrationFiles());
    const cols = db.prepare("PRAGMA table_info(bots)").all() as { name: string; dflt_value: string | null; notnull: number }[];
    const platform = cols.find((c) => c.name === 'platform');
    const groupId = cols.find((c) => c.name === 'vk_group_id');
    const confirmation = cols.find((c) => c.name === 'vk_confirmation');
    const screenName = cols.find((c) => c.name === 'vk_screen_name');
    expect(platform?.dflt_value).toBe("'telegram'");
    expect(platform?.notnull).toBe(1);
    expect(groupId).toBeDefined();
    expect(confirmation).toBeDefined();
    expect(screenName).toBeDefined();
  });

  it('существующие боты остаются telegram (дефолт применяется к старым строкам)', () => {
    const db = makeDb();
    applyFiles(db, migrationFiles('0030_platform_vk.sql'));
    db.prepare("INSERT INTO bots (id, owner_id, name, token_enc, webhook_secret, active, created_at) VALUES ('b1','o','n','t','s',1,1)").run();
    applyFiles(db, ['0030_platform_vk.sql']);
    const row = db.prepare('SELECT platform, vk_group_id, vk_confirmation, vk_screen_name FROM bots WHERE id = ?').get('b1') as any;
    expect(row.platform).toBe('telegram');
    expect(row.vk_group_id).toBeNull();
    expect(row.vk_confirmation).toBeNull();
    expect(row.vk_screen_name).toBeNull();
  });
});
