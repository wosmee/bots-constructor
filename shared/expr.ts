// Функции выражений: небольшой whitelisted набор над интерполяцией {{var}}.
//
// Устройство: движок сначала интерполирует шаблон ({{var}} -> значение), затем
// этот модуль вычисляет вызовы функций в строке, и только потом остаток отдаётся
// в evalExpression() — тот же безопасный калькулятор арифметики, что был раньше.
// Если в выражении нет ни одного вызова функции, поведение полностью прежнее:
// evalExpression и ничего больше.
//
// Ни eval, ни new Function здесь нет: разбор ручной, грамматика строгая,
// аргументы — только литералы и вложенные вызовы.
import { evalExpression } from './types';

// Белый список. Всё, чего здесь нет, — ошибка автора, а не «ничего не делать»:
// молчаливое игнорирование сделало бы опечатку невидимой.
export const EXPR_FUNCTIONS = [
  'len',
  'upper',
  'lower',
  'trim',
  'substr',
  'replace',
  'concat',
  'default',
  'now',
  'today',
  'format_date',
  'random',
  'round',
  'floor',
  'ceil',
] as const;

export type ExprFunction = (typeof EXPR_FUNCTIONS)[number];

const FUNC_SET = new Set<string>(EXPR_FUNCTIONS);

// Потолок вложенности: защита от длинной цепочки скобок. Глубже — считаем
// выражение сломанным и отдаём исходную строку: сценарий не должен вешать воркер.
const MAX_DEPTH = 24;
// Ограничение на длину результата одной функции: concat() иначе мог бы вернуть
// мегабайты, которые затем уедут в Telegram.
const MAX_RESULT = 64 * 1024;

export interface ExprEval {
  /** Итоговое значение: число, если остаток — арифметика, иначе строка. */
  value: string | number;
  /** false — выражение не вычислилось (неизвестная функция/битая скобка). */
  ok: boolean;
  /** Код причины для валидатора: 'expr-unknown-fn' | 'expr-malformed'. */
  error?: 'expr-unknown-fn' | 'expr-malformed';
  /** Текст проблемы для сообщения автору. */
  message?: string;
}

// Идентификатор на позиции i: имя целиком, индекс за ним и позиция «(» после
// необязательных пробелов (-1, если скобки нет). Вынесено отдельно, потому что
// сканирование обязано быть однопроходным: наивный «пробег до конца слова на
// каждой позиции» даёт квадратичное время, и строка в 100 КБ вешала воркер.
interface IdentHit {
  name: string;
  /** Индекс за последним символом имени. */
  end: number;
  /** Индекс «(» сразу после имени (пробелы пропущены) либо -1. */
  open: number;
}

function isIdentStart(ch: string | undefined): boolean {
  return !!ch && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_');
}

function isIdentChar(ch: string | undefined): boolean {
  return isIdentStart(ch) || (!!ch && ch >= '0' && ch <= '9');
}

function scanIdent(src: string, i: number): IdentHit | null {
  if (!isIdentStart(src[i])) return null;
  let j = i;
  while (j < src.length && isIdentChar(src[j])) j++;
  let k = j;
  while (k < src.length && src[k] === ' ') k++;
  // Слева не должно быть «склейки»: «ab» в «2ab(3)» — уже не имя функции.
  if (i > 0 && /[A-Za-z0-9_.]/.test(src[i - 1])) return { name: src.slice(i, j), end: j, open: -1 };
  return { name: src.slice(i, j), end: j, open: src[k] === '(' ? k : -1 };
}

// Позиция закрывающей скобки для вызова, открытого в `open`. Учитывает
// вложенность и кавычки: «replace(x, ")", y)» — закрывающая внутри строки.
function matchingParen(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Аргументы вызова: режем по запятым верхнего уровня, кавычки и вложенные
// скобки не считаются разделителями.
export function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

interface Ctx {
  now: number;
  error?: 'expr-unknown-fn' | 'expr-malformed';
  message?: string;
  rand: () => number;
}

// Значение аргумента: строка в кавычках — как есть; иначе — рекурсивное
// вычисление (вложенные вызовы) и, если остаток — чистая арифметика, её
// вычисление. Без второго шага `round(5 * 1.2)` получило бы строку «5 * 1.2»
// и превратило бы её в 0.
function argValue(raw: string, depth: number, ctx: Ctx): string {
  const t = raw.trim();
  if (t.length >= 2) {
    const q = t[0];
    if ((q === '"' || q === "'") && t[t.length - 1] === q) return t.slice(1, -1);
  }
  // Аргумент без вызовов — обычная арифметика («round(5 * 1.2)»): считаем её.
  if (!hasFunctionCall(t)) return String(evalExpression(t));
  const inner = evalCalls(t, depth + 1, ctx);
  if (!inner.ok) {
    ctx.error ||= inner.error;
    ctx.message ||= inner.message;
    return t;
  }
  // Арифметику считаем только когда она была ВНЕ вызовов: результат функции —
  // значение, а не выражение.
  return String(finishValue(inner.text, !!inner.arithmetic));
}

function num(raw: string, fallback = 0): number {
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : fallback;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

// Разбор «даты» в Date: принимаем unix-мс, unix-секунды и строку YYYY-MM-DD.
export function toDate(raw: string, _now: number): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) {
    // Похоже на секунды, а не миллисекунды: 10 цифр вместо 13.
    const ms = Math.abs(n) < 1e11 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(iso)) return null;
  return new Date(iso);
}

// Подстановка даты по шаблону: YYYY MM DD HH mm ss. Неизвестные буквы остаются
// как есть — «сегодня 23.09» автор напишет сам.
export function formatDate(d: Date, pattern?: string): string {
  const p = (pattern ?? '').trim() || 'YYYY-MM-DD';
  return p
    .replace(/YYYY/g, String(d.getUTCFullYear()))
    .replace(/MM/g, pad2(d.getUTCMonth() + 1))
    .replace(/DD/g, pad2(d.getUTCDate()))
    .replace(/HH/g, pad2(d.getUTCHours()))
    .replace(/mm/g, pad2(d.getUTCMinutes()))
    .replace(/ss/g, pad2(d.getUTCSeconds()));
}

function clip(s: string): string {
  return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) : s;
}

function digitsOf(raw: string | undefined): number {
  return raw === undefined ? 0 : Math.max(0, Math.min(10, Math.trunc(num(raw))));
}

// Вызов одной функции по имени и аргументам. Неизвестное имя -> ошибка.
function callFunction(name: string, args: string[], depth: number, ctx: Ctx): { ok: boolean; value: string } {
  if (!FUNC_SET.has(name)) {
    ctx.error ||= 'expr-unknown-fn';
    ctx.message ||= `Неизвестная функция ${name}()`;
    return { ok: false, value: '' };
  }
  const a = args.map((x) => argValue(x, depth, ctx));
  if (ctx.error) return { ok: false, value: '' };

  const checkArity = (min: number, max: number): boolean => {
    if (a.length < min || a.length > max) {
      ctx.error ||= 'expr-malformed';
      ctx.message ||= `${name}(): нужно аргументов от ${min} до ${max}, получено ${a.length}`;
      return false;
    }
    return true;
  };
  const fail = { ok: false, value: '' };

  switch (name as ExprFunction) {
    case 'len':
      if (!checkArity(1, 1)) return fail;
      return { ok: true, value: String(a[0].length) };
    case 'upper':
      if (!checkArity(1, 1)) return fail;
      return { ok: true, value: a[0].toUpperCase() };
    case 'lower':
      if (!checkArity(1, 1)) return fail;
      return { ok: true, value: a[0].toLowerCase() };
    case 'trim': {
      if (!checkArity(1, 2)) return fail;
      const s = a[0].trim();
      // Второй аргумент — список символов для обрезки (как в PHP trim).
      if (a.length < 2 || !a[1]) return { ok: true, value: s };
      const chars = new Set(a[1].split(''));
      let i = 0;
      let j = s.length;
      while (i < j && chars.has(s[i])) i++;
      while (j > i && chars.has(s[j - 1])) j--;
      return { ok: true, value: s.slice(i, j) };
    }
    case 'substr': {
      if (!checkArity(2, 3)) return fail;
      const s = a[0];
      const from = Math.trunc(num(a[1]));
      const start = from < 0 ? Math.max(0, s.length + from) : Math.min(from, s.length);
      if (a.length < 3) return { ok: true, value: s.slice(start) };
      const len = Math.max(0, Math.trunc(num(a[2])));
      return { ok: true, value: s.slice(start, start + len) };
    }
    case 'replace': {
      if (!checkArity(3, 3)) return fail;
      // Разделитель — строка, не регулярка: регексп из данных пользователя
      // вёл бы себя непредсказуемо (и это ReDoS-поверхность).
      if (!a[1]) return { ok: true, value: a[0] };
      return { ok: true, value: a[0].split(a[1]).join(a[2]) };
    }
    case 'concat':
      return { ok: true, value: clip(a.join('')) };
    case 'default':
      if (!checkArity(1, 3)) return fail;
      if (a[0] !== '' && a[0] !== 'undefined' && a[0] !== 'null') return { ok: true, value: a[0] };
      return { ok: true, value: a.length > 1 ? a[1] : '' };
    case 'now':
      if (!checkArity(0, 1)) return fail;
      if (a.length === 1 && a[0].trim()) return { ok: true, value: formatDate(new Date(ctx.now), a[0]) };
      return { ok: true, value: String(ctx.now) };
    case 'today':
      if (!checkArity(0, 1)) return fail;
      return { ok: true, value: formatDate(new Date(ctx.now), a[0] || 'YYYY-MM-DD') };
    case 'format_date': {
      if (!checkArity(1, 2)) return fail;
      const d = toDate(a[0], ctx.now);
      if (!d) {
        ctx.error ||= 'expr-malformed';
        ctx.message ||= `format_date(): не удалось разобрать дату «${a[0]}»`;
        return fail;
      }
      return { ok: true, value: formatDate(d, a[1]) };
    }
    case 'random': {
      if (!checkArity(0, 2)) return fail;
      // random() -> 0..99, random(max) -> 0..max-1, random(min,max) -> [min,max).
      if (a.length === 0) return { ok: true, value: String(Math.floor(ctx.rand() * 100)) };
      if (a.length === 1) {
        const max = Math.trunc(num(a[0], 100));
        return { ok: true, value: String(max <= 0 ? 0 : Math.floor(ctx.rand() * max)) };
      }
      const min = Math.trunc(num(a[0]));
      const max = Math.trunc(num(a[1]));
      if (max <= min) return { ok: true, value: String(min) };
      return { ok: true, value: String(min + Math.floor(ctx.rand() * (max - min))) };
    }
    case 'round': {
      if (!checkArity(1, 2)) return fail;
      const factor = 10 ** digitsOf(a[1]);
      return { ok: true, value: String(Math.round(num(a[0]) * factor) / factor) };
    }
    case 'floor': {
      if (!checkArity(1, 2)) return fail;
      const factor = 10 ** digitsOf(a[1]);
      return { ok: true, value: String(Math.floor(num(a[0]) * factor) / factor) };
    }
    case 'ceil': {
      if (!checkArity(1, 2)) return fail;
      const factor = 10 ** digitsOf(a[1]);
      return { ok: true, value: String(Math.ceil(num(a[0]) * factor) / factor) };
    }
    default:
      ctx.error ||= 'expr-unknown-fn';
      ctx.message ||= `Неизвестная функция ${name}()`;
      return fail;
  }
}

// Вычислить все вызовы функций в строке. Возвращает текст, в котором вызовы
// заменены результатами, а весь остальной текст остался как был.
export function evalCalls(
  src: string,
  depth = 0,
  ctx: Ctx = { now: Date.now(), rand: Math.random }
): {
  ok: boolean;
  text: string;
  error?: 'expr-unknown-fn' | 'expr-malformed';
  message?: string;
  /** true, если вне вызовов встречалась арифметика — тогда остаток считается калькулятором. */
  arithmetic?: boolean;
} {
  if (depth > MAX_DEPTH) {
    return { ok: false, text: src, error: 'expr-malformed', message: 'Слишком глубокая вложенность выражений' };
  }
  const s = src ?? '';
  let out = '';
  let i = 0;
  // Операторы и цифры, встреченные ВНЕ вызовов функций. Нужны, чтобы решить,
  // считать ли арифметику над результатом: результат функции — непрозрачное
  // значение, и прогонять его через калькулятор нельзя (дата «2026-09-23»
  // иначе превратилась бы в 1994: калькулятор видит там вычитание).
  let arithmeticOutside = false;
  while (i < s.length) {
    const ident = scanIdent(s, i);
    if (!ident || ident.open < 0) {
      // Обычный текст: копируем слово целиком, а не по символу. Это и делает
      // проход линейным — иначе на длинной строке без вызовов мы бы сканировали
      // каждую позицию заново.
      const literal = s.slice(i, ident ? ident.end : i + 1);
      if (/[+\-*/]/.test(literal) || /\d/.test(literal)) arithmeticOutside = true;
      out += literal;
      i = ident ? ident.end : i + 1;
      continue;
    }
    const close = matchingParen(s, ident.open);
    if (close < 0) {
      return { ok: false, text: s, error: 'expr-malformed', message: `Не закрыта скобка вызова ${ident.name}(` };
    }
    const innerRaw = s.slice(ident.open + 1, close);
    const args = innerRaw.trim() === '' ? [] : splitArgs(innerRaw);
    const res = callFunction(ident.name, args, depth, ctx);
    if (!res.ok) return { ok: false, text: s, error: ctx.error ?? 'expr-malformed', message: ctx.message };
    out += res.value;
    i = close + 1;
  }
  if (ctx.error) return { ok: false, text: s, error: ctx.error, message: ctx.message };
  // Поле добавляем только когда оно true: форма ответа для обычного текста
  // должна оставаться прежней (по ней сравниваются тесты).
  return arithmeticOutside ? { ok: true, text: out, arithmetic: true } : { ok: true, text: out };
}

// Есть ли в строке хоть один вызов функции по имени из белого списка. Нужно,
// чтобы НЕ трогать обычные тексты: без вызовов поведение прежнее.
export function hasFunctionCall(src: string): boolean {
  const s = src ?? '';
  let i = 0;
  while (i < s.length) {
    const ident = scanIdent(s, i);
    if (!ident) {
      i++;
      continue;
    }
    if (ident.open >= 0 && FUNC_SET.has(ident.name)) return true;
    i = ident.end > i ? ident.end : i + 1;
  }
  return false;
}

// Имена вызовов, которых нет в белом списке, — для валидатора (expr-unknown-fn).
export function unknownFunctionNames(src: string): string[] {
  const s = src ?? '';
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ident = scanIdent(s, i);
    if (!ident) {
      i++;
      continue;
    }
    if (ident.open < 0 || matchingParen(s, ident.open) < 0) {
      // Битая скобка — отдельная проверка (hasMalformedCall).
      i = ident.end > i ? ident.end : i + 1;
      continue;
    }
    if (!FUNC_SET.has(ident.name) && !out.includes(ident.name)) out.push(ident.name);
    i = ident.end > i ? ident.end : i + 1;
  }
  return out;
}

// Незакрытые скобки вызова — тоже ошибка автора, а не «пусть уйдёт как есть».
export function hasMalformedCall(src: string): boolean {
  const s = src ?? '';
  let i = 0;
  while (i < s.length) {
    const ident = scanIdent(s, i);
    if (!ident) {
      i++;
      continue;
    }
    if (ident.open >= 0 && matchingParen(s, ident.open) < 0) return true;
    i = ident.end > i ? ident.end : i + 1;
  }
  return false;
}

// Единая точка входа: интерполированный текст -> значение выражения.
// Без вызовов функций работает ровно как раньше (evalExpression).
export function evalExprWithFunctions(
  interpolated: string,
  opts: { now?: number; rand?: () => number } = {}
): ExprEval {
  const src = interpolated ?? '';
  if (!hasFunctionCall(src)) return { value: evalExpression(src), ok: true };
  const res = evalCalls(src, 0, { now: opts.now ?? Date.now(), rand: opts.rand ?? Math.random });
  // Контракт: неизвестная функция/битый вызов -> исходная строка как есть.
  if (!res.ok) return { value: src, ok: false, error: res.error, message: res.message };
  return { value: finishValue(res.text, !!res.arithmetic), ok: true };
}

// Итоговое значение после подстановки функций.
//
// Правило: арифметика считается калькулятором ТОЛЬКО когда она реально была в
// шаблоне вне вызовов (`arithmetic`) либо когда результат — чистое число.
// Иначе текст отдаётся как есть. Без этого правила дата «2026-09-23» уезжала
// в калькулятор (он видит там вычитание) и превращалась в 1994.
const PURE_NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/;

function finishValue(text: string, arithmetic: boolean): string | number {
  if (arithmetic) return evalExpression(text);
  const t = text.trim();
  if (PURE_NUMBER_RE.test(t)) return Number(t);
  return text;
}
