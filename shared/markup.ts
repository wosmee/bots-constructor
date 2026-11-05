// Разметка сообщений: интерполяция переменных + экранирование под выбранный
// parse_mode. Один модуль на движок (воркер) и на превью/валидатор (фронт),
// чтобы правило экранирования не разъехалось между ними.
//
// Правило безопасности: {{var}} ИНТЕРПОЛИРУЕТСЯ и затем ЭКРАНИРУЕТСЯ — данные
// пользователя не могут сломать разметку или инъектировать тег. Явный опт-ин
// {{{var}}} подставляет значение как есть: автор сам отвечает за содержимое.
// Исключение — HTML-режим: значение с несбалансированными тегами (типично для
// пользовательского ввода вроде last_input) экранируется, иначе Telegram
// отклонит всё сообщение (400 «can't parse entities») и бот молча замолчит.
//
// parseMode 'none' (и отсутствие поля — совместимость со старыми сценариями)
// даёт сегодняшнее поведение: обычная интерполяция без escape.
import { ParseMode } from './types';

// Символы, значимые в MarkdownV2. Telegram требует экранировать каждый из них.
// Список фиксирован документацией: . _ * [ ] ( ) ~ ` > # + - = | { } !
const MDV2_SPECIAL = /[._*\[\]()~`>#+\-=|{}!\\]/g;

// В HTML-разметке Telegram значимы только <, > и &.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeMdV2(text: string): string {
  return text.replace(MDV2_SPECIAL, (m) => `\\${m}`);
}

// Экранирование под режим. 'none'/undefined — без изменений.
export function escapeMarkup(text: string, mode: ParseMode | undefined): string {
  const s = text ?? '';
  if (!mode || mode === 'none') return s;
  if (mode === 'HTML') return escapeHtml(s);
  if (mode === 'MarkdownV2') return escapeMdV2(s);
  return s;
}

// {{{var}}} — «как есть». Разбираем раньше обычных {{var}}, иначе тройные
// скобки были бы съедены как {{ + {var}.
const RAW_RE = /\{\{\{\s*([\w.]+)\s*\}\}\}/g;
const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

// Sentinel: временная замена raw-подстановок, чтобы escape не превратил уже
// вставленное значение в мусор. Символ \u0000 не может прийти из Telegram.
const SENTINEL = '\u0000';

// Интерполяция + экранирование. Возвращает готовый текст для Telegram.
export function renderMarkup(
  template: string,
  vars: Record<string, unknown>,
  mode: ParseMode | undefined
): string {
  const src = template ?? '';
  // Что подставить: undefined/null -> пустая строка, как в interpolate().
  const valueOf = (key: string): string => {
    const v = vars?.[key];
    return v === undefined || v === null ? '' : String(v);
  };
  // Значение для raw-подстановки. В HTML-режиме проверяем баланс тегов: если в
  // {{{var}}} попал пользовательский ввод (last_input и т.п.) с обрезком тега,
  // всё сообщение уходит в Telegram 400 и бот молча глохнет. Чистое или
  // сбалансированное значение (авторская разметка) проходит как есть, битое —
  // экранируется. Литеральный текст шаблона экранируется целиком и здесь не
  // участвует.
  const rawValue = (key: string): string => {
    const v = valueOf(key);
    if (mode === 'HTML' && v && htmlTagProblem(v)) return escapeHtml(v);
    return v;
  };

  // 1. Raw-части заменяем на плейсхолдеры и запоминаем их отдельно.
  const raw: string[] = [];
  const withPlaceholders = src.replace(RAW_RE, (_m, key: string) => {
    raw.push(rawValue(key));
    return `${SENTINEL}${raw.length - 1}${SENTINEL}`;
  });

  // 2. Обычные переменные интерполируем и экранируем.
  const interpolated = withPlaceholders.replace(VAR_RE, (_m, key: string) => valueOf(key));
  const escaped = escapeMarkup(interpolated, mode);

  // 3. Возвращаем raw-значения на место (уже после escape).
  if (!raw.length) return escaped;
  return escaped.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_m, i: string) => raw[Number(i)] ?? '');
}

// Проверка баланса HTML-тегов для валидатора: незакрытый или лишний тег
// ломает отправку («can't parse entities»). Возвращает текст первой проблемы
// либо null. Умеет самозакрывающиеся теги и комментарии.
const HTML_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;

export function htmlTagProblem(text: string): string | null {
  const stack: string[] = [];
  // Служебные теги Telegram, которые допустимо не закрывать/использовать.
  const voidTags = new Set(['br', 'hr']);
  HTML_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTML_TAG_RE.exec(text ?? ''))) {
    const whole = m[0];
    const name = m[1].toLowerCase();
    const selfClosing = m[2] === '/';
    if (whole.startsWith('</')) {
      if (!stack.length) return `лишний закрывающий тег </${name}>`;
      const open = stack.pop() as string;
      if (open !== name) return `тег <${open}> закрыт как </${name}>`;
    } else if (!selfClosing && !voidTags.has(name)) {
      stack.push(name);
    }
  }
  if (stack.length) return `не закрыт тег <${stack[stack.length - 1]}>`;
  return null;
}
