// Анти-дрейф: действия карточки бота (A5). Три кнопки («Данные», «Оплата»,
// «Удалить») раньше несли класс delete-bot и все три краснели на hover; в узкой
// колонке сетки третья вылезала за границу. Теперь — отдельный ряд
// .bot-card-actions с переносом, нейтральный вид и красный только у danger.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const app = read('../web/src/App.tsx');
const styles = read('../web/src/styles.css');

interface Rule { selector: string; body: string; at: string[] }

function parseCss(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const at: string[] = [];
  let buf = '';
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '{') {
      const head = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (head.startsWith('@')) {
        at.push(head);
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
      rules.push({ selector: head, body: clean.slice(i + 1, j - 1), at: [...at] });
      i = j;
      continue;
    }
    if (ch === '}') {
      at.pop();
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  return rules;
}

const cssRules = parseCss(styles);

describe('разметка карточки бота', () => {
  it('действия вынесены в отдельный ряд', () => {
    expect(app).toContain('bot-card-actions');
    expect(app).toContain('bot-card-action');
  });

  it('класс delete-bot в App.tsx отсутствует вовсе', () => {
    expect(app).not.toContain('delete-bot');
  });

  it('danger-класс только у кнопки удаления', () => {
    const occurrences = app.split('\n').filter((l) => l.includes('bot-card-action danger'));
    expect(occurrences.length).toBe(1);
  });

  it('data-open сохранён у двух кнопок-переходов', () => {
    const occurrences = app.split('\n').filter((l) => l.includes('data-open'));
    expect(occurrences.length).toBe(2);
  });
});

describe('стили действий карточки', () => {
  it('строка id переносится, ряд действий — тоже', () => {
    const id = cssRules.find((r) => r.selector.includes('.bot-card-id'));
    expect(id, 'нет правила .bot-card-id').toBeTruthy();
    expect(id!.body).toContain('flex-wrap: wrap');

    const actions = cssRules.find((r) => r.selector.includes('.bot-card-actions'));
    expect(actions, 'нет правила .bot-card-actions').toBeTruthy();
    expect(actions!.body).toContain('flex-wrap: wrap');
  });

  it('старое правило .delete-bot удалено', () => {
    expect(styles).not.toContain('delete-bot');
  });

  it('красный — только на hover у danger', () => {
    for (const r of cssRules) {
      if (!r.selector.includes('.bot-card-action')) continue;
      const parts = r.selector.split(',');
      for (const part of parts) {
        if (!part.includes('.bot-card-action')) continue;
        if (!r.body.includes('var(--danger)')) continue;
        expect(part, `danger-цвет вне hover: ${part}`).toContain(':hover');
      }
    }
  });

  it('нейтральный hover остальных кнопок — акцентный, не красный', () => {
    const hover = cssRules.find(
      (r) => r.selector.includes('.bot-card-action:hover') && !r.selector.includes('danger')
    );
    expect(hover, 'нет нейтрального hover у .bot-card-action').toBeTruthy();
    expect(hover!.body).toContain('var(--accent)');
    expect(hover!.body).not.toContain('var(--danger)');
  });

  it('токены акцента и опасности определены в обеих темах', () => {
    const root = cssRules.find((r) => r.selector === ':root');
    expect(root!.body).toContain('--accent-soft');
    expect(root!.body).toContain('--danger-soft');
    const light = cssRules.find((r) => r.selector.includes('html[data-theme="light"]'));
    expect(light, 'нет блока светлой темы').toBeTruthy();
    expect(light!.body).toContain('--accent-soft');
    expect(light!.body).toContain('--danger-soft');
  });
});
