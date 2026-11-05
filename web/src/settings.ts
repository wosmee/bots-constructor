// Настройки интерфейса: per-user, на бэке (D1). Один внешний стор на всё
// приложение — тема и язык применяются сразу, без перезагрузки.
import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { Lang } from './i18n';

export type ThemeName = 'dark' | 'light';
export type SkillLevel = 'high' | 'medium' | 'low';
export type PaletteMode = 'accordion' | 'free';

export interface Settings {
  theme: ThemeName;
  hints_enabled: boolean;
  language: Lang;
  feature_whatif: boolean;
  feature_conflicts: boolean;
  feature_sleep: boolean;
  /** Показывать секцию «Продвинутое» в палитре блоков. */
  advanced_blocks: boolean; // TODO(prompt-2): full UI
  /** '' — уровень ещё не выбран (после регистрации покажем экран выбора). */
  skill_level: SkillLevel | '';
  /** Как раскрываются группы палитры: по одной (аккордеон) или любое число. */
  palette_mode: PaletteMode;
  // Когда уровень выбрали. Пока null/undefined — стартовый экран ещё не
  // показывали. Смотреть на пустой skill_level нельзя: пока настройки грузятся,
  // он пуст у всех, и модалка мигает даже тем, у кого уровень есть (F8).
  skill_level_set_at: number | null;
  // Когда прошли тур «соберите первого бота». Живёт на аккаунте, не в браузере (F9).
  tour_done_at: number | null;
}

export type UserRole = 'user' | 'moderator' | 'admin';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  hints_enabled: true,
  language: 'ru',
  feature_whatif: true,
  feature_conflicts: true,
  feature_sleep: true,
  advanced_blocks: false, // TODO(prompt-2): full UI
  skill_level: '',
  palette_mode: 'accordion',
  skill_level_set_at: null,
  tour_done_at: null,
};

const SKILL_LEVELS: (SkillLevel | '')[] = ['', 'high', 'medium', 'low'];

let state: Settings = { ...DEFAULT_SETTINGS };
let role: UserRole = 'user';
// Пока настройки не пришли с сервера, их значения — это дефолты, а не факты о
// пользователе. Различать эти два состояния обязательно: иначе экран выбора
// уровня показывается всем, кто просто ещё ждёт ответ сервера (F8).
let loaded = false;
// Счётчик запросов: ответ, пришедший после более свежего запроса, игнорируется.
// Вместе с мержем это снимает гонку, когда два тумблера щёлкают подряд.
let reqSeq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getSettings(): Settings {
  return state;
}
export function getRole(): UserRole {
  return role;
}

export function isSettingsLoaded(): boolean {
  return loaded;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyTheme(theme: ThemeName) {
  // Тема — это инверсия графита через CSS-переменные; медный акцент не трогаем.
  document.documentElement.dataset.theme = theme;
}

// Тема и язык применяются парой: одна функция, чтобы не забыть второе.
function applyUi(s: Settings) {
  applyTheme(s.theme);
  applyLang(s.language);
}

// Язык интерфейса должен совпадать с тем, что видит человек: скринридеры,
// подбор словарей браузером и проверка орфографии читают <html lang>.
function applyLang(lang: Lang) {
  const prev = document.documentElement.getAttribute('lang');
  if (prev !== lang) document.documentElement.setAttribute('lang', lang);
}

// Разбор ответа сервера. Возвращает только те поля, что реально пришли —
// мержим поверх текущего состояния, а не заменяем его целиком.
function mapServer(r: any): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (r == null || typeof r !== 'object') return out;
  if (r.theme === 'light' || r.theme === 'dark') out.theme = r.theme;
  if (typeof r.hints_enabled !== 'undefined') out.hints_enabled = !!r.hints_enabled && r.hints_enabled !== 0;
  if (r.language === 'en' || r.language === 'ru') out.language = r.language;
  if (typeof r.feature_whatif !== 'undefined') out.feature_whatif = !!r.feature_whatif && r.feature_whatif !== 0;
  if (typeof r.feature_conflicts !== 'undefined')
    out.feature_conflicts = !!r.feature_conflicts && r.feature_conflicts !== 0;
  if (typeof r.feature_sleep !== 'undefined') out.feature_sleep = !!r.feature_sleep && r.feature_sleep !== 0;
  // TODO(prompt-2): full UI
  if (typeof r.advanced_blocks !== 'undefined') out.advanced_blocks = !!r.advanced_blocks && r.advanced_blocks !== 0;
  if (SKILL_LEVELS.includes(r.skill_level)) out.skill_level = r.skill_level;
  // Неизвестное или устаревшее значение трактуем как 'accordion' — дефолт.
  if (r.palette_mode === 'free' || r.palette_mode === 'accordion') out.palette_mode = r.palette_mode;
  // Даты: 0 и мусор трактуем как «не задано» — иначе экран выбора уровня и тур
  // показались бы по случайному значению.
  const stamp = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  if ('skill_level_set_at' in r) out.skill_level_set_at = stamp(r.skill_level_set_at);
  if ('tour_done_at' in r) out.tour_done_at = stamp(r.tour_done_at);
  return out;
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

export function useRole(): UserRole {
  return useSyncExternalStore(subscribe, getRole, getRole);
}

export function useSettingsLoaded(): boolean {
  return useSyncExternalStore(subscribe, isSettingsLoaded, isSettingsLoaded);
}

// Грузим при входе. Ошибку не пробрасываем: без бэка работаем на дефолтах.
export async function loadSettings(): Promise<void> {
  try {
    const r: any = await api.getSettings();
    state = { ...state, ...mapServer(r) };
    role = (r?.role as UserRole) ?? 'user';
    applyUi(state);
    emit();
  } catch {
    applyUi(state);
    emit();
  } finally {
    // Даже если сервер не ответил, «ждать» больше нечего: интерфейс должен
    // перестать считать настройки неизвестными и показать что-то определённое.
    loaded = true;
    emit();
  }
}

export function resetSettings(): void {
  reqSeq++;
  state = { ...DEFAULT_SETTINGS };
  role = 'user';
  loaded = false;
  applyUi(state);
  emit();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const safePatch = { ...patch };
  // Переключатели не должны случайно сбрасывать выбранный уровень.
  if (!Object.prototype.hasOwnProperty.call(safePatch, 'skill_level')) delete safePatch.skill_level;
  // Применяем локально сразу — интерфейс не должен ждать сеть.
  const next = { ...state, ...safePatch };
  const previous = state;
  state = next;
  applyUi(next);
  emit();

  const seq = ++reqSeq;
  try {
    const r: any = await api.putSettings(safePatch);
    // Пока шёл запрос, пользователь успел кликнуть ещё — этот ответ устарел.
    if (seq !== reqSeq) return;
    // Мержим, а не заменяем: сервер — истина по своим полям, но локальные
    // правки, сделанные за время запроса, перетирать нельзя.
    state = { ...state, ...mapServer(r) };
    if (r?.role) role = r.role;
    applyUi(state);
    emit();
  } catch (error) {
    // Не выдаём несохранённое состояние за действительное. Если тем временем
    // был новый клик, его запрос владеет состоянием и откат старого ответа нельзя.
    if (seq === reqSeq) {
      state = previous;
      applyUi(state);
      emit();
    }
    throw error;
  }
}
