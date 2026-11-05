// Инспектор мини-аппов (фаза B). React-рендера в корневом vitest нет (нет
// jsdom/testing-library — как и в остальных тестах проекта, см.
// inspector-fields.test.ts), поэтому проверяются чистые иммутабельные
// хелперы, через которые компонент правит схему. Импорт — из
// MiniInspector.tsx: тест доказывает, что реэкспорт хелперов из компонента
// работает (контракт задачи: хелперы экспортируются из MiniInspector.tsx).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyElChange,
  applyElProps,
  applyPageChange,
  duplicateEl,
  moveZ,
  nextFieldId,
  removeEl,
} from '../web/src/MiniInspector';
import { miniElement, validateMiniAppShape, type MiniApp } from '../shared/miniapp';
import { sanitizeCss, sanitizeRichText } from '../shared/mini-sanitize';

function fixture(): MiniApp {
  const a = miniElement('text', 'e1', 10, 20);
  const b = miniElement('button', 'e2', 30, 40);
  const c = miniElement('image', 'e3', 50, 60);
  return {
    version: 1,
    tabbar: { enabled: false, tabs: [] },
    pages: [
      { id: 'p1', name: 'Главная', bg: '#ffffff', els: [a, b, c] },
      { id: 'p2', name: 'Товар', bg: '#eeeeee', els: [] },
    ],
    startPageId: 'p1',
  };
}

const el1 = (app: MiniApp) => app.pages[0].els.find((e) => e.id === 'e1')!;

describe('applyElChange', () => {
  it('правит только целевой элемент и не мутирует старую схему', () => {
    const app = fixture();
    const before = JSON.stringify(app);
    const next = applyElChange(app, 0, 'e1', { x: 99, y: 88 });

    expect(next).not.toBe(app);
    expect(next.pages).not.toBe(app.pages);
    expect(next.pages[0]).not.toBe(app.pages[0]);
    expect(next.pages[0].els).not.toBe(app.pages[0].els);
    expect(el1(next)).not.toBe(el1(app));

    expect(el1(next).x).toBe(99);
    expect(el1(next).y).toBe(88);
    // старая схема не тронута
    expect(el1(app).x).toBe(10);
    expect(JSON.stringify(app)).toBe(before);
    // соседние элементы перенесены как есть (тот же объект)
    expect(next.pages[0].els[1]).toBe(app.pages[0].els[1]);
    // другие страницы не пересоздаются зря
    expect(next.pages[1]).toBe(app.pages[1]);
  });

  it('меняет action и visible_when целиком', () => {
    const app = fixture();
    const next = applyElChange(app, 0, 'e2', {
      action: { id: 'goto', pageId: 'p2' },
      visible_when: { left: 'tag:vip', op: '==', right: '1' },
    });
    expect(next.pages[0].els[1].action).toEqual({ id: 'goto', pageId: 'p2' });
    expect(next.pages[0].els[1].visible_when).toEqual({ left: 'tag:vip', op: '==', right: '1' });
    expect(app.pages[0].els[1].action).toEqual({ id: 'none' });
    expect(app.pages[0].els[1].visible_when).toBeNull();
  });

  it('несуществующий элемент/страница — та же схема, без мутаций', () => {
    const app = fixture();
    expect(applyElChange(app, 0, 'nope', { x: 1 })).toBe(app);
    expect(applyElChange(app, 5, 'e1', { x: 1 })).toBe(app);
    expect(applyElChange(app, -1, 'e1', { x: 1 })).toBe(app);
  });

  it('результат остаётся валидной схемой', () => {
    const app = fixture();
    const next = applyElChange(app, 0, 'e1', { w: 300, h: 100 });
    expect(validateMiniAppShape(next)).toBe(true);
  });
});

describe('applyElProps', () => {
  it('мержит props, сохраняя остальные ключи', () => {
    const app = applyElProps(fixture(), 0, 'e1', { text: 'Привет' });
    const withMore = applyElProps(app, 0, 'e1', { emoji: '🙂' });

    expect(withMore.pages[0].els[0].props).toEqual({ text: 'Привет', emoji: '🙂' });
    expect(app.pages[0].els[0].props).toEqual({ text: 'Привет' });
    expect(withMore.pages[0].els[0]).not.toBe(app.pages[0].els[0]);
    expect(withMore.pages[0].els[0].props).not.toBe(app.pages[0].els[0].props);
  });

  it('props других элементов не пересоздаются', () => {
    const app = fixture();
    const next = applyElProps(app, 0, 'e1', { text: 'x' });
    expect(next.pages[0].els[1].props).toBe(app.pages[0].els[1].props);
  });

  it('нет элемента — та же схема', () => {
    const app = fixture();
    expect(applyElProps(app, 0, 'nope', { text: 'x' })).toBe(app);
  });
});

describe('applyPageChange', () => {
  it('правит имя и фон страницы иммутабельно', () => {
    const app = fixture();
    const next = applyPageChange(app, 0, { name: 'Новая', bg: '#123456' });
    expect(next.pages[0].name).toBe('Новая');
    expect(next.pages[0].bg).toBe('#123456');
    expect(app.pages[0].name).toBe('Главная');
    expect(next.pages[0]).not.toBe(app.pages[0]);
    // els не пересоздаются
    expect(next.pages[0].els).toBe(app.pages[0].els);
    expect(next.pages[1]).toBe(app.pages[1]);
  });

  it('индекс вне диапазона — та же схема', () => {
    const app = fixture();
    expect(applyPageChange(app, 9, { name: 'x' })).toBe(app);
    expect(applyPageChange(app, -1, { name: 'x' })).toBe(app);
  });
});

describe('moveZ', () => {
  it('front переставляет элемент в конец (поверх остальных)', () => {
    const app = fixture();
    const next = moveZ(app, 0, 'e1', 'front');
    expect(next.pages[0].els.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
    expect(app.pages[0].els.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    // сам элемент не клонируется
    expect(next.pages[0].els[2]).toBe(el1(app));
  });

  it('back переставляет элемент в начало', () => {
    const app = fixture();
    const next = moveZ(app, 0, 'e3', 'back');
    expect(next.pages[0].els.map((e) => e.id)).toEqual(['e3', 'e1', 'e2']);
    expect(app.pages[0].els.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('элемент уже на месте — та же схема (не плодит шаги undo)', () => {
    const app = fixture();
    expect(moveZ(app, 0, 'e3', 'front')).toBe(app);
    expect(moveZ(app, 0, 'e1', 'back')).toBe(app);
  });

  it('нет элемента/страницы — та же схема', () => {
    const app = fixture();
    expect(moveZ(app, 0, 'nope', 'front')).toBe(app);
    expect(moveZ(app, 7, 'e1', 'front')).toBe(app);
  });
});

describe('duplicateEl', () => {
  it('копия: новый id, +16/+16, в конец списка', () => {
    const app = fixture();
    const before = JSON.stringify(app);
    const next = duplicateEl(app, 0, 'e1');
    const copy = next.pages[0].els[next.pages[0].els.length - 1];

    expect(next.pages[0].els).toHaveLength(4);
    expect(copy.id).not.toBe('e1');
    expect(copy.x).toBe(el1(app).x + 16);
    expect(copy.y).toBe(el1(app).y + 16);
    expect(copy.type).toBe('text');
    expect(copy.w).toBe(el1(app).w);
    expect(copy.h).toBe(el1(app).h);
    // старая схема не мутирована
    expect(JSON.stringify(app)).toBe(before);
    // копия глубокая: правка копии не задевает оригинал
    expect(copy).not.toBe(el1(app));
    expect(copy.props).not.toBe(el1(app).props);
  });

  it('новый id не пересекается с существующими (в т.ч. на других страницах)', () => {
    const app = fixture();
    const ids = new Set<string>();
    for (const p of app.pages) for (const e of p.els) ids.add(e.id);
    const copy = duplicateEl(app, 0, 'e1').pages[0].els[3];
    expect(ids.has(copy.id)).toBe(false);
  });

  it('копия остаётся валидной схемой', () => {
    const next = duplicateEl(fixture(), 0, 'e2');
    expect(validateMiniAppShape(next)).toBe(true);
  });

  it('нет элемента — та же схема', () => {
    const app = fixture();
    expect(duplicateEl(app, 0, 'nope')).toBe(app);
    expect(duplicateEl(app, 3, 'e1')).toBe(app);
  });
});

describe('removeEl', () => {
  it('удаляет только целевой элемент, иммутабельно', () => {
    const app = fixture();
    const next = removeEl(app, 0, 'e2');
    expect(next.pages[0].els.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(app.pages[0].els).toHaveLength(3);
    expect(next.pages[0]).not.toBe(app.pages[0]);
    expect(validateMiniAppShape(next)).toBe(true);
  });

  it('нет такого элемента — та же схема', () => {
    const app = fixture();
    expect(removeEl(app, 0, 'nope')).toBe(app);
  });
});

describe('nextFieldId', () => {
  it('даёт следующий свободный f<n>', () => {
    expect(nextFieldId([])).toBe('f1');
    expect(nextFieldId([{ id: 'f1' }, { id: 'f2' }])).toBe('f3');
  });

  it('не коллидирует с существующими id', () => {
    expect(nextFieldId([{ id: 'f1' }, { id: 'f3' }])).toBe('f2');
    expect(nextFieldId([{ id: 'name' }, { id: 'f1' }])).toBe('f2');
  });
});

// ---------------------------------------------------------------------------
// Фаза D: пользовательский контент санитизируется до записи в схему.
// Инспектор пишет props.html через sanitizeRichText, style.css/page.css —
// через sanitizeCss. Проверяем связку «sanitizer + хелперы схемы» (то, что
// делает onChange инспектора) и анти-дрейф по исходнику компонента: без
// React-рендера это единственный способ поймать отвязанный санитайзер.
// ---------------------------------------------------------------------------

const inspectorSrc = readFileSync(new URL('../web/src/MiniInspector.tsx', import.meta.url), 'utf8');

describe('фаза D: sanitizeRichText в props.html', () => {
  it('script вырезается до записи в схему', () => {
    // Так делает onChange инспектора: sanitizeRichText → applyElProps.
    const dirty = 'до<script>alert(1)</script>после<b>жирный</b>';
    const next = applyElProps(fixture(), 0, 'e1', { html: sanitizeRichText(dirty) });
    const html = String(el1(next).props.html);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('<b>жирный</b>');
  });

  it('onChange поля html в исходнике инспектора идёт через sanitizeRichText', () => {
    // Анти-дрейф: санитайзер обязан оставаться в обвязке поля (а не только в импорте).
    expect(inspectorSrc).toMatch(/html:\s*sanitizeRichText\(e\.target\.value\)/);
  });
});

describe('фаза D: sanitizeCss в style.css', () => {
  it('expression вырезается, безопасные декларации остаются', () => {
    const dirty = 'width: expression(alert(1)); color: blue';
    const next = applyElChange(fixture(), 0, 'e1', { style: { css: sanitizeCss(dirty) } });
    const css = String(el1(next).style.css);
    expect(css).not.toContain('expression');
    expect(css).toBe('color: blue');
  });

  it('onChange поля style.css в исходнике инспектора идёт через sanitizeCss', () => {
    expect(inspectorSrc).toMatch(/css:\s*sanitizeCss\(e\.target\.value\)/);
  });
});

describe('фаза D: page.css санитизирован', () => {
  it('javascript: и @import вырезаются до записи на страницу', () => {
    const dirty = '@import url(evil.css); background: javascript:alert(1); padding: 8px';
    const next = applyPageChange(fixture(), 0, { css: sanitizeCss(dirty) });
    const css = String(next.pages[0].css);
    expect(css).not.toContain('@import');
    expect(css).not.toContain('javascript:');
    expect(css).toBe('padding: 8px');
  });

  it('textarea page.css в исходнике инспектора пишет через patchPage({ css: sanitizeCss(...) })', () => {
    expect(inspectorSrc).toMatch(/patchPage\(\{\s*css:\s*sanitizeCss\(e\.target\.value\)/);
  });
});

describe('цепочка правок инспектора', () => {
  it('последовательные изменения накапливаются на новых объектах', () => {
    const v0 = fixture();
    const v1 = applyElProps(v0, 0, 'e1', { text: 'Шаг 1' });
    const v2 = applyElChange(v1, 0, 'e1', { x: 42 });
    const v3 = applyElProps(v2, 0, 'e1', { text: 'Шаг 3' });

    expect(el1(v0).props).toEqual({});
    expect(el1(v0).x).toBe(10);
    expect(el1(v1).props).toEqual({ text: 'Шаг 1' });
    expect(el1(v2).x).toBe(42);
    expect(el1(v2).props).toEqual({ text: 'Шаг 1' });
    expect(el1(v3).props).toEqual({ text: 'Шаг 3' });
    expect(el1(v3).x).toBe(42);
    // каждая версия — свой объект
    expect(v3).not.toBe(v2);
    expect(v2).not.toBe(v1);
    expect(v1).not.toBe(v0);
  });
});
