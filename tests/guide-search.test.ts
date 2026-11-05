// Глобальный поиск по гайду (Промпт 2, TASKS 5+6): чистые функции из
// guideSearch.ts — индекс, матчинг, группировка, клавиатура. Без DOM и React.
import { describe, expect, it } from 'vitest';
import { translate, type TKey } from '../web/src/i18n';
import {
  buildGuideIndex,
  matchGuide,
  groupHits,
  moveCursor,
  escapeAction,
  GUIDE_FAQ,
  GUIDE_RECIPES,
} from '../web/src/guideSearch';
import { GLOSSARY_TERMS } from '../web/src/Glossary';

const t = (key: TKey): string => translate('ru', key);

// Индекс собирается один раз — как и в компоненте (useMemo).
const INDEX = buildGuideIndex({ t });

const ids = (hits: { id: string }[]) => hits.map((h) => h.id);

describe('buildGuideIndex', () => {
  it('содержит все блоки: по записи на каждый тип', () => {
    const blocks = INDEX.filter((h) => h.tab === 'blocks');
    expect(blocks.length).toBeGreaterThanOrEqual(45);
    // Машинное имя лежит в haystack: поиск по payment_link/foreach обязан работать.
    const pay = blocks.find((h) => h.id === 'block-payment_link');
    expect(pay).toBeTruthy();
    expect(pay!.haystack).toContain('payment_link');
  });

  it('содержит все рецепты, FAQ и термины глоссария', () => {
    const recipes = INDEX.filter((h) => h.tab === 'recipes');
    expect(recipes.length).toBe(GUIDE_RECIPES.length);
    const faq = INDEX.filter((h) => h.tab === 'faq');
    expect(faq.length).toBe(GUIDE_FAQ.length);
    const gloss = INDEX.filter((h) => h.section === 'glossary.title');
    expect(gloss.length).toBe(GLOSSARY_TERMS.length);
  });

  it('label/snippet — переведённый текст, а не сырые ключи словаря', () => {
    for (const item of INDEX) {
      expect(item.label.startsWith('guide.') || item.label.startsWith('glossary.') || item.label.startsWith('block.'), `не переведён: ${item.id}`).toBe(false);
    }
  });

  it('у каждого FAQ-хита есть detailsKey — его <details> раскрывается при переходе', () => {
    for (const f of INDEX.filter((h) => h.tab === 'faq')) {
      expect(f.detailsKey).toBe(f.id);
    }
  });
});

describe('matchGuide', () => {
  it('пустой запрос — пустой результат', () => {
    expect(matchGuide(INDEX, '')).toEqual([]);
    expect(matchGuide(INDEX, '   ')).toEqual([]);
  });

  it('находит блок по русской подписи', () => {
    const hits = matchGuide(INDEX, 'Платёжная ссылка');
    expect(ids(hits)).toContain('block-payment_link');
  });

  it('находит по машинному типу: payment_link, getChatMember, foreach', () => {
    expect(ids(matchGuide(INDEX, 'payment_link'))).toContain('block-payment_link');
    expect(ids(matchGuide(INDEX, 'foreach'))).toContain('block-foreach');
    // getChatMember — термин глоссария; регистр не важен (нормализация).
    const hits = ids(matchGuide(INDEX, 'getChatMember'));
    expect(hits).toContain('gloss-getchatmember');
    expect(ids(matchGuide(INDEX, 'channel_check'))).toContain('block-channel_check');
  });

  it('находит термин глоссария', () => {
    expect(ids(matchGuide(INDEX, 'идемпотентность'))).toContain('gloss-idempotency');
    expect(ids(matchGuide(INDEX, 'chat_id'))).toContain('gloss-chatid');
  });

  it('находит вопрос FAQ по тексту вопроса и по ответу', () => {
    expect(ids(matchGuide(INDEX, 'платёжные секреты'))).toContain('faq-pay-secrets');
    // Ответ (snippet/haystack) тоже индексируется: «AES-256» есть только в ответе.
    expect(ids(matchGuide(INDEX, 'AES-256'))).toContain('faq-pay-secrets');
  });

  it('многословный запрос: AND по словам, порядок не важен', () => {
    const a = matchGuide(INDEX, 'рассылка сегмент');
    const b = matchGuide(INDEX, 'сегмент рассылка');
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a)).toContain('block-segment_broadcast');
    // Слово не из записи отсекает её (AND, а не OR).
    expect(ids(matchGuide(INDEX, 'рассылка квантовая'))).toEqual([]);
  });

  it('ё/е и регистр не влияют: «СЧЁТ» == «счет»', () => {
    const up = matchGuide(INDEX, 'СЧЁТ');
    const low = matchGuide(INDEX, 'счет');
    expect(ids(up)).toEqual(ids(low));
    expect(ids(up)).toContain('block-invoice'); // «Показывает счёт на оплату…»
  });

  it('находит термин глоссария «подсценарий» — по-русски и по машинному id', () => {
    expect(ids(matchGuide(INDEX, 'подсценарий'))).toContain('gloss-subflow');
    expect(ids(matchGuide(INDEX, 'subflow'))).toContain('gloss-subflow');
  });

  it('находит рецепт извлечения подсценария', () => {
    expect(ids(matchGuide(INDEX, 'создать подсценарий из выделения'))).toContain('recipe-subflow-extract');
  });

  it('находит FAQ про живой бот и библиотеку', () => {
    expect(ids(matchGuide(INDEX, 'отредактировать библиотеку'))).toContain('faq-subflow-live');
  });

  it('хиты не несут haystack наружу', () => {
    const [hit] = matchGuide(INDEX, 'payment_link');
    expect((hit as { haystack?: unknown }).haystack).toBeUndefined();
  });
});

describe('groupHits', () => {
  it('группирует по секциям и считает записи', () => {
    const groups = groupHits(matchGuide(INDEX, 'оплат'));
    let total = 0;
    for (const [section, g] of groups) {
      expect(g.section).toBe(section);
      expect(g.count).toBe(g.hits.length);
      expect(g.count).toBeGreaterThan(0);
      for (const h of g.hits) expect(h.section).toBe(section);
      total += g.count;
    }
    expect(total).toBe(matchGuide(INDEX, 'оплат').length);
  });

  it('пустой вход — пустая карта', () => {
    expect(groupHits([]).size).toBe(0);
  });
});

describe('escapeAction', () => {
  it('ПЕРВЫЙ Escape (непустой запрос) очищает запрос', () => {
    expect(escapeAction('payment')).toBe('clear');
  });

  it('ВТОРОЙ Escape (пустой запрос) закрывает модалку', () => {
    expect(escapeAction('')).toBe('close');
    expect(escapeAction('   ')).toBe('close');
  });
});

describe('moveCursor', () => {
  it('циклически вниз: с конца — в начало', () => {
    expect(moveCursor(3, 0, 'down')).toBe(1);
    expect(moveCursor(3, 2, 'down')).toBe(0);
  });

  it('циклически вверх: с начала — в конец', () => {
    expect(moveCursor(3, 0, 'up')).toBe(2);
    expect(moveCursor(3, 2, 'up')).toBe(1);
  });

  it('курсор не выбран (-1): down — первая, up — последняя', () => {
    expect(moveCursor(3, -1, 'down')).toBe(0);
    expect(moveCursor(3, -1, 'up')).toBe(2);
  });

  it('пустой список — курсор не появляется', () => {
    expect(moveCursor(0, -1, 'down')).toBe(-1);
    expect(moveCursor(0, 0, 'up')).toBe(-1);
  });
});
