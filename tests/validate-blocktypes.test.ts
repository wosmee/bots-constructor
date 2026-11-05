// Контракт F-019: BLOCK_TYPES в shared/validate.ts обязан совпадать с union
// BlockType в shared/types.ts. Дрейф (добавили тип в union, забыли в список
// валидатора) ломает публикацию сценариев в проде — см. docs/AUDIT-2026-10-18.md
// (F-018: 8 блоков набора 2026-10 отвергались как unknown-type 17 дней).
// Union парсим из исходника текстом, чтобы тест ловил расхождение без правок.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { BLOCK_TYPES, validateScenario } from '../shared/validate';

const typesSource = readFileSync(fileURLToPath(new URL('../shared/types.ts', import.meta.url)), 'utf8');

// Объявление `export type BlockType = ... | 'last';` — до закрывающей `';`
// (не до любой `;`: в комментариях union встречается точка с запятой).
function parseBlockTypeUnion(): string[] {
  const m = typesSource.match(/export type BlockType =([\s\S]*?');/);
  if (!m) throw new Error('union BlockType не найден в shared/types.ts');
  const names = [...m[1].matchAll(/\|\s*'([^']+)'/g)].map((x) => x[1]);
  if (names.length === 0) throw new Error('union BlockType распарсен пустым');
  return names;
}

describe('контракт: BLOCK_TYPES === union BlockType', () => {
  const union = parseBlockTypeUnion();

  it('каждый BlockType из types.ts присутствует в BLOCK_TYPES', () => {
    const missing = union.filter((t) => !BLOCK_TYPES.includes(t as never));
    expect(missing).toEqual([]);
  });

  it('в BLOCK_TYPES нет типов, которых нет в union', () => {
    const extra = BLOCK_TYPES.filter((t) => !union.includes(t));
    expect(extra).toEqual([]);
  });

  it('ни там, ни там нет дубликатов', () => {
    expect(new Set(union).size).toBe(union.length);
    expect(new Set(BLOCK_TYPES).size).toBe(BLOCK_TYPES.length);
  });
});

// Регрессия F-018 (адаптация tmp/audit-2026-10-18/s4/repro-unknown-type.test.ts):
// минимальный сценарий с каждым из 8 блоков набора 2026-10 проходит
// validateScenario без замечания unknown-type.
const base = () => ({ start: { id: 'start', type: 'start' as const, params: {}, next: 'q' } });

const cases: Record<string, any> = {
  quiz: { ...base(), q: { id: 'q', type: 'quiz', params: { question: '?', pollOptions: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionId: 'a' }, branches: { passed: '', failed: '' } } },
  location: { ...base(), q: { id: 'q', type: 'location', params: {}, branches: { sent: '', declined: '' } } },
  edit_message: { ...base(), q: { id: 'q', type: 'edit_message', params: {}, branches: { ok: '' } } },
  delete_message: { ...base(), q: { id: 'q', type: 'delete_message', params: {}, next: '' } },
  language: { ...base(), q: { id: 'q', type: 'language', params: {}, branches: { fallback: '' } } },
  timer_deadline: { ...base(), q: { id: 'q', type: 'timer_deadline', params: {}, branches: { done: '' } } },
  ai_classify: { ...base(), q: { id: 'q', type: 'ai_classify', params: {}, branches: { fallback: '' } } },
  webhook_in: { ...base(), q: { id: 'q', type: 'webhook_in', params: {}, next: '' } },
};

describe('регрессия F-018: блоки набора 2026-10 не отвергаются как unknown-type', () => {
  for (const [name, blocks] of Object.entries(cases)) {
    it(`${name}: валидатор не считает тип неизвестным`, () => {
      const issues = validateScenario({ version: 1, start: 'start', blocks } as any);
      const unknown = issues.filter((i) => i.code === 'unknown-type');
      expect(unknown.map((i) => i.message)).toEqual([]);
    });
  }
});
