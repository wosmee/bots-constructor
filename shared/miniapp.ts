// Схема мини-аппов конструктора. Единый источник истины для воркера (рантайм,
// валидация, публикация) и веба (редактор холста, превью).
//
// Модель: мини-апп = набор страниц + таб-бар. Страницы двух видов: таб-страницы
// (корни навигации, перечислены в tabbar) и обычные (открываются действием
// «перейти на страницу» поверх таба). Навигация рантайма — стек на таб:
// переход пушит, Telegram BackButton делает pop, смена таба сбрасывает стек.
//
// Элемент страницы позиционируется свободно (x/y/w/h в px при базовой ширине
// экрана 390). Адаптивность: элемент может быть прижат к краю или растянут
// (anchor/widthMode), рантайм пересчитывает под реальную ширину.

import type { ConditionOp } from './types';

// ── элементы ────────────────────────────────────────────────────────────────

export type MiniElementType =
  // базовый набор (макет 1)
  | 'text'
  | 'heading'
  | 'button'
  | 'image'
  | 'card'
  | 'input'
  | 'divider'
  | 'spacer'
  // формы и товар
  | 'form'
  | 'product'
  // data-привязанные (каталог/админка)
  | 'grid'        // сетка карточек из data-таблицы; тап = страница товара
  | 'chips'       // фильтры-чипы: мультивыбор значений колонки таблицы
  | 'search'      // поиск по выбранным колонкам таблицы
  | 'sort'        // сортировка по колонке
  | 'stat'        // счётчик/сумма по таблице («новых за сегодня»)
  | 'table'       // таблица строк из data-таблицы (админка)
  | 'record_form' // поиск строки по полю → правка колонок → save/delete
  | 'user_list'   // юзеры бота + смена тега действием
  | 'user_info'   // профиль: имя, id, теги, переменные
  | 'support'     // форма поддержки (createSupportTicket или своя таблица)
  | 'refresh'     // кнопка рефетча данных страницы
  // интеграции
  | 'ai_gen'     // AI-генерация: промпт → картинка в Filebase → галерея
  // --- фаза D ---
  | 'richtext'   // богатый текст: санитизированный HTML (b/i/u/s/a/br)
  | 'carousel'   // горизонтальная карусель картинок (swipe)
  | 'video';     // видео: YouTube-embed или прямая ссылка-плеер

// Источник картинки. filebase — загрузки конструктора (роут /m/img/...),
// tg — file_id из чата бота (воркер стримит с api.telegram.org), url — внешний.
export type MediaSrc =
  | { type: 'filebase'; url: string }
  | { type: 'tg'; fileId: string }
  | { type: 'url'; url: string };

// Условие видимости элемента. Операторы — те же 13, что у блоков condition
// (shared/types.ts ConditionOp): валидатор и рантайм переиспользуют логику.
// left/right — ссылки на контекст: user.* (id, name, username), tag:<имя>,
// var:<имя> (переменные юзера бота), field:<колонка текущей строки> для
// элементов внутри карточки/строки.
export interface MiniVisibleWhen {
  left: string;
  op: ConditionOp;
  right: string;
}

// Действие элемента по клику/сабмиту. Закрытый набор: произвольного JS нет.
export type MiniAction =
  | { id: 'none' }
  | { id: 'goto'; pageId: string }
  | { id: 'link'; url: string }
  | { id: 'data'; table: string; values: MiniValueRef[] } // запись строки
  | { id: 'scenario'; target: string }                    // webhook-вход /p/:token
  | { id: 'close' }
  | { id: 'toggle'; elementId: string }                    // показать/скрыть элемент
  | { id: 'ai'; prompt: string }                           // генерация картинки (фаза C)
  | { id: 'favorite'; itemId: string }                     // избранное: toggle в переменной юзера
  | { id: 'pay'; product: string; stars: number };         // оплата Telegram Stars (фаза D): целое > 0

// Значение при записи в data: литерал, поле формы или контекст юзера.
export type MiniValueRef =
  | { kind: 'literal'; column: string; value: string }
  | { kind: 'field'; column: string; fieldId: string }    // значение поля формы
  | { kind: 'user'; column: string; path: string };       // user.id / user.name

export interface MiniElementStyle {
  bg?: string;
  color?: string;
  size?: number;
  radius?: number;
  align?: 'left' | 'center' | 'right';
  shadow?: boolean;
  grad?: string; // css-градиент заглушки/обложки
  css?: string; // пользовательский CSS (санитизированный, скоуп .el-<id>) — фаза D
}

export interface MiniElement {
  id: string;
  type: MiniElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  // адаптивность: прижатие к краю и режим ширины (пересчёт рантаймом)
  anchor?: 'left' | 'right' | 'center' | 'stretch';
  style: MiniElementStyle;
  props: Record<string, unknown>;
  action: MiniAction;
  visible_when?: MiniVisibleWhen | null;
}

// ── страницы и таб-бар ──────────────────────────────────────────────────────

export interface MiniPage {
  id: string;
  name: string;
  bg: string;
  els: MiniElement[];
  css?: string; // пользовательский CSS страницы (санитизированный) — фаза D
}

export interface MiniTab {
  pageId: string;
  icon: string; // эмодзи или имя иконки из каталога рантайма
  label: string;
}

export interface MiniTabbar {
  enabled: boolean;
  tabs: MiniTab[]; // 2–5, порядок = порядок в доке
}

// ── мини-апп целиком ────────────────────────────────────────────────────────

export type MiniAccessRule =
  | { kind: 'all' }
  | { kind: 'tag'; tag: string }
  | { kind: 'users'; ids: number[] };

export interface MiniApp {
  version: 1;
  tabbar: MiniTabbar;
  pages: MiniPage[];
  startPageId: string; // куда попадаем при открытии без start_param
}

// Контекст юзера, который воркер отдаёт рантайму вместе со схемой.
// Рантайм по нему вычисляет visible_when и интерполяцию {user.name}.
// Секретов не содержит; строки чужих юзеров приходят отдельно и только
// через серверные выборки /m/api.
export interface MiniContext {
  userId: number;
  name: string;
  username: string | null;
  tags: string[];
  vars: Record<string, string>;
}

// ── палитра редактора (зеркало PALETTE_GROUPS ботов) ─────────────────────────

export type MiniPaletteGroupId =
  | 'content'
  | 'forms'
  | 'data'
  | 'integrations'
  | 'flow'
  | 'advanced';

export interface MiniPaletteGroup {
  id: MiniPaletteGroupId;
  title: string; // TKey в вебе; здесь машинный состав
  items: MiniElementType[];
}

export const MINI_PALETTE_GROUPS: MiniPaletteGroup[] = [
  { id: 'content', title: 'palette.mini.content', items: ['text', 'heading', 'image', 'card', 'divider', 'spacer', 'richtext', 'carousel', 'video'] },
  { id: 'forms', title: 'palette.mini.forms', items: ['input', 'form', 'button', 'product'] },
  {
    id: 'data',
    title: 'palette.mini.data',
    items: ['grid', 'chips', 'search', 'sort', 'stat', 'table', 'record_form', 'user_list', 'user_info', 'support', 'refresh'],
  },
  { id: 'integrations', title: 'palette.mini.integrations', items: ['ai_gen'] },
  // flow-группа в редакторе — страницы/табы/навигация, не элементы холста;
  // состав пустой намеренно: редактор рисует её из страниц схемы.
  { id: 'flow', title: 'palette.mini.flow', items: [] },
  // advanced: visible_when, z-order, raw JSON — гейт по skill_level 'low'
  { id: 'advanced', title: 'palette.mini.advanced', items: [] },
];

// ── дефолты и фабрики ───────────────────────────────────────────────────────

// Базовая ширина виртуального экрана; все координаты в ней.
export const MINI_CANVAS_W = 390;
export const MINI_CANVAS_H = 844;

// Лимиты мини-аппов (фаза C). Filebase-бакет общий на аккаунт, поэтому квоты
// считаем своими счётчиками: страницы/элементы — из схемы при публикации,
// медиа-байты — в mini_app_usage, частота /m/api — счётчиком в KV.
export const MINI_LIMITS = {
  pages: 20,
  elsPerPage: 80,
  mediaBytesPerBot: 100 * 1024 * 1024,
  apiPerMin: 120,
  aiPerUserDay: 20,
} as const;

export const MINI_ELEMENT_DEFAULTS: Record<MiniElementType, { w: number; h: number }> = {
  text: { w: 220, h: 40 },
  heading: { w: 260, h: 44 },
  button: { w: 180, h: 46 },
  image: { w: 200, h: 140 },
  card: { w: 300, h: 160 },
  input: { w: 260, h: 44 },
  divider: { w: 300, h: 4 },
  spacer: { w: 300, h: 24 },
  form: { w: 300, h: 220 },
  product: { w: 300, h: 200 },
  grid: { w: 350, h: 300 },
  chips: { w: 350, h: 44 },
  search: { w: 350, h: 44 },
  sort: { w: 160, h: 40 },
  stat: { w: 160, h: 90 },
  table: { w: 350, h: 260 },
  record_form: { w: 320, h: 300 },
  user_list: { w: 350, h: 260 },
  user_info: { w: 350, h: 120 },
  support: { w: 320, h: 220 },
  refresh: { w: 140, h: 40 },
  ai_gen: { w: 320, h: 240 },
  richtext: { w: 320, h: 120 },
  carousel: { w: 350, h: 200 },
  video: { w: 350, h: 200 },
};

export function miniElement(type: MiniElementType, id: string, x = 20, y = 80): MiniElement {
  const d = MINI_ELEMENT_DEFAULTS[type];
  return { id, type, x, y, w: d.w, h: d.h, style: {}, props: {}, action: { id: 'none' }, visible_when: null };
}

export function emptyMiniApp(startPageId: string): MiniApp {
  return {
    version: 1,
    tabbar: { enabled: false, tabs: [] },
    pages: [],
    startPageId,
  };
}

// ── валидация формы схемы (без бизнес-правил, только структура) ─────────────

export function validateMiniAppShape(a: any): a is MiniApp {
  if (!a || typeof a !== 'object') return false;
  if (a.version !== 1) return false;
  if (!Array.isArray(a.pages) || a.pages.length === 0) return false;
  if (typeof a.startPageId !== 'string') return false;
  if (!a.pages.some((p: any) => p && p.id === a.startPageId)) return false;
  if (!a.tabbar || typeof a.tabbar.enabled !== 'boolean' || !Array.isArray(a.tabbar.tabs)) return false;
  if (a.tabbar.enabled && (a.tabbar.tabs.length < 1 || a.tabbar.tabs.length > 5)) return false;
  const pageIds = new Set(a.pages.map((p: any) => p?.id));
  for (const t of a.tabbar.tabs) {
    if (!t || typeof t.pageId !== 'string' || !pageIds.has(t.pageId)) return false;
  }
  for (const p of a.pages) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') return false;
    if (!Array.isArray(p.els)) return false;
    for (const e of p.els) {
      if (!e || typeof e.id !== 'string' || typeof e.type !== 'string') return false;
      if (!(e.type in MINI_ELEMENT_DEFAULTS)) return false;
      for (const k of ['x', 'y', 'w', 'h']) if (typeof e[k] !== 'number' || !isFinite(e[k])) return false;
      if (!e.action || typeof e.action.id !== 'string') return false;
    }
  }
  return true;
}
