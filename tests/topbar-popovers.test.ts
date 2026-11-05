// Регрессия к багу «меню верхней панели открывается за правым краем экрана».
//
// Причина была в CSS: общий .conflict-pop объявлен как position: fixed БЕЗ
// координат, а меню «…» и «?» (класс .more-pop) рендерятся прямо в .pill-wrap
// обвязки панели, без портала, и координат из JS им никто не выдаёт. Для
// fixed-элемента без top/left браузер берёт статическую позицию — правее
// триггера, и при окне 1440px меню шириной 217px уходило за край на 176px
// (в окне оставалось 18% площади, ни один пункт не кликабелен).
//
// Тест читает правила из styles.css, а не DOM: живой замер требует браузера, а
// защитить правило от повторной потери якоря можно и здесь. Живые замеры до и
// после правки — tmp/probe-popovers-before.json и -after.json.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/src/styles.css', import.meta.url), 'utf8');

interface Rule { selector: string; body: string }

// Наивный парсер (тот же приём, что в spacing.test.ts): стили одноуровневые,
// вложенность только у @media — её содержимое тоже разбирается.
function parseCss(source: string): Rule[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let buf = '';
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '{') {
      const head = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (head.startsWith('@')) {
        i++;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth++;
        else if (clean[j] === '}') depth--;
        j++;
      }
      rules.push({ selector: head, body: clean.slice(i + 1, j - 1) });
      i = j;
      continue;
    }
    if (ch === '}') {
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  return rules;
}

const rules = parseCss(css);

// Все объявления селектора по порядку: оверрайды (например, в @media) тоже
// нужны, но базовое правило — первое, и его нельзя терять за оверрайдом.
function rulesFor(selector: string): Rule[] {
  return rules.filter((r) => r.selector.split(',').some((s) => s.trim() === selector));
}

function rule(selector: string): Rule | undefined {
  return rulesFor(selector)[0];
}

describe('меню обвязки панели привязано к своей кнопке', () => {
  it('.more-pop позиционируется от триггера, а не статикой', () => {
    const more = rule('.more-pop');
    expect(more, 'нет правила .more-pop').toBeTruthy();
    expect(more!.body).toContain('position: absolute');
    // Правый якорь обязателен: обвязка панели (кнопки «?» и «…») прижата к
    // правому краю, поэтому abs-элемент без right уехал бы вбок от кнопки.
    expect(more!.body).toMatch(/right:\s*0/);
    // Отступ вниз от кнопки: меню должно раскрываться под ней, а не поверх.
    expect(more!.body).toMatch(/top:\s*calc\(100%/);
  });

  it('.more-pop не наследует fixed от .conflict-pop', () => {
    // Общий класс объявлен fixed — если .more-pop не переопределяет position,
    // меню снова встанет по статической позиции за краем окна.
    const base = rule('.conflict-pop');
    expect(base!.body).toContain('position: fixed');
    // Ни одно объявление .more-pop не должно возвращать fixed: в @media
    // .conflict-pop переопределяют (width/max-height), и «последнее правило»
    // тут не годится — проверяем все.
    const more = rulesFor('.more-pop');
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((r) => !r.body.includes('position: fixed'))).toBe(true);
    expect(more.some((r) => r.body.includes('position: absolute'))).toBe(true);
  });

  it('обвязка панели — точка отсчёта для absolute-меню', () => {
    // Без position: relative у .pill-wrap элемент отсчитывался бы от дальнего
    // предка, и правый анкер перестал бы совпадать с кнопкой.
    const wrap = rule('.pill-wrap');
    expect(wrap, 'нет правила .pill-wrap').toBeTruthy();
    expect(wrap!.body).toContain('position: relative');
  });

  it('список конфликтов остаётся портальным и не ломается этим правилом', () => {
    // .conflict-pop у конфликтов рендерится порталом в body и получает top/left
    // из JS (Constructor.tsx). Правило для .more-pop его не должно затрагивать:
    // селектор узкий, только по .more-pop.
    const more = rule('.more-pop');
    expect(more!.selector.split(',').map((s) => s.trim())).toEqual(['.more-pop']);
  });
});
