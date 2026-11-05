// Раскладка действий верхней панели: что остаётся на виду, что уезжает в «…».
//
// Причина — глаза устают от одного места, где одновременно горит десяток
// кнопок. Держим на виду только частые действия (≤ 5), редкие — в меню.
import type { TKey } from './i18n';

export type TopbarActionId =
  | 'undo'
  | 'redo'
  | 'search'
  | 'tidy'
  | 'vars'
  | 'stats'
  | 'logs'
  | 'shortcuts'
  | 'versions'
| 'guide'
| 'settings'
  | 'catalog'
  | 'data'
  | 'tour'
  | 'preview'
  | 'templates'
  | 'save'
  | 'publish';

export interface TopbarAction {
  id: TopbarActionId;
  /** Подпись кнопки в меню «ещё» (в панели текст может быть иконкой). */
  label: TKey;
  /** Частое действие — остаётся на виду всегда. */
  primary: boolean;
}

// Порядок = порядок в интерфейсе. `primary` — только то, без чего не собрать
// бота: проверка сценария, сохранение и публикация. Это кластер «запуск» —
// единственное место панели, где вообще есть кнопки действий.
// Отмена/повтор уехали в меню вслед за счётчиком: у них есть Ctrl+Z / Ctrl+Y,
// а глаза устают именно от одновременной россыпи кнопок в одном месте.
//
// Два «странных» на вид места в списке:
//  * `stats/logs/vars/search/tidy/versions/undo/redo` — рабочие инструменты
//    редактора, им место в «…»;
//  * `guide/glossary/tour/shortcuts` — обучение и справка, они уезжают под
//    отдельный вход «?», а не в «…» (см. `HELP_ACTION_IDS`);
//  * `settings/catalog/data` — не инструменты сценария: настройки и каталог
//    живут на дашборде, «данные» — отдельная страница бота. В панели редактора
//    их не показываем (см. `EDITOR_OVERFLOW_HIDDEN`).
export const TOPBAR_ACTIONS: TopbarAction[] = [
  { id: 'undo', label: 'editor.undo', primary: false },
  { id: 'redo', label: 'editor.redo', primary: false },
  { id: 'preview', label: 'editor.preview', primary: true },
  { id: 'save', label: 'editor.save', primary: true },
  { id: 'publish', label: 'editor.publish', primary: true },
  { id: 'search', label: 'editor.find', primary: false },
  { id: 'tidy', label: 'editor.tidy', primary: false },
  { id: 'vars', label: 'editor.vars', primary: false },
  { id: 'stats', label: 'editor.stats', primary: false },
  { id: 'logs', label: 'editor.logs', primary: false },
  { id: 'shortcuts', label: 'pro.shortcuts', primary: false },
  { id: 'versions', label: 'editor.versions', primary: false },
  { id: 'guide', label: 'editor.guides', primary: false },
  { id: 'settings', label: 'nav.settings', primary: false },
  { id: 'catalog', label: 'nav.catalog', primary: false },
  { id: 'data', label: 'nav.data', primary: false },
  { id: 'tour', label: 'tour.reopen', primary: false },
  { id: 'templates', label: 'editor.templates', primary: false },
];

// Справка и обучение — отдельный вход «?», а не общее меню «…»: у них другой
// смысл (объяснить интерфейс) и другой режим использования (редко, вдумчиво).
export const HELP_ACTION_IDS: TopbarActionId[] = ['guide', 'tour', 'shortcuts'];

// Пункты, которым не место в панели редактора: это отдельные страницы бота, а
// не действия со сценарием. Обе открываются с дашборда (карточка бота / каталог),
// поэтому в редакторе их не дублируем. `settings` здесь НЕ прячем: это
// единственный вход в настройки — из редактора им тоже надо пользоваться.
export const EDITOR_OVERFLOW_HIDDEN: TopbarActionId[] = ['catalog', 'data'];

// Что остаётся в «…» после вычета справки и разделов аккаунта.
export function editorOverflowActions(actions: TopbarAction[] = TOPBAR_ACTIONS): TopbarAction[] {
  const hide = new Set<TopbarActionId>([...HELP_ACTION_IDS, ...EDITOR_OVERFLOW_HIDDEN]);
  return actions.filter((a) => !a.primary && !hide.has(a.id));
}

export function primaryActions(actions: TopbarAction[] = TOPBAR_ACTIONS): TopbarAction[] {
  return actions.filter((a) => a.primary);
}

export function overflowActions(actions: TopbarAction[] = TOPBAR_ACTIONS): TopbarAction[] {
  return actions.filter((a) => !a.primary);
}

// Видимых пунктов на панели: основные действия в заданном порядке. Держим
// функцией, чтобы ограничение «≤ 5» было проверяемым, а не устной традицией.
export function visibleActionIds(actions: TopbarAction[] = TOPBAR_ACTIONS): TopbarActionId[] {
  return primaryActions(actions).map((a) => a.id);
}

// Кнопки-обвязка панели, которые видны всегда и не являются действиями
// сценария: «?» (справка) и «…» (редкие действия). Шестерёнка режима панели
// отсюда убрана — режим переехал в «Настройки».
//
// Вместе с тремя действиями (превью, сохранить, опубликовать) это ровно 5
// элементов в строке — предел, ради которого константа и заведена. Ставить 1
// было бы неправдой: вход в справку тоже занимает место в строке, и «≤ 5»
// перестало бы соответствовать тому, что видно на экране.
export const TOPBAR_CHROME_ITEMS = 2;

// Сколько всего элементов окажется в раскрытой панели на виду.
export function topbarVisibleItemCount(actions: TopbarAction[] = TOPBAR_ACTIONS): number {
  return primaryActions(actions).length + TOPBAR_CHROME_ITEMS;
}
