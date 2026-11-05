// Глобальный поиск по гайду: индекс, матчинг, группировка и клавиатура —
// чистые функции без DOM и React, чтобы поведение проверялось тестами
// (tests/guide-search.test.ts), а компонент только рисовал результат.
//
// Индекс строится ОДИН раз на язык (в Guide.tsx — useMemo по t), а не на
// каждое нажатие клавиши: записей сотни, переводы читаются при сборке.
import type { BlockType } from '../../shared/types';
import { BLOCK_META, guideTextKey, normalizeSearch } from './blocks';
import { GLOSSARY_TERMS } from './Glossary';
import type { TKey } from './i18n';

export type GuideTab = 'start' | 'blocks' | 'recipes' | 'mini' | 'publish' | 'faq';

// Одна запись поиска: что показываем в списке результатов и куда прыгаем.
export interface GuideHit {
  id: string;
  tab: GuideTab;
  /** Заголовок группы результатов — ключ словаря (переводится при рендере). */
  section: TKey;
  /** Видимый текст записи (уже переведённый — индекс строится на языке). */
  label: string;
  snippet?: string;
  /** id DOM-элемента (data-guide-id) для scrollIntoView. */
  targetId: string;
  /** Для FAQ: какой <details> раскрыть перед скроллом. */
  detailsKey?: string;
}

// Запись индекса = hit + нормализованный текст для матчинга.
export interface GuideIndexItem extends GuideHit {
  haystack: string;
}

// ------------------------------------------------------------------ контент
// Таблицы контента гайда живут здесь, а не в Guide.tsx: индекс и рендер
// обязаны ходить по одному списку, иначе поиск нашёл бы запись, которой
// нет на вкладке (или наоборот). Ключи старых рецептов/FAQ — из базового
// словаря i18n.ts, новых — из i18n.frag.guide.ts.

export interface GuideRecipe {
  /** Стабильный id: React-ключ, data-guide-id и id записи поиска. */
  id: string;
  title: TKey;
  steps: TKey[];
}

export const GUIDE_RECIPES: GuideRecipe[] = [
  { id: 'recipe-menu', title: 'guide.recipe.0.title', steps: ['guide.recipe.0.s0', 'guide.recipe.0.s1', 'guide.recipe.0.s2'] },
  { id: 'recipe-lead', title: 'guide.recipe.1.title', steps: ['guide.recipe.1.s0', 'guide.recipe.1.s1', 'guide.recipe.1.s2', 'guide.recipe.1.s3'] },
  { id: 'recipe-quiz', title: 'guide.recipe.2.title', steps: ['guide.recipe.2.s0', 'guide.recipe.2.s1', 'guide.recipe.2.s2', 'guide.recipe.2.s3'] },
  { id: 'recipe-ai', title: 'guide.recipe.3.title', steps: ['guide.recipe.3.s0', 'guide.recipe.3.s1', 'guide.recipe.3.s2', 'guide.recipe.3.s3'] },
  { id: 'recipe-broadcast', title: 'guide.recipe.4.title', steps: ['guide.recipe.4.s0', 'guide.recipe.4.s1', 'guide.recipe.4.s2'] },
  { id: 'recipe-ab', title: 'guide.recipe.5.title', steps: ['guide.recipe.5.s0', 'guide.recipe.5.s1', 'guide.recipe.5.s2'] },
  // Рецепт «Своя платёжка»: ключи guide.recipe.payments.* зафиксированы
  // контрактом — на них ссылается страница «Оплата» (PaymentsPage).
  {
    id: 'recipe-payments',
    title: 'guide.recipe.payments.title',
    steps: ['guide.recipe.payments.s0', 'guide.recipe.payments.s1', 'guide.recipe.payments.s2', 'guide.recipe.payments.s3'],
  },
  { id: 'recipe-channel', title: 'guide.recipe.channel.title', steps: ['guide.recipe.channel.s0', 'guide.recipe.channel.s1', 'guide.recipe.channel.s2', 'guide.recipe.channel.s3'] },
  { id: 'recipe-remind', title: 'guide.recipe.remind.title', steps: ['guide.recipe.remind.s0', 'guide.recipe.remind.s1', 'guide.recipe.remind.s2'] },
  { id: 'recipe-foreach', title: 'guide.recipe.foreach.title', steps: ['guide.recipe.foreach.s0', 'guide.recipe.foreach.s1', 'guide.recipe.foreach.s2', 'guide.recipe.foreach.s3'] },
  { id: 'recipe-segment', title: 'guide.recipe.segment.title', steps: ['guide.recipe.segment.s0', 'guide.recipe.segment.s1', 'guide.recipe.segment.s2'] },
  { id: 'recipe-editmsg', title: 'guide.recipe.editmsg.title', steps: ['guide.recipe.editmsg.s0', 'guide.recipe.editmsg.s1', 'guide.recipe.editmsg.s2'] },
  { id: 'recipe-markup', title: 'guide.recipe.markup.title', steps: ['guide.recipe.markup.s0', 'guide.recipe.markup.s1', 'guide.recipe.markup.s2', 'guide.recipe.markup.s3', 'guide.recipe.markup.s4', 'guide.recipe.markup.s5', 'guide.recipe.markup.s6', 'guide.recipe.markup.s7'] },
  { id: 'recipe-inputkinds', title: 'guide.recipe.inputkinds.title', steps: ['guide.recipe.inputkinds.s0', 'guide.recipe.inputkinds.s1', 'guide.recipe.inputkinds.s2'] },
  // Подсценарии (библиотека фрагментов): ключи — в i18n.frag.guide.ts.
  { id: 'recipe-subflow-extract', title: 'guide.recipe.subflow.extract.title', steps: ['guide.recipe.subflow.extract.s0', 'guide.recipe.subflow.extract.s1', 'guide.recipe.subflow.extract.s2', 'guide.recipe.subflow.extract.s3'] },
  { id: 'recipe-subflow-update', title: 'guide.recipe.subflow.update.title', steps: ['guide.recipe.subflow.update.s0', 'guide.recipe.subflow.update.s1', 'guide.recipe.subflow.update.s2'] },
  { id: 'recipe-subflow-foreign', title: 'guide.recipe.subflow.foreign.title', steps: ['guide.recipe.subflow.foreign.s0', 'guide.recipe.subflow.foreign.s1', 'guide.recipe.subflow.foreign.s2'] },
  { id: 'recipe-subflow-deleted', title: 'guide.recipe.subflow.deleted.title', steps: ['guide.recipe.subflow.deleted.s0', 'guide.recipe.subflow.deleted.s1', 'guide.recipe.subflow.deleted.s2'] },
  // Набор блоков 2026-10: ключи — в i18n.frag.guide.ts.
  { id: 'recipe-deadline', title: 'guide.recipe.deadline.title', steps: ['guide.recipe.deadline.s0', 'guide.recipe.deadline.s1', 'guide.recipe.deadline.s2', 'guide.recipe.deadline.s3'] },
  { id: 'recipe-geo', title: 'guide.recipe.geo.title', steps: ['guide.recipe.geo.s0', 'guide.recipe.geo.s1', 'guide.recipe.geo.s2', 'guide.recipe.geo.s3'] },
  { id: 'recipe-classify', title: 'guide.recipe.classify.title', steps: ['guide.recipe.classify.s0', 'guide.recipe.classify.s1', 'guide.recipe.classify.s2', 'guide.recipe.classify.s3'] },
  { id: 'recipe-webhook', title: 'guide.recipe.webhook.title', steps: ['guide.recipe.webhook.s0', 'guide.recipe.webhook.s1', 'guide.recipe.webhook.s2', 'guide.recipe.webhook.s3'] },
  { id: 'recipe-lang', title: 'guide.recipe.lang.title', steps: ['guide.recipe.lang.s0', 'guide.recipe.lang.s1', 'guide.recipe.lang.s2', 'guide.recipe.lang.s3'] },
];

export interface GuideFaq {
  id: string;
  q: TKey;
  a: TKey;
}

export const GUIDE_FAQ: GuideFaq[] = [
  { id: 'faq-0', q: 'guide.faq.0.q', a: 'guide.faq.0.a' },
  { id: 'faq-1', q: 'guide.faq.1.q', a: 'guide.faq.1.a' },
  { id: 'faq-2', q: 'guide.faq.2.q', a: 'guide.faq.2.a' },
  { id: 'faq-3', q: 'guide.faq.3.q', a: 'guide.faq.3.a' },
  { id: 'faq-4', q: 'guide.faq.4.q', a: 'guide.faq.4.a' },
  { id: 'faq-5', q: 'guide.faq.5.q', a: 'guide.faq.5.a' },
  { id: 'faq-6', q: 'guide.faq.6.q', a: 'guide.faq.6.a' },
  { id: 'faq-7', q: 'guide.faq.7.q', a: 'guide.faq.7.a' },
  // Новые вопросы набора 2026-09 (ключи — во фрагменте i18n.frag.guide.ts).
  { id: 'faq-pay-secrets', q: 'guide.faq.paysecrets.q', a: 'guide.faq.paysecrets.a' },
  { id: 'faq-callback-twice', q: 'guide.faq.callback.q', a: 'guide.faq.callback.a' },
  { id: 'faq-idempotency', q: 'guide.faq.idempotency.q', a: 'guide.faq.idempotency.a' },
  { id: 'faq-foreach-stuck', q: 'guide.faq.foreach.q', a: 'guide.faq.foreach.a' },
  // Операторы условий: список «в списке» режется по запятой (ES-07).
  { id: 'faq-cond-in', q: 'guide.faq.condin.q', a: 'guide.faq.condin.a' },
  // Подсценарии: копия или ссылка, живой бот и публикация.
  { id: 'faq-subflow-copy', q: 'guide.faq.subflowcopy.q', a: 'guide.faq.subflowcopy.a' },
  { id: 'faq-subflow-live', q: 'guide.faq.subflowlive.q', a: 'guide.faq.subflowlive.a' },
  { id: 'faq-subflow-publish', q: 'guide.faq.subflowpublish.q', a: 'guide.faq.subflowpublish.a' },
];

// ------------------------------------------------------- мини-аппы (фаза C)
// Справочный слой мини-аппов: статьи (шаги) и свои FAQ. Ключи — в блоке
// «мини-аппы» фрагмента i18n.frag.guide.ts. Индекс и рендер вкладки «мини»
// ходят по этим же спискам.

export interface GuideMiniArticle {
  id: string;
  title: TKey;
  steps: TKey[];
}

export const GUIDE_MINI_ARTICLES: GuideMiniArticle[] = [
  {
    id: 'mini-catalog',
    title: 'guide.mini.catalog.title',
    steps: [
      'guide.mini.catalog.s0', 'guide.mini.catalog.s1', 'guide.mini.catalog.s2',
      'guide.mini.catalog.s3', 'guide.mini.catalog.s4', 'guide.mini.catalog.s5',
      'guide.mini.catalog.s6',
    ],
  },
  {
    id: 'mini-admin',
    title: 'guide.mini.admin.title',
    steps: [
      'guide.mini.admin.s0', 'guide.mini.admin.s1', 'guide.mini.admin.s2',
      'guide.mini.admin.s3', 'guide.mini.admin.s4', 'guide.mini.admin.s5',
    ],
  },
  {
    id: 'mini-bot',
    title: 'guide.mini.bot.title',
    steps: [
      'guide.mini.bot.s0', 'guide.mini.bot.s1', 'guide.mini.bot.s2',
      'guide.mini.bot.s3', 'guide.mini.bot.s4',
    ],
  },
  {
    id: 'mini-publish',
    title: 'guide.mini.publish.title',
    steps: [
      'guide.mini.publish.s0', 'guide.mini.publish.s1', 'guide.mini.publish.s2',
      'guide.mini.publish.s3', 'guide.mini.publish.s4',
    ],
  },
];

export const GUIDE_MINI_FAQ: GuideFaq[] = [
  { id: 'faq-mini-outside', q: 'guide.mini.faq.outside.q', a: 'guide.mini.faq.outside.a' },
  { id: 'faq-mini-denied', q: 'guide.mini.faq.denied.q', a: 'guide.mini.faq.denied.a' },
  { id: 'faq-mini-images', q: 'guide.mini.faq.images.q', a: 'guide.mini.faq.images.a' },
  { id: 'faq-mini-oneuser', q: 'guide.mini.faq.oneuser.q', a: 'guide.mini.faq.oneuser.a' },
];

export const GUIDE_PUBLISH_STEPS: TKey[] = [
  'guide.publish.s0',
  'guide.publish.s1',
  'guide.publish.s2',
  'guide.publish.s3',
  'guide.publish.s4',
];

export const GUIDE_CHECKS: { q: TKey; a: TKey }[] = [
  { q: 'guide.check.0.q', a: 'guide.check.0.a' },
  { q: 'guide.check.1.q', a: 'guide.check.1.a' },
  { q: 'guide.check.2.q', a: 'guide.check.2.a' },
  { q: 'guide.check.3.q', a: 'guide.check.3.a' },
  { q: 'guide.check.4.q', a: 'guide.check.4.a' },
  { q: 'guide.check.5.q', a: 'guide.check.5.a' },
  { q: 'guide.check.6.q', a: 'guide.check.6.a' },
];

// Пункты чек-листа: cl1 собран из двух ключей с <code> между ними.
export const GUIDE_CL_ITEMS: { id: string; keys: TKey[] }[] = [
  { id: 'publish-cl0', keys: ['guide.publish.cl0'] },
  { id: 'publish-cl1', keys: ['guide.publish.cl1.a', 'guide.publish.cl1.b'] },
  { id: 'publish-cl2', keys: ['guide.publish.cl2'] },
  { id: 'publish-cl3', keys: ['guide.publish.cl3'] },
];

// Секции стартовой вкладки: одна запись поиска на секцию, текст — сумма
// всех ключей внутри. JSX старта остаётся в Guide.tsx, здесь только ключи.
export const GUIDE_START_SECTIONS: { id: string; title: TKey; keys: TKey[] }[] = [
  {
    id: 'start-main',
    title: 'guide.start.title',
    keys: [
      'guide.beginner.first',
      'guide.beginner.first.text',
      'guide.start.s1.b', 'guide.start.s1.a', 'guide.start.s1.c',
      'guide.start.s2.b', 'guide.start.s2.a', 'guide.start.s2.c', 'guide.start.s2.d',
      'guide.start.s3.b', 'guide.start.s3.a',
      'guide.start.s4.b', 'guide.start.s4.a', 'guide.start.s4.c',
      'guide.start.s5.b', 'guide.start.s5.a',
      'guide.start.s6.b', 'guide.start.s6.a',
      'guide.start.rule.b', 'guide.start.rule',
    ],
  },
  {
    id: 'start-examples',
    title: 'guide.start.examples',
    keys: [
      'guide.start.ex1', 'guide.start.ex1.t',
      'guide.start.ex2', 'guide.start.ex2.t',
      'guide.start.ex3', 'guide.start.ex3.t',
    ],
  },
  {
    id: 'start-hotkeys',
    title: 'guide.start.hotkeys',
    keys: [
      'guide.start.hk1', 'guide.start.hk1.t',
      'guide.start.hk2', 'guide.start.hk2.t',
      'guide.start.hk3', 'guide.start.hk3.t',
    ],
  },
];

// ------------------------------------------------------------------ индекс

const SNIPPET_LEN = 140;

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_LEN ? `${flat.slice(0, SNIPPET_LEN - 1)}…` : flat;
}

export interface BuildGuideIndexOpts {
  /** Перевод текущего языка: (key) => string. */
  t: (key: TKey) => string;
}

// Собирает записи по ВСЕМ табам: блоки (label + hint + машинный тип +
// текст-пример), рецепты, шаги публикации, проверки валидатора, чек-лист,
// FAQ, глоссарий и секции старта. Справочник блоков ГЕНЕРИРУЕТСЯ из
// BLOCK_META: новый тип блока попадает в поиск и в гайд автоматически,
// руками ничего дописывать не нужно.
export function buildGuideIndex(opts: BuildGuideIndexOpts): GuideIndexItem[] {
  const { t } = opts;
  const out: GuideIndexItem[] = [];
  const add = (item: GuideIndexItem): void => {
    item.haystack = normalizeSearch(item.haystack);
    out.push(item);
  };

  // --- блоки: Object.keys + чтение свойств в цикле. Spread/Object.fromEntries
  // по BLOCK_META делать нельзя: label/hint — геттеры ленивого i18n.
  for (const type of Object.keys(BLOCK_META) as BlockType[]) {
    const m = BLOCK_META[type];
    const example = t(guideTextKey(type));
    add({
      id: `block-${type}`,
      tab: 'blocks',
      section: 'guide.blocks.title',
      label: m.label,
      snippet: snippet(`${m.hint} ${example}`),
      targetId: `block-${type}`,
      haystack: `${m.label} ${m.hint} ${type} ${example}`,
    });
  }

  // --- рецепты: заголовок + все шаги.
  for (const r of GUIDE_RECIPES) {
    const title = t(r.title);
    const steps = r.steps.map((k) => t(k)).join(' ');
    add({
      id: r.id,
      tab: 'recipes',
      section: 'guide.recipes.title',
      label: title,
      snippet: snippet(steps),
      targetId: r.id,
      haystack: `${title} ${steps}`,
    });
  }

  // --- мини-аппы: статьи (заголовок + шаги) и FAQ вкладки «мини».
  for (const a of GUIDE_MINI_ARTICLES) {
    const title = t(a.title);
    const steps = a.steps.map((k) => t(k)).join(' ');
    add({
      id: a.id,
      tab: 'mini',
      section: 'guide.mini.title',
      label: title,
      snippet: snippet(steps),
      targetId: a.id,
      haystack: `${title} ${steps}`,
    });
  }
  for (const f of GUIDE_MINI_FAQ) {
    const qText = t(f.q);
    const aText = t(f.a);
    add({
      id: f.id,
      tab: 'mini',
      section: 'guide.mini.faq.title',
      label: qText,
      snippet: snippet(aText),
      targetId: f.id,
      detailsKey: f.id,
      haystack: `${qText} ${aText}`,
    });
  }

  // --- публикация: шаги, проверки валидатора и чек-лист.
  GUIDE_PUBLISH_STEPS.forEach((key, i) => {
    const text = t(key);
    add({
      id: `publish-s${i}`,
      tab: 'publish',
      section: 'guide.publish.title',
      label: text,
      targetId: `publish-s${i}`,
      haystack: text,
    });
  });
  GUIDE_CHECKS.forEach((c, i) => {
    const qText = t(c.q);
    const aText = t(c.a);
    add({
      id: `publish-check-${i}`,
      tab: 'publish',
      section: 'guide.publish.checks',
      label: qText,
      snippet: snippet(aText),
      targetId: `publish-check-${i}`,
      haystack: `${qText} ${aText}`,
    });
  });
  for (const item of GUIDE_CL_ITEMS) {
    const text = item.keys.map((k) => t(k)).join(' ');
    add({
      id: item.id,
      tab: 'publish',
      section: 'guide.publish.checklist',
      label: snippet(text),
      targetId: item.id,
      haystack: text,
    });
  }

  // --- FAQ: вопрос + ответ; detailsKey раскрывает <details> при переходе.
  for (const f of GUIDE_FAQ) {
    const qText = t(f.q);
    const aText = t(f.a);
    add({
      id: f.id,
      tab: 'faq',
      section: 'guide.faq.title',
      label: qText,
      snippet: snippet(aText),
      targetId: f.id,
      detailsKey: f.id,
      haystack: `${qText} ${aText}`,
    });
  }

  // --- глоссарий: термин + текст + машинный id (chat_id, getchatmember…).
  for (const term of GLOSSARY_TERMS) {
    const name = t(term.term);
    const text = t(term.text);
    add({
      id: `gloss-${term.id}`,
      tab: 'start',
      section: 'glossary.title',
      label: name,
      snippet: snippet(text),
      targetId: `gloss-${term.id}`,
      haystack: `${name} ${text} ${term.id}`,
    });
  }

  // --- стартовая вкладка: секции целиком.
  for (const s of GUIDE_START_SECTIONS) {
    const text = s.keys.map((k) => t(k)).join(' ');
    add({
      id: s.id,
      tab: 'start',
      section: 'guide.start.title',
      label: t(s.title),
      snippet: snippet(text),
      targetId: s.id,
      haystack: `${t(s.title)} ${text}`,
    });
  }

  return out;
}

// ------------------------------------------------------------------ матчинг

// Все слова запроса должны найтись в тексте (AND, порядок не важен).
// normalizeSearch — общий нормализатор из blocks.ts: регистр, пробелы, ё/е.
export function matchWords(haystack: string, query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const h = normalizeSearch(haystack);
  return words.every((w) => h.includes(w));
}

// Поиск по индексу: на текущем языке (label/snippet уже переведены при
// сборке) + по машинным именам, которые лежат в haystack. Пустой запрос —
// пустой результат: список «всего подряд» не показываем.
export function matchGuide(index: GuideIndexItem[], query: string): GuideHit[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index
    .filter((item) => words.every((w) => item.haystack.includes(w)))
    .map(({ haystack: _haystack, ...hit }) => hit);
}

export interface GuideHitGroup {
  section: TKey;
  hits: GuideHit[];
  count: number;
}

// Группировка результатов: Map сохраняет порядок первого появления секции,
// счётчик — число записей в группе.
export function groupHits(hits: GuideHit[]): Map<TKey, GuideHitGroup> {
  const out = new Map<TKey, GuideHitGroup>();
  for (const hit of hits) {
    let g = out.get(hit.section);
    if (!g) {
      g = { section: hit.section, hits: [], count: 0 };
      out.set(hit.section, g);
    }
    g.hits.push(hit);
    g.count += 1;
  }
  return out;
}

// ------------------------------------------------------------------ клавиши

// Курсор списка результатов: циклически (с конца — в начало и обратно).
// current < 0 (ничего не выбрано): 'down' ставит на первую, 'up' — на последнюю.
export function moveCursor(count: number, current: number, dir: 'down' | 'up'): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return dir === 'down' ? 0 : count - 1;
  const next = dir === 'down' ? current + 1 : current - 1;
  return (next + count) % count;
}

// Порядок Escape в модалке гайда: ПЕРВЫЙ Escape (при непустом запросе)
// очищает запрос, ВТОРОЙ — закрывает модалку. Пробелы запросом не считаются.
export function escapeAction(query: string): 'clear' | 'close' {
  return query.trim() ? 'clear' : 'close';
}
