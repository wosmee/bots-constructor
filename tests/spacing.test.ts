// Анти-дрейф: вертикальный ритм текстовых страниц (A6). Контейнеры страниц
// (.data-page, .catalog-body, .pay-page, .support-page) обязаны держать
// расстояние между детьми через flex+gap — иначе заголовок, подсказка и
// callout слипаются, а правки отдельных margin снова разбалансируют страницу.
// Линтуем ТОЛЬКО эти четыре контейнера, не весь CSS.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const files: [string, string][] = [
  ['styles.css', read('../web/src/styles.css')],
  ['payments.css', read('../web/src/payments.css')],
  ['subflows.css', read('../web/src/subflows.css')],
];

interface Rule { selector: string; body: string; file: string }

// Наивный парсер: стили одноуровневые, вложенность только у @media —
// её содержимое тоже разбирается (атрибут-контекст здесь не нужен).
function parseCss(file: string, css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
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
      rules.push({ selector: head, body: clean.slice(i + 1, j - 1), file });
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

const allRules = files.flatMap(([file, css]) => parseCss(file, css));

// Правило, которое делает контейнер flex-колонкой с gap (ищем по содержимому:
// padding-оверрайды в @media тому же селектору не должны мешать).
function isFlexGapContainer(r: Rule): boolean {
  return /display:\s*flex/.test(r.body) && /gap/.test(r.body);
}

describe('контейнеры страниц держат ритм через flex+gap', () => {
  const containers: [string, string][] = [
    ['.data-page', 'styles.css'],
    ['.catalog-body', 'styles.css'],
    ['.pay-page', 'payments.css'],
    ['.support-page', 'styles.css'],
  ];

  for (const [selector, file] of containers) {
    it(`${selector} (${file}) — flex-колонка с gap`, () => {
      const matches = allRules.filter(
        (r) =>
          r.file === file &&
          r.selector.split(',').some((s) => s.trim() === selector) &&
          isFlexGapContainer(r)
      );
      expect(matches.length, `${selector} не flex+gap`).toBeGreaterThan(0);
      expect(matches[0].body).toContain('flex-direction: column');
    });
  }
});

describe('прямые дети не удваивают отступы', () => {
  it('.data-toolbar и .data-tabs как прямые дети .data-page обнулены', () => {
    // margin снят либо в базовом правиле, либо оверрайдом .data-page > …
    // (оверрайд может быть общим селектором через запятую)
    const toolbar = allRules.find(
      (r) => r.file === 'styles.css' && r.selector.split(',').some((s) => s.trim() === '.data-page > .data-toolbar')
    );
    expect(toolbar, 'нет .data-page > .data-toolbar').toBeTruthy();
    expect(toolbar!.body).toContain('margin-bottom: 0');
    const tabs = allRules.find((r) => r.file === 'styles.css' && r.selector === '.data-tabs');
    expect(tabs!.body).toMatch(/margin:\s*0/);
  });

  it('.sf-card как прямой ребён .data-page обнулён, вне — нет', () => {
    const override = allRules.find((r) => r.file === 'subflows.css' && r.selector === '.data-page > .sf-card');
    expect(override, 'нет .data-page > .sf-card').toBeTruthy();
    expect(override!.body).toContain('margin-bottom: 0');
    const base = allRules.find((r) => r.file === 'subflows.css' && r.selector === '.sf-card');
    expect(base!.body).toContain('margin-bottom: var(--sp-3)');
  });

  it('прямые дети .pay-page обнулены, .pay-form внутри .pay-conn сохранена', () => {
    const payToolbar = allRules.find((r) => r.file === 'payments.css' && r.selector === '.pay-page > .pay-toolbar');
    expect(payToolbar, 'нет .pay-page > .pay-toolbar').toBeTruthy();
    expect(payToolbar!.body).toContain('margin-bottom: 0');
    const payForm = allRules.find((r) => r.file === 'payments.css' && r.selector === '.pay-page > .pay-form');
    expect(payForm, 'нет .pay-page > .pay-form').toBeTruthy();
    expect(payForm!.body).toContain('margin-bottom: 0');
    const formBase = allRules.find((r) => r.file === 'payments.css' && r.selector === '.pay-form');
    expect(formBase!.body).toContain('margin-bottom: var(--sp-3)');
  });
});
