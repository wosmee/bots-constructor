// Справочный слой набора блоков 2026-10: рецепты гайда, поиск по ним
// и explain-тексты восьми новых типов (RU + EN).
import { describe, expect, it } from 'vitest';
import { translate, loadDict, type TKey } from '../web/src/i18n';
import { buildGuideIndex, matchGuide, GUIDE_RECIPES } from '../web/src/guideSearch';
import { describeBlock } from '../web/src/explain';
import type { BlockType } from '../shared/types';

// Новые рецепты набора 2026-10 (id из GUIDE_RECIPES).
const NEW_RECIPE_IDS = ['recipe-deadline', 'recipe-geo', 'recipe-classify', 'recipe-webhook', 'recipe-lang'];

// Восемь новых типов блоков набора 2026-10.
const NEW_TYPES: BlockType[] = [
  'edit_message',
  'delete_message',
  'quiz',
  'language',
  'timer_deadline',
  'ai_classify',
  'webhook_in',
  'location',
];

const INDEX_RU = buildGuideIndex({ t: (key: TKey) => translate('ru', key) });

const ids = (hits: { id: string }[]) => hits.map((h) => h.id);

describe('рецепты набора 2026-10', () => {
  it('все пять рецептов присутствуют в GUIDE_RECIPES', () => {
    const present = new Set(GUIDE_RECIPES.map((r) => r.id));
    for (const id of NEW_RECIPE_IDS) expect(present.has(id), `нет рецепта ${id}`).toBe(true);
  });

  it('title и шаги каждого нового рецепта переводятся в ru и en', async () => {
    await loadDict('en');
    for (const r of GUIDE_RECIPES.filter((x) => NEW_RECIPE_IDS.includes(x.id))) {
      for (const key of [r.title, ...r.steps]) {
        const ru = translate('ru', key);
        const en = translate('en', key);
        expect(ru, `не переведён (ru): ${key}`).not.toBe(key);
        expect(en, `не переведён (en): ${key}`).not.toBe(key);
        expect(ru.length, `пустой ru: ${key}`).toBeGreaterThan(10);
        expect(en.length, `пустой en: ${key}`).toBeGreaterThan(10);
        // EN-фрагмент обязан быть английским, а не копией ключа-заглушки.
        expect(en.startsWith('guide.'), `en похож на ключ: ${key}`).toBe(false);
      }
    }
  });
});

describe('поиск по гайду находит новые рецепты по слову из тела', () => {
  const cases: [string, string][] = [
    ['дедлайн', 'recipe-deadline'],
    ['геопозиция', 'recipe-geo'],
    ['метк', 'recipe-classify'],
    ['вебхук', 'recipe-webhook'],
    ['язык', 'recipe-lang'],
  ];
  for (const [word, expected] of cases) {
    it(`«${word}» → ${expected}`, () => {
      expect(ids(matchGuide(INDEX_RU, word))).toContain(expected);
    });
  }

  it('новый рецепт — запись вкладки «recipes» с переведённым label', () => {
    for (const id of NEW_RECIPE_IDS) {
      const item = INDEX_RU.find((h) => h.id === id);
      expect(item, `нет в индексе: ${id}`).toBeTruthy();
      expect(item!.tab).toBe('recipes');
      expect(item!.label.startsWith('guide.'), `label не переведён: ${id}`).toBe(false);
      expect(item!.haystack.length).toBeGreaterThan(20);
    }
  });
});

describe('explain-тексты восьми новых типов', () => {
  it('describeBlock не пустой и не ключ-заглушка (ru и en)', () => {
    for (const type of NEW_TYPES) {
      for (const lang of ['ru', 'en'] as const) {
        const text = describeBlock({ id: 'b', type, params: {} }, lang);
        expect(text, `пустой explain (${lang}): ${type}`).not.toBe('');
        expect(text.startsWith('block.'), `explain — ключ (${lang}): ${type}`).toBe(false);
        expect(text.length, `подозрительно короткий (${lang}): ${type}`).toBeGreaterThan(20);
      }
    }
  });

  it('с настройками блока explain подставляет их в текст', () => {
    const text = describeBlock(
      { id: 'b', type: 'timer_deadline', params: { deadlineAt: '2026-10-05T12:00', cancelVar: 'paid', deadlineText: 'Слот освобождён' } },
      'ru'
    );
    expect(text).toContain('paid');
    expect(text).toContain('2026-10-05T12:00');
    const classify = describeBlock(
      { id: 'b', type: 'ai_classify', params: { classifyLabels: ['lead', 'question', 'spam'], classifyFallbackLabel: 'other' } },
      'ru'
    );
    expect(classify).toContain('lead');
    expect(classify).toContain('other');
  });

  it('ru и en различаются — это не одна строка на оба языка', () => {
    for (const type of NEW_TYPES) {
      const ru = describeBlock({ id: 'b', type, params: {} }, 'ru');
      const en = describeBlock({ id: 'b', type, params: {} }, 'en');
      expect(ru, `ru == en у ${type}`).not.toBe(en);
    }
  });
});
