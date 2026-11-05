// Thin client for the platform API. In dev, /api is proxied to the Worker (wrangler dev).
// In production the UI is a static site, so API_BASE points at the deployed Worker.
//
// SECURITY: no secret is ever bundled. Two ways in:
//   1) обычный пользователь: логин + пароль -> session token (Bearer), хранится в sessionStorage;
//   2) админ платформы: ADMIN_KEY, введённый в рантайме (x-admin-key), тоже sessionStorage.
// Оба варианта живут только в этой вкладке и не попадают в JS-бандл.
import { createApiError } from './journey';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

const ADMIN_KEY_STORAGE = 'botsAdminKey';
const TOKEN_STORAGE = 'botsSessionToken';

// ---------------- admin key (платформенный доступ) ----------------

export function setAdminKey(key: string) {
  if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
}
export function getAdminKey(): string {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? '';
}
export function hasAdminKey(): boolean {
  return getAdminKey().length > 0;
}

// ---------------- session token (обычный пользователь) ----------------

export function setSessionToken(token: string) {
  if (token) sessionStorage.setItem(TOKEN_STORAGE, token);
  else sessionStorage.removeItem(TOKEN_STORAGE);
}
export function getSessionToken(): string {
  return sessionStorage.getItem(TOKEN_STORAGE) ?? '';
}
export function hasSessionToken(): boolean {
  return getSessionToken().length > 0;
}

export function logoutLocal() {
  sessionStorage.removeItem(TOKEN_STORAGE);
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
}

async function req(path: string, init?: RequestInit) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = getAdminKey();
  if (key) headers['x-admin-key'] = key;
  const token = getSessionToken();
  if (token) headers['authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (e) {
    const error = new Error(e instanceof Error ? e.message : 'network failure') as Error & { kind?: string };
    error.kind = 'network';
    throw error;
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : text;
    } catch {
      body = null;
    }
    throw createApiError(res.status, body);
  }
  return res.json();
}

// Как req(), но не теряет тело ответа при ошибке: публикация отдаёт 422
// вместе со списком замечаний, и они нужны в UI.
async function reqKeepBody(path: string, init?: RequestInit): Promise<any> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = getAdminKey();
  if (key) headers['x-admin-key'] = key;
  const token = getSessionToken();
  if (token) headers['authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (e) {
    const error = new Error(e instanceof Error ? e.message : 'network failure') as Error & { kind?: string };
    error.kind = 'network';
    throw error;
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw createApiError(res.status, body ?? text);
  }
  return body;
}

export interface SessionUser {
  id: string;
  login: string;
}

export type TicketKind = 'bug' | 'question' | 'idea' | 'billing' | 'abuse' | 'other';
export type TicketStatus = 'new' | 'in_progress' | 'closed';
export interface SupportTicket {
  id: string;
  // Сквозной номер обращения (#1, #2, …). null/undefined у легаси-тикета —
  // тогда UI показывает короткий id.
  number?: number | null;
  author_user_id: string;
  author_login: string;
  bot_id: string | null;
  kind: TicketKind;
  subject: string;
  status: TicketStatus;
  assignee_user_id: string | null;
  created_at: number;
  updated_at: number;
  last_message_at: number;
}

// Человекочитаемая метка тикета: «#12», а для легаси-строк без номера —
// короткий хвост id (t_<uuid>), чтобы метка не была пустой.
export function ticketLabel(ticket: Pick<SupportTicket, 'id' | 'number'>): string {
  return ticket.number != null ? `#${ticket.number}` : ticket.id.replace(/^[a-z]_/, '').slice(0, 8);
}
export interface SupportMessage {
  id: string;
  ticket_id: string;
  author_role: 'user' | 'staff';
  author_user_id: string;
  author_login: string;
  body: string;
  created_at: number;
}

// ---- страница «Пользователи»: ответ staff-роутов /api/admin/users/* ----
export interface AdminUserBot {
  id: string;
  name: string;
  active: number;
  created_at: number;
  published_version: number | null;
  scenario_version: number | null;
}

export interface AdminUserProfile {
  user: { id: string; login: string; role: string; created_at: number };
  bots: AdminUserBot[];
  totals: { bots: number; logEvents: number };
}

export interface AdminLogRow {
  id: number;
  bot_id: string;
  bot_name: string;
  user_id: number | null;
  event: string;
  ts: number;
}

export interface BotStatus {
  active: number;
  name: string;
  version: number;
  publishedVersion: number | null;
  webhook: { url?: string; pending_update_count?: number; last_error_message?: string } | null;
  commands: { command: string; description: string }[];
  checkedAt: number;
  cached: boolean;
}

export interface TemplateListItem {
  id: string;
  author_user_id: string;
  title: string;
  description: string;
  tags: string[];
  created_at: number;
  uses_count: number;
  likes_count: number;
}

export interface TemplateFull extends TemplateListItem {
  scenario_json: string;
}

// Клиент бота: кто писал боту и что сценарий о нём запомнил.
export interface ClientRow {
  user_id: number;
  name: string;
  username: string;
  first_seen: number;
  last_seen: number;
  block: string;
  vars: Record<string, unknown>;
}

// Таблица автора бота («Заказы» и т.п.) и её записи.
export interface Collection {
  id: string;
  name: string;
  fields: string[];
  created_at: number;
  count: number;
}

export interface CollectionItem {
  id: string;
  user_id: number | null;
  data: Record<string, string>;
  created_at: number;
  updated_at: number;
}

// Платёжное подключение владельца. Секреты приходят ТОЛЬКО маской: has —
// задан ли хоть один ключ, keys — имена заданных (значений нет и не будет).
export type PaymentProviderId = 'telegram' | 'yookassa' | 'robokassa' | 'stripe' | 'custom';

export interface PaymentConnection {
  id: string;
  provider: PaymentProviderId;
  title: string;
  config: Record<string, string>;
  secrets: { has: boolean; keys: string[] };
  // Короткий публичный код вебхука (/p/<token>); null быть не должен — воркер
  // выдаёт токен лениво при чтении списка, но тип честный.
  webhook_token: string | null;
  // Публичный базовый хост вебхука с воркера (PAY_WEBHOOK_BASE или origin).
  webhookBase?: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

// Замечание проверки подключения: field — ключ поля из PROVIDER_SPECS
// (shopId|successUrl|…|webhookSecret) или '' (замечание не про конкретное
// поле); message — честная русская строка с воркера (данные, не UI-строка).
export interface PaymentCheckProblem {
  field: string;
  kind: 'format' | 'provider' | 'missing';
  message: string;
}

export interface PaymentCheckResult {
  ok: boolean;
  provider: PaymentProviderId;
  mode: 'live' | 'format-only';
  problems: PaymentCheckProblem[];
  providerStatus?: number;
}

// Публичный вебхук подключения: провайдер шлёт подтверждения сюда. base —
// публичный хост с воркера (PAY_WEBHOOK_BASE); если payload старый и поля нет,
// фолбэк на текущую API-базу. Путь совпадает с роутом POST /p/:token.
export function paymentWebhookUrl(token: string, base?: string): string {
  const host = (base || API_BASE || window.location.origin).replace(/\/+$/, '');
  return `${host}/p/${token}`;
}

// Выгрузка CSV: файл отдаёт файл с заголовком attachment, но авторизация —
// Bearer-токеном в sessionStorage, поэтому качаем через fetch и отдаём как blob.
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const key = getAdminKey();
  if (key) headers['x-admin-key'] = key;
  const token = getSessionToken();
  if (token) headers['authorization'] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers });
  } catch (e) {
    const error = new Error(e instanceof Error ? e.message : 'network failure') as Error & { kind?: string };
    error.kind = 'network';
    throw error;
  }
  if (!res.ok) {
    // WU-07: ошибка со статусом и телом — friendlyApiError на вызывающей
    // стороне сам переведёт её в безопасное сообщение на языке интерфейса.
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : text;
    } catch {
      body = null;
    }
    throw createApiError(res.status, body);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  // ---- проверка админ-ключа (вход на вкладке «Админ») ----
  // Ключ проверяется сервером ДО записи в sessionStorage: GET /api/admin/session
  // отвечает 200 { ok, adminKey } на верный ключ и 401 admin_key_invalid на
  // любой другой. Кандидат передаётся явным заголовком — из хранилища ничего
  // не читается (в момент ввода там ещё пусто или лежит протухший ключ).
  checkAdminKey: async (candidate: string): Promise<{ ok: true; adminKey: true }> => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/admin/session`, { headers: { 'x-admin-key': candidate } });
    } catch (e) {
      const error = new Error(e instanceof Error ? e.message : 'network failure') as Error & { kind?: string };
      error.kind = 'network';
      throw error;
    }
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : text;
    } catch {
      body = null;
    }
    if (!res.ok) throw createApiError(res.status, body);
    return body as { ok: true; adminKey: true };
  },

  // ---- auth ----
  register: (login: string, password: string) =>
    req('/api/auth/register', { method: 'POST', body: JSON.stringify({ login, password }) }) as Promise<{
      ok: true;
      token: string;
      user: SessionUser;
    }>,
  login: (login: string, password: string) =>
    req('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) }) as Promise<{
      ok: true;
      token: string;
      user: SessionUser;
    }>,
  me: () => req('/api/auth/me') as Promise<{ user: SessionUser }>,
  logout: () => req('/api/auth/logout', { method: 'POST' }) as Promise<{ ok: true }>,
  deleteAccount: (password: string) =>
    req('/api/auth/me', { method: 'DELETE', body: JSON.stringify({ password }) }) as Promise<{ ok: true }>,
  // Смена пароля гасит все прежние сессии и сразу выдаёт новый токен.
  changePassword: (oldPassword: string, newPassword: string) =>
    req('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }) as Promise<{ ok: true; sessionsClosed: number; token: string }>,
  logoutAll: () => req('/api/auth/logout-all', { method: 'POST' }) as Promise<{ ok: true; sessionsClosed: number }>,

  // ---- bots ----
  listBots: () => req('/api/bots') as Promise<{ bots: any[]; adminKey?: boolean }>,
  createBot: (name: string, token: string, platform: 'telegram' | 'vk' = 'telegram', owner_id?: string) =>
    req('/api/bots', { method: 'POST', body: JSON.stringify({ name, token, platform, owner_id }) }),
  // ---- mini apps ----
  listMiniApps: (botId: string) =>
    req(`/api/bots/${botId}/miniapps`) as Promise<{
      miniapps: { id: string; bot_id: string; name: string; slug: string; access_rule: any; published: boolean; updated_at: number; bot_username?: string | null }[];
    }>,
  listOwnedMiniApps: () =>
    req('/api/miniapps') as Promise<{
      miniapps: { id: string; bot_id: string; bot_name: string; bot_username: string | null; name: string; slug: string; published: boolean | number; updated_at: number }[];
    }>,
  createMiniApp: (botId: string, name: string, slug: string, access_rule: any, template?: string) =>
    req(`/api/bots/${botId}/miniapps`, {
      method: 'POST',
      body: JSON.stringify({ name, slug, access_rule, ...(template ? { template } : {}) }),
    }) as Promise<{ id: string; slug: string; draft: any }>,
  getMiniApp: (id: string) =>
    req(`/api/miniapps/${id}`) as Promise<{
      id: string; bot_id: string; name: string; slug: string; access_rule: any;
      draft: any; published: any; updated_at: number;
    }>,
  // keepalive — для сохранения черновика на уходе со страницы (S3-02): без
  // него браузер оборвёт запрос вместе с закрываемой вкладкой.
  saveMiniAppDraft: (id: string, draft: any, name?: string, keepalive = false) =>
    req(`/api/miniapps/${id}`, { method: 'PUT', body: JSON.stringify(name ? { draft, name } : { draft }), keepalive }) as Promise<{ ok: true }>,
  publishMiniApp: (id: string, app?: any, menuButton?: boolean) =>
    req(`/api/miniapps/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify(app !== undefined ? { app, menu_button: menuButton === true } : { menu_button: menuButton === true }),
    }) as Promise<{ revision: number; menu_warning: string | null; bot_username: string | null; slug: string }>,
  listMiniAppVersions: (id: string) =>
    req(`/api/miniapps/${id}/versions`) as Promise<{ versions: { id: string; revision: number; created_at: number }[] }>,
  rollbackMiniApp: (id: string, revision: number) =>
    req(`/api/miniapps/${id}/rollback`, { method: 'POST', body: JSON.stringify({ revision }) }) as Promise<{ revision: number }>,
  deleteMiniApp: (id: string) => req(`/api/miniapps/${id}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
  getBot: (id: string) => req(`/api/bots/${id}`),
  getScenario: (id: string) => req(`/api/bots/${id}/scenario`),
  // version — оптимистичная блокировка (WU-03): отправляем версию, из которой
  // выросли правки, чтобы сервер мог отклонить запись поверх чужой (две
  // вкладки одного аккаунта) вместо молчаливого last-write-wins.
  saveScenario: (id: string, name: string, flow_json: string, version?: number | null) =>
    req(`/api/bots/${id}/scenario`, {
      method: 'PUT',
      body: JSON.stringify(version != null ? { name, flow_json, version } : { name, flow_json }),
    }),
  // Черновик несохранённых правок живёт на сервере (F9): тот же черновик
  // подхватывается на любом устройстве, потому что принадлежит аккаунту.
  getDraft: (id: string) =>
    req(`/api/bots/${id}/draft`) as Promise<{ draft: { flow_json: string; updated_at: number } | null }>,
  // keepalive нужен для сохранения на уходе со страницы: без него браузер
  // обрывает запрос вместе с вкладкой.
  saveDraft: (id: string, flow_json: string, keepalive = false) =>
    req(`/api/bots/${id}/draft`, { method: 'PUT', body: JSON.stringify({ flow_json }), keepalive }) as Promise<{ ok: true }>,
  deleteDraft: (id: string) =>
    req(`/api/bots/${id}/draft`, { method: 'DELETE' }) as Promise<{ ok: true }>,
  // Удаление: снимает webhook в Telegram, стирает бота и всё, что к нему
  // привязано. Возвращает пошаговый отчёт — как при публикации.
  deleteBot: (id: string) =>
    req(`/api/bots/${id}`, { method: 'DELETE' }) as Promise<{
      ok: true;
      steps: { key: string; label: string; status: 'ok' | 'fail' | 'skipped'; detail?: string }[];
    }>,
  getStats: (id: string) => req(`/api/bots/${id}/stats`),

  // ---- статусы пачкой (дашборд без N+1) ----
  statuses: (ids: string[], deep = false) =>
    req('/api/bots/statuses', { method: 'POST', body: JSON.stringify({ ids, deep }) }) as Promise<{
      statuses: Record<string, BotStatus | null>;
    }>,

  versions: (id: string) => req(`/api/bots/${id}/versions`) as Promise<{
    active: boolean | number;
    publishedVersion: number | null;
    versions: { version: number; name: string; updated_at: number; size: number; published?: boolean }[];
  }>,
  deleteVersion: (id: string, version: number) =>
    req(`/api/bots/${id}/versions/${version}`, { method: 'DELETE' }) as Promise<{ ok: true; version: number }>,
  clearVersions: (id: string) =>
    req(`/api/bots/${id}/versions`, { method: 'DELETE' }) as Promise<{ ok: true; deleted: number }>,
  rollback: (id: string, version: number) =>
    req(`/api/bots/${id}/rollback`, { method: 'POST', body: JSON.stringify({ version }) }) as Promise<{ ok: true; version: number; flow_json: string }>,
  publishVersion: (id: string, version: number) =>
    reqKeepBody(`/api/bots/${id}/publish-version`, { method: 'POST', body: JSON.stringify({ version }) }),

  // ---- события бота (отладка без Telegram) ----
  logs: (id: string, limit = 100, userId?: number | null) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (userId != null) qs.set('userId', String(userId));
    return req(`/api/bots/${id}/logs?${qs.toString()}`) as Promise<{
      logs: { id: number; user_id: number | null; event: string; ts: number }[];
    }>;
  },
  clearLogs: (id: string) => req(`/api/bots/${id}/logs`, { method: 'DELETE' }) as Promise<{ ok: true; deleted: number }>,

  // ---- точный прогон сценария движком воркера ----
  simulate: (id: string, flow_json: string, inputs: string[]) =>
    req(`/api/bots/${id}/simulate`, {
      method: 'POST',
      body: JSON.stringify({ flow_json, inputs }),
    }) as Promise<{
      log: { who: 'bot' | 'user'; text: string }[];
      pending: { kind: string; prompt?: string; buttons?: { label: string; value: string }[] } | null;
      vars: Record<string, unknown>;
    }>,

  // ---- настройки интерфейса (per-user, D1) ----
  getSettings: () => req('/api/settings'),
  putSettings: (patch: Record<string, unknown>) =>
    req('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  profile: () => req('/api/me') as Promise<{ user: SessionUser | null; role: string }>,

  support: {
    listTickets: (params: { status?: TicketStatus; kind?: TicketKind; q?: string; number?: number | string; assignee?: string; limit?: number; offset?: number } = {}) => {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') qs.set(key, String(value));
      const query = qs.toString();
      return req(`/api/support/tickets${query ? `?${query}` : ''}`) as Promise<{ tickets: SupportTicket[]; total: number }>;
    },
    createTicket: (body: { kind: TicketKind; subject: string; body: string; botId?: string }) =>
      req('/api/support/tickets', { method: 'POST', body: JSON.stringify(body) }) as Promise<{ ticket: SupportTicket; messages: SupportMessage[] }>,
    getTicket: (id: string) => req(`/api/support/tickets/${id}`) as Promise<{ ticket: SupportTicket; messages: SupportMessage[] }>,
    addMessage: (id: string, body: string) => req(`/api/support/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) }) as Promise<{ ticket: SupportTicket; messages: SupportMessage[] }>,
    assign: (id: string) => req(`/api/support/tickets/${id}/assign`, { method: 'POST' }) as Promise<{ ticket: SupportTicket; messages: SupportMessage[] }>,
    close: (id: string) => req(`/api/support/tickets/${id}/close`, { method: 'POST' }) as Promise<{ ticket: SupportTicket; messages: SupportMessage[] }>,
    reopen: (id: string) => req(`/api/support/tickets/${id}/reopen`, { method: 'POST' }) as Promise<{ ticket: SupportTicket; messages: SupportMessage[] }>,
    openCount: () => req('/api/support/open-count') as Promise<{ open: number }>,
  },

  // ---- каталог шаблонов (глобальный) ----
  listTemplates: (params: { sort?: string; q?: string; tag?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.sort) qs.set('sort', params.sort);
    if (params.q) qs.set('q', params.q);
    if (params.tag) qs.set('tag', params.tag);
    const s = qs.toString();
    return req(`/api/templates${s ? `?${s}` : ''}`) as Promise<{ templates: TemplateListItem[] }>;
  },
  getTemplate: (id: string) => req(`/api/templates/${id}`) as Promise<{ template: TemplateFull }>,
  createTemplate: (body: { title: string; description: string; tags: string[]; scenario_json: string }) =>
    req('/api/templates', { method: 'POST', body: JSON.stringify(body) }) as Promise<{ template: TemplateListItem }>,
  useTemplate: (id: string) => req(`/api/templates/${id}/use`, { method: 'POST' }) as Promise<{ ok: true; uses_count: number }>,
  deleteTemplate: (id: string) => req(`/api/templates/${id}`, { method: 'DELETE' }) as Promise<{ ok: true }>,

  // ---- рефералы ----
  getReferrals: (botId: string) =>
    req(`/api/bots/${botId}/referrals`) as Promise<{ total: number; byInviter: Record<string, number> }>,

  // ---- публикация ----
  validate: (id: string, flow_json: string) =>
    reqKeepBody(`/api/bots/${id}/validate`, { method: 'POST', body: JSON.stringify({ flow_json }) }),
  publish: (id: string, name: string, flow_json: string) =>
    reqKeepBody(`/api/bots/${id}/publish`, { method: 'POST', body: JSON.stringify({ name, flow_json }) }),
  unpublish: (id: string) => reqKeepBody(`/api/bots/${id}/unpublish`, { method: 'POST' }),
  // ---- данные бота: клиенты и таблицы ----
  clients: (botId: string, params: { q?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    const s = qs.toString();
    return req(`/api/bots/${botId}/clients${s ? `?${s}` : ''}`) as Promise<{ total: number; rows: ClientRow[] }>;
  },
  // Правка переменных клиента руками и полное удаление его данных.
  updateClient: (botId: string, userId: number, vars: Record<string, unknown>) =>
    req(`/api/bots/${botId}/clients/${userId}`, { method: 'PUT', body: JSON.stringify({ vars }) }) as Promise<{
      ok: true;
    }>,
  deleteClient: (botId: string, userId: number) =>
    req(`/api/bots/${botId}/clients/${userId}`, { method: 'DELETE' }) as Promise<{ ok: true; changes: number }>,

  collections: (botId: string) => req(`/api/bots/${botId}/collections`) as Promise<{ collections: Collection[] }>,
  createCollection: (botId: string, name: string, fields: string[]) =>
    req(`/api/bots/${botId}/collections`, {
      method: 'POST',
      body: JSON.stringify({ name, fields }),
    }) as Promise<{ collection: Collection }>,
  updateCollection: (botId: string, cid: string, patch: { name?: string; fields?: string[] }) =>
    req(`/api/bots/${botId}/collections/${cid}`, { method: 'PUT', body: JSON.stringify(patch) }) as Promise<{
      ok: true;
    }>,
  deleteCollection: (botId: string, cid: string) =>
    req(`/api/bots/${botId}/collections/${cid}`, { method: 'DELETE' }) as Promise<{ ok: true }>,

  collectionItems: (botId: string, cid: string, params: { q?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    const s = qs.toString();
    return req(`/api/bots/${botId}/collections/${cid}/items${s ? `?${s}` : ''}`) as Promise<{
      total: number;
      fields: string[];
      rows: CollectionItem[];
    }>;
  },
  createItem: (botId: string, cid: string, data: Record<string, string>) =>
    req(`/api/bots/${botId}/collections/${cid}/items`, { method: 'POST', body: JSON.stringify({ data }) }) as Promise<{
      ok: true;
      id: string;
    }>,
  updateItem: (botId: string, cid: string, itemId: string, data: Record<string, string>) =>
    req(`/api/bots/${botId}/collections/${cid}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    }) as Promise<{ ok: true }>,
  deleteItem: (botId: string, cid: string, itemId: string) =>
    req(`/api/bots/${botId}/collections/${cid}/items/${itemId}`, { method: 'DELETE' }) as Promise<{ ok: true }>,

  // ---- публикация/статус ----
  getStatus: (id: string) => req(`/api/bots/${id}/status`) as Promise<{
    active: number;
    name: string;
    version: number;
    publishedVersion: number | null;
    webhook: { url?: string; pending_update_count?: number; last_error_message?: string } | null;
    commands: { command: string; description: string }[];
  }>,

  // ---- библиотека подсценариев (фрагменты владельца) ----
  subflows: {
    list: () =>
      req('/api/subflows') as Promise<{
        subflows: {
          id: string;
          name: string;
          description: string;
          revision: number;
          flow_json: string;
          inputs: { name: string; description: string; required: boolean }[];
          outputs: { name: string; description: string; required: boolean }[];
          created_at: number;
          updated_at: number;
          used_by_bots?: number;
        }[];
      }>,
    get: (id: string) => req(`/api/subflows/${id}`) as Promise<{ subflow: any }>,
    create: (body: { name: string; description?: string; flow_json: string; inputs?: unknown[]; outputs?: unknown[] }) =>
      req('/api/subflows', { method: 'POST', body: JSON.stringify(body) }) as Promise<{ subflow: any }>,
    save: (id: string, body: { name?: string; description?: string; flow_json?: string; inputs?: unknown[]; outputs?: unknown[] }) =>
      req(`/api/subflows/${id}`, { method: 'PUT', body: JSON.stringify(body) }) as Promise<{ ok: true; revision: number; subflow: any }>,
    remove: (id: string) => req(`/api/subflows/${id}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    versions: (id: string) =>
      req(`/api/subflows/${id}/versions`) as Promise<{
        revision: number;
        versions: { revision: number; name: string; created_at: number; size: number; current: boolean }[];
      }>,
    rollback: (id: string, revision: number) =>
      req(`/api/subflows/${id}/rollback`, { method: 'POST', body: JSON.stringify({ revision }) }) as Promise<{
        ok: true;
        revision: number;
        subflow: any;
      }>,
    preview: (id: string, body: { inputs?: Record<string, string>; steps?: string[] }) =>
      reqKeepBody(`/api/subflows/${id}/preview`, { method: 'POST', body: JSON.stringify(body) }) as Promise<{
        ok: boolean;
        issues?: any[];
        log?: { who: 'bot' | 'user'; text: string }[];
        pending?: unknown;
        vars?: Record<string, unknown>;
      }>,
    // Сухая проверка вызовов бота: статусы для бейджей холста.
    checkBot: (botId: string, flow_json?: string) =>
      req(`/api/bots/${botId}/subflow-check`, { method: 'POST', body: JSON.stringify(flow_json ? { flow_json } : {}) }) as Promise<{
        calls: {
          blockId: string;
          subflowId: string;
          alias: string;
          status: 'ok' | 'outdated' | 'missing' | 'cycle' | 'depth' | 'revision-missing';
          latestRevision?: number;
          pinnedRevision?: number;
        }[];
      }>,
  },

  // ---- платежи владельца: подключения своего провайдера ----
  // Секреты принимаются ОДИН раз при создании/обновлении и наружу не
  // возвращаются никогда — в ответах только маска { has, keys }.
  payments: {    listConnections: (botId: string) =>
      req(`/api/bots/${botId}/payments/connections`) as Promise<{ connections: PaymentConnection[] }>,
    createConnection: (botId: string, body: { provider: PaymentProviderId; title?: string; config?: Record<string, string>; secrets?: Record<string, string> }) =>
      req(`/api/bots/${botId}/payments/connections`, { method: 'POST', body: JSON.stringify(body) }) as Promise<{
        connection: PaymentConnection;
      }>,
    updateConnection: (botId: string, cid: string, patch: { title?: string; config?: Record<string, string>; secrets?: Record<string, string>; enabled?: boolean }) =>
      req(`/api/bots/${botId}/payments/connections/${cid}`, { method: 'PUT', body: JSON.stringify(patch) }) as Promise<{
        connection: PaymentConnection | null;
      }>,
    deleteConnection: (botId: string, cid: string) =>
      req(`/api/bots/${botId}/payments/connections/${cid}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    // Ротация публичного адреса вебхука: старый токен мгновенно перестаёт
    // работать, владелец обновляет адрес в кабинете провайдера.
    regenerateWebhook: (botId: string, cid: string) =>
      req(`/api/bots/${botId}/payments/connections/${cid}/regenerate-webhook`, { method: 'POST' }) as Promise<{
        ok: true;
        webhook_token: string;
        connection: PaymentConnection | null;
      }>,
    // Честный результат проверки: mode='live' — провайдер действительно
    // отвечал, 'format-only' — проверен только формат полей. problems —
    // структурированные замечания (field — ключ из PROVIDER_SPECS или '').
    // Старый воркер отдавал problems: string[] — нормализуем здесь, чтобы
    // страница не знала о версии контракта.
    checkConnection: async (botId: string, cid: string): Promise<PaymentCheckResult> => {
      const r = (await req(`/api/bots/${botId}/payments/connections/${cid}/check`, { method: 'POST' })) as {
        ok?: boolean;
        provider?: PaymentProviderId;
        mode?: 'live' | 'format-only';
        problems?: Array<string | PaymentCheckProblem>;
        providerStatus?: number;
      };
      const problems = (r.problems ?? []).map((p) =>
        typeof p === 'string' ? { field: '', kind: 'format' as const, message: p } : p
      );
      return {
        ok: !!r.ok,
        provider: r.provider ?? 'custom',
        mode: r.mode === 'live' ? 'live' : 'format-only',
        problems,
        ...(r.providerStatus !== undefined ? { providerStatus: r.providerStatus } : {}),
      };
    },
  },

  // ---- страница «Пользователи» (staff-only, read-only) ----
  admin: {
    user: (login: string) =>
      req(`/api/admin/users/${encodeURIComponent(login)}`) as Promise<AdminUserProfile>,
    userLogs: (login: string, params: { limit?: number; botId?: string; userId?: number | null } = {}) => {
      const qs = new URLSearchParams();
      if (params.limit != null) qs.set('limit', String(params.limit));
      if (params.botId) qs.set('botId', params.botId);
      if (params.userId != null) qs.set('userId', String(params.userId));
      const s = qs.toString();
      return req(`/api/admin/users/${encodeURIComponent(login)}/logs${s ? `?${s}` : ''}`) as Promise<{
        logs: AdminLogRow[];
      }>;
    },
  },
};
