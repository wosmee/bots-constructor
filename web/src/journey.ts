import type { Issue } from '../../shared/validate';
import type { TKey } from './i18n';

export function canCreateBot(name: string, token: string): boolean {
  return Boolean(name.trim() && token.trim());
}

export function canPublishScenario(issues: Pick<Issue, 'level'>[]): boolean {
  return !issues.some((issue) => issue.level === 'error');
}

export type PopoverName = 'conflicts' | 'more';

export function nextPopoverState(name: PopoverName, isOpen = false): { conflicts: boolean; more: boolean } {
  if (isOpen) return { conflicts: false, more: false };
  return name === 'conflicts' ? { conflicts: true, more: false } : { conflicts: false, more: true };
}

export function publishStepLabelKey(step: string): TKey {
  return step === 'save' || step === 'validate' || step === 'webhook' || step === 'commands' || step === 'activate' || step === 'db'
    ? `publish.step.${step}` as TKey
    : 'publish.step.unknown';
}

export function rollbackSettingsState<T>(previous: T, _optimistic: T): T {
  return previous;
}

export type ApiErrorInput = {
  status?: number;
  body?: unknown;
  message?: string;
  kind?: 'network' | 'timeout' | 'http';
};

const FRIENDLY_ERRORS: Record<string, string> = {
  unauthorized: 'Сессия истекла — войдите заново',
  'войдите заново': 'Сессия истекла — войдите заново',
  'name and token required': 'Введите имя и токен бота',
  'flow_json required': 'Сценарий пока не сохранён',
  'логин занят': 'Этот логин уже занят',
};

const ERROR_KEYS: Record<string, string> = {
  unauthorized: 'error.unauthorized',
  forbidden: 'error.forbidden',
  'это не ваш бот': 'error.forbidden',
  'name and token required': 'error.botRequired',
  'flow_json required': 'error.notSaved',
  'логин занят': 'error.loginTaken',
  'слишком много': 'error.rateLimited',
};

function rawApiMessage(input: ApiErrorInput): string {
  if (typeof input.body === 'string') return input.body.trim();
  if (input.body && typeof input.body === 'object') {
    const body = input.body as Record<string, unknown>;
    if (typeof body.error === 'string') return body.error.trim();
    if (typeof body.message === 'string') return body.message.trim();
  }
  return String(input.message ?? '').trim();
}

export function createApiError(status: number, body: unknown): Error & ApiErrorInput {
  const e = new Error(rawApiMessage({ body })) as Error & ApiErrorInput;
  e.status = status;
  e.body = body;
  e.kind = 'http';
  return e;
}

// F-015 (WU-03): PUT /api/bots/:id/scenario отвечает 409 { code:
// 'version-conflict', current } на запись поверх более свежей версии (две
// вкладки одного аккаунта). Детектор по машинному коду, а не по тексту:
// статус+code стабильны, формулировка error — нет.
export function isVersionConflict(error: unknown): boolean {
  const input: ApiErrorInput =
    error && typeof error === 'object' ? (error as ApiErrorInput) : {};
  if (input.status !== 409) return false;
  const body = input.body && typeof input.body === 'object' ? (input.body as Record<string, unknown>) : null;
  return body?.code === 'version-conflict';
}

// Актуальная версия сценария из ответа 409 (поле current); null, если сервер
// не прислал число — вызывающий код тогда версию не подменяет.
export function versionConflictCurrent(error: unknown): number | null {
  const input: ApiErrorInput =
    error && typeof error === 'object' ? (error as ApiErrorInput) : {};
  const body = input.body && typeof input.body === 'object' ? (input.body as Record<string, unknown>) : null;
  return typeof body?.current === 'number' ? body.current : null;
}

export function apiErrorKey(input: ApiErrorInput | unknown): string {
  const value: ApiErrorInput = typeof input === 'object' && input !== null ? input as ApiErrorInput : { message: String(input ?? '') };
  if (value.kind === 'network') return 'error.network';
  if (value.kind === 'timeout') return 'error.timeout';
  const status = value.status;
  if (status === 401) return 'error.unauthorized';
  if (status === 403) return 'error.forbidden';
  if (status === 429) return 'error.rateLimited';
  const raw = rawApiMessage(value).toLowerCase();
  for (const [needle, key] of Object.entries(ERROR_KEYS)) if (raw.includes(needle)) return key;
  if (status && status >= 500) return 'error.server';
  if (status && status >= 400) return 'error.validation';
  return 'error.unknown';
}

const SAFE_MESSAGES: Record<string, Record<string, string>> = {
  ru: {
    'error.unauthorized': 'Сессия истекла — войдите заново', 'error.forbidden': 'У вас нет доступа к этому боту',
    'error.botRequired': 'Введите имя и токен бота', 'error.notSaved': 'Сценарий пока не сохранён', 'error.loginTaken': 'Этот логин уже занят',
    'error.rateLimited': 'Слишком много запросов. Попробуйте позже', 'error.network': 'Не удалось подключиться. Проверьте интернет и повторите попытку',
    'error.timeout': 'Сервер не ответил вовремя. Попробуйте ещё раз', 'error.server': 'Сервер временно недоступен. Попробуйте ещё раз',
    'error.validation': 'Проверьте данные и исправьте ошибки', 'error.unknown': 'Не удалось выполнить действие. Попробуйте ещё раз',
  },
  en: {
    'error.unauthorized': 'Your session expired — sign in again', 'error.forbidden': 'You do not have access to this bot',
    'error.botRequired': 'Enter the bot name and token', 'error.notSaved': 'The scenario has not been saved yet', 'error.loginTaken': 'This login is already taken',
    'error.rateLimited': 'Too many requests. Try again later', 'error.network': 'Could not connect. Check your internet and try again',
    'error.timeout': 'The server did not respond in time. Try again', 'error.server': 'The server is temporarily unavailable. Try again',
    'error.validation': 'Check the data and fix the errors', 'error.unknown': 'The action failed. Try again',
  },
};

export function friendlyApiError(message: unknown, language: 'ru' | 'en' = 'ru'): string {
  const input: ApiErrorInput = message instanceof Error
    ? message as Error & ApiErrorInput
    : (message && typeof message === 'object' ? message as ApiErrorInput : { message: String(message ?? '') });
  const key = apiErrorKey(input);
  if (input.status || input.kind) return SAFE_MESSAGES[language]?.[key] ?? SAFE_MESSAGES.ru[key];
  const raw = rawApiMessage(input).toLowerCase();
  if (/sql|stack|secret|token=|password|internal path|constraint failed|database|implementation detail/.test(raw)) return SAFE_MESSAGES[language]?.['error.unknown'] ?? SAFE_MESSAGES.ru['error.unknown'];
  return FRIENDLY_ERRORS[raw] ?? (raw ? String(message).trim() : 'Ошибка');
}

// ---------------- ошибки экрана входа ----------------
// Экран входа/регистрации/админ-ключа — единственное место, где 401 означает
// «неверные данные», а не «сессия истекла». Глобальный маппинг 401 →
// error.unauthorized (apiErrorKey) везде else корректен и не трогается; здесь
// же сначала смотрим машинный code сервера, потом русскую строку error, и
// только иначе — friendlyApiError.

const AUTH_ERROR_TEXTS: Record<string, Record<'ru' | 'en', string>> = {
  'auth.error.loginNotFound': { ru: 'Логин не найден', en: 'No account with this login' },
  'auth.error.wrongPassword': { ru: 'Пароль не верный', en: 'Incorrect password' },
  'auth.error.adminKey': { ru: 'Неверный админ-ключ', en: 'Incorrect admin key' },
  'auth.error.loginTaken': { ru: 'Этот логин уже занят', en: 'This login is already taken' },
};

// code сервера → ключ текста. Стабильное поле, добавленное 29.09.2026 на
// auth-роутах и проверке админ-ключа.
const AUTH_CODE_KEYS: Record<string, string> = {
  login_not_found: 'auth.error.loginNotFound',
  wrong_password: 'auth.error.wrongPassword',
  admin_key_invalid: 'auth.error.adminKey',
};

// Фолбэк по русской строке error: старые версии воркера и роуты без code.
// Порядок важен: «не верный»/«не правильный» — до «не найден», чтобы строка
// «Пароль не найден» (её нет, но вдруг) не перехватила парольную ошибку.
const AUTH_TEXT_KEYS: Array<[string, string]> = [
  ['логин не найден', 'auth.error.loginNotFound'],
  ['пароль не верный', 'auth.error.wrongPassword'],
  ['пароль не правильный', 'auth.error.wrongPassword'],
  ['неверный админ-ключ', 'auth.error.adminKey'],
  ['логин занят', 'auth.error.loginTaken'],
];

export function authErrorMessage(error: unknown, language: 'ru' | 'en' = 'ru'): string {
  const input: ApiErrorInput =
    error instanceof Error
      ? (error as Error & ApiErrorInput)
      : error && typeof error === 'object'
        ? (error as ApiErrorInput)
        : { message: String(error ?? '') };

  const body =
    input.body && typeof input.body === 'object' ? (input.body as Record<string, unknown>) : null;
  const code = typeof body?.code === 'string' ? body.code : '';
  if (code === 'rate_limited') return SAFE_MESSAGES[language]?.['error.rateLimited'] ?? SAFE_MESSAGES.ru['error.rateLimited'];
  const byCode = AUTH_CODE_KEYS[code];
  if (byCode) return AUTH_ERROR_TEXTS[byCode][language];

  const raw = rawApiMessage(input).toLowerCase();
  for (const [needle, key] of AUTH_TEXT_KEYS) {
    if (raw.includes(needle)) return AUTH_ERROR_TEXTS[key][language];
  }
  return friendlyApiError(input, language);
}

export function validationIssueKey(code: string): string {
  return `validation.${code}`;
}

export function validationIssueMessage(issue: Pick<Issue, 'code' | 'message'>, language: 'ru' | 'en' = 'ru'): string {
  const en: Record<string, string> = {
    'msg-empty': 'Message text is required',
    'missing-target': 'Choose an existing target block',
    'start-cmd': 'The entry command must start with /',
    'empty': 'Add at least one block to the scenario',
    // F5: ветки стали обязательными — у этих кодов теперь своя формулировка,
    // иначе в английском интерфейсе они показывались заглушкой.
    'btn-branch': 'A button has no target — draw an arrow from its port',
    'cond-then': 'The “yes” branch is empty — draw an arrow from the “yes” port',
    'cond-else': 'The “no” branch is empty — draw an arrow from the “no” port',
    'switch-branch': 'A switch case leads nowhere — draw an arrow from its port',
    'inv-paid': 'The “paid” branch is empty',
    'inv-cancelled': 'The “cancelled” branch is empty',
    'data-found': 'The “found” branch is empty',
    'data-notfound': 'The “not found” branch is empty',
    'kw-miss': 'No “no match” branch — the bot stays silent on other text',
    'kw-hit': 'The “matched” branch is empty',
    // F2/F3: теги и цепочка — у своих кодов тоже должна быть формулировка.
    'tag-name': 'The tag name is required',
    'tag-outvar': 'No variable for the tag list — the default is tags',
    'cond-tag-op': 'Tags only support “equals” and “not equals”',
    'chain-empty': 'The chain has no messages — add text or media',
    'chain-media': 'A chain item has no URL or file_id — nothing to send',
    'chain-text': 'A chain item has empty text',
    // §7: лимиты Telegram — значение кнопки, счёт и уведомления.
    'btn-value-long': 'A button value exceeds 64 bytes — Telegram rejects the whole message. Shorten it',
    'invoice-title-long': 'The invoice title exceeds 32 characters — it will be truncated when sent',
    'invoice-desc-long': 'The invoice description exceeds 255 characters — it will be truncated when sent',
    'cbt-toast-long': 'The callback notification exceeds 200 characters — Telegram shows only the first ~200',
  };
  if (language === 'en') return en[issue.code] ?? 'Check this block configuration';
  return issue.message;
}
