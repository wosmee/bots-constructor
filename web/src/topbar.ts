// Верхняя панель редактора: режим раскрытия и зона выезда.
//
// Режим — состояние УСТРОЙСТВА, а не аккаунта: хранится в localStorage, как и
// раскрытые группы палитры. На сервер его не отправляем и между устройствами
// не синхронизируем — так попросил владелец продукта.

export type TopbarMode = 'slide' | 'always';

// Ключ в стиле остальных оконных настроек репозитория (`palette.openGroups`):
// состояние окна — точка, не подчёркивание.
export const TOPBAR_MODE_KEY = 'topbar.mode';

// Высота невидимой зоны у верхней кромки окна, с которой панель выезжает.
// Раньше триггером была только сама полоса 30px: курсор нужно было поймать
// точно по ней, и панель «не открывалась».
export const TOPBAR_TRIGGER_HEIGHT = 28;

export function isTopbarMode(v: unknown): v is TopbarMode {
  return v === 'slide' || v === 'always';
}

// Разбор значения из localStorage. Неизвестное или битое значение — дефолт, а не
// падение панели. Дефолт передаётся вторым аргументом: у новичка он `always`
// (прятать от него нечего), у всех остальных — `slide`.
export function parseTopbarMode(
  raw: string | null | undefined,
  fallback: TopbarMode = 'slide'
): TopbarMode {
  return raw === 'always' || raw === 'slide' ? raw : fallback;
}

// Дефолт режима по уровню: пока пользователь не выбрал режим сам, новичок
// получает постоянно раскрытую панель, остальные — выезжающую полосу.
// Раньше это делал флаг `pinned` на каждом рендере, из-за чего настройка
// не могла победить: см. пункт 14 UI-редизайна.
export function defaultTopbarMode(skillLevel?: string | null): TopbarMode {
  return skillLevel === 'low' ? 'always' : 'slide';
}

// UX-03: на широком экране (>1200px) места хватает, а основные действия
// (Превью/Сохранить/Опубликовать) не должны прятаться за наведением —
// новый пользователь их просто не находил. Дефолт применяется ТОЛЬКО пока
// пользователь сам не выбрал режим, и НЕ персистится: иначе «always»
// застыл бы в localStorage и на узком окне того же устройства.
// Ширина читается один раз при загрузке модуля: getSnapshot в
// useSyncExternalStore обязан быть стабильным между рендерами.
export const WIDE_SCREEN_WIDTH = 1200;

const WIDE_DEFAULT: TopbarMode =
  typeof window !== 'undefined' && window.innerWidth > WIDE_SCREEN_WIDTH ? 'always' : 'slide';

export function wideTopbarDefault(): TopbarMode {
  return WIDE_DEFAULT;
}

export function nextTopbarMode(mode: TopbarMode): TopbarMode {
  return mode === 'slide' ? 'always' : 'slide';
}

// Раскрыта ли панель. В `always` она видна постоянно и не зависит от наведения;
// в `slide` — по наведению/тапу. `pinned` оставлен для совместимости вызовов и
// больше не перебивает выбранный режим — новичок получает `always` как ДЕФОЛТ
// (see `defaultTopbarMode`), а не как принудительное состояние рендера.
export function topbarExpanded(
  mode: TopbarMode,
  state: { pinned?: boolean; hover?: boolean; open?: boolean }
): boolean {
  if (mode === 'always') return true;
  return !!(state.hover || state.open);
}

// Показывается ли каретка сворачивания: в режиме «всегда видна» сворачивать
// нечего, поэтому кнопка убирается вместе с hover-триггером. У новичка каретка
// тоже есть: он мог выбрать `slide` в настройках, и тогда режим должен работать.
export function topbarToggleVisible(mode: TopbarMode): boolean {
  return mode === 'slide';
}

// Чтение/запись режима. Ошибки доступа к localStorage (приватный режим)
// молча гасим: панель просто останется в дефолтном режиме. Дефолт без
// сохранённого значения — по ширине окна (UX-03).
export function readTopbarMode(): TopbarMode {
  try {
    return parseTopbarMode(localStorage.getItem(TOPBAR_MODE_KEY), wideTopbarDefault());
  } catch {
    return wideTopbarDefault();
  }
}

export function writeTopbarMode(mode: TopbarMode): void {
  try {
    localStorage.setItem(TOPBAR_MODE_KEY, mode);
  } catch {
    /* не критично */
  }
}

// ------------------------------------------------------------------ store
//
// Режим панели меняется из SettingsModal, а читается в конструкторе. Это две
// разные точки дерева, поэтому состояние живёт в крошечном внешнем сторе, а не
// в useState конструктора: иначе переключение в модалке не доходило бы до
// редактора без перезагрузки. Тот же приём, что в settings.ts.

const modeListeners = new Set<() => void>();

function notifyTopbarMode(): void {
  for (const cb of modeListeners) cb();
}

export function getTopbarMode(): TopbarMode {
  return readTopbarMode();
}

export function setTopbarMode(mode: TopbarMode): void {
  writeTopbarMode(mode);
  notifyTopbarMode();
}

// Дефолт по уровню записываем только если пользователь ещё ничего не выбирал:
// явный выбор в настройках всегда важнее уровня. Персистим лишь «always»
// новичка; «slide» — и так фолбэк readTopbarMode, а широкому экрану дефолт
// «always» даёт сам readTopbarMode без записи (UX-03).
export function ensureTopbarMode(skillLevel?: string | null): void {
  try {
    const raw = localStorage.getItem(TOPBAR_MODE_KEY);
    if (isTopbarMode(raw)) return;
    const bySkill = defaultTopbarMode(skillLevel);
    if (bySkill !== 'always') return;
    writeTopbarMode(bySkill);
    notifyTopbarMode();
  } catch {
    /* приватный режим — работаем на дефолтах */
  }
}

export function subscribeTopbarMode(cb: () => void): () => void {
  modeListeners.add(cb);
  if (modeListeners.size === 1) {
    // Другие вкладки того же браузера: без этого режим расходился бы между ними.
    window.addEventListener('storage', onStorageMode);
  }
  return () => {
    modeListeners.delete(cb);
    if (!modeListeners.size) window.removeEventListener('storage', onStorageMode);
  };
}

function onStorageMode(e: StorageEvent): void {
  if (e.key === TOPBAR_MODE_KEY || e.key === null) notifyTopbarMode();
}
