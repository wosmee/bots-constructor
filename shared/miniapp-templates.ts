// Стартовые шаблоны мини-аппов. Шаблон — обычная схема MiniApp: после создания
// её можно разобрать до последнего элемента. Id страниц/элементов генерируются
// при применении (applyMiniTemplate), поэтому два аппа из одного шаблона не
// сталкиваются id. Эталон возможностей — мини-аппы с витриной и админкой:
// каталог с фильтрами, stat/таблицы/форма записи.
import {
  emptyMiniApp,
  miniElement,
  type MiniApp,
  type MiniElement,
  type MiniPage,
} from './miniapp';

export type MiniTemplateId = 'catalog' | 'admin' | 'clean';

let seq = 0;
const nid = (p: string) => `${p}${++seq}_${Math.random().toString(36).slice(2, 7)}`;

function el(type: MiniElement['type'], x: number, y: number, props: Record<string, unknown> = {}, extra: Partial<MiniElement> = {}): MiniElement {
  const e = miniElement(type, nid('e'), x, y);
  e.props = props;
  return { ...e, ...extra };
}

function catalogTemplate(): MiniApp {
  const home: MiniPage = { id: nid('p'), name: 'Витрина', bg: '#fff7f9', els: [] };
  const item: MiniPage = { id: nid('p'), name: 'Товар', bg: '#ffffff', els: [] };
  const book: MiniPage = { id: nid('p'), name: 'Запись', bg: '#ffffff', els: [] };

  home.els = [
    el('heading', 24, 64, { text: 'Каталог' }, { style: { size: 26, color: '#2b1b23' } }),
    el('search', 20, 116, { table: '', columns: [] }),
    el('chips', 20, 172, { table: '', column: '' }),
    el('grid', 20, 228, { table: '', titleColumn: '', priceColumn: '', detailPageId: item.id }, { h: 420 }),
    el('button', 105, 680, { text: 'Записаться' }, { style: { bg: '#6d5efc', color: '#ffffff', radius: 14 }, action: { id: 'goto', pageId: book.id } }),
  ];
  item.els = [
    el('image', 45, 70, { src: { type: 'url', url: '' }, emoji: '🖼' }, { w: 300, h: 220 }),
    el('heading', 24, 310, { text: '{field.title}' }, { style: { size: 22 } }),
    el('text', 24, 350, { text: '{field.description}' }, { style: { color: '#666666' } }),
    el('button', 105, 700, { text: 'Выбрать' }, { style: { bg: '#22c55e', color: '#ffffff', radius: 12 }, action: { id: 'goto', pageId: book.id } }),
  ];
  book.els = [
    el('heading', 24, 70, { text: 'Запись' }, { style: { size: 24 } }),
    el('form', 45, 130, { fields: [{ id: 'name', label: 'Имя' }, { id: 'phone', label: 'Телефон' }], submit: 'Отправить', mapping: [{ column: 'имя', fieldId: 'name' }, { column: 'телефон', fieldId: 'phone' }] }, { action: { id: 'data', table: '', values: [] } }),
    el('text', 24, 420, { text: 'Бот ответит в чат в течение минуты.' }, { style: { size: 12, color: '#999999' } }),
  ];

  const app = emptyMiniApp(home.id);
  app.pages = [home, item, book];
  app.tabbar = { enabled: true, tabs: [{ pageId: home.id, icon: '🏠', label: 'Витрина' }, { pageId: book.id, icon: '📅', label: 'Запись' }] };
  return app;
}

function adminTemplate(): MiniApp {
  const dash: MiniPage = { id: nid('p'), name: 'Сводка', bg: '#f4f6fb', els: [] };
  const rows: MiniPage = { id: nid('p'), name: 'Записи', bg: '#ffffff', els: [] };

  dash.els = [
    el('heading', 24, 64, { text: 'Сводка' }, { style: { size: 24 } }),
    el('stat', 20, 120, { table: '', mode: 'count' }, { w: 165 }),
    el('stat', 205, 120, { table: '', mode: 'sum', column: '' }, { w: 165 }),
    el('user_info', 20, 240, {}),
    el('button', 105, 400, { text: 'К записям' }, { style: { bg: '#6d5efc', color: '#ffffff', radius: 12 }, action: { id: 'goto', pageId: rows.id } }),
  ];
  rows.els = [
    el('search', 20, 70, { table: '', columns: [] }),
    el('table', 20, 126, { table: '', columns: [] }, { h: 380 }),
    el('record_form', 40, 530, { table: '', searchColumn: '', editColumns: [] }, { h: 260 }),
  ];

  const app = emptyMiniApp(dash.id);
  app.pages = [dash, rows];
  app.tabbar = { enabled: true, tabs: [{ pageId: dash.id, icon: '📊', label: 'Сводка' }, { pageId: rows.id, icon: '🗂', label: 'Записи' }] };
  return app;
}

export function applyMiniTemplate(id: MiniTemplateId): MiniApp {
  if (id === 'catalog') return catalogTemplate();
  if (id === 'admin') return adminTemplate();
  const page: MiniPage = { id: nid('p'), name: 'Главная', bg: '#ffffff', els: [] };
  const app = emptyMiniApp(page.id);
  app.pages = [page];
  return app;
}
