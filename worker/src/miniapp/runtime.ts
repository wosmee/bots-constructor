// Серверный рантайм мини-аппов: проверка Telegram initData, сборка контекста
// юзера, access-правила, видимость элементов и интерполяция {user.*}.
//
// Принципы (как в движке сценариев):
//  - семантика операторов сравнения — ОДНА на платформу: evalConditionOp из
//    engine.ts, никаких вторых реализаций;
//  - теги и переменные юзера читаются существующими функциями db.ts
//    (listUserTags, getClient) — runtime не знает SQL;
//  - сравнение подписи initData — constant-time (safeEqual из платёжного слоя);
//  - любой сбой разбора (битый JSON, мусор в initData) — это null/пусто, а не
//    исключение: рантайм мини-аппа не должен ронять воркер.

import type { MiniAccessRule, MiniContext, MiniElement, MiniVisibleWhen } from '../../../shared/miniapp';
import { normalizeTag } from '../../../shared/types';
import { listUserTags, getClient } from '../db';
import { evalConditionOp } from '../engine';
import { safeEqual } from '../blocks/payments/providers';

// ------------------------------------------------------------------ initData

const enc = new TextEncoder();

// auth_date старше суток — initData отклоняется (реплей открытой ссылки).
const AUTH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

// HMAC-SHA256, ключ — строка; результат — сырые байты. Нужен для промежуточного
// секрета Telegram (он бинарный, в строку его не превратить без потерь).
async function hmacBytes(key: string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

// HMAC-SHA256, ключ — сырые байты; результат — hex строкой.
async function hmacHexWithKey(key: Uint8Array, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

// Проверка initData мини-аппа по алгоритму Telegram:
//  1. secret = HMAC_SHA256(key="WebAppData", data=botToken);
//  2. data_check_string = все пары (URL-декодированные) кроме hash, сортировка
//     по ключу, склейка "\n" в виде key=value;
//  3. HMAC_SHA256(key=secret, data=data_check_string) === hash (constant-time);
//  4. auth_date не старше 24 часов.
// Возвращает профиль из поля user либо null — initData недействителен.
// now вынесен параметром для детерминированных тестов.
export async function parseAndValidateInitData(
  initData: string,
  botToken: string,
  now: number = Date.now()
): Promise<{ userId: number; name: string; username: string | null } | null> {
  const raw = String(initData ?? '');
  const token = String(botToken ?? '');
  if (!raw || !token) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const hash = params.get('hash');
  if (!hash) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (now - authDate * 1000 > AUTH_MAX_AGE_MS) return null;

  const pairs: [string, string][] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') pairs.push([key, value]);
  });
  // Сортировка именно по ключу: сортировка готовых строк «key=value» дала бы
  // иной порядок, если один ключ — префикс другого с цифрой ('=' > '0'-'9').
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  let computed: string;
  try {
    const secret = await hmacBytes('WebAppData', token);
    computed = await hmacHexWithKey(secret, dataCheckString);
  } catch {
    return null;
  }
  if (!safeEqual(computed, hash.trim().toLowerCase())) return null;

  let user: any = null;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    return null;
  }
  const userId = Number(user?.id);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const first = String(user.first_name ?? '').trim();
  const last = String(user.last_name ?? '').trim();
  const username = typeof user.username === 'string' && user.username ? user.username : null;
  const name = [first, last].filter(Boolean).join(' ') || username || '';
  return { userId, name, username };
}

// ------------------------------------------------------------------ контекст

// Контекст юзера для рантайма: теги и переменные из существующих функций db.ts.
// Имя/username — из initData (свежее); если пустые — фолбэк на профиль сессии.
// Значения переменных приводятся к строке: visible_when и интерполяция работают
// со строками, как и движок сценариев.
export async function buildContext(
  db: D1Database,
  botId: string,
  userId: number,
  name: string,
  username: string | null
): Promise<MiniContext> {
  const [tags, client] = await Promise.all([
    listUserTags(db, botId, userId).catch(() => [] as string[]),
    getClient(db, botId, userId).catch(() => null),
  ]);
  const vars: Record<string, string> = {};
  try {
    const parsed = JSON.parse(client?.vars_json ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        vars[k] = v === null || v === undefined ? '' : String(v);
      }
    }
  } catch {
    /* битый vars_json — контекст без переменных, не падение */
  }
  return {
    userId,
    name: String(name ?? '').trim() || client?.first_name || '',
    username: username ?? client?.username ?? null,
    tags,
    vars,
  };
}

// ------------------------------------------------------------------ доступ

// Кто может открыть мини-апп. Теги в базе уже нормализованы (см. db.ts),
// правило нормализуем той же normalizeTag — иначе «VIP» и «vip» разошлись бы.
export function checkAccess(rule: MiniAccessRule, ctx: MiniContext): boolean {
  switch (rule?.kind) {
    case 'all':
      return true;
    case 'tag':
      return !!rule.tag && ctx.tags.includes(normalizeTag(rule.tag));
    case 'users':
      return Array.isArray(rule.ids) && rule.ids.includes(ctx.userId);
    default:
      // Неизвестное правило — доступ закрыт: fail-safe, а не «пустим всех».
      return false;
  }
}

// ------------------------------------------------------------------ видимость

// Резолвинг ссылки visible_when: user.id/user.name/user.username, tag:<имя>
// ('1' если тег есть, иначе ''), var:<имя> (переменная юзера), field:<колонка>
// (значение из строки/карточки). Строка без известного префикса — литерал
// (правая часть «== Москва»); неизвестный префикс — ''.
export function resolveRef(ref: string, ctx: MiniContext, row?: Record<string, string>): string {
  const s = String(ref ?? '');
  if (s.startsWith('user.')) {
    const key = s.slice(5);
    if (key === 'id') return String(ctx.userId);
    if (key === 'name') return ctx.name;
    if (key === 'username') return ctx.username ?? '';
    return '';
  }
  const colon = s.indexOf(':');
  if (colon === -1) return s;
  const prefix = s.slice(0, colon);
  const name = s.slice(colon + 1);
  if (prefix === 'tag') return ctx.tags.includes(normalizeTag(name)) ? '1' : '';
  if (prefix === 'var') {
    const v = ctx.vars[name];
    return v === undefined || v === null ? '' : String(v);
  }
  if (prefix === 'field') {
    const v = row?.[name];
    return v === undefined || v === null ? '' : String(v);
  }
  return '';
}

// Видим ли элемент. Отсутствие условия (null/undefined) — видим всегда.
// Семантика операторов — evalConditionOp из engine.ts: те же 13 ConditionOp,
// одна реализация на condition-блоки и мини-аппы.
export function evalVisible(
  cond: MiniVisibleWhen | null | undefined,
  ctx: MiniContext,
  row?: Record<string, string>
): boolean {
  if (!cond) return true;
  const left = resolveRef(cond.left, ctx, row);
  const right = resolveRef(cond.right, ctx, row);
  return evalConditionOp(left, cond.op, right);
}

// Элементы страницы, которые видит этот юзер (без строки — не внутри карточки).
export function filterVisibleElements(els: MiniElement[], ctx: MiniContext): MiniElement[] {
  return (els ?? []).filter((e) => e && evalVisible(e.visible_when, ctx));
}

// ------------------------------------------------------------------ серверный скоупинг схемы
//
// F-036 (аудит 18.10, задача 1a): visible_when обязан применяться НА СЕРВЕРЕ.
// Раньше фильтр был только клиентским: boot отдавал полную схему, и любой юзер
// читал «админские» страницы/элементы (а через query — и все таблицы бота).

// Условия со ссылкой field: вычисляются на строке карточки — серверного
// контекста строки нет, поэтому такие элементы НЕ фильтруются сервером.
// Доступ к таблице они не расширяют: таблица уже открыта родительским элементом.
function hasFieldRef(cond: MiniVisibleWhen | null | undefined): boolean {
  if (!cond) return false;
  return String(cond.left ?? '').startsWith('field:') || String(cond.right ?? '').startsWith('field:');
}

// Серверная фильтрация схемы мини-аппа для boot-ответа: скрытые элементы не
// уходят клиенту вовсе. Возвращает копию, исходник не мутирует.
export function filterVisibleApp<T>(app: T, ctx: MiniContext): T {
  const a = app as any;
  if (!a || !Array.isArray(a.pages)) return app;
  return {
    ...a,
    pages: a.pages.map((p: any) => ({
      ...p,
      els: Array.isArray(p?.els)
        ? p.els.filter((e: MiniElement) => e && (hasFieldRef(e.visible_when) || evalVisible(e.visible_when, ctx)))
        : [],
    })),
  };
}

// Whitelist таблиц юзера: строится из ВИДИМЫХ элементов отфильтрованной схемы —
// props.table data-элементов и table действия 'data'. /m/api query/action
// сверяют с ним body.table: таблица, которой нет ни на одном доступном
// элементе, юзеру не читается и не пишется.
export function collectAllowedTables(app: any): Set<string> {
  const tables = new Set<string>();
  for (const p of app?.pages ?? []) {
    for (const e of p?.els ?? []) {
      if (!e) continue;
      const t = (e.props as any)?.table;
      if (typeof t === 'string' && t) tables.add(t);
      const act: any = e.action;
      if (act?.id === 'data' && typeof act.table === 'string' && act.table) tables.add(act.table);
    }
  }
  return tables;
}

// ------------------------------------------------------------------ интерполяция

// {user.name} / {user.id} / {user.username} в текстах мини-аппа. Плейсхолдер —
// одинарные фигурные скобки (не {{var}} сценариев, поэтому interpolate из
// shared/types напрямую не подходит). Неизвестные {ключи} остаются как есть;
// username === null подставляет пустую строку (конвенция движка: undefined/null
// -> '').
const MINI_USER_RE = /\{\s*user\.(id|name|username)\s*\}/g;

export function interpolate(text: string, ctx: MiniContext): string {
  const s = String(text ?? '');
  if (!s) return '';
  return s.replace(MINI_USER_RE, (_m, key: string) => {
    if (key === 'id') return String(ctx.userId);
    if (key === 'name') return ctx.name;
    return ctx.username ?? '';
  });
}
