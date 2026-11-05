// Верхняя панель (F11): режим раскрытия и раскладка действий.
// Логика вынесена в чистые функции, поэтому проверяется здесь, а не через UI.
import { describe, expect, it } from 'vitest';
import {
  TOPBAR_ACTIONS,
  HELP_ACTION_IDS,
  editorOverflowActions,
  primaryActions,
  overflowActions,
  topbarVisibleItemCount,
  visibleActionIds,
} from '../web/src/topbarActions';
import {
  TOPBAR_MODE_KEY,
  TOPBAR_TRIGGER_HEIGHT,
  defaultTopbarMode,
  isTopbarMode,
  nextTopbarMode,
  parseTopbarMode,
  topbarExpanded,
  topbarToggleVisible,
} from '../web/src/topbar';

describe('parseTopbarMode', () => {
  it('дефолт — slide: панель не занимает вертикаль постоянно', () => {
    expect(parseTopbarMode(null)).toBe('slide');
    expect(parseTopbarMode(undefined)).toBe('slide');
    expect(parseTopbarMode('')).toBe('slide');
  });

  it('пускает только известные значения, мусор трактует как slide', () => {
    expect(parseTopbarMode('always')).toBe('always');
    expect(parseTopbarMode('slide')).toBe('slide');
    expect(parseTopbarMode('ALWAYS')).toBe('slide');
    expect(parseTopbarMode('{"mode":"always"}')).toBe('slide');
    expect(isTopbarMode('always')).toBe(true);
    expect(isTopbarMode('sometimes')).toBe(false);
  });
});

describe('nextTopbarMode', () => {
  it('переключает режим в обе стороны', () => {
    expect(nextTopbarMode('slide')).toBe('always');
    expect(nextTopbarMode('always')).toBe('slide');
  });
});

describe('topbarExpanded', () => {
  it('в slide панель раскрыта по наведению или тапу', () => {
    expect(topbarExpanded('slide', {})).toBe(false);
    expect(topbarExpanded('slide', { hover: true })).toBe(true);
    expect(topbarExpanded('slide', { open: true })).toBe(true);
  });

  it('в always панель раскрыта всегда, даже без наведения', () => {
    expect(topbarExpanded('always', {})).toBe(true);
    expect(topbarExpanded('always', { hover: false, open: false })).toBe(true);
  });

  // Регрессия к пункту 14 редизайна: `pinned` перебивал выбранный режим на
  // каждом рендере, поэтому новичок физически не мог получить `slide`.
  it('pinned больше не перебивает выбранный режим', () => {
    expect(topbarExpanded('slide', { pinned: true })).toBe(false);
    expect(topbarExpanded('slide', { pinned: true, hover: true })).toBe(true);
  });
});

describe('topbarToggleVisible', () => {
  it('каретка сворачивания есть только в slide', () => {
    expect(topbarToggleVisible('slide')).toBe(true);
    expect(topbarToggleVisible('always')).toBe(false);
  });

  it('новичку каретка тоже нужна: он мог сам выбрать slide', () => {
    expect(topbarToggleVisible('slide')).toBe(true);
  });
});

describe('defaultTopbarMode', () => {
  it('уровень задаёт дефолт, а не принудительное состояние', () => {
    // Новичку панель раскрыта «по умолчанию»: прятать от него нечего.
    expect(defaultTopbarMode('low')).toBe('always');
    expect(defaultTopbarMode('medium')).toBe('slide');
    expect(defaultTopbarMode('high')).toBe('slide');
    expect(defaultTopbarMode(null)).toBe('slide');
    expect(defaultTopbarMode(undefined)).toBe('slide');
  });

  it('дефолт применяется только к пустому значению localStorage', () => {
    // Явный выбор пользователя важнее уровня — иначе настройка безмолвно
    // отменялась бы при каждой загрузке редактора.
    expect(parseTopbarMode(null, defaultTopbarMode('low'))).toBe('always');
    expect(parseTopbarMode('slide', defaultTopbarMode('low'))).toBe('slide');
    expect(parseTopbarMode('always', defaultTopbarMode('high'))).toBe('always');
    expect(parseTopbarMode('мусор', defaultTopbarMode('low'))).toBe('always');
  });
});

describe('зона выезда', () => {
  it('полоса выезда заведомо шире прежних 30px по высоте окна', () => {
    expect(TOPBAR_TRIGGER_HEIGHT).toBeGreaterThanOrEqual(24);
    expect(TOPBAR_TRIGGER_HEIGHT).toBeLessThanOrEqual(32);
  });

  it('ключ режима — оконный, в стиле остальных настроек браузера', () => {
    expect(TOPBAR_MODE_KEY).toBe('topbar.mode');
  });
});

describe('раскладка действий', () => {
  it('на виду не больше пяти элементов вместе с обвязкой панели', () => {
    // Обвязка — «?» (справка) и «…» (редкие действия); они тоже занимают место.
    expect(topbarVisibleItemCount()).toBeLessThanOrEqual(5);
    expect(visibleActionIds()).toEqual(['preview', 'save', 'publish']);
  });

  it('редкие действия не теряются — они в меню «ещё»', () => {
    const overflow = overflowActions().map((a) => a.id);
    expect(overflow).toContain('versions');
    expect(overflow).toContain('settings');
    expect(overflow).toContain('guide');
    expect(overflow).toContain('catalog');
    expect(overflow).toContain('data');
    expect(overflow).toContain('tour');
    expect(overflow).toContain('templates');
    expect(overflow).toContain('undo');
    expect(overflow).toContain('redo');
    expect(overflow).toContain('search');
    expect(overflow).toContain('tidy');
    expect(overflow).toContain('vars');
    expect(overflow).toContain('stats');
    expect(overflow).toContain('logs');
    expect(overflow).toContain('shortcuts');
  });

  // Пункт 4 редизайна: справка уходит под отдельный вход «?», а разделы
  // аккаунта (каталог, данные) — на дашборд, а не в панель редактора.
  it('в панели редактора остаются только действия со сценарием', () => {
    const editor = editorOverflowActions().map((a) => a.id);
    expect(editor).toContain('versions');
    expect(editor).toContain('settings');
    expect(editor).toContain('search');
    expect(editor).toContain('logs');
    expect(editor).not.toContain('guide');
    expect(editor).not.toContain('tour');
    expect(editor).not.toContain('shortcuts');
    expect(editor).not.toContain('catalog');
    expect(editor).not.toContain('data');
  });

  it('в справку попадают ровно guide/tour/shortcuts', () => {
    expect(HELP_ACTION_IDS).toEqual(['guide', 'tour', 'shortcuts']);
  });

  it('каждое действие попадает ровно в одну корзину', () => {
    const all = [...primaryActions().map((a) => a.id), ...overflowActions().map((a) => a.id)];
    expect(all.length).toBe(TOPBAR_ACTIONS.length);
    expect(new Set(all).size).toBe(all.length);
  });
});
