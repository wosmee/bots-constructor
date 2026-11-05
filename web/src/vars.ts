// Системные переменные: их выставляет платформа, автор сценария их не создаёт.
// Один список на всё приложение — панель переменных, чипсы в инспекторе и
// подсказки должны называть одно и то же.
// Внутренние '__*' (isInternalVar из shared/types) сюда НЕ попадают: движок
// использует их для своего обмена, автор их не видит и не подставляет.
import type { TKey } from './i18n';

export const SYSTEM_VARS: { name: string; key: TKey }[] = [
  { name: 'last_input', key: 'vars.sys.lastInput' },
  { name: 'ref.link', key: 'vars.sys.refLink' },
  { name: 'ref.inviter', key: 'vars.sys.refInviter' },
  { name: 'ref.count', key: 'vars.sys.refCount' },
  { name: 'ref.verified', key: 'vars.sys.refVerified' },
  { name: 'ref.earnings', key: 'vars.sys.refEarnings' },
  { name: 'ref.leaderboard', key: 'vars.sys.refLeaderboard' },
  { name: 'ref.referred', key: 'vars.sys.refReferred' },
  { name: 'ref.event', key: 'vars.sys.refEvent' },
  // набор 2026-09: платежи, опросы и профиль пользователя (PUBLIC_SYSTEM_VARS
  // из shared/types — те же имена, без внутренних '__*').
  { name: 'pay.link', key: 'vars.sys.payLink' },
  { name: 'pay.order', key: 'vars.sys.payOrder' },
  { name: 'poll.answer', key: 'vars.sys.pollAnswer' },
  { name: 'poll.options', key: 'vars.sys.pollOptions' },
  { name: 'user.name', key: 'vars.sys.userName' },
  { name: 'user.username', key: 'vars.sys.userUsername' },
  { name: 'user.id', key: 'vars.sys.userId' },
  { name: 'user.tags', key: 'vars.sys.userTags' },
  { name: 'user.subscription', key: 'vars.sys.userSubscription' },
  { name: 'user.paid_total', key: 'vars.sys.userPaidTotal' },
  { name: 'user.ref_count', key: 'vars.sys.userRefCount' },
  { name: 'user.first_seen', key: 'vars.sys.userFirstSeen' },
  // набор 2026-10: язык и геопозиция из апдейта (блоки language / location).
  { name: 'user.lang', key: 'vars.sys.userLang' },
  { name: 'user.lat', key: 'vars.sys.userLat' },
  { name: 'user.lon', key: 'vars.sys.userLon' },
];

export const SYSTEM_VAR_NAMES = SYSTEM_VARS.map((v) => v.name);

export function isSystemVar(name: string): boolean {
  return SYSTEM_VAR_NAMES.includes(name);
}

// Вставка текста в поле в позицию курсора.
//
// Поля в инспекторе — контролируемые (value из состояния React), поэтому
// простого `el.value = ...` недостаточно: React затрёт его при следующей
// перерисовке. Пишем значение через нативный сеттер и вручную поднимаем
// событие input — так React узнаёт об изменении так же, как при живом вводе.
// Курсор после вставки ставим за вставленным текстом.
export function insertAtCaret(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  text: string
): void {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const next = el.value.slice(0, start) + text + el.value.slice(end);

  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, next);
  else el.value = next;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  const caret = start + text.length;
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* тип поля без выделения — не критично */
  }
}

// Отфильтровать переменные сценария по строке поиска (голосовой ввод не нужен,
// но подстрока по имени — то, что ожидают).
export function filterVars<T extends { name: string }>(list: T[], query: string): T[] {
  const q = normalizeSearchLite(query);
  if (!q) return list;
  return list.filter((v) => normalizeSearchLite(v.name).includes(q));
}

function normalizeSearchLite(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
}
