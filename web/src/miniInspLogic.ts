// Чистые функции инспектора мини-аппов: иммутабельные правки схемы.
// Компонент MiniInspector.tsx тонкий — любое изменение схемы идёт через эти
// хелперы, поэтому тесты проверяют их напрямую, без React-рендера (в корневом
// vitest нет jsdom/testing-library — как и в остальных тестах проекта,
// см. inspector-fields.test.ts). Файл намеренно без импортов React.
import type { MiniApp, MiniElement, MiniPage } from '../../shared/miniapp';

// Правка страницы (имя, фон). Вне диапазона — возвращаем ту же схему.
export function applyPageChange(app: MiniApp, pageIdx: number, patch: Partial<MiniPage>): MiniApp {
  if (pageIdx < 0 || pageIdx >= app.pages.length) return app;
  return { ...app, pages: app.pages.map((p, i) => (i === pageIdx ? { ...p, ...patch } : p)) };
}

// Поверхностная правка элемента: x/y/w/h, action, visible_when, style (целиком).
export function applyElChange(
  app: MiniApp,
  pageIdx: number,
  elId: string,
  patch: Partial<MiniElement>
): MiniApp {
  const page = app.pages[pageIdx];
  if (!page || !page.els.some((e) => e.id === elId)) return app;
  return {
    ...app,
    pages: app.pages.map((p, i) =>
      i === pageIdx ? { ...p, els: p.els.map((e) => (e.id === elId ? { ...e, ...patch } : e)) } : p
    ),
  };
}

// Правка props элемента с сохранением остальных ключей props.
export function applyElProps(
  app: MiniApp,
  pageIdx: number,
  elId: string,
  patch: Record<string, unknown>
): MiniApp {
  const el = app.pages[pageIdx]?.els.find((e) => e.id === elId);
  if (!el) return app;
  return applyElChange(app, pageIdx, elId, { props: { ...el.props, ...patch } });
}

// Z-order: конец массива els = передний план (рантайм рисует по порядку).
// Если элемент уже на месте — возвращаем ту же схему (не плодим шаги undo).
export function moveZ(app: MiniApp, pageIdx: number, elId: string, dir: 'front' | 'back'): MiniApp {
  const page = app.pages[pageIdx];
  if (!page) return app;
  const idx = page.els.findIndex((e) => e.id === elId);
  if (idx < 0) return app;
  if (dir === 'front' && idx === page.els.length - 1) return app;
  if (dir === 'back' && idx === 0) return app;
  const els = page.els.slice();
  const [el] = els.splice(idx, 1);
  if (dir === 'front') els.push(el);
  else els.unshift(el);
  return { ...app, pages: app.pages.map((p, i) => (i === pageIdx ? { ...p, els } : p)) };
}

let elSeq = 0;

// id элемента, уникальный в пределах всей схемы (страницы могут копироваться).
export function genElId(app: MiniApp): string {
  const used = new Set<string>();
  for (const p of app.pages) for (const e of p.els) used.add(e.id);
  let id = '';
  do {
    id = `el${Date.now().toString(36)}${(elSeq++).toString(36)}`;
  } while (used.has(id));
  return id;
}

// Дубликат: новый id, сдвиг +16/+16, в конец списка (поверх оригинала).
export function duplicateEl(app: MiniApp, pageIdx: number, elId: string): MiniApp {
  const page = app.pages[pageIdx];
  const el = page?.els.find((e) => e.id === elId);
  if (!page || !el) return app;
  const copy: MiniElement = JSON.parse(JSON.stringify(el));
  copy.id = genElId(app);
  copy.x = el.x + 16;
  copy.y = el.y + 16;
  return {
    ...app,
    pages: app.pages.map((p, i) => (i === pageIdx ? { ...p, els: [...p.els, copy] } : p)),
  };
}

export function removeEl(app: MiniApp, pageIdx: number, elId: string): MiniApp {
  const page = app.pages[pageIdx];
  if (!page || !page.els.some((e) => e.id === elId)) return app;
  return {
    ...app,
    pages: app.pages.map((p, i) =>
      i === pageIdx ? { ...p, els: p.els.filter((e) => e.id !== elId) } : p
    ),
  };
}

// Следующий свободный id поля формы: f1, f2, … — минимальный без коллизий.
export function nextFieldId(fields: Array<{ id?: unknown }>): string {
  const used = new Set(fields.map((f) => String(f?.id ?? '')));
  let n = 1;
  while (used.has(`f${n}`)) n++;
  return `f${n}`;
}
