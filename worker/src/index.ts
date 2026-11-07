import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { D1Database } from '@cloudflare/workers-types';
import {
  Scenario,
  pickPath,
  normalizeTag,
  REF_INVITER_VAR,
  REF_COUNT_VAR,
  BOT_MSG_VAR,
  PAY_ORDER_VAR,
  HTTP_PAGE_VAR,
  CHAT_FALLBACK_VAR,
  waitVar,
  type ConditionDef,
} from '../../shared/types';
import { scenarioHasReferral, jsonContentHash } from '../../shared/graph';
import { validateScenario, countIssues, scenarioCommands, type Issue } from '../../shared/validate';
import { expandSubflows, checkSubflowCalls, scenarioHasSubflows, remapIssuesToCallSites, type SubflowLibrary, type SubflowRevisionSnapshot, type SubflowIoDef } from '../../shared/subflow';
import { encryptToken, decryptToken } from './crypto';
import { vkCall, translateOutgoing, vkEventAnswerParams, vkMessageToTelegramUpdate, vkEventToTelegramUpdate, vkDownloadMedia, vkUploadPhoto, vkUploadDoc, vkExtractAttachments, randomId as randomVkId, type VkEvent } from './vk';
import {
  getBot,
  loadScenario,
  loadScenarioVersion,
  saveScenario,
  getSession,
  getSessionCas,
  upsertSession,
  logEvent,
  subscribe,
  unsubscribe,
  listSubscribers,
  insertScheduled,
  dueScheduled,
  deleteScheduled,
  stats,
  setBotActive,
  setVkCallbackServerId,
  setBotName,
  setPublishedVersion,
  setBotUsername,
  listBots,
  getAccountByLogin,
  insertAccount,
  getAccountRole,
  // referrals
  recordReferral,
  countInvited,
  referralContext,
  referralStats,
  // settings
  getSettings,
  putSettings,
  DEFAULT_SETTINGS,
  isValidSkillLevel,
  isValidPaletteMode,
  type UserSettings,
  type ThemeName,
  type LangName,
  type SkillLevel,
  type PaletteMode,
  // templates
  listTemplates,
  getTemplate,
  insertTemplate,
  bumpTemplateUses,
  bumpTemplateLikes,
  deleteTemplate,
  toListItem,
  // perf / new features
  deleteBotCascade,
  updateScenarioJson,
  setAccountPassword,
  indexUserSession,
  dropUserSessions,
  forgetUserSession,
  bumpScheduledAttempt,
  claimScheduledSend,
  rescheduleScheduledSend,
  listBotsWithTokens,
  loadScenarioCached,
  invalidateScenarioCache,
  upsertSessionCas,
  listScenarioVersions,
  getScenarioVersion,
  deleteScenarioVersion,
  deleteScenarioVersionsExcept,
  listLogs,
  listLogsByOwner,
  countLogsByOwner,
  listOwnerBotsForAdmin,
  clearLogs,
  deleteOldLogs,
  insertScheduledBatch,
  setBotReferralFlag,
  // расписания (§4, миграция 0027)
  upsertSchedule,
  countBotSchedules,
  getScheduleByBlock,
  listEnabledSchedules,
  markScheduleRun,
  disableSchedule,
  type BotScheduleRow,
  // база клиентов + коллекции (таблицы автора бота)
  listClients,
  getClient,
  updateClientVars,
  deleteClient,
  listCollections,
  getCollection,
  insertCollection,
  updateCollection,
  deleteCollection,
  listCollectionItems,
  getCollectionItem,
  countItemsByCollections,
  updateCollectionItem,
  deleteCollectionItem,
  collectionAdd,
  collectionFind,
  collectionUpdate,
  collectionRemove,
  listUserIdsByTag,
  // теги пользователей (F2)
  addUserTag,
  removeUserTag,
  clearUserTags,
  listUserTags,
  hasUserTag,
  // черновики сценария на сервере (F9)
  getScenarioDraft,
  putScenarioDraft,
  deleteScenarioDraft,
  // счётчики сценария (миграция 0019)
  counterInc,
  counterDec,
  counterReset,
  counterGet,
  tryBumpBroadcastCounter,
  // платежи (миграция 0018)
  listPaymentConnections,
  getPaymentConnection,
  insertPaymentConnection,
  updatePaymentConnection,
  deletePaymentConnection,
  getPaymentConnectionByToken,
  ensureWebhookToken,
  rotateWebhookToken,
  insertPaymentOrder,
  getPaymentOrder,
  getPaymentOrderByExternalId,
  markPaymentOrderPaid,
  updatePaymentOrderStatus,
  type PaymentConnectionRow,
  type PaymentProvider,
  type BroadcastChunk,
  type TemplateRow,
  type BotRow,
  deleteAccountCascade,
  // подсценарии (миграция 0021)
  listSubflows,
  getSubflow,
  saveSubflowRevision,
  listSubflowVersions,
  getSubflowVersion,
  restoreSubflowRevision,
  deleteSubflow,
  subflowUsageCounts,
  putScenarioBuild,
  getScenarioBuild,
  type SubflowRow,
} from './db';
import {
  createSupportTicket,
  listSupportTickets,
  getSupportTicket,
  listSupportMessages,
  addSupportMessage,
  setTicketStatus,
  assignTicket,
  countOpenTickets,
  type SupportTicketRow,
  type SupportMessageRow,
} from './db';
import {
  createMiniApp,
  getMiniApp,
  getMiniAppBySlug,
  listMiniAppsByBot,
  listMiniAppsByOwner,
  updateMiniAppDraft,
  publishMiniApp,
  listMiniAppVersions,
  getMiniAppVersion,
  deleteMiniApp,
  getMiniAppUsage,
  addMiniAppMediaBytes,
  bumpMiniAppAiCount,
  createMiniPayment,
  deleteMiniPayment,
  getMiniPaymentByPayload,
  markMiniPaymentPaid,
  type MiniAppRow,
} from './db';
import {
  validateMiniAppShape,
  emptyMiniApp,
  MINI_LIMITS,
  type MiniAccessRule,
  type MiniContext,
} from '../../shared/miniapp';
import { applyMiniTemplate, type MiniTemplateId } from '../../shared/miniapp-templates';
import { checkPublishLimits, checkMediaQuota, rateLimitMiniApi } from './miniapp/limits';
import { generateMiniImage, toggleFavorite } from './miniapp/ai';
import { sendMiniInvoice, miniPaymentPayload, parseMiniPayPayload, validateMiniInvoice } from './miniapp/payments';
import { sanitizeRichText, sanitizeCss } from '../../shared/mini-sanitize';
import { SPA_HTML } from './miniapp/spa';
import {
  parseAndValidateInitData,
  buildContext,
  checkAccess,
  filterVisibleApp,
  collectAllowedTables,
} from './miniapp/runtime';
import {
  runEngine,
  type DataOps,
  type TagOps,
  type ReferralOps,
  type ChannelOps,
  type CounterOps,
  type UserOps,
  type BroadcastOps,
  type BroadcastSegment,
  type PaymentOps,
  type PaymentOrderInfo,
  type ScheduleOps,
  type ScheduleDef,
} from './engine';
import { scheduleToCron, isScheduleDue } from '../../shared/cron';
import {
  MAX_ASYNC_CHAIN,
  MAX_BUDGET_RESUMES,
  MAX_SCHEDULES_PER_BOT,
  MAX_SCHEDULE_RECIPIENTS_PER_TICK,
  SCHEDULE_RUN_CHUNK,
  SCHEDULE_RUN_STAGGER_MS,
} from '../../shared/limits';
import { makeReferralOps, makeMemReferralOps } from './blocks/referral/db';
import { normalizeHistory, clampTurns, assembleAiMessages, appendTurns } from './aiHistory';
import {
  createCheckoutLink,
  verifyWebhook,
  parseSecrets,
  parseConfig,
  validateConnectionInput,
  checkModeFor,
  liveCheckConnection,
  type PaymentSecrets,
} from './blocks/payments/providers';
// Набор 2026-10: входящие вебхуки (регистрация при публикации + роут /wh/:token)
// и парсинг ответа ИИ-классификатора.
import { createWebhookHook, getWebhookHookByToken, deleteWebhookHooksForBot } from './blocks/webhookin/db';
import { extractWebhookVars, normalizeWebhookField } from './blocks/webhookin/runtime';
import { parseClassifyAnswer } from './blocks/aiclassify/runtime';
import { deadlineBranch } from './blocks/deadline/runtime';
import { parseRefStartParam } from './blocks/referral/runtime';
import {
  hashPassword,
  verifyPassword,
  createSession,
  readSession,
  dropSession,
  bearerToken,
  type SessionUser,
} from './auth';

import { normalizeTicketInput, canAccessTicket, nextTicketStatus } from './support';
import {
  mediaEnabled,
  mediaExt,
  mediaGet,
  mediaKey,
  mediaPut,
  mediaDelete,
  ensureMediaBucket,
  MAX_MEDIA_BYTES,
} from './media';

interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ENCRYPTION_KEY: string;
  ADMIN_KEY?: string;
  ADMIN_TG_ID?: string;
  ENVIRONMENT?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  // Tooken images-endpoint (OpenAI-совместимый) для AI-генерации мини-аппов.
  TOOKEN_IMAGE_API_KEY?: string;
  TOOKEN_IMAGE_BASE_URL?: string;
  TOOKEN_IMAGE_MODEL?: string;
  // Дополнительные разрешённые CORS-источники через запятую (без передеплоя).
  CORS_ORIGINS?: string;
  // Опциональный белый список хостов для блоков http/action.webhook (SSRF).
  HTTP_ALLOWED_HOSTS?: string;
  // Публичный хост платёжных вебхуков (кастомный домен воркера, wrangler.toml).
  // Пусто — фолбэк на origin запроса (локальная разработка).
  PAY_WEBHOOK_BASE?: string;
  // S3-ключи Filebase для медиа мини-аппов (wrangler secret put). Без них
  // загрузка медиа отвечает 503, остальной воркер работает.
  FILEBASE_KEY?: string;
  FILEBASE_SECRET?: string;
  // F3-200: серверный флаг фичи мини-аппов. Скрытие «Ещё в разработке» (UI)
  // закрывает только фронт; пока флаг не включён, создание и публикация
  // мини-аппов на сервере закрыты для всех, кроме админ-сессии. Существующие
  // аппы и рантайм /m/... продолжают работать. Включение — var/secret
  // MINI_APPS_ENABLED=1.
  MINI_APPS_ENABLED?: string;
}

const app = new Hono<{ Bindings: Env }>();

const supportId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function supportStaff(user: { role?: string } | null): boolean {
  return user?.role === 'admin' || user?.role === 'moderator';
}

// ---------------- CORS ----------------
// Список разрешённых источников, а не '*': с открытым CORS любой сайт мог бы
// дёргать API от имени залогиненного пользователя (токен лежит в sessionStorage,
// но браузер сам подставит его в запрос с чужой страницы).
const PROD_ORIGINS = [
  'https://bots-constructor-web.pages.dev',
  // Кастомный домен Pages-проекта botlab.dpdns.org (DNS указывает туда) —
  // фронт прод-витрины. Без него в allowlist браузер
  // блокирует ответы API (логин падает с «Не удалось подключиться»).
  'https://botlab.dpdns.org',
];

const ORIGIN_PATTERNS: RegExp[] = [
  // Превью-деплои Pages: <branch>.bots-constructor-web.pages.dev
  /^https:\/\/[a-z0-9-]+\.bots-constructor-web\.pages\.dev$/,
  // Превью кастом-домена: <branch>.botlab.dpdns.org (preview-алиасы Pages).
  /^https:\/\/[a-z0-9-]+\.botlab\.dpdns\.org$/,
  // Локальная разработка (vite dev + wrangler dev).
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

function originAllowed(origin: string, extra: string | undefined): boolean {
  if (!origin) return false;
  if (PROD_ORIGINS.includes(origin)) return true;
  if (ORIGIN_PATTERNS.some((re) => re.test(origin))) return true;
  if (!extra) return false;
  return extra
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}

// Вешаем на все пути: часть эндпоинтов (настройки, каталог) доступна и по
// коротким адресам /settings, /templates — для них тоже нужен preflight.
app.use(
  '*',
  cors({
    // Возвращаем origin только если он в списке; иначе заголовок не ставится
    // вообще и браузер блокирует ответ. Пустой origin (curl, Telegram,
    // same-origin) — это не CORS-запрос, заголовок ему не нужен.
    origin: (origin: string, c: any) => (originAllowed(origin, c?.env?.CORS_ORIGINS) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type', 'x-admin-key', 'authorization'],
  })
);

// ---------------- admin access ----------------
// Fail-closed ВО ВСЕХ окружениях: если ADMIN_KEY не задан — админского доступа
// НЕТ, включая локальную разработку. Раньше существовало dev-исключение
// (ENVIRONMENT != production → пускать всех): любой текст в x-admin-key открывал
// дашборд, а один потерянный секрет в настройках окружения выгружал все боты.
// Локально ключ теперь задаётся явно: wrangler dev --var ADMIN_KEY:<local-key>.
// Пустой x-admin-key не сравнивается никогда: пустая строка не должна совпасть
// ни с чем. Сам ключ не логируется и не попадает ни в один ответ.
let adminWarned = false;

// Сравнение без утечки по времени: сначала длина, затем XOR всех байт.
// crypto.timingSafeEqual в Workers нет; при лимите 10 попыток/10 минут это
// скорее гигиена, но стоит она три строки.
function keysEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAdminRequest(c: any): boolean {
  const key = c.env.ADMIN_KEY;
  if (!key) {
    if (!adminWarned) {
      adminWarned = true;
      console.warn('[admin] ADMIN_KEY не задан — админский доступ ЗАКРЫТ');
    }
    return false;
  }
  const sent = c.req.header('x-admin-key');
  return !!sent && keysEqual(sent, key);
}

// Глобальный обработчик ошибок: без него любое непойманное исключение
// (гонка при регистрации, битый ключ шифрования) отдавало голый 500,
// а в логах не оставалось ничего.
app.onError((err: any, c: any) => {
  const msg = String(err?.message ?? err ?? 'internal error');
  // WS-08: путь БЕЗ query — в query-параметрах встречаются токены и подписи
  // (например /p/:token, initData), им в observability-логах не место.
  console.error(`[error] ${c.req.method} ${c.req.path}: ${msg}`);
  // Нарушение уникальности в D1 — это конфликт, а не поломка сервера.
  if (/unique|constraint/i.test(msg)) return json({ error: 'такая запись уже есть' }, 409);
  return json({ error: 'внутренняя ошибка сервера' }, 500);
});

app.notFound((c) => json({ error: `нет такого маршрута: ${c.req.method} ${c.req.path}` }, 404));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------- rate limit (антибрут на /api/auth/*) ----------------
// Счётчик в KV: не строгий (гонки возможны), но перебор паролей ломает.
// Считаем ТОЛЬКО неудачи: раньше в тот же бакет попадали и успешные входы,
// поэтому офис/мобильная сеть за общим NAT ловила 429 на ровном месте.
const RL_WINDOW_SEC = 600;
const RL_MAX = 10; // неудачных попыток за окно
const RL_SLOWDOWN_AFTER = 4; // после стольки неудач добавляем паузу перед ответом

async function failCount(env: Env, key: string): Promise<number> {
  if (!env.KV) return 0;
  try {
    const n = Number(await env.KV.get(`rl:${key}`));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function bumpFail(env: Env, key: string): Promise<number> {
  const n = (await failCount(env, key)) + 1;
  if (env.KV) {
    await env.KV.put(`rl:${key}`, String(n), { expirationTtl: RL_WINDOW_SEC }).catch(() => {});
  }
  return n;
}

async function resetFail(env: Env, key: string): Promise<void> {
  if (!env.KV) return;
  await env.KV.delete(`rl:${key}`).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Замедление перебора: после нескольких неудач ответ приходит не мгновенно.
// Различимые ответы «Логин не найден»/«Пароль не верный» оставлены сознательно
// (так просил владелец) — от перечисления логинов защищают пауза, счётчики
// неудач (login:<ip> и acct:<login>) и блокировка 429 после 10 попыток.
// Машинное поле code рядом с error позволяет фронту показать точный текст,
// не парся русскую строку.
async function slowDown(env: Env, key: string): Promise<void> {
  const n = await failCount(env, key);
  if (n > RL_SLOWDOWN_AFTER) await sleep(Math.min(3000, (n - RL_SLOWDOWN_AFTER) * 500));
}

async function tooManyAttempts(env: Env, key: string): Promise<boolean> {
  return (await failCount(env, key)) >= RL_MAX;
}

// F-011: минутный частотный лимит на дорогие пути (simulate/publish). Тот же
// счётчик KV, что у counterLimited, но окно 60 с и свой порог. Возвращает
// готовый 429 с Retry-After или null. KV недоступен — не блокируем (fail-open,
// как у всех счётчиков платформы: доступность важнее строгости, F-012).
async function minuteLimited(c: any, key: string, max: number): Promise<Response | null> {
  if (!c.env.KV) return null;
  try {
    const minute = Math.floor(Date.now() / 60_000);
    const k = `rl:${key}:${minute}`;
    const n = Number(await c.env.KV.get(k));
    const count = Number.isFinite(n) ? n : 0;
    if (count >= max) {
      return new Response(
        JSON.stringify({ error: 'Слишком частые запросы. Подождите минуту и попробуйте снова.' }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }
      );
    }
    await c.env.KV.put(k, String(count + 1), { expirationTtl: 120 }).catch(() => {});
  } catch {
    /* KV деградировал — пропускаем */
  }
  return null;
}

function clientIp(c: any): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
}

// ---------------- identity ----------------

type Identity = { admin: boolean; user: SessionUser | null };

// Владелец ботов, созданных под платформенным ключом (ADMIN_KEY): у такой
// сессии аккаунта нет, но боты ей всё же принадлежат. Литерал «admin» —
// ровно то же значение, что писал в bots.owner_id POST /api/bots, поэтому
// каталог платформенной сессии читается тем же запросом, что у аккаунта:
// listBots(db, ADMIN_OWNER_ID). Чужие боты при этом не показываются — режим
// «весь список» (ownerId = null) остаётся неиспользуемым.
const ADMIN_OWNER_ID = 'admin';

async function resolveIdentity(c: any): Promise<Identity> {
  if (isAdminRequest(c)) return { admin: true, user: null };
  const user = await readSession(c.env.KV, bearerToken(c));
  return { admin: false, user };
}

// Returns a 401 Response when nobody is authenticated, otherwise the identity.
async function auth(c: any): Promise<Identity | Response> {
  const id = await resolveIdentity(c);
  if (!id.admin && !id.user) return json({ error: 'unauthorized' }, 401);
  return id;
}

function isResponse(x: unknown): x is Response {
  return typeof Response !== 'undefined' && x instanceof Response;
}

async function loadOwnedBot(c: any, id: Identity): Promise<BotRow | Response> {
  const bot = await getBot(c.env.DB, c.req.param('id'));
  if (!bot) return json({ error: 'not found' }, 404);
  if (id.admin) return bot;
  if (id.user && bot.owner_id === id.user.id) return bot;
  return json({ error: 'forbidden' }, 403);
}

// Доступ сотрудника (admin/moderator/ADMIN_KEY) к ЧУЖИМ ботам. Используется
// ТОЛЬКО в read-only маршрутах: GET /api/bots/:id/logs, POST /api/bots/statuses
// и страница «Пользователи» (/api/admin/*). loadOwnedBot/loadOwnedBotById
// намеренно НЕ расширены: запись сценария, публикация и удаление чужого бота
// сотрудникам недоступны.
async function canAccessAnyBot(c: any, id: Identity): Promise<boolean> {
  if (id.admin) return true;
  if (!id.user) return false;
  const role = await roleOf(c, id);
  return role === 'admin' || role === 'moderator';
}

const TG_TIMEOUT_MS = 15_000; // Telegram ждёт ответ 60 с — апдейт не должен висеть дольше 15.

function tgCall(token: string, method: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'bots-constructor/1.0' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TG_TIMEOUT_MS),
  });
}

// Единая точка исходящей отправки для движка/очереди: Telegram-боты идут через
// tgCall как раньше (совместимость байт-в-байт), VK-боты — через vkCall с
// переводом payload. Возвращает Response-подобный объект { ok, json() } —
// вызывающие (dispatchOuts/processDue) работают с ним как с ответом Telegram.
function vkResponse(ok: boolean, result: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok, result }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function platformCall(
  platform: 'telegram' | 'vk',
  token: string,
  method: string,
  payload: Record<string, unknown>,
  opts?: { vkGroupId?: number | null; kv?: KVNamespace }
): Promise<Response> {
  if (platform !== 'vk') return tgCall(token, method, payload);
  // Медиа: sendPhoto/sendDocument/sendMediaGroup на VK — upload-цепочка
  // (внешний URL → upload-сервер VK → attachment). Требует group_id (BotRow);
  // при его отсутствии — фолбэк ссылкой (translateOutgoing default).
  const mediaUrl =
    method === 'sendMediaGroup'
      ? undefined
      : typeof payload.photo === 'string'
      ? payload.photo
      : typeof payload.document === 'string'
      ? payload.document
      : undefined;
  if (method === 'sendPhoto' || method === 'sendDocument') {
    const uploaded = await vkSendMediaUpload(method, mediaUrl, payload, token, opts);
    if (uploaded) return uploaded;
  }
  if (method === 'sendMediaGroup') {
    const sent = await vkSendMediaGroup(payload, token, opts);
    if (sent) return sent;
  }
  const translated = translateOutgoing(method, payload);
  if (!translated) return vkResponse(true, { skipped: true });
  try {
    const result = await vkCall(translated.method, translated.params, token);
    // messages.send возвращает conversation_message_id числом. Вызывающие
    // (rememberBotMsg: data.result.message_id) ждут Telegram-форму — кладём
    // число в result.message_id, не меняя их.
    const mid = Number(result);
    const normalized = Number.isFinite(mid) && mid > 0 ? { message_id: mid, conversation_message_id: mid } : result;
    return vkResponse(true, normalized);
  } catch (e) {
    // Ошибка VK — «не-ok»-ответ: вызывающие ветки ошибок (edit_message, delete)
    // обрабатывают его как сбой доставки, поток сценария не рвётся.
    console.warn(`[vk] ${translated.method} failed: ${(e as Error).message}`);
    return vkResponse(false);
  }
}

// Upload-цепочка одного медиа (sendPhoto/sendDocument). Успех — Response с
// Telegram-формой message_id; неудача — null (вызывающий уйдёт в
// translateOutgoing-фолбэк текстом+ссылкой).
async function vkSendMediaUpload(
  method: string,
  mediaUrl: string | undefined,
  payload: Record<string, unknown>,
  token: string,
  opts?: { vkGroupId?: number | null }
): Promise<Response | null> {
  if (!mediaUrl || !/^https:\/\//i.test(mediaUrl) || !opts?.vkGroupId) return null;
  const peerId = Number(payload.chat_id);
  const caption = typeof payload.caption === 'string' ? payload.caption : '';
  try {
    const dl = await vkDownloadMedia(mediaUrl);
    if (!dl.ok) return null;
    if (method === 'sendPhoto') {
      const up = await vkUploadPhoto(dl.bytes, opts.vkGroupId, token);
      if (!up.ok) return null;
      const result = await vkCall(
        'messages.send',
        {
          peer_id: peerId,
          ...(caption ? { message: caption.slice(0, 4096) } : {}),
          attachment: up.attachment,
          random_id: randomVkId(),
        },
        token
      );
      const mid = Number(result);
      return vkResponse(true, Number.isFinite(mid) && mid > 0 ? { message_id: mid, conversation_message_id: mid } : {});
    }
    const name = mediaUrl.split('/').pop()?.split('?')[0] || 'file';
    const up = await vkUploadDoc(dl.bytes, peerId, name, token);
    if (!up.ok) return null;
    const result = await vkCall(
      'messages.send',
      {
        peer_id: peerId,
        ...(caption ? { message: caption.slice(0, 4096) } : {}),
        attachment: up.attachment,
        random_id: randomVkId(),
      },
      token
    );
    const mid = Number(result);
    return vkResponse(true, Number.isFinite(mid) && mid > 0 ? { message_id: mid, conversation_message_id: mid } : {});
  } catch (e) {
    console.warn(`[vk] media upload failed: ${(e as Error).message}`);
    return null;
  }
}

// Альбом: media-массив движка → загрузка каждого фото → один messages.send
// со списком attachment через запятую (VK не имеет отдельного «альбома»,
// но attachment принимает несколько). Видео-элементы пропускаются (не
// загружаются ключом сообщества) — фолбэк caption.
async function vkSendMediaGroup(
  payload: Record<string, unknown>,
  token: string,
  opts?: { vkGroupId?: number | null }
): Promise<Response | null> {
  const media = Array.isArray(payload.media) ? (payload.media as { type?: string; media?: string; caption?: string }[]) : [];
  const photos = media.filter((m) => m?.type === 'photo' && typeof m.media === 'string' && /^https:\/\//i.test(m.media));
  if (!photos.length || !opts?.vkGroupId) return null;
  const peerId = Number(payload.chat_id);
  try {
    const attachments: string[] = [];
    for (const p of photos.slice(0, 10)) {
      const dl = await vkDownloadMedia(p.media!);
      if (!dl.ok) continue;
      const up = await vkUploadPhoto(dl.bytes, opts.vkGroupId, token);
      if (up.ok) attachments.push(up.attachment);
    }
    if (!attachments.length) return null;
    const caption = photos.find((p) => p.caption)?.caption || '';
    const result = await vkCall(
      'messages.send',
      {
        peer_id: peerId,
        ...(caption ? { message: caption.slice(0, 4096) } : {}),
        attachment: attachments.join(','),
        random_id: randomVkId(),
      },
      token
    );
    const mid = Number(result);
    return vkResponse(true, Number.isFinite(mid) && mid > 0 ? { message_id: mid, conversation_message_id: mid } : {});
  } catch (e) {
    console.warn(`[vk] media group failed: ${(e as Error).message}`);
    return null;
  }
}

// F-028: 429 от Telegram с parameters.retry_after. Раньше такой ответ просто
// считался неудачей — рассылка теряла получателей, а крон долбил тот же
// запрос в следующую минуту. Ошибка несёт сколько секунд ждать; вызывающий
// (processDue) переносит задачу, НЕ тратя попытку из MAX_ATTEMPTS.
class TgRateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`telegram 429 retry_after=${retryAfterSec}`);
    this.name = 'TgRateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}

// tgCall + разбор 429: бросает TgRateLimitError с retry_after из ответа.
// Прочие статусы возвращает как есть — сигнатура tgCall не меняется.
async function tgCallChecked(token: string, method: string, payload: Record<string, unknown>): Promise<Response> {
  const res = await tgCall(token, method, payload);
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
    const ra = Number(body?.parameters?.retry_after);
    // Telegram даёт 1..3600; зажимаем в разумные пределы для очереди.
    throw new TgRateLimitError(Math.min(300, Math.max(1, Number.isFinite(ra) ? ra : 3)));
  }
  return res;
}

// ---------------- исходящие запросы из сценария (SSRF) ----------------
// Блоки http и action.webhook вызывают произвольный URL, который ввёл
// пользователь. Без ограничений это бесплатный прокси внутрь сети Cloudflare
// и способ подвесить запрос: tgCall таймаут имел, а обычный fetch — нет.
const HTTP_TIMEOUT_MS = 10_000;
const HTTP_MAX_BYTES = 256 * 1024; // ответа больше четверти мегабайта нам не нужно
const HTTP_MAX_REDIRECTS = 3;

// Куда сценариям ходить нельзя: локальные адреса и облачные metadata-сервисы.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    h === 'localhost' ||
    h === 'metadata' ||
    h === 'metadata.google.internal' ||
    h === '169.254.169.254' ||
    ['.localhost', '.local', '.internal', '.arpa'].some((suffix) => h.endsWith(suffix))
  ) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]?:/i.test(h)) return true;
  // Неопределённый адрес (::) маршрутизируется как loopback/localhost на многих
  // ОС, а ::ffff:<ipv4> — это IPv4-mapped форма (обрабатывается ниже).
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true;
  const mapped = h.match(/^::ffff:(.+)$/i);
  if (mapped) {
    // WHATWG URL приводит ::ffff:127.0.0.1 к hex-форме ::ffff:7f00:1 —
    // её тоже разворачиваем в IPv4 и проверяем общим правилом.
    const hex = mapped[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedHost(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    return isBlockedHost(mapped[1]);
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return true;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && (b === 0 || b === 2 || b === 168)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function hostAllowed(host: string, allowlist: string | undefined): boolean {
  const list = (allowlist ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // No global allowlist by product decision: public hosts remain permitted unless
  // an operator configures HTTP_ALLOWED_HOSTS. Workers cannot DNS-resolve a name
  // before fetch, so a public name resolving privately is residual platform risk;
  // every textual redirect hop is nevertheless checked before it is fetched.
  if (!list.length) return true;
  return list.includes(host.toLowerCase());
}

// fetch с таймаутом, ручными редиректами (каждый — с проверкой хоста) и
// ограничением размера ответа.
async function safeFetch(rawUrl: string, init: RequestInit, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  let target: URL;
  try {
    target = new URL(String(rawUrl));
  } catch {
    throw new Error('некорректный URL');
  }
  for (let hop = 0; ; hop++) {
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('разрешены только http и https');
    if (isBlockedHost(target.hostname)) throw new Error('адрес недоступен');
    if (!hostAllowed(target.hostname, env.HTTP_ALLOWED_HOSTS)) throw new Error('хост не в белом списке');

    const res = await fetchImpl(target.toString(), {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get('location');
    if (!isRedirect || !location || hop >= HTTP_MAX_REDIRECTS) return res;
    target = new URL(location, target);
  }
}

// Читаем тело с жёстким лимитом: иначе огромный ответ съест память изолята.
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > HTTP_MAX_BYTES) throw new Error(`ответ больше ${HTTP_MAX_BYTES} байт`);
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength ?? 0;
    if (total > HTTP_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`ответ больше ${HTTP_MAX_BYTES} байт`);
    }
    chunks.push(value as Uint8Array);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function validateScenarioShape(s: any): s is Scenario {
  return s && typeof s === 'object' && typeof s.start === 'string' && s.blocks && typeof s.blocks === 'object';
}

// ---------------- Auth API (обычные пользователи) ----------------

const LOGIN_RE = /^[a-zA-Z0-9._-]{3,32}$/;

// Служебные логины: аккаунт-литерал 'admin' используется платформенным ключом,
// остальные резервируем, чтобы никто не занял их и не выдавал себя за сервис.
const RESERVED_LOGINS = new Set(['admin', 'moderator', 'system', 'support', 'root', 'api']);

app.post('/api/auth/register', async (c) => {
  const ip = clientIp(c);
  if (await tooManyAttempts(c.env, `reg:${ip}`)) {
    return json({ error: 'слишком много попыток регистрации. Подождите 10 минут' }, 429);
  }
  const body = await c.req.json<{ login?: string; password?: string }>().catch(() => null);
  const login = (body?.login || '').trim().toLowerCase();
  const password = body?.password || '';
  if (!LOGIN_RE.test(login)) {
    await bumpFail(c.env, `reg:${ip}`);
    return json({ error: 'логин: 3-32 символа, латиница, цифры, . _ -' }, 400);
  }
  if (RESERVED_LOGINS.has(login)) {
    await bumpFail(c.env, `reg:${ip}`);
    return json({ error: 'этот логин зарезервирован' }, 400);
  }
  if (password.length < 6) {
    await bumpFail(c.env, `reg:${ip}`);
    return json({ error: 'пароль короче 6 символов' }, 400);
  }

  const existing = await getAccountByLogin(c.env.DB, login);
  if (existing) {
    await bumpFail(c.env, `reg:${ip}`);
    return json({ error: 'Логин занят' }, 409);
  }

  const id = crypto.randomUUID();
  const pass_hash = await hashPassword(password);
  try {
    await insertAccount(c.env.DB, { id, login, pass_hash, created_at: Date.now() });
  } catch (e: any) {
    // Гонка: два одинаковых логина одновременно. ON CONFLICT ловим здесь,
    // чтобы клиент получил 409, а не 500.
    if (/unique|constraint/i.test(String(e?.message ?? ''))) return json({ error: 'Логин занят' }, 409);
    throw e;
  }
  await resetFail(c.env, `reg:${ip}`);
  const token = await createSession(c.env.KV, { id, login });
  await indexUserSession(c.env.KV, id, token);
  return json({ ok: true, token, user: { id, login } });
});

app.post('/api/auth/login', async (c) => {
  const ip = clientIp(c);
  const ipKey = `login:${ip}`;
  const body = await c.req.json<{ login?: string; password?: string }>().catch(() => null);
  const login = (body?.login || '').trim().toLowerCase();
  // Отдельный бакет на аккаунт: перебор одного пароля с разных адресов
  // (распределённый брут) тоже должен упираться в лимит.
  const accKey = `acct:${login}`;
  // Лимит считаем заранее, но блокируем ТОЛЬКО неудачный вход: верный пароль
  // обязан пускать даже при полном бакете. Иначе легитимный пользователь,
  // которого заблокировал чужой брутфорс, не мог бы войти даже со своим
  // паролем — счётчик сбрасывается только успешным входом.
  const ipBlocked = await tooManyAttempts(c.env, ipKey);
  const accBlocked = await tooManyAttempts(c.env, accKey);

  const acc = await getAccountByLogin(c.env.DB, login);
  // Короткое замыкание сохранено намеренно: если аккаунта нет, пароль НЕ
  // проверяется вообще (никакого PBKDF2-вызова) — нечего сравнивать.
  if (!acc || !(await verifyPassword(body?.password || '', acc?.pass_hash ?? ''))) {
    if (ipBlocked) {
      return json({ error: 'слишком много неудачных попыток. Подождите 10 минут' }, 429);
    }
    if (accBlocked) {
      return json({ error: 'слишком много неудачных попыток для этого аккаунта. Подождите 10 минут' }, 429);
    }
    await Promise.all([bumpFail(c.env, ipKey), bumpFail(c.env, accKey)]);
    await slowDown(c.env, accKey);
    // Различимые сообщения (см. комментарий у slowDown): владелец хочет видеть
    // «Логин не найден» и «Пароль не верный» отдельно. code — стабильное
    // машинное поле для фронта, error — человекочитаемый русский текст.
    return acc
      ? json({ error: 'Пароль не верный', code: 'wrong_password' }, 401)
      : json({ error: 'Логин не найден', code: 'login_not_found' }, 401);
  }
  await Promise.all([resetFail(c.env, ipKey), resetFail(c.env, accKey)]);
  const token = await createSession(c.env.KV, { id: acc.id, login: acc.login });
  await indexUserSession(c.env.KV, acc.id, token);
  return json({ ok: true, token, user: { id: acc.id, login: acc.login } });
});

app.get('/api/auth/me', async (c) => {
  const id = await resolveIdentity(c);
  if (id.admin) return json({ user: { id: 'admin', login: 'admin' } });
  if (id.user) return json({ user: id.user });
  return json({ user: null }, 401);
});

app.delete('/api/auth/me', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (id.admin && !id.user) return json({ error: 'у админского ключа нет пароля' }, 400);
  const body = await c.req.json<{ password?: string }>().catch(() => null);
  const acc = await getAccountByLogin(c.env.DB, id.user!.login);
  if (!acc) return json({ error: 'аккаунт не найден' }, 404);
  if (!(await verifyPassword(body?.password || '', acc.pass_hash)))
    return json({ error: 'Пароль не верный', code: 'wrong_password' }, 401);
  // F-017/WS-10: до каскада снимаем вебхуки ботов в Telegram и чистим их
  // KV-ключи (webhook-секрет <botId> и кэш сценария sc:<botId>). Иначе Telegram
  // продолжит слать апдейты на воркер по вебхуку удалённого бота — «призрак»
  // молча ack'ает их, а ключи без TTL копятся. Сбой Telegram/KV на одном боте
  // не должен отменять удаление аккаунта: всё в try/catch.
  const ownedBots = await listBotsWithTokens(c.env.DB, acc.id).catch(() => [] as { id: string; token_enc: string }[]);
  for (const b of ownedBots) {
    try {
      const t = await decryptToken(b.token_enc, c.env.ENCRYPTION_KEY);
      await tgCall(t, 'deleteWebhook', { drop_pending_updates: false }).catch(() => null);
    } catch {
      /* битый токен — вебхук не снять, но удаление не блокируем */
    }
    await Promise.all([
      c.env.KV?.delete(b.id).catch(() => {}),
      invalidateScenarioCache(c.env.KV, b.id).catch(() => {}),
      // wh:<botId> — кэш статусов вебхука (POST /api/bots/statuses), тот же
      // набор ключей, что чистит DELETE /api/bots/:id.
      c.env.KV?.delete(`wh:${b.id}`).catch(() => {}),
    ]).catch(() => {});
  }
  await deleteAccountCascade(c.env.DB, acc.id);
  await dropUserSessions(c.env.KV, acc.id);
  await dropSession(c.env.KV, bearerToken(c));
  return json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
  const token = bearerToken(c);
  const user = await readSession(c.env.KV, token);
  if (user) await forgetUserSession(c.env.KV, user.id, token);
  await dropSession(c.env.KV, token);
  return json({ ok: true });
});

// Смена пароля. После успеха ВСЕ сессии пользователя сбрасываются — иначе
// украденный или забытый токен продолжал бы жить месяц.
app.post('/api/auth/password', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (id.admin && !id.user) return json({ error: 'у админского ключа нет пароля' }, 400);
  const body = await c.req.json<{ oldPassword?: string; newPassword?: string }>().catch(() => null);
  const oldPassword = body?.oldPassword || '';
  const newPassword = body?.newPassword || '';
  if (newPassword.length < 6) return json({ error: 'пароль короче 6 символов' }, 400);

  const acc = await getAccountByLogin(c.env.DB, id.user!.login);
  if (!acc) return json({ error: 'аккаунт не найден' }, 404);
  if (!(await verifyPassword(oldPassword, acc.pass_hash))) {
    return json({ error: 'Пароль не верный', code: 'wrong_password' }, 401);
  }
  await setAccountPassword(c.env.DB, acc.id, await hashPassword(newPassword));
  const dropped = await dropUserSessions(c.env.KV, acc.id);
  // Выдаём свежий токен: все старые погашены, но текущую вкладку логинить
  // заново не нужно — фронт просто подменит токен в sessionStorage.
  const token = await createSession(c.env.KV, { id: acc.id, login: acc.login });
  await indexUserSession(c.env.KV, acc.id, token);
  return json({ ok: true, sessionsClosed: dropped, token });
});

// «Выйти на всех устройствах»: гасим все сессии аккаунта, включая текущую.
app.post('/api/auth/logout-all', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (id.admin && !id.user) return json({ ok: true, sessionsClosed: 0 });
  const dropped = await dropUserSessions(c.env.KV, id.user!.id);
  await dropSession(c.env.KV, bearerToken(c));
  return json({ ok: true, sessionsClosed: dropped });
});

// Роль пользователя: 'user' | 'moderator' | 'admin'.
// ADMIN_KEY всегда даёт admin; обычные роли читаются из accounts.role.
async function roleOf(c: any, id: Identity): Promise<string> {
  if (id.admin) return 'admin';
  if (!id.user) return 'user';
  return (await getAccountRole(c.env.DB, id.user.id)) || 'user';
}

// Кто именно выполняет действие: id пользователя из токена (у админа — 'admin').
function actorId(id: Identity): string {
  return id.admin ? 'admin' : id.user!.id;
}

// ---------------- Настройки интерфейса (per-user, D1) ----------------

const BOOL_KEYS = ['hints_enabled', 'feature_whatif', 'feature_conflicts', 'feature_sleep', 'advanced_blocks'] as const;

// Время, когда уровень реально выбрали, ставит сервер, а не клиент: только он
// знает, что это первая запись непустого значения. Фронту это поле приходит
// на чтение, но принять его из тела запроса нельзя — иначе им можно было бы
// переписать историю (сбросить дату и снова получить экран выбора).
function numberTimestampOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function parseSettingsBody(body: any): { patch: Partial<UserSettings> } | { error: string } {
  if (body == null || typeof body !== 'object') return { error: 'тело запроса должно быть JSON-объектом' };
  const patch: Partial<UserSettings> = {};
  if ('theme' in body) {
    if (body.theme !== 'dark' && body.theme !== 'light') return { error: "theme: 'dark' или 'light'" };
    patch.theme = body.theme as ThemeName;
  }
  if ('language' in body) {
    if (body.language !== 'ru' && body.language !== 'en') return { error: "language: 'ru' или 'en'" };
    patch.language = body.language as LangName;
  }
  if ('skill_level' in body) {
    if (!isValidSkillLevel(body.skill_level)) {
      return { error: "skill_level: '' | 'high' | 'medium' | 'low'" };
    }
    patch.skill_level = body.skill_level as SkillLevel;
  }
  if ('palette_mode' in body) {
    // Это не булево значение, поэтому не идёт в BOOL_KEYS.
    if (!isValidPaletteMode(body.palette_mode)) {
      return { error: "palette_mode: 'accordion' или 'free'" };
    }
    patch.palette_mode = body.palette_mode as PaletteMode;
  }
  // tour_done_at: клиент сообщает «тур пройден». Отрицательное/мусорное значение
  // игнорируем, а не пишем в базу.
  if ('tour_done_at' in body) {
    patch.tour_done_at = numberTimestampOrNull(body.tour_done_at);
  }
  for (const k of BOOL_KEYS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (typeof v === 'boolean') (patch as any)[k] = v;
    else if (v === 0 || v === 1 || v === '0' || v === '1') (patch as any)[k] = !!Number(v);
    else return { error: `${k}: булево значение (0 или 1)` };
  }
  return { patch };
}

const settingsRoutes = ['/api/settings', '/settings'];

// Экран выбора уровня должен показаться ровно один раз на аккаунт. Поэтому
// момент выбора записывает сервер: как только пришёл непустой skill_level,
// ставим skill_level_set_at (если он ещё не стоял).
function markSkillLevelChosen(patch: Partial<UserSettings>): Partial<UserSettings> {
  if (!patch.skill_level) return patch;
  return { ...patch, skill_level_set_at: Date.now() };
}

app.on('GET', settingsRoutes, async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (id.admin && !id.user) {
    const stored = (await c.env.KV.get('settings:admin', 'json').catch(() => null)) as Partial<UserSettings> | null;
    return json({ ...DEFAULT_SETTINGS, ...(stored ?? {}), role: 'admin', user: { id: 'admin', login: 'admin' } });
  }
  const [settings, role] = await Promise.all([getSettings(c.env.DB, id.user!.id), roleOf(c, id)]);
  return json({ ...settings, role, user: id.user });
});

app.on('PUT', settingsRoutes, async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const body = await c.req.json<any>().catch(() => null);
  const parsed = parseSettingsBody(body);
  if ('error' in parsed) return json({ error: parsed.error }, 400);
  if (id.admin && !id.user) {
    const role = 'admin';
    const key = 'settings:admin';
    const previous = (await c.env.KV.get(key, 'json').catch(() => null)) as Partial<UserSettings> | null;
    const merged = { ...DEFAULT_SETTINGS, ...(previous ?? {}), ...markSkillLevelChosen(parsed.patch) };
    await c.env.KV.put(key, JSON.stringify(merged));
    return json({ ...merged, role, user: { id: 'admin', login: 'admin' } });
  }
  const settings = await putSettings(c.env.DB, id.user!.id, markSkillLevelChosen(parsed.patch));
  const role = await roleOf(c, id);
  return json({ ...settings, role, user: id.user });
});

app.on('GET', ['/api/me', '/me'], async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (id.admin && !id.user) return json({ user: { id: 'admin', login: 'admin' }, role: 'admin' });
  const role = await roleOf(c, id);
  return json({ user: id.user, role });
});

// ---------------- подсценарии: библиотека владельца ----------------
//
// Правила безопасности (промпт субфлоу): бот может ссылаться ТОЛЬКО на
// фрагменты своего владельца, и это проверяется на КАЖДОМ пути чтения
// (сохранение сценария, валидация, публикация, превью, шаблоны), а не только
// в UI. Библиотека грузится одним списком по owner_id, поэтому чужой subflowId
// автоматически отсутствует в ней и становится ошибкой subflow-missing.

// Ограничение размера фрагмента: 256 КБ — вчетверо меньше общего лимита
// flow_json (1 МБ), потому что фрагмент РАСКРЫВАЕТСЯ в каждый вызов: при
// десяти вызовах один «почти мегабайтный» фрагмент раздул бы билд за предел
// лимита сценария.
const MAX_SUBFLOW_BYTES = 256 * 1024;

function parseIoJson(raw: string | null | undefined): SubflowIoDef[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim())
      .map((x: any) => ({
        name: String(x.name).trim().slice(0, 64),
        description: String(x.description ?? '').slice(0, 200),
        required: !!x.required,
      }));
  } catch {
    return [];
  }
}

// Библиотека фрагментов владельца: актуальные ревизии + снимки ревизий,
// закреплённых вызовами (из subflow_versions). Чужой subflowId в библиотеку
// не попадает физически — ссылка на него становится ошибкой subflow-missing.
async function loadSubflowLibrary(db: D1Database, ownerId: string, scenario: Scenario | null): Promise<SubflowLibrary> {
  const rows = await listSubflows(db, ownerId).catch(() => [] as SubflowRow[]);
  const library: SubflowLibrary = {};
  // Закреплённые ревизии: из сценария и (вложенно) из самих фрагментов.
  const pinned = new Map<string, Set<number>>();
  const collectPins = (sc: Scenario | null | undefined) => {
    for (const b of Object.values(sc?.blocks ?? {})) {
      if (b.type !== 'subflow') continue;
      const sid = String(b.params?.subflowId ?? '').trim();
      const rev = b.params?.subflowRevision;
      if (!sid || rev == null) continue;
      if (!pinned.has(sid)) pinned.set(sid, new Set());
      pinned.get(sid)!.add(Number(rev));
    }
  };
  collectPins(scenario);
  for (const row of rows) {
    library[row.id] = {
      id: row.id,
      name: row.name,
      revision: row.revision,
      flow_json: safeParseScenario(row.flow_json),
      inputs: parseIoJson(row.inputs_json),
      outputs: parseIoJson(row.outputs_json),
      latestRevision: row.revision,
    };
    try {
      collectPins(JSON.parse(row.flow_json) as Scenario);
    } catch {
      /* битый фрагмент не роняет загрузку: раскрытие сообщит проблему */
    }
  }
  // Снимки закреплённых ревизий: отсутствуют -> expander даст subflow-revision.
  for (const row of rows) {
    const pins = pinned.get(row.id);
    if (!pins?.size) continue;
    const revisions: Record<number, SubflowRevisionSnapshot> = {};
    for (const rev of pins) {
      if (rev === row.revision) continue;
      const v = await getSubflowVersion(db, row.id, rev).catch(() => null);
      if (!v) continue;
      revisions[rev] = {
        flow_json: safeParseScenario(v.flow_json),
        inputs: parseIoJson(v.inputs_json),
        outputs: parseIoJson(v.outputs_json),
      };
    }
    if (Object.keys(revisions).length) library[row.id].revisions = revisions;
  }
  return library;
}

function safeParseScenario(raw: string): Scenario {
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && v.blocks && typeof v.blocks === 'object') return v as Scenario;
  } catch {
    /* ниже — пустой сценарий */
  }
  return { version: 1, start: '', blocks: {} };
}

// Guard сохранения: сценарий бота не должен ссылаться на чужие/удалённые
// фрагменты. Отклоняем ЯВНО (не вырезаем молча — тихое удаление теряет работу
// автора). Возвращает список subflowId, которых нет в библиотеке владельца.
function findForeignSubflowRefs(scenario: Scenario, library: SubflowLibrary): string[] {
  if (!scenarioHasSubflows(scenario)) return [];
  const foreign: string[] = [];
  for (const b of Object.values(scenario.blocks ?? {})) {
    if (b.type !== 'subflow') continue;
    const sid = String(b.params?.subflowId ?? '').trim();
    if (sid && !library[sid]) foreign.push(sid);
  }
  return foreign;
}

// Раскрытие сценария с библиотекой владельца: единая точка, которую зовут
// публикация, publish-version, превью (simulate), экспорт шаблона и
// subflow-check. Проблемы РАСКРЫТОГО артефакта мапятся обратно на блоки
// вызова авторского сценария (remapIssuesToCallSites) — UI всегда указывает
// на блок, который автор видит на холсте. Ошибки блокируют публикацию;
// предупреждения (subflow-outdated) попадают в отчёт, но не блокируют.
async function expandScenarioForOwner(
  db: D1Database,
  ownerId: string,
  scenario: Scenario
): Promise<{ expanded: Scenario; issues: Issue[]; library: SubflowLibrary }> {
  if (!scenarioHasSubflows(scenario)) return { expanded: scenario, issues: [], library: {} };
  const library = await loadSubflowLibrary(db, ownerId, scenario);
  // 1. Авторский вид: вызовы проверяются по библиотеке (dangling/чужие/циклы/
  //    глубина/входы/ревизии) — все против id блока вызова.
  const authorIssues = validateScenario(scenario, { subflows: library });
  const { scenario: expanded } = expandSubflows(scenario, library);
  // 2. Раскрытый артефакт: полный набор существующих проверок (битые ссылки,
  //    тупики, содержимое блоков внутри фрагментов) — пользователь получит те
  //    же ошибки, что и на рукописном эквиваленте.
  const expandedIssues = remapIssuesToCallSites(validateScenario(expanded), scenario);
  // Дедуп: одна проблема могла попасть в оба прохода (например, пустой текст
  // сообщения внутри фрагмента виден и в авторской валидации через раскрытие).
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const i of [...authorIssues, ...expandedIssues]) {
    const key = `${i.code}|${i.blockId ?? ''}|${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(i);
  }
  return { expanded, issues, library };
}

// ---------------- Каталог пользовательских шаблонов (глобальный) ----------------

const templateRoutes = ['/api/templates', '/templates'];

app.on('GET', templateRoutes, async (c) => {
  const q = c.req.query('q') || '';
  const sort = c.req.query('sort') === 'newest' ? 'newest' : 'popularity';
  const tag = c.req.query('tag') || '';
  const items = await listTemplates(c.env.DB, { sort, q, tag });
  return json({ templates: items });
});

app.on('POST', templateRoutes, async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  // Каталог общий, а публикация бесплатная — без лимита его заспамят за вечер.
  const spamKey = `tpl:${actorId(id)}`;
  if (await tooManyAttempts(c.env, spamKey)) {
    return json({ error: 'слишком много шаблонов за час. Подождите' }, 429);
  }
  const body = await c.req.json<any>().catch(() => null);
  const title = String(body?.title ?? '').trim();
  const description = String(body?.description ?? '').trim();
  const rawTags = Array.isArray(body?.tags) ? body.tags : [];
  const scenarioJson = typeof body?.scenario_json === 'string' ? body.scenario_json : '';

  if (!title) return json({ error: 'У шаблона должно быть название' }, 400);
  if (title.length > 120) return json({ error: 'Название длиннее 120 символов' }, 400);
  if (description.length > 500) return json({ error: 'Описание длиннее 500 символов' }, 400);
  if (!scenarioJson) return json({ error: 'Пустой сценарий: нечего публиковать в каталог' }, 400);
  // F-004 (аудит 18.10): каталог общий — без лимита туда ложился сценарий
  // любого размера (1 МБ принят живьём). Тот же потолок, что у save/publish.
  if (scenarioJson.length > MAX_FLOW_BYTES) {
    return json({ error: `сценарий больше ${Math.round(MAX_FLOW_BYTES / 1024)} КБ — публиковать нельзя` }, 413);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(scenarioJson);
  } catch {
    return json({ error: 'scenario_json — невалидный JSON' }, 400);
  }
  if (!validateScenarioShape(parsed)) return json({ error: 'Сценарий должен содержать start и blocks' }, 400);

  // Шаблоны общие между пользователями, а подсценарий принадлежит одному
  // владельцу: шаблон с блоками subflow указывал бы на чужой фрагмент (утечка
  // или поломка при импорте). Поэтому на ЭКСПОРТЕ сценарий раскрывается и в
  // каталог ложится РАСКРЫТЫЙ вид — импорт всегда получает обычные блоки и
  // физически не может создать ссылку на чужой фрагмент. Существующие шаблоны
  // (до подсценариев) не меняются: у них нет блоков subflow, раскрытие no-op.
  const ownerId = actorId(id);
  const expansion = await expandScenarioForOwner(c.env.DB, ownerId, parsed as Scenario);
  const scenarioJsonOut = scenarioHasSubflows(parsed as Scenario)
    ? JSON.stringify(expansion.expanded)
    : scenarioJson;
  const issues = expansion.issues;
  const counts = countIssues(issues);
  if (counts.errors > 0) {
    const first = issues.find((i) => i.level === 'error');
    return json(
      { error: `Сценарий не проходит проверку: ${first?.message ?? 'есть ошибки'}`, issues },
      400
    );
  }

  const tags = rawTags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 12);
  const row: TemplateRow = {
    id: crypto.randomUUID(),
    author_user_id: actorId(id),
    title,
    description,
    tags: JSON.stringify(tags),
    scenario_json: scenarioJsonOut,
    created_at: Date.now(),
    uses_count: 0,
    likes_count: 0,
  };
  await insertTemplate(c.env.DB, row);
  await bumpFail(c.env, spamKey);
  return json({ template: toListItem(row) }, 201);
});

app.on('GET', ['/api/templates/:id', '/templates/:id'], async (c) => {
  const id = c.req.param('id');
  const t = await getTemplate(c.env.DB, id);
  if (!t) return json({ error: 'шаблон не найден' }, 404);
  return json({ template: { ...t, tags: JSON.parse(t.tags || '[]') } });
});

// Счётчики каталога открыты (лайк/использование доступны без логина), но
// накрутить их в цикле нельзя: лимит по IP на час.
const COUNTER_MAX = 60;
const COUNTER_WINDOW_SEC = 3600;

async function counterLimited(c: any, kind: string): Promise<Response | null> {
  const key = `ctr:${kind}:${clientIp(c)}`;
  if (!c.env.KV) return null;
  try {
    const n = Number((await c.env.KV.get(`rl:${key}`)) ?? 0);
    if (Number.isFinite(n) && n >= COUNTER_MAX) {
      return json({ error: 'слишком много запросов. Подождите' }, 429);
    }
    await c.env.KV.put(`rl:${key}`, String((Number.isFinite(n) ? n : 0) + 1), {
      expirationTtl: COUNTER_WINDOW_SEC,
    });
  } catch {
    /* KV недоступен — не блокируем счётчик */
  }
  return null;
}

app.on('POST', ['/api/templates/:id/use', '/templates/:id/use'], async (c) => {
  const limited = await counterLimited(c, 'use');
  if (limited) return limited;
  const id = c.req.param('id');
  const t = await getTemplate(c.env.DB, id);
  if (!t) return json({ error: 'шаблон не найден' }, 404);
  const uses_count = await bumpTemplateUses(c.env.DB, id);
  return json({ ok: true, uses_count });
});

app.on('POST', ['/api/templates/:id/like', '/templates/:id/like'], async (c) => {
  const limited = await counterLimited(c, 'like');
  if (limited) return limited;
  const id = c.req.param('id');
  const t = await getTemplate(c.env.DB, id);
  if (!t) return json({ error: 'шаблон не найден' }, 404);
  const likes_count = await bumpTemplateLikes(c.env.DB, id);
  return json({ ok: true, likes_count });
});

app.on('DELETE', ['/api/templates/:id', '/templates/:id'], async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const templateId = c.req.param('id');
  const t = await getTemplate(c.env.DB, templateId);
  if (!t) return json({ error: 'шаблон не найден' }, 404);

  const role = await roleOf(c, id);
  const canDeleteAny = role === 'admin' || role === 'moderator';
  if (!canDeleteAny && t.author_user_id !== actorId(id)) {
    return json({ error: 'удалять можно только свои шаблоны' }, 403);
  }
  await deleteTemplate(c.env.DB, templateId);
  return json({ ok: true });
});

// ---------------- Рефералы ----------------

app.get('/api/bots/:id/referrals', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const s = await referralStats(c.env.DB, owned.id);
  return json({ total: s.total, byInviter: s.byInviter });
});


// ---------------- Support / ticketing ----------------

function supportLogin(id: Identity): string {
  return id.admin ? 'admin' : id.user!.login;
}

async function supportTicketResponse(c: any, ticket: SupportTicketRow): Promise<Response> {
  const messages = await listSupportMessages(c.env.DB, ticket.id);
  return json({ ticket, messages });
}

app.get('/api/support/open-count', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (!supportStaff({ role: await roleOf(c, id) })) return json({ error: 'forbidden' }, 403);
  return json({
    open: await countOpenTickets(c.env.DB),
  });
});

app.get('/api/support/tickets', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const staff = supportStaff({ role: await roleOf(c, id) });
  const result = await listSupportTickets(c.env.DB, {
    authorUserId: staff ? undefined : actorId(id),
    status: c.req.query('status'),
    kind: c.req.query('kind'),
    q: c.req.query('q'),
    // Явный фильтр по номеру (#N) — поиск «123» или «#123» через q тоже работает.
    number: c.req.query('number') || undefined,
    assignee: c.req.query('assignee'),
    assigneeUserId: actorId(id),
    limit: Number(c.req.query('limit') || 50),
    offset: Number(c.req.query('offset') || 0),
  });
  return json(result);
});

app.post('/api/support/tickets', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const actor = actorId(id);
  const spamKey = `sup:${actor}`;
  if (await tooManyAttempts(c.env, spamKey)) return json({ error: 'слишком много обращений. Подождите' }, 429);
  const body = await c.req.json<any>().catch(() => null);
  const input = normalizeTicketInput(body ?? {});
  if ('error' in input) {
    const errors = {
      'invalid kind': 'выберите тип обращения',
      'subject length': 'Тема: от 3 до 140 символов',
      'body length': 'Сообщение: от 1 до 4000 символов',
    };
    return json({ error: errors[input.error] }, 400);
  }
  const now = Date.now();
  const ticket: SupportTicketRow = {
    id: supportId('t'), author_user_id: actor, author_login: supportLogin(id),
    bot_id: body?.botId ? String(body.botId) : null, kind: input.kind, subject: input.subject, status: 'new', assignee_user_id: null,
    created_at: now, updated_at: now, last_message_at: now,
  };
  const message: SupportMessageRow = {
    id: supportId('m'), ticket_id: ticket.id, author_role: 'user', author_user_id: actor,
    author_login: supportLogin(id), body: input.body, created_at: now,
  };
  await createSupportTicket(c.env.DB, ticket, message);
  await bumpFail(c.env, spamKey);
  // Номер выдаёт сам INSERT (подзапрос MAX+1) — перечитываем строку, чтобы
  // клиент сразу увидел #N. Перечитка не удалась (не должно случиться) —
  // отдаём исходную строку без номера: UI отрендерит fallback на id.
  const fresh = await getSupportTicket(c.env.DB, ticket.id).catch(() => null);
  return supportTicketResponse(c, fresh ?? ticket);
});

app.get('/api/support/tickets/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const ticket = await getSupportTicket(c.env.DB, c.req.param('id'));
  if (!ticket) return json({ error: 'обращение не найдено' }, 404);
  const staff = supportStaff({ role: await roleOf(c, id) });
  if (!canAccessSupportTicket(ticket, id, staff)) return json({ error: 'forbidden' }, 403);
  return supportTicketResponse(c, ticket);
});

function canAccessSupportTicket(ticket: SupportTicketRow, id: Identity, staff: boolean): boolean {
  return canAccessTicket({ staff, actorId: actorId(id), authorId: ticket.author_user_id });
}

async function supportMutation(c: any, action: 'message' | 'assign' | 'close' | 'reopen'): Promise<Response> {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const ticket = await getSupportTicket(c.env.DB, c.req.param('id'));
  if (!ticket) return json({ error: 'обращение не найдено' }, 404);
  const staff = supportStaff({ role: await roleOf(c, id) });
  if (!canAccessSupportTicket(ticket, id, staff)) return json({ error: 'forbidden' }, 403);
  if (action !== 'message' && !staff) return json({ error: 'forbidden' }, 403);
  if (action === 'message' && !staff && ticket.status !== 'new' && ticket.status !== 'in_progress' && ticket.status !== 'closed') {
    return json({ error: 'forbidden' }, 403);
  }
  if (action === 'assign') {
    if (ticket.assignee_user_id && ticket.assignee_user_id !== actorId(id)) return json({ error: 'обращение уже взято другим сотрудником' }, 409);
    if (!await assignTicket(c.env.DB, ticket.id, actorId(id))) return json({ error: 'не удалось взять обращение' }, 409);
  } else if (action === 'close' || action === 'reopen') {
    await setTicketStatus(c.env.DB, ticket.id, action === 'close' ? 'closed' : (ticket.assignee_user_id ? 'in_progress' : 'new'));
  } else {
    const body = await c.req.json().catch(() => null) as { body?: unknown } | null;
    const text = String(body?.body ?? '').trim();
    if (text.length < 1 || text.length > 4000) return json({ error: 'Сообщение: от 1 до 4000 символов' }, 400);
    const role = staff ? 'staff' : 'user';
    const status = nextTicketStatus(ticket.status as 'new' | 'in_progress' | 'closed', role, !!ticket.assignee_user_id);
    await addSupportMessage(c.env.DB, {
      id: supportId('m'), ticket_id: ticket.id, author_role: role,
      author_user_id: actorId(id), author_login: supportLogin(id), body: text, created_at: Date.now(),
    }, status);
  }
  const fresh = await getSupportTicket(c.env.DB, ticket.id);
  return fresh ? supportTicketResponse(c, fresh) : json({ error: 'обращение не найдено' }, 404);
}

app.post('/api/support/tickets/:id/messages', (c) => supportMutation(c, 'message'));
app.post('/api/support/tickets/:id/assign', (c) => supportMutation(c, 'assign'));
app.post('/api/support/tickets/:id/close', (c) => supportMutation(c, 'close'));
app.post('/api/support/tickets/:id/reopen', (c) => supportMutation(c, 'reopen'));


app.get('/api/health', (c) => json({ ok: true, env: c.env.ENVIRONMENT ?? 'dev' }));

// ---------------- проверка админ-ключа (вход на вкладке «Админ») ----------------
// Единственный вопрос, на который отвечает роут: валиден ли присланный ключ.
// Доступен без авторизации (это и есть проверка), но со своим антибрутом
// admin:<ip> — те же RL_WINDOW_SEC/RL_MAX/slowDown, что у /api/auth/login.
// Тело 401 одинаково для отсутствующего и неверного ключа — роут не выдаёт,
// был ли заголовок вообще. Сам ключ не логируется и не возвращается.
app.get('/api/admin/session', async (c) => {
  const ip = clientIp(c);
  const ipKey = `admin:${ip}`;
  if (await tooManyAttempts(c.env, ipKey)) {
    return json({ error: 'слишком много неудачных попыток. Подождите 10 минут', code: 'rate_limited' }, 429);
  }
  if (isAdminRequest(c)) {
    await resetFail(c.env, ipKey);
    return json({ ok: true, adminKey: true });
  }
  await bumpFail(c.env, ipKey);
  await slowDown(c.env, ipKey);
  return json({ error: 'Неверный админ-ключ', code: 'admin_key_invalid' }, 401);
});

app.get('/api/bots', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  // Дашборд всегда показывает только боты СВОЕГО аккаунта — чужие боты в
  // каталоге не нужны никому, а поиск по пользователям живёт на странице
  // «Пользователи» (/api/admin/users/:login). Сессия чисто с ADMIN_KEY (без
  // аккаунта) тоже получает СВОЙ каталог: боты, созданные под платформенным
  // ключом (owner_id = 'admin'). До этого ветка отдавала пустой список, и
  // созданный под ключом бот не появлялся в каталоге никогда — он писался с
  // owner_id = 'admin', которого не было ни у одного аккаунта, поэтому его не
  // находила и страница «Пользователи». Флаг adminKey оставлен: по нему UI
  // знает, что это платформенная сессия, и не обещает чужих ботов.
  // Пагинация опциональна (?limit=&offset=): без параметров — весь список,
  // как раньше. limit зажат сверху (LIST_BOTS_MAX_LIMIT), чтобы параметром
  // нельзя было вытащить базу целиком одним запросом; total уходит рядом,
  // чтобы UI не делал отдельный COUNT.
  const page = parseBotsPage(c.req.query('limit'), c.req.query('offset'));
  if (id.admin && !id.user) {
    const r = await listBots(c.env.DB, ADMIN_OWNER_ID, page);
    return json({ bots: r.bots, total: r.total, adminKey: true });
  }
  const r = await listBots(c.env.DB, id.user!.id, page);
  return json({ bots: r.bots, total: r.total });
});

// limit/offset строки запроса -> { limit, offset } | undefined. Некорректные
// значения игнорируются (пагинации нет), валидные — зажимаются в границы.
function parseBotsPage(limitRaw: string | undefined, offsetRaw: string | undefined): { limit: number; offset: number } | undefined {
  if (limitRaw === undefined && offsetRaw === undefined) return undefined;
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (!Number.isInteger(limit) || limit <= 0) return undefined;
  return {
    limit: Math.min(limit, LIST_BOTS_MAX_LIMIT),
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}
const LIST_BOTS_MAX_LIMIT = 200;

// ---------------- страница «Пользователи» (staff-only, read-only) ----------------
//
// Доступ: admin/moderator/ADMIN_KEY (canAccessAnyBot). Обычный user — 403.
// Скоуп строго ограничен: профиль аккаунта, список его ботов со статусами
// версий и логи (побочно + агрегированные). Тикеты, платежи, коллекции и
// сессии сюда НЕ входят. Запись чужих ботов сотрудникам недоступна —
// loadOwnedBot/loadOwnedBotById намеренно не расширены.

// Нормализация логина как при входе: trim + lowercase (accounts.login хранится
// в нижнем регистре). Hono уже декодировал параметр маршрута, поэтому
// повторный decodeURIComponent не делаем — он бы бросал URIError на «%».
function normalizeLoginParam(raw: string): string {
  return String(raw ?? '').trim().toLowerCase().slice(0, 64);
}

// Общий гейт staff-роутов: 401 анониму, 403 обычному пользователю.
async function requireStaff(c: any): Promise<Identity | Response> {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (!(await canAccessAnyBot(c, id))) return json({ error: 'forbidden' }, 403);
  return id;
}

app.get('/api/admin/users/:login', async (c) => {
  const id = await requireStaff(c);
  if (isResponse(id)) return id;
  const login = normalizeLoginParam(c.req.param('login'));
  const acc = await getAccountByLogin(c.env.DB, login);
  // Журнал обращений сотрудника: только логин, без содержимого данных.
  await logEvent(c.env.DB, 'admin', null, `admin.user.view.${login}`).catch(() => {});
  if (!acc) return json({ error: 'аккаунт не найден' }, 404);
  const [role, bots, logEvents] = await Promise.all([
    getAccountRole(c.env.DB, acc.id),
    listOwnerBotsForAdmin(c.env.DB, acc.id),
    countLogsByOwner(c.env.DB, acc.id),
  ]);
  return json({
    user: { id: acc.id, login: acc.login, role, created_at: acc.created_at },
    bots,
    totals: { bots: bots.length, logEvents },
  });
});

app.get('/api/admin/users/:login/logs', async (c) => {
  const id = await requireStaff(c);
  if (isResponse(id)) return id;
  const login = normalizeLoginParam(c.req.param('login'));
  await logEvent(c.env.DB, 'admin', null, `admin.user.logs.${login}`).catch(() => {});
  const acc = await getAccountByLogin(c.env.DB, login);
  if (!acc) return json({ error: 'аккаунт не найден' }, 404);
  const rawUser = c.req.query('userId');
  const userId = rawUser ? Number(rawUser) : null;
  const logs = await listLogsByOwner(c.env.DB, acc.id, {
    // limit зажат внутри listLogsByOwner (≤500), как в listLogs.
    limit: Number(c.req.query('limit') ?? 100),
    botId: c.req.query('botId') || undefined,
    userId: Number.isFinite(userId as number) ? (userId as number) : null,
  });
  return json({ logs });
});

app.post('/api/bots', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const body = await c.req.json<{ owner_id?: string; name: string; token: string; platform?: string }>().catch(() => null);
  if (!body?.name || !body?.token) return json({ error: 'name and token required' }, 400);
  if (!id.admin && !id.user) return json({ error: 'unauthorized' }, 401);
  // Платформа: по умолчанию Telegram (все существующие клиенты не передают
  // поле). Мусорные значения отклоняем явно — бот неизвестной платформы был бы
  // мёртвой строкой в БД.
  const platform = body.platform ?? 'telegram';
  if (platform !== 'telegram' && platform !== 'vk') {
    return json({ error: 'platform must be telegram or vk' }, 400);
  }
  // Владелец: у обычной сессии — свой аккаунт, у платформенной (ADMIN_KEY) —
  // ADMIN_OWNER_ID. Это ровно тот же ключ, которым её каталог читается в
  // GET /api/bots, иначе созданный бот не появился бы в списке (была ровно
  // такая ошибка). Явный body.owner_id не уважаем: владельца выбирает сессия,
  // а не тело запроса — иначе им можно было бы записать бота на чужой аккаунт.
  const owner_id = id.user ? id.user.id : ADMIN_OWNER_ID;

  const botId = crypto.randomUUID();
  const webhook_secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const token_enc = await encryptToken(body.token, c.env.ENCRYPTION_KEY);

  // VK: токен проверяется ЖИВЫМ запросом groups.getById — как getMe у Telegram
  // при публикации. Битый/чужой ключ сообщества здесь честнее отклонить сразу,
  // чем создавать бота, который не сможет ни единого сообщения отправить.
  // Ответ несёт id группы (нужен Callback API) и screen_name (vk.me-ссылки).
  let vkGroupId: number | null = null;
  let vkScreenName: string | null = null;
  let vkConfirmation: string | null = null;
  if (platform === 'vk') {
    try {
      // group_id:'me' API 5.199 не принимает (ошибка 100 «group_id not
      // domain», пробы 29.10). Ключ сообщества видит ровно одну группу —
      // getById без параметров возвращает её.
      const resp = (await vkCall('groups.getById', { fields: 'screen_name' }, body.token)) as {
        groups?: { id?: number; screen_name?: string }[];
      };
      const group = resp.groups?.[0];
      if (!group?.id) return json({ error: 'vk token invalid: group not found' }, 400);
      vkGroupId = Number(group.id);
      vkScreenName = group.screen_name ? String(group.screen_name) : null;
      // Строка подтверждения Callback API: VK шлёт confirmation-событие при
      // регистрации сервера и затем на каждый неизвестный запрос мы обязаны
      // ответить ею. Генерируем свою (VK принимает произвольную строку).
      vkConfirmation = crypto.randomUUID().replace(/-/g, '');
    } catch (e) {
      return json({ error: `vk token invalid: ${(e as Error).message.slice(0, 120)}` }, 400);
    }
  }

  // Keep bot metadata and its initial draft in one D1 batch so a successful
  // creation can never leave the editor without readable state.
  const starter = {
    version: 1,
    start: 'start',
    blocks: {
      start: { id: 'start', type: 'start', params: { command: '/start' }, next: '' },
    },
  } as Scenario;
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        'INSERT INTO bots (id, owner_id, name, token_enc, webhook_secret, active, created_at, platform, vk_group_id, vk_confirmation, vk_screen_name) VALUES (?,?,?,?,?,?,0,?,?,?,?)'
      )
      .bind(botId, owner_id, body.name, token_enc, webhook_secret, Date.now(), platform, vkGroupId, vkConfirmation, vkScreenName),
    c.env.DB
      .prepare('INSERT INTO scenarios (id, bot_id, name, flow_json, version, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(`${botId}:1`, botId, body.name, JSON.stringify(starter), 1, Date.now()),
  ]);
  // Seed the (bot_id -> webhook_secret) mapping in KV so the webhook entry can
  // verify auth before any D1 lookup (avoids leaking bot existence).
  await c.env.KV.put(botId, webhook_secret).catch(() => {});
  await logEvent(c.env.DB, botId, null, `bot.created.${platform}`);
  return json({ id: botId, webhook_secret, platform, ...(vkGroupId ? { vk_group_id: vkGroupId } : {}) });
});

app.get('/api/bots/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const bot = await loadOwnedBot(c, id);
  if (isResponse(bot)) return bot;
  return json({ id: bot.id, name: bot.name, active: bot.active, created_at: bot.created_at });
});

// Ограничение размера сценария. История версий хранит полную копию JSON на
// каждое сохранение — без лимита одна поломка на клиенте забивает базу.
const MAX_FLOW_BYTES = 1024 * 1024; // 1 МБ

app.put('/api/bots/:id/scenario', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const body = await c.req.json<{ name?: string; flow_json: string; version?: number }>().catch(() => null);
  if (!body?.flow_json) return json({ error: 'flow_json required' }, 400);
  if (body.flow_json.length > MAX_FLOW_BYTES) {
    return json({ error: `сценарий больше ${Math.round(MAX_FLOW_BYTES / 1024)} КБ — сохранить нельзя` }, 413);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(body.flow_json);
  } catch {
    return json({ error: 'flow_json is not valid JSON' }, 400);
  }
  if (!validateScenarioShape(parsed)) return json({ error: 'scenario must have start + blocks' }, 400);

  // Подсценарии: ссылка на чужой/удалённый фрагмент отклоняется ЯВНО.
  // Молча вырезать нельзя — автор потерял бы работу, не поняв почему.
  if (scenarioHasSubflows(parsed as Scenario)) {
    const library = await loadSubflowLibrary(c.env.DB, owned.owner_id, parsed as Scenario);
    const foreign = findForeignSubflowRefs(parsed as Scenario, library);
    if (foreign.length) {
      return json(
        { error: `сценарий ссылается на недоступные подсценарии: ${foreign.slice(0, 5).join(', ')}. Бот может вызывать только фрагменты из вашей библиотеки.` },
        400
      );
    }
  }

  const prev = await loadScenario(c.env.DB, owned.id);
  // F-015 (WU-03): оптимистичная блокировка версии. Фронт шлёт body.version —
  // версию, которую читал автор. Если она устарела (другая вкладка успела
  // сохранить) — 409 с актуальной версией, last-write-wins больше не затирает
  // чужие правки молча. Без version в теле — прежнее поведение (обратная
  // совместимость: API-клиенты, автосохранение старых сборок).
  const bodyVersion = Number(body.version);
  if (Number.isFinite(bodyVersion) && bodyVersion > 0 && prev && bodyVersion !== prev.version) {
    return json(
      {
        error: `Сценарий изменился в другом месте: вы редактируете версию ${bodyVersion}, а сохранена версия ${prev.version}. Обновите страницу, чтобы не потерять чужие правки.`,
        code: 'version-conflict',
        current: prev.version,
      },
      409
    );
  }
  // Новая версия — только если изменилось СОДЕРЖИМОЕ. Перетаскивание блока
  // меняет лишь координаты: перезаписываем ту же версию, иначе история версий
  // превращается в тысячу копий одного и того же сценария.
  const sameContent =
    !!prev && prev.flow_json.length <= MAX_FLOW_BYTES && jsonContentHash(prev.flow_json) === jsonContentHash(body.flow_json);

  let version: number;
  if (sameContent) {
    version = prev!.version;
    await updateScenarioJson(c.env.DB, owned.id, version, body.name || 'scenario', body.flow_json);
  } else {
    version = (prev?.version ?? 0) + 1;
    await saveScenario(c.env.DB, owned.id, body.name || 'scenario', body.flow_json, version);
  }
  await afterScenarioSave(c, owned.id, body.flow_json);
  // Сохранённая версия стала истиной — черновик больше не нужен. Иначе при
  // следующем открытии автор снова увидел бы «есть незавершённые правки».
  await deleteScenarioDraft(c.env.DB, owned.id).catch(() => {});
  await logEvent(c.env.DB, owned.id, null, `scenario.saved.v${version}`);
  return json({ ok: true, version, newVersion: !sameContent });
});

// После сохранения сценария: сбрасываем KV-кэш (иначе бот продолжит работать
// по старой версии) и пересчитываем флаг «в сценарии есть рефералка».
async function afterScenarioSave(c: any, botId: string, flowJson: string): Promise<void> {
  let hasReferral = false;
  try {
    hasReferral = scenarioHasReferral(JSON.parse(flowJson) as Scenario);
  } catch {
    hasReferral = false; // невалидный JSON уже отсеян выше
  }
  await Promise.all([
    invalidateScenarioCache(c.env.KV, botId),
    setBotReferralFlag(c.env.DB, botId, hasReferral).catch(() => {}),
  ]);
}

app.get('/api/bots/:id/scenario', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const sc = await loadScenario(c.env.DB, owned.id);
  if (!sc) return json({ error: 'no scenario' }, 404);
  return json({ flow_json: sc.flow_json, version: sc.version });
});

// ---------------- Черновик сценария на сервере (F9) ----------------
// Черновик — те же несохранённые правки, что раньше лежали в localStorage
// браузера. Теперь он на аккаунте: работа, начатая на одном устройстве,
// продолжается на другом. Прав на черновик ровно столько же, сколько на бота.

app.get('/api/bots/:id/draft', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const draft = await getScenarioDraft(c.env.DB, owned.id);
  if (!draft) return json({ draft: null });
  return json({ draft: { flow_json: draft.flow_json, updated_at: draft.updated_at } });
});

app.put('/api/bots/:id/draft', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const body = await c.req.json<{ flow_json?: string }>().catch(() => null);
  const flowJson = typeof body?.flow_json === 'string' ? body.flow_json : '';
  if (!flowJson) return json({ error: 'flow_json required' }, 400);
  if (flowJson.length > MAX_FLOW_BYTES) {
    return json({ error: `черновик больше ${Math.round(MAX_FLOW_BYTES / 1024)} КБ — сохранить нельзя` }, 413);
  }
  try {
    const parsed = JSON.parse(flowJson);
    if (!validateScenarioShape(parsed)) return json({ error: 'scenario must have start + blocks' }, 400);
  } catch {
    return json({ error: 'flow_json is not valid JSON' }, 400);
  }
  await putScenarioDraft(c.env.DB, owned.id, flowJson);
  return json({ ok: true });
});

app.delete('/api/bots/:id/draft', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  await deleteScenarioDraft(c.env.DB, owned.id);
  return json({ ok: true });
});

app.get('/api/bots/:id/stats', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const s = await stats(c.env.DB, owned.id);
  return json({ ...s });
});

// Удаление бота: снимаем webhook в Telegram, стираем запись и всё, что к ней
// привязано (сценарии, сессии, подписчики, отложенные отправки, рефералы),
// плюс чистим KV. Токен бота из базы удаляется вместе со строкой.
app.delete('/api/bots/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;

  const steps: Step[] = [];
  // Webhook снимаем ДО удаления строки: иначе бот останется привязанным к
  // несуществующему эндпоинту и будет копить ошибки в Telegram.
  // F3-105/F3-111: у VK-бота удаляется Callback-сервер (deleteCallbackServer
  // по server_id из 0031; setCallbackServer VK удалил — 30.10); KV-ключ
  // vk:<id> вычищается вместе с остальными.
  if (owned.platform === 'vk') {
    try {
      const token = await decryptToken(owned.token_enc, c.env.ENCRYPTION_KEY);
      const serverId = Number(owned.vk_callback_server_id) || 0;
      if (serverId) {
        await vkCall('groups.deleteCallbackServer', { group_id: owned.vk_group_id, server_id: serverId, api_version: '5.199' }, token);
      }
      steps.push({ key: 'webhook', label: 'Callback-сервер VK удалён', status: 'ok', detail: 'бот отвязан' });
    } catch (e: any) {
      steps.push({ key: 'webhook', label: 'Callback-сервер VK удалён', status: 'fail', detail: String(e?.message ?? 'VK не удалил сервер').slice(0, 120) });
    }
  } else {
    try {
      const token = await decryptToken(owned.token_enc, c.env.ENCRYPTION_KEY);
      const res = await tgCall(token, 'deleteWebhook', { drop_pending_updates: false });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      steps.push({
        key: 'webhook',
        label: 'Webhook снят',
        status: data.ok ? 'ok' : 'fail',
        detail: data.ok ? 'бот отвязан' : data.description || 'Telegram не подтвердил снятие',
      });
    } catch (e: any) {
      steps.push({ key: 'webhook', label: 'Webhook снят', status: 'fail', detail: String(e?.message ?? 'токен не расшифрован') });
    }
  }

  try {
    await deleteBotCascade(c.env.DB, owned.id);
    steps.push({ key: 'db', label: 'Данные удалены', status: 'ok', detail: 'бот и связанные данные удалены' });
  } catch (e: any) {
    steps.push({ key: 'db', label: 'Данные удалены', status: 'fail', detail: String(e?.message ?? 'ошибка базы данных') });
    return json({ ok: false, steps }, 500);
  }
  await Promise.all([
    c.env.KV.delete(owned.id).catch(() => {}), // webhook secret
    invalidateScenarioCache(c.env.KV, owned.id).catch(() => {}),
    c.env.KV.delete(`wh:${owned.id}`).catch(() => {}),
    // F3-111: секрет VK-вебхука тоже живёт в KV (vk:<id>) — без удаления
    // ключ остаётся мусором, а найденный по id бот-призрак пустым секретом.
    c.env.KV.delete(`vk:${owned.id}`).catch(() => {}),
  ]);
  return json({ ok: true, steps });
});

// ---------------- Публикация: проверка → webhook → команды → активен ----------------

interface Step {
  key: string;
  label: string;
  status: 'ok' | 'fail' | 'skipped';
  detail?: string;
}

function parseScenarioBody(raw: string | undefined): { scenario: Scenario } | { error: string } {
  if (!raw) return { error: 'flow_json required' };
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'flow_json is not valid JSON' };
  }
  if (!validateScenarioShape(parsed)) return { error: 'scenario must have start + blocks' };
  return { scenario: parsed as Scenario };
}

// ---------------- медиа мини-аппов (Filebase / S3) ----------------

// Загрузка картинки автором бота. multipart/form-data, поле file.
// Ответ: { key, url } — url готов для <img> в рантайме мини-аппа.
app.post('/api/bots/:id/media', async (c) => {
  if (!mediaEnabled(c.env)) return json({ error: 'media storage not configured' }, 503);
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'file required' }, 400);
  const ext = mediaExt(file.type);
  if (!ext) return json({ error: 'unsupported type, images only' }, 400);
  if (file.size > MAX_MEDIA_BYTES) return json({ error: 'file too large, max 5 MB' }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = mediaKey(owned.id, ext);
  const usage = await getMiniAppUsage(c.env.DB, owned.id);
  if (!checkMediaQuota(usage?.media_bytes ?? 0, bytes.length)) {
    return json({ error: `media quota exceeded (limit ${MINI_LIMITS.mediaBytesPerBot} bytes per bot)` }, 413);
  }
  try {
    await ensureMediaBucket(c.env);
    await mediaPut(c.env, key, bytes, file.type);
    await addMiniAppMediaBytes(c.env.DB, owned.id, bytes.length);
  } catch (e: any) {
    return json({ error: 'media upload failed', detail: String(e?.name || e?.message || e) }, 502);
  }
  return json({ key, url: `/m/img/${key}`, size: file.size, type: file.type });
});

// Удаление загруженной картинки (владелец бота). Используется конструктором
// и тестами; объект в Filebase исчезает сразу, CDN-кэш протухнет сам.
app.delete('/api/bots/:id/media/:key', async (c) => {
  if (!mediaEnabled(c.env)) return json({ error: 'media storage not configured' }, 503);
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const key = c.req.param('key');
  if (!/^[a-zA-Z0-9_-]+\/[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif)$/.test(key)) return json({ error: 'bad key' }, 400);
  if (!key.startsWith(owned.id + '/')) return json({ error: 'forbidden' }, 403);
  try {
    await mediaDelete(c.env, key);
    return json({ ok: true });
  } catch (e: any) {
    return json({ error: 'media delete failed', detail: String(e?.name || e?.message || e) }, 502);
  }
});

// Раздача медиа. Публичный GET с долгим кэшем: ключ содержит uuid, угадать
// чужой невозможно; доступ мини-аппа к странице всё равно проверяет access_rule.
app.get('/m/img/:botId/:file', async (c) => {
  if (!mediaEnabled(c.env)) return json({ error: 'media storage not configured' }, 503);
  const botId = c.req.param('botId');
  const file = c.req.param('file');
  if (!/^[a-zA-Z0-9_-]+$/.test(botId) || !/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif)$/.test(file)) {
    return json({ error: 'bad key' }, 400);
  }
  try {
    const obj = await mediaGet(c.env, `${botId}/${file}`);
    if (!obj) return json({ error: 'not found' }, 404);
    return new Response(obj.body, {
      headers: {
        'content-type': obj.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'content-length': String(obj.size),
      },
    });
  } catch (e: any) {
    const code = e?.name || e?.Code || '';
    if (code === 'NoSuchKey' || code === 'NotFound' || e?.$metadata?.httpStatusCode === 404) {
      return json({ error: 'not found' }, 404);
    }
    return json({ error: 'media fetch failed', detail: `${code}: ${e?.message || e}` }, 502);
  }
});

// ---------------- мини-аппы: конструктор (CRUD, публикация) ----------------

// slug мини-аппа: часть ссылки t.me/<bot_username>/<slug>. Нижний регистр,
// 3–32 символа, старт с буквы/цифры — иначе Telegram ссылку не съест.
const MINI_SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

function parseAccessRule(raw: unknown): MiniAccessRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as any;
  if (r.kind === 'all') return { kind: 'all' };
  if (r.kind === 'tag' && typeof r.tag === 'string' && r.tag.trim()) return { kind: 'tag', tag: r.tag.trim() };
  if (r.kind === 'users' && Array.isArray(r.ids) && r.ids.length && r.ids.every((n: any) => Number.isInteger(n) && n > 0)) {
    return { kind: 'users', ids: r.ids };
  }
  return null;
}

// Мини-апп принадлежит владельцу бота; платформа (ADMIN_KEY) проходит как
// владелец любого бота — ровно та же семантика, что у loadOwnedBot.
async function loadOwnedMiniApp(c: any, id: Identity): Promise<MiniAppRow | Response> {
  const row = await getMiniApp(c.env.DB, c.req.param('id'));
  if (!row) return json({ error: 'not found' }, 404);
  if (id.admin) return row;
  if (id.user && row.owner_id === id.user.id) return row;
  return json({ error: 'forbidden' }, 403);
}

// F3-200: фича мини-аппов выключена, пока не задан MINI_APPS_ENABLED.
// Админ-сессия (ADMIN_KEY) проходит всегда — доработка и просмотр живых
// аппов не блокируются.
function miniAppsFeatureOn(c: any): boolean {
  if (isAdminRequest(c)) return true;
  return c.env.MINI_APPS_ENABLED === '1' || c.env.MINI_APPS_ENABLED === 'true';
}

app.post('/api/bots/:id/miniapps', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (!miniAppsFeatureOn(c)) return json({ error: 'feature disabled' }, 403);
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const body = (await c.req.json().catch(() => null)) as any;
  const name = String(body?.name || '').trim();
  const slug = String(body?.slug || '').trim().toLowerCase();
  if (!name) return json({ error: 'name required' }, 400);
  if (!MINI_SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400);
  const rule = parseAccessRule(body?.access_rule ?? { kind: 'all' });
  if (!rule) return json({ error: 'bad access_rule' }, 400);
  if (await getMiniAppBySlug(c.env.DB, owned.id, slug)) return json({ error: 'slug taken' }, 409);

  const startId = 'p1';
  const tplId = String(body?.template || 'clean') as MiniTemplateId;
  if (!['catalog', 'admin', 'clean'].includes(tplId)) return json({ error: 'bad template' }, 400);
  const draft = tplId === 'clean' ? (() => {
    const d = emptyMiniApp(startId);
    d.pages = [{ id: startId, name: 'Главная', bg: '#ffffff', els: [] }];
    return d;
  })() : applyMiniTemplate(tplId);
  const rowId = crypto.randomUUID();
  await createMiniApp(c.env.DB, {
    id: rowId,
    botId: owned.id,
    ownerId: owned.owner_id,
    name,
    slug,
    accessRuleJson: JSON.stringify(rule),
    draftJson: JSON.stringify(draft),
  });
  return json({ id: rowId, slug, draft }, 201);
});

app.get('/api/bots/:id/miniapps', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const rows = await listMiniAppsByBot(c.env.DB, owned.id);
  return json({
    miniapps: rows.map((r) => ({
      id: r.id, bot_id: r.bot_id, name: r.name, slug: r.slug,
      bot_username: owned.bot_username ?? null,
      access_rule: JSON.parse(r.access_rule_json),
      published: r.published_json != null,
      updated_at: r.updated_at,
    })),
  });
});

app.get('/api/miniapps', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const ownerId = id.admin ? ADMIN_OWNER_ID : id.user!.id;
  return json({ miniapps: await listMiniAppsByOwner(c.env.DB, ownerId) });
});

app.get('/api/miniapps/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await loadOwnedMiniApp(c, id);
  if (isResponse(row)) return row;
  return json({
    id: row.id, bot_id: row.bot_id, name: row.name, slug: row.slug,
    access_rule: JSON.parse(row.access_rule_json),
    draft: JSON.parse(row.draft_json),
    published: row.published_json != null ? JSON.parse(row.published_json) : null,
    updated_at: row.updated_at,
  });
});

// F-037/S3-04 (1b): пользовательский контент схемы санитизируется и на записи
// черновика — редактор рендерит draft через dangerouslySetInnerHTML, и без
// этого автор получал self-XSS (а админ — stored XSS при просмотре чужого аппа).
function sanitizeMiniAppSchema(appJson: any): any {
  if (!appJson || typeof appJson !== 'object') return appJson;
  for (const p of appJson.pages ?? []) {
    if (typeof p?.css === 'string') p.css = sanitizeCss(p.css);
    for (const e of p?.els ?? []) {
      if (e?.style && typeof e.style.css === 'string') e.style.css = sanitizeCss(e.style.css);
      if (e?.type === 'richtext' && e.props && typeof e.props.html === 'string') {
        e.props.html = sanitizeRichText(e.props.html);
      }
    }
  }
  return appJson;
}

app.put('/api/miniapps/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await loadOwnedMiniApp(c, id);
  if (isResponse(row)) return row;
  const body = (await c.req.json().catch(() => null)) as any;
  if (body?.draft !== undefined && !validateMiniAppShape(body.draft)) {
    return json({ error: 'draft must be a valid mini app schema' }, 400);
  }
  // F-043: байтовый лимит схемы — как у сценариев (MAX_FLOW_BYTES). История
  // ревизий хранит полную копию JSON, без лимита один сломанный клиент
  // раздувает базу.
  if (body?.draft !== undefined && JSON.stringify(body.draft).length > MAX_FLOW_BYTES) {
    return json({ error: `схема мини-аппа больше ${Math.round(MAX_FLOW_BYTES / 1024)} КБ — сохранить нельзя` }, 413);
  }
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
  const draft = body?.draft !== undefined ? sanitizeMiniAppSchema(body.draft) : undefined;
  await updateMiniAppDraft(c.env.DB, row.id, JSON.stringify(draft), name);
  return json({ ok: true });
});

// Публикация: тело может нести app (схема из редактора) — тогда публикуем её,
// иначе текущий черновик. Опционально menu_button: ставит кнопку меню бота
// на мини-апп через setChatMenuButton; ошибка Telegram публику не отменяет,
// уходит предупреждением в ответ.
app.post('/api/miniapps/:id/publish', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (!miniAppsFeatureOn(c)) return json({ error: 'feature disabled' }, 403);
  const row = await loadOwnedMiniApp(c, id);
  if (isResponse(row)) return row;
  const body = (await c.req.json().catch(() => null)) as any;
  const appJson = body?.app !== undefined ? body.app : JSON.parse(row.draft_json);
  if (!validateMiniAppShape(appJson)) return json({ error: 'app must be a valid mini app schema' }, 400);
  // Серверный гейт фазы D: пользовательский контент санитизируется ДО записи.
  // Рантайм доверяет схеме, поэтому единственный рубеж — публикация.
  for (const p of appJson.pages ?? []) {
    if (typeof p.css === 'string') p.css = sanitizeCss(p.css);
    for (const e of p.els ?? []) {
      if (e?.style && typeof e.style.css === 'string') e.style.css = sanitizeCss(e.style.css);
      if (e?.type === 'richtext' && e.props && typeof e.props.html === 'string') {
        e.props.html = sanitizeRichText(e.props.html);
      }
    }
  }
  const limitHit = checkPublishLimits(appJson);
  if (limitHit) return json({ error: limitHit }, 400);
  const payload = JSON.stringify(appJson);
  // F-043: байтовый лимит публикации — каждая ревизия хранит полную копию.
  if (payload.length > MAX_FLOW_BYTES) {
    return json({ error: `схема мини-аппа больше ${Math.round(MAX_FLOW_BYTES / 1024)} КБ — публиковать нельзя` }, 413);
  }
  const revision = await publishMiniApp(c.env.DB, row.id, payload);

  let menuWarning: string | null = null;
  if (body?.menu_button === true) {
    try {
      const bot = await getBot(c.env.DB, row.bot_id);
      const token = bot ? await decryptToken(bot.token_enc, c.env.ENCRYPTION_KEY) : null;
      if (!token) menuWarning = 'bot token unavailable';
      else {
        const me = await tgCall(token, 'getMe', {}).then((r) => r.json()) as any;
        const username = me?.ok ? me.result?.username : null;
        if (!username) menuWarning = 'bot has no username';
        else {
          const set = await tgCall(token, 'setChatMenuButton', {
            menu_button: { type: 'web_app', url: `https://t.me/${username}/${row.slug}` },
          });
          if (!set.ok) menuWarning = `setChatMenuButton failed: ${set.status}`;
        }
      }
    } catch (e: any) {
      menuWarning = String(e?.message || e);
    }
  }
  const bot = await getBot(c.env.DB, row.bot_id);
  return json({ revision, menu_warning: menuWarning, bot_username: bot?.bot_username ?? null, slug: row.slug });
});

app.get('/api/miniapps/:id/versions', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await loadOwnedMiniApp(c, id);
  if (isResponse(row)) return row;
  return json({ versions: await listMiniAppVersions(c.env.DB, row.id) });
});

// Откат: публикует старый снапшот НОВОЙ ревизией — история не переписывается.
app.post('/api/miniapps/:id/rollback', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (!miniAppsFeatureOn(c)) return json({ error: 'feature disabled' }, 403);
  const row = await loadOwnedMiniApp(c, id);
  if (isResponse(row)) return row;
  const body = (await c.req.json().catch(() => null)) as any;
  const revision = Number(body?.revision);
  if (!Number.isInteger(revision) || revision < 1) return json({ error: 'bad revision' }, 400);
  const snap = await getMiniAppVersion(c.env.DB, row.id, revision);
  if (snap == null) return json({ error: 'revision not found' }, 404);
  // F3-208: снапшот мог быть записан до санитизации — прогоняем через тот же
  // фильтр, что и публикация (rollback публикует его новой ревизией).
  const snapObj = sanitizeMiniAppSchema(JSON.parse(snap));
  const newRev = await publishMiniApp(c.env.DB, row.id, JSON.stringify(snapObj));
  return json({ revision: newRev });
});

app.delete('/api/miniapps/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await loadOwnedMiniApp(c, id);
  if (isResponse(row)) return row;
  await deleteMiniApp(c.env.DB, row.id);
  return json({ ok: true });
});

// ---------------- мини-аппы: рантайм (/m/...) ----------------
//
// Вход в мини-апп — HTML без данных: initData существует только внутри JS
// Telegram WebApp, поэтому схема и контекст приходят вторым запросом
// (POST /m/api/.../boot) с заголовком X-Telegram-Init-Data. Без валидной
// подписи и прошедшего access_rule не отдаётся ни схема, ни строки таблиц.

type MiniRuntime = { botId: string; slug: string; row: MiniAppRow; token: string; ctx: MiniContext; startParam: string };

async function miniRuntime(c: any): Promise<MiniRuntime | Response> {
  const botId = c.req.param('botId');
  const slug = c.req.param('slug');
  const row = await getMiniAppBySlug(c.env.DB, botId, slug);
  if (!row || row.published_json == null) return json({ error: 'not found' }, 404);
  const bot = await getBot(c.env.DB, botId);
  if (!bot) return json({ error: 'not found' }, 404);
  const initData = c.req.header('x-telegram-init-data') || '';
  if (!initData) return json({ error: 'unauthorized' }, 401);
  const token = await decryptToken(bot.token_enc, c.env.ENCRYPTION_KEY);
  const who = await parseAndValidateInitData(initData, token);
  if (!who) return json({ error: 'unauthorized' }, 401);
  const ctx = await buildContext(c.env.DB, botId, who.userId, who.name, who.username);
  const rule = JSON.parse(row.access_rule_json) as MiniAccessRule;
  if (!checkAccess(rule, ctx)) return json({ error: 'forbidden' }, 403);
  // Минутный rate limit на пару (бот, юзер): защита /m/api от перебора выборок.
  if (!(await rateLimitMiniApi(c.env.KV, botId, who.userId, Date.now()))) {
    return json({ error: 'rate limited' }, 429);
  }
  // start_param живёт ВНУТРИ initData (Telegram передаёт его подписанным):
  // query-строка до воркера в Telegram не доживает.
  const sp = new URLSearchParams(initData).get('start_param');
  return { botId, slug, row, token, ctx, startParam: sp || '' };
}

// HTML мини-аппа: одна SPA на все аппы. F-035 (1c): вставляем бут-скрипт с
// { botId, slug } в маркер MINI_BOOT — рантайм по нему зовёт POST .../boot и
// получает схему/ctx. Схема и ctx в HTML НЕ кладутся: initData проверяется
// только сервером boot-запроса (иначе данные отдавались бы без авторизации).
// botId/slug экранируются (в HTML они попадают из пути URL).
app.get('/m/:botId/:slug', async (c) => {
  const botId = c.req.param('botId');
  const slug = c.req.param('slug');
  if (!/^[a-zA-Z0-9_-]+$/.test(botId) || !MINI_SLUG_RE.test(slug)) return json({ error: 'not found' }, 404);
  const row = await getMiniAppBySlug(c.env.DB, botId, slug);
  if (!row || row.published_json == null) return json({ error: 'not found' }, 404);
  const bootJson = JSON.stringify({ botId, slug }).replace(/</g, '\\u003C');
  const html = SPA_HTML.replace(
    '<!--MINI_BOOT-->',
    `<script id="mini-boot" type="application/json">${bootJson}</script>`
  );
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
});

app.post('/m/api/:botId/:slug/boot', async (c) => {
  const rt = await miniRuntime(c);
  if (isResponse(rt)) return rt;
  // F-036 (1a): visible_when применяется НА СЕРВЕРЕ — скрытые элементы не
  // уходят клиенту вовсе (раньше фильтр был только клиентским: любой юзер
  // видел «админские» страницы в схеме и выгружал их таблицы через query).
  const appJson = filterVisibleApp(JSON.parse(rt.row.published_json as string), rt.ctx);
  await logEvent(c.env.DB, rt.botId, rt.ctx.userId, 'mini.open').catch(() => {});
  return json({ app: appJson, ctx: rt.ctx, startParam: rt.startParam });
});

// Whitelist таблиц юзера (F-036, 1a): таблицы из ВИДИМЫХ элементов схемы.
// /m/api query/action сверяют с ним body.table — таблица, не открытая ни на
// одном доступном элементе, не читается и не пишется.
// F3-201: кэш на запрос (rt) — query и action в одном апдейте больше не
// пересчитывают filterVisibleApp + collectAllowedTables повторно.
const miniAllowedTablesCache = new WeakMap<MiniRuntime, Set<string>>();
function miniAllowedTables(rt: MiniRuntime): Set<string> {
  let set = miniAllowedTablesCache.get(rt);
  if (!set) {
    const app = filterVisibleApp(JSON.parse(rt.row.published_json as string), rt.ctx);
    set = collectAllowedTables(app);
    miniAllowedTablesCache.set(rt, set);
  }
  return set;
}

// F-039: есть ли в опубликованной схеме ai_gen-элемент или действие ai —
// только они делают kind:'ai' законным. Проверяем полную схему (не видимую
// часть): генерация — свойство аппа, а не элемента конкретного юзера.
function miniAppHasAiElement(rt: MiniRuntime): boolean {
  let app: any;
  try {
    app = JSON.parse(rt.row.published_json as string);
  } catch {
    return false;
  }
  for (const p of app?.pages ?? []) {
    for (const e of p?.els ?? []) {
      if (!e) continue;
      if (e.type === 'ai_gen') return true;
      if ((e.action as any)?.id === 'ai') return true;
    }
  }
  return false;
}

// Выборки для data-блоков. Строки чужих юзеров уходят только отсюда и только
// прошедшему access_rule клиенту; фильтры/поиск/сортировка — на сервере.
app.post('/m/api/:botId/:slug/query', async (c) => {
  const rt = await miniRuntime(c);
  if (isResponse(rt)) return rt;
  const body = (await c.req.json().catch(() => null)) as any;
  if (body?.kind === 'users') {
    // Профиль самого юзера + его теги: полный список юзеров бота мини-аппу
    // не отдаётся (это данные админки конструктора, не аппа).
    return json({ rows: [{ id: String(rt.ctx.userId), data: { name: rt.ctx.name, username: rt.ctx.username ?? '', tags: rt.ctx.tags.join(', ') } }] });
  }
  if (body?.kind !== 'rows' || typeof body.table !== 'string') return json({ error: 'bad query' }, 400);
  // F-036 (1a): таблица обязана быть открыта видимым элементом схемы — иначе
  // любой юзер выгружает все таблицы бота (заказы, телефоны) прямым запросом.
  if (!miniAllowedTables(rt).has(body.table)) return json({ rows: [], total: 0 });
  const cols = await listCollections(c.env.DB, rt.botId);
  const col = cols.find((x) => x.name === body.table);
  if (!col) return json({ rows: [], total: 0 });
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const { rows, total } = await listCollectionItems(c.env.DB, rt.botId, col.id, {
    q: typeof body.search?.term === 'string' ? body.search.term : '',
    limit,
    offset,
  });
  let out = rows.map((r) => ({ id: r.id, data: JSON.parse(r.data_json || '{}'), created_at: r.created_at }));
  // Фильтры и сортировка поверх страницы: таблицы автора маленькие
  // (лимит 200 строк), серверный WHERE по data_json здесь избыточен.
  const filters = Array.isArray(body.filters) ? body.filters : [];
  for (const f of filters) {
    if (!f || typeof f.column !== 'string') continue;
    // F3-202: SPA шлёт чипы-мультивыбор как op:'in' со склеенным списком
    // (values.join(',')) — строгое равенство оставляло пустой результат при
    // 2+ выбранных чипах. in — список значений через запятую, not_in —
    // исключение; прочие/отсутствующие op — прежнее равенство.
    if (f.op === 'in' || f.op === 'not_in') {
      const set = String(f.value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
      // Пустой список у 'in' — фильтр не выбирает ничего, у 'not_in' — ничего
      // не исключает. Чтобы пустые чипы не вырезали все строки, пустой set
      // пропускаем как «фильтра нет».
      if (set.length) {
        out = out.filter((r) => (f.op === 'in' ? set.includes(String(r.data[f.column] ?? '')) : !set.includes(String(r.data[f.column] ?? ''))));
      }
      continue;
    }
    out = out.filter((r) => String(r.data[f.column] ?? '') === String(f.value ?? ''));
  }
  if (body.sort && typeof body.sort.column === 'string') {
    const dir = body.sort.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const av = a.data[body.sort.column];
      const bv = b.data[body.sort.column];
      const an = Number(av);
      const bn = Number(bv);
      if (isFinite(an) && isFinite(bn) && av !== '' && bv !== '') return (an - bn) * dir;
      return String(av ?? '').localeCompare(String(bv ?? ''), 'ru') * dir;
    });
  }
  return json({ rows: out, total });
});

// Действия мини-аппа: запись/правка/удаление строки, тикет поддержки,
// запуск сценария бота синтетическим сообщением.
app.post('/m/api/:botId/:slug/action', async (c) => {
  const rt = await miniRuntime(c);
  if (isResponse(rt)) return rt;
  const body = (await c.req.json().catch(() => null)) as any;
  const kind = body?.kind;

  if (kind === 'insert' || kind === 'update' || kind === 'delete') {
    if (typeof body.table !== 'string') return json({ error: 'bad table' }, 400);
    // F-036 (1a): запись только в таблицу, открытую видимым элементом схемы.
    if (!miniAllowedTables(rt).has(body.table)) return json({ error: 'forbidden table' }, 403);
    const cols = await listCollections(c.env.DB, rt.botId);
    const col = cols.find((x) => x.name === body.table);
    if (!col) return json({ error: 'unknown table' }, 404);
    // F-040 (задача 22c): тот же sanitizeData, что на владельческом пути
    // коллекций — поля по схеме таблицы, размер значения, без мусорных ключей.
    const fields = parseFieldsJson(col.fields_json);
    if (kind === 'insert') {
      const data = sanitizeData(body.values, fields);
      if (!data) return json({ error: 'bad values' }, 400);
      const id = await collectionAdd(c.env.DB, rt.botId, col.id, rt.ctx.userId, data);
      await logEvent(c.env.DB, rt.botId, rt.ctx.userId, 'mini.data.insert').catch(() => {});
      return json({ ok: true, id });
    }
    if (typeof body.itemId !== 'string' || body.itemId.length > 64) return json({ error: 'bad itemId' }, 400);
    const item = await getCollectionItem(c.env.DB, rt.botId, col.id, body.itemId);
    if (!item) return json({ error: 'not found' }, 404);
    if (kind === 'update') {
      const data = sanitizeData(body.values, fields);
      if (!data) return json({ error: 'bad values' }, 400);
      await collectionUpdate(c.env.DB, rt.botId, col.id, { id: item.id }, data);
      return json({ ok: true });
    }
    await collectionRemove(c.env.DB, rt.botId, col.id, { id: item.id });
    return json({ ok: true });
  }

  if (kind === 'support') {
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
    const now = Date.now();
    const ticketId = crypto.randomUUID();
    await createSupportTicket(
      c.env.DB,
      {
        id: ticketId,
        author_user_id: String(rt.ctx.userId),
        author_login: rt.ctx.username || String(rt.ctx.userId),
        bot_id: rt.botId,
        kind: 'miniapp',
        subject: String(fields.subject || 'Обращение из мини-аппа').slice(0, 200),
        status: 'new',
        assignee_user_id: null,
        created_at: now,
        updated_at: now,
        last_message_at: now,
      },
      {
        id: crypto.randomUUID(),
        ticket_id: ticketId,
        author_role: 'user',
        author_user_id: String(rt.ctx.userId),
        author_login: rt.ctx.username || String(rt.ctx.userId),
        body: String(fields.body || JSON.stringify(fields)).slice(0, 4000),
        created_at: now,
      }
    );
    await logEvent(c.env.DB, rt.botId, rt.ctx.userId, 'mini.support').catch(() => {});
    return json({ ok: true, ticket: ticketId });
  }

  if (kind === 'favorite') {
    // Избранное живёт в переменной юзера 'mini_favs' (строка id через запятую):
    // то же хранилище, что переменные сценариев, — бот видит выбор юзера.
    // F-045: itemId ≤512 символов и не больше 200 избранных на юзера — иначе
    // vars_json сессии раздувается произвольным мусором.
    const itemId = String(body.itemId || '').trim();
    if (!itemId) return json({ error: 'itemId required' }, 400);
    if (itemId.length > 512) return json({ error: 'itemId слишком длинный' }, 400);
    const sessRow = await getSession(c.env.DB, rt.botId, rt.ctx.userId);
    const vars: Record<string, unknown> = sessRow?.vars_json ? JSON.parse(sessRow.vars_json) : {};
    const list = String(vars.mini_favs || '');
    const ids = list.split(',').filter(Boolean);
    const has = ids.includes(itemId);
    if (!has && ids.length >= 200) {
      return json({ error: 'В избранном уже 200 элементов — уберите лишнее' }, 400);
    }
    vars.mini_favs = toggleFavorite(list, itemId);
    await upsertSession(c.env.DB, rt.botId, rt.ctx.userId, sessRow?.current_block ?? null, JSON.stringify(vars));
    await logEvent(c.env.DB, rt.botId, rt.ctx.userId, has ? 'mini.fav.off' : 'mini.fav.on').catch(() => {});
    return json({ ok: true, favorite: !has });
  }

  if (kind === 'ai') {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return json({ error: 'prompt required' }, 400);
    // F-039: лимит длины промпта — иначе юзер шлёт мегабайты текста и жжёт
    // токены генератора сверх бюджета владельца.
    if (prompt.length > 2000) {
      return json({ error: 'Промпт длиннее 2000 символов — сократите его' }, 400);
    }
    // F-039: действие доступно только если в ОПУБЛИКОВАННОЙ схеме есть
    // ai_gen-элемент. Без этой проверки любой юзер с initData мог дёргать
    // генерацию у аппа, где её нет вовсе (расход квоты Filebase/TOOKEN).
    if (!miniAppHasAiElement(rt)) {
      return json({ error: 'В этом приложении нет AI-блока' }, 400);
    }
    try {
      const res = await generateMiniImage(c.env, {
        botId: rt.botId,
        userId: rt.ctx.userId,
        prompt,
        limit: MINI_LIMITS.aiPerUserDay,
        // F-039: счётчик НА ПОЛЬЗОВАТЕЛЯ (PK bot_id+user_id+date), а не общий
        // на бота — один посетитель больше не исчерпывает бюджет всем.
        onCount: (today) => bumpMiniAppAiCount(c.env.DB, rt.botId, today, rt.ctx.userId),
      });
      await logEvent(c.env.DB, rt.botId, rt.ctx.userId, 'mini.ai').catch(() => {});
      return json({ ok: true, url: res.url });
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('ai limit')) return json({ error: 'ai daily limit' }, 429);
      if (msg.includes('ai not configured') || msg.includes('unsupported')) return json({ error: msg }, 503);
      return json({ error: 'ai generation failed' }, 502);
    }
  }

  if (kind === 'pay') {
    // Оплата Telegram Stars (фаза D): счёт уходит юзеру в личный чат бота.
    // F-041: строка mini_payments создаётся ДО sendInvoice — payload счёта
    // 'mini:<paymentId>' уникален, вебхук бота по нему находит строку, сверяет
    // сумму в pre_checkout и идемпотентно отмечает paid. Без строки
    // successful_payment пришёл бы на неизвестный payload и платёж «ни к чему
    // не приводил» (находка аудита).
    let validated: { product: string; stars: number };
    try {
      validated = validateMiniInvoice({ product: body.product, stars: body.stars });
    } catch (e: any) {
      return json({ error: String(e?.message || e).replace('pay validation: ', '') }, 400);
    }
    const paymentId = crypto.randomUUID();
    try {
      await createMiniPayment(c.env.DB, {
        id: paymentId,
        bot_id: rt.botId,
        app_id: rt.row.id,
        user_id: rt.ctx.userId,
        amount: validated.stars,
        payload: miniPaymentPayload(paymentId),
        created_at: Date.now(),
      });
    } catch {
      // UNIQUE payload/PRIMARY KEY id: строка уже есть (повторный запрос) —
      // счёт не выставляем, чтобы не плодить параллельные платёжные сущности.
      return json({ error: 'платёж уже создан' }, 409);
    }
    try {
      await sendMiniInvoice(c.env, { botId: rt.botId, token: rt.token, userId: rt.ctx.userId, product: validated.product, stars: validated.stars, paymentId });
      await logEvent(c.env.DB, rt.botId, rt.ctx.userId, 'mini.pay').catch(() => {});
      return json({ ok: true });
    } catch (e: any) {
      // Счёт не ушёл — pending-строка висела бы вечно: убираем её.
      await deleteMiniPayment(c.env.DB, paymentId).catch(() => {});
      const msg = String(e?.message || e);
      if (msg.includes('pay validation')) return json({ error: msg.replace('pay validation: ', '') }, 400);
      await logEvent(c.env.DB, rt.botId, rt.ctx.userId, 'mini.pay.fail').catch(() => {});
      return json({ error: 'invoice failed' }, 502);
    }
  }

  if (kind === 'scenario') {
    // Синтетический текстовый апдейт от юзера мини-аппа: сценарий видит его
    // как обычное сообщение (команда/ключевое слово автора). Сессию пишем
    // тем же путём, что webhook, чтобы состояние бота не расходилось.
    const text = String(body.command || '').trim();
    if (!text) return json({ error: 'command required' }, 400);
    const sc = await loadScenarioCached(c.env.KV, c.env.DB, rt.botId);
    if (!sc) return json({ error: 'bot has no scenario' }, 404);
    const scenario = JSON.parse(sc.flow_json) as Scenario;
    const sessRow = await getSessionCas(c.env.DB, rt.botId, rt.ctx.userId);
    const session = {
      currentBlock: sessRow?.current_block ?? null,
      vars: sessRow?.vars_json ? JSON.parse(sessRow.vars_json) : {},
    };
    const update = {
      update_id: 0,
      message: {
        message_id: 0,
        date: Math.floor(Date.now() / 1000),
        chat: { id: rt.ctx.userId, type: 'private' },
        from: { id: rt.ctx.userId, is_bot: false, first_name: rt.ctx.name, username: rt.ctx.username ?? undefined },
        text,
      },
    };
    const dataOps = makeDataOps(c.env.DB, rt.botId);
    const tagOps = makeTagOps(c.env.DB, rt.botId);
    const referralOps = makeReferralOps(c.env.DB, rt.botId);
    const engineOps = makeEngineOps(c.env, rt.botId, rt.token, rt.ctx.userId, webhookOrigin(c.req.url));
    const result = await runEngine({ scenario, update, session, botUsername: null, data: dataOps, tags: tagOps, referral: referralOps, ...engineOps });
    const final = await dispatchOuts(c.env, rt.token, rt.botId, rt.ctx.userId, result.outs, { currentBlock: result.currentBlock, vars: result.vars }, 0, scenario, null, dataOps, tagOps, referralOps, engineOps);
    // F3-204: CAS-запись сессии, как в вебхуке (гонка F-002 из мини-ветки:
    // сценарий мини-аппа и вебхук бота могли писать одну сессию независимо).
    const casBaseVars = sessRow ? JSON.parse(sessRow.vars_json) as Record<string, unknown> : null;
    const casBaseUpdatedAt = sessRow ? Number(sessRow.updated_at) : null;
    await upsertSessionCas(c.env.DB, {
      botId: rt.botId,
      userId: rt.ctx.userId,
      currentBlock: final.currentBlock,
      varsJson: JSON.stringify(final.vars),
      baseVars: casBaseVars,
      baseUpdatedAt: casBaseUpdatedAt != null && Number.isFinite(casBaseUpdatedAt) ? casBaseUpdatedAt : null,
    });
    await logEvent(c.env.DB, rt.botId, rt.ctx.userId, 'mini.scenario').catch(() => {});
    return json({ ok: true });
  }

  return json({ error: 'bad kind' }, 400);
});

app.post('/api/bots/:id/validate', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const body = await c.req.json<{ flow_json?: string }>().catch(() => null);
  const parsed = parseScenarioBody(body?.flow_json);
  if ('error' in parsed) return json({ error: parsed.error }, 400);
  // Подсценарии: валидация авторского вида + сухое раскрытие с библиотекой
  // ВЛАДЕЛЬЦА (чужой фрагмент = subflow-missing). Все проблемы — против id
  // блока вызова, как их показывает редактор.
  const library = scenarioHasSubflows(parsed.scenario)
    ? await loadSubflowLibrary(c.env.DB, owned.owner_id, parsed.scenario)
    : undefined;
  const issues = validateScenario(parsed.scenario, library ? { subflows: library } : undefined);
  const counts = countIssues(issues);
  return json({ ok: counts.errors === 0, issues, counts });
});

app.post('/api/bots/:id/publish', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  // F-011: публикация дёргает Telegram (setWebhook, getWebhookInfo, getMe,
  // setMyCommands) и пишет версии — 10/мин на бота достаточно с запасом.
  const limited = await minuteLimited(c, `pub:${owned.id}`, 10);
  if (limited) return limited;

  const body = await c.req.json<{ name?: string; flow_json?: string }>().catch(() => null);
  const parsed = parseScenarioBody(body?.flow_json);
  if ('error' in parsed) return json({ error: parsed.error }, 400);
  if ((body?.flow_json?.length ?? 0) > MAX_FLOW_BYTES) {
    return json({ error: `сценарий больше ${Math.round(MAX_FLOW_BYTES / 1024)} КБ — публиковать нельзя` }, 413);
  }
  const scenario = parsed.scenario;

  const steps: Step[] = [];
  // Подсценарии: раскрываем вызовы фрагментов ВЛАДЕЛЬЦА в плоский сценарий и
  // валидируем РАСКРЫТЫЙ артефакт (проблемы мапятся на блоки вызова). Авторский
  // вид сохраняется в scenarios, раскрытый — в scenario_builds: вебхук всегда
  // исполняет билд, живой бот не зависит от будущих правок библиотеки.
  const expansion = await expandScenarioForOwner(c.env.DB, owned.owner_id, scenario);
  const platform = owned.platform === 'vk' ? 'vk' : 'telegram';
  const issues = expansion.issues;
  const counts = countIssues(issues);

  // Валидация авторского вида: publish не должен пропускать битые сценарии.
  // Сценарий БЕЗ подсценариев expandScenarioForOwner возвращает с пустым
  // списком проверок — поэтому авторский JSON валидируется отдельно (с
  // библиотекой владельца, если она загружена) и ДО записи версии.
  const authorIssues = validateScenario(scenario, {
    ...(expansion.library ? { subflows: expansion.library } : {}),
    platform,
  });
  const authorErrors = authorIssues.filter((i) => i.level === 'error');
  if (authorErrors.length > 0) {
    const current = await loadScenario(c.env.DB, owned.id);
    await logEvent(c.env.DB, owned.id, null, `publish.blocked.${authorErrors.length}`);
    return json({ ok: false, version: current?.version ?? 0, steps: [], issues: authorIssues, counts: countIssues(authorIssues) }, 422);
  }

  // 1. Сохранение версии
  const prev = await loadScenario(c.env.DB, owned.id);
  const version = (prev?.version ?? 0) + 1;
  await saveScenario(c.env.DB, owned.id, body?.name || owned.name, body!.flow_json!, version);
  if (body?.name && body.name !== owned.name) await setBotName(c.env.DB, owned.id, body.name);
  await afterScenarioSave(c, owned.id, body!.flow_json!);
  await logEvent(c.env.DB, owned.id, null, `scenario.saved.v${version}`);
  steps.push({ key: 'save', label: 'Сценарий сохранён', status: 'ok', detail: `версия ${version}` });

  // 2. Проверка. Ошибки останавливают пайплайн — до Telegram дело не доходит.
  if (counts.errors > 0) {
    steps.push({
      key: 'validate',
      label: 'Проверка сценария',
      status: 'fail',
      detail: `${counts.errors} ошибок` + (counts.warnings ? `, ${counts.warnings} предупреждений` : ''),
    });
    await logEvent(c.env.DB, owned.id, null, `publish.blocked.${counts.errors}`);
    return json({ ok: false, version, steps, issues, counts }, 422);
  }
  steps.push({
    key: 'validate',
    label: 'Проверка сценария',
    status: 'ok',
    detail: counts.warnings ? `замечаний: ${counts.warnings}` : 'без замечаний',
  });

  // 2b. Раскрытый артефакт (scenario_builds): вебхук исполняет ЕГО, а не
  // авторский вид. Пишется до любых обращений к Telegram — если запись не
  // прошла, публикация останавливается, и бот не остаётся в полуживом
  // состоянии. Детерминизм: этот JSON уже не изменится, даже если автор
  // позже отредактирует фрагмент в библиотеке.
  if (scenarioHasSubflows(scenario)) {
    const buildJson = JSON.stringify(expansion.expanded);
    if (buildJson.length > MAX_FLOW_BYTES) {
      steps.push({ key: 'build', label: 'Сборка подсценариев', status: 'fail', detail: `раскрытый сценарий больше ${Math.round(MAX_FLOW_BYTES / 1024)} КБ` });
      await logEvent(c.env.DB, owned.id, null, 'publish.build.too_large');
      return json({ ok: false, version, steps, issues, counts }, 413);
    }
    await putScenarioBuild(c.env.DB, owned.id, version, buildJson);
    steps.push({
      key: 'build',
      label: 'Сборка подсценариев',
      status: 'ok',
      detail: `раскрыто блоков: ${Object.keys(expansion.expanded.blocks).length}`,
    });
  }

  // 2c. Входящие вебхуки (набор 2026-10): каждому блоку webhook_in — свой
  // токен-эндпоинт /wh/<token>. Пересоздаём на каждую публикацию: снятые
  // блоки не должны оставлять живые адреса (старые токены умирают вместе со
  // строками бота). Адрес показываем автору в шаге публикации.
  const hookBlocks = Object.values(scenario.blocks ?? {}).filter((b) => b.type === 'webhook_in' && !b.params?.disabled);
  if (hookBlocks.length) {
    await deleteWebhookHooksForBot(c.env.DB, owned.id);
    const origin = new URL(c.req.url).origin;
    const urls: string[] = [];
    for (const hb of hookBlocks) {
      // UNIQUE(token) в bot_webhooks — своя таблица: генератор сверяет только
      // payment_connections, поэтому коллизию внутри bot_webhooks гасим ретраем.
      let created = false;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        const hookToken = await generateUniqueWebhookToken(c.env.DB);
        try {
          await createWebhookHook(c.env.DB, {
            id: `${owned.id}:${hb.id}`,
            botId: owned.id,
            token: hookToken,
            blockId: hb.id,
            fields: (Array.isArray(hb.params?.webhookFields) ? hb.params!.webhookFields!.map(String) : [])
            .map(normalizeWebhookField)
            .filter(Boolean),
          });
          urls.push(`${origin}/wh/${hookToken}`);
          created = true;
        } catch {
          if (attempt === 2) throw new Error('hook token collision');
        }
      }
    }
    steps.push({ key: 'webhooks_in', label: 'Входящие вебхуки', status: 'ok', detail: urls.join(', ') });
    await logEvent(c.env.DB, owned.id, null, `publish.webhooks_in.${hookBlocks.length}`);
  } else {
    // Блоков нет — хуков бота быть не должно (автор мог удалить последний).
    await deleteWebhookHooksForBot(c.env.DB, owned.id).catch(() => {});
  }

  // 3. Webhook
  await c.env.KV.put(owned.id, owned.webhook_secret).catch(() => {});
  const token = await decryptToken(owned.token_enc, c.env.ENCRYPTION_KEY);

  // ---------------- VK-публикация: Callback API ----------------
  // 30.10: VK УДАЛИЛ метод groups.setCallbackServer («Unknown method passed»,
  // живая проба). Новый цикл (api 5.199): groups.addCallbackServer (url+secret
  // → server_id) + groups.setCallbackSettings (server_id, message_new/
  // message_event). Смена адреса — groups.editCallbackServer, снятие —
  // deleteCallbackServer. server_id хранится в bots.vk_callback_server_id
  // (миграция 0031): переиздание правит существующий сервер, а не плодит.
  if (platform === 'vk') {
    const webhookUrl = `${new URL(c.req.url).origin}/vk/${owned.id}`;
    await c.env.KV.put(`vk:${owned.id}`, owned.webhook_secret).catch(() => {});
    let serverOk = true;
    let serverDetail = 'соединение живое';
    let serverId = Number(owned.vk_callback_server_id) || 0;
    try {
      if (serverId) {
        // Повторная публикация: адрес/секрет могли смениться (rotate secret).
        try {
          await vkCall('groups.editCallbackServer', { group_id: owned.vk_group_id, server_id: serverId, url: webhookUrl, secret: owned.webhook_secret, api_version: '5.199' }, token);
        } catch {
          // Сервера больше нет (удалён в панели VK) — создаём заново.
          const added = (await vkCall('groups.addCallbackServer', { group_id: owned.vk_group_id, url: webhookUrl, title: 'constructor', secret: owned.webhook_secret, api_version: '5.199' }, token)) as { server_id?: number };
          serverId = Number(added?.server_id) || 0;
          if (!serverId) throw new Error('no server_id');
          await setVkCallbackServerId(c.env.DB, owned.id, serverId);
        }
      } else {
        const added = (await vkCall('groups.addCallbackServer', { group_id: owned.vk_group_id, url: webhookUrl, title: 'constructor', secret: owned.webhook_secret, api_version: '5.199' }, token)) as { server_id?: number };
        serverId = Number(added?.server_id) || 0;
        if (!serverId) throw new Error('VK не вернул server_id');
        await setVkCallbackServerId(c.env.DB, owned.id, serverId);
      }
    } catch (e) {
      serverOk = false;
      serverDetail = `VK отклонил сервер: ${(e as Error).message.slice(0, 120)}`;
      steps.push({ key: 'webhook', label: 'Callback-сервер VK', status: 'fail', detail: serverDetail });
      await logEvent(c.env.DB, owned.id, null, 'publish.vk.server.fail');
      return json({ ok: false, version, steps, issues, counts }, 502);
    }
    try {
      await vkCall(
        'groups.setCallbackSettings',
        { group_id: owned.vk_group_id, server_id: serverId, api_version: '5.199', message_new: 1, message_event: 1 },
        token
      );
    } catch (e) {
      serverOk = false;
      serverDetail = `VK не включил события: ${(e as Error).message.slice(0, 120)}`;
      steps.push({ key: 'webhook', label: 'Callback-сервер VK', status: 'fail', detail: serverDetail });
      await logEvent(c.env.DB, owned.id, null, 'publish.vk.settings.fail');
      return json({ ok: false, version, steps, issues, counts }, 502);
    }
    if (serverOk) {
      steps.push({ key: 'webhook', label: 'Callback-сервер VK', status: 'ok', detail: serverDetail });
    }
    // Меню команд: у VK-сообществ нет аналога setMyCommands — команды
    // срабатывают как текстовые сообщения (блок «Команда» ловит /команда).
    steps.push({ key: 'commands', label: 'Меню команд', status: 'skipped', detail: 'в VK меню команд нет — команды работают текстом' });

    // 5. Активация (VK-ветка — общая точка с Telegram)
    await setPublishedVersion(c.env.DB, owned.id, version);
    await setBotActive(c.env.DB, owned.id, 1);
    await logEvent(c.env.DB, owned.id, null, 'publish.ok');
    steps.push({ key: 'activate', label: 'Бот опубликован', status: 'ok', detail: 'принимает сообщения' });
    return json({ ok: true, version, steps, issues, counts });
  }

  const webhookUrl = `${new URL(c.req.url).origin}/${owned.id}`;
  const setRes = await tgCall(token, 'setWebhook', {
    url: webhookUrl,
    secret_token: owned.webhook_secret,
    // poll_answer нужен блоку «Опрос», pre_checkout_query — блоку «Счёт»
    // (без него Telegram не присылает пред-чекаут и оплата отменяется).
    allowed_updates: ['message', 'callback_query', 'poll_answer', 'pre_checkout_query'],
  });
  const setData = (await setRes.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!setData.ok) {
    steps.push({ key: 'webhook', label: 'Webhook установлен', status: 'fail', detail: setData.description || 'Telegram отклонил webhook' });
    await logEvent(c.env.DB, owned.id, null, 'publish.webhook.fail');
    return json({ ok: false, version, steps, issues, counts }, 502);
  }
  const infoRes = await tgCall(token, 'getWebhookInfo', {});
  const info = (await infoRes.json().catch(() => ({}))) as { result?: any };
  const wh = info.result ?? {};
  if (wh.url && wh.url !== webhookUrl) {
    steps.push({ key: 'webhook', label: 'Webhook установлен', status: 'fail', detail: `Telegram держит другой адрес: ${wh.url}` });
    await logEvent(c.env.DB, owned.id, null, 'publish.webhook.mismatch');
    return json({ ok: false, version, steps, issues, counts }, 502);
  }
  steps.push({
    key: 'webhook',
    label: 'Webhook установлен',
    status: 'ok',
    detail: wh.pending_update_count ? `в очереди: ${wh.pending_update_count}` : 'соединение живое',
  });

  // 3b. @username бота — нужен для реферальных ссылок t.me/<bot>?start=ref_<id>.
  const meRes = await tgCall(token, 'getMe', {}).catch(() => null);
  const me = ((await meRes?.json().catch(() => ({}))) ?? {}) as { result?: { username?: string } };
  if (me.result?.username) await setBotUsername(c.env.DB, owned.id, me.result.username);

  // 4. Меню команд
  const cmds = scenarioCommands(scenario);
  if (!cmds.length) {
    steps.push({ key: 'commands', label: 'Меню команд', status: 'skipped', detail: 'нет команд в сценарии' });
  } else {
    const cmdRes = await tgCall(token, 'setMyCommands', { commands: cmds });
    const cmdData = (await cmdRes.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    steps.push({
      key: 'commands',
      label: 'Меню команд',
      status: cmdData.ok ? 'ok' : 'fail',
      detail: cmdData.ok ? cmds.map((x) => x.command).join(' ') : cmdData.description || 'не удалось обновить меню',
    });
  }

  // 5. Активация
  await setPublishedVersion(c.env.DB, owned.id, version);
  await setBotActive(c.env.DB, owned.id, 1);
  await logEvent(c.env.DB, owned.id, null, 'publish.ok');
  steps.push({ key: 'activate', label: 'Бот опубликован', status: 'ok', detail: 'принимает сообщения' });

  return json({ ok: true, version, steps, issues, counts, webhook: wh });
});

// Публикация только явно выбранной сохранённой версии. Черновик из запроса
// здесь намеренно не принимается: live-путь всегда получает immutable snapshot.
app.post('/api/bots/:id/publish-version', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const body = await c.req.json<{ version?: number }>().catch(() => null);
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 1) return json({ error: 'version: номер версии' }, 400);
  // Берём только снимок из D1 после проверки владельца; flow_json клиента
  // для live-публикации здесь принципиально не существует.
  const saved = await loadScenarioVersion(c.env.DB, owned.id, version);
  if (!saved) return json({ error: `версия ${version} не найдена` }, 404);
  let scenario: Scenario;
  try {
    scenario = JSON.parse(saved.flow_json) as Scenario;
  } catch {
    return json({ error: 'сохранённая версия повреждена' }, 500);
  }
  // Подсценарии: публикация сохранённой версии раскрывается и валидируется
  // так же, как обычная публикация. Если раскрытый билд этой версии уже есть
  // (публиковалась раньше) — берём его: повторное раскрытие могло бы дать
  // другой результат, если библиотека изменилась, а publish-version обязан
  // публиковать ТОТ ЖЕ артефакт.
  let expandedScenario = scenario;
  const existingBuild = await getScenarioBuild(c.env.DB, owned.id, version).catch(() => null);
  if (existingBuild) {
    try {
      expandedScenario = JSON.parse(existingBuild) as Scenario;
    } catch {
      expandedScenario = scenario;
    }
  } else if (scenarioHasSubflows(scenario)) {
    const expansion = await expandScenarioForOwner(c.env.DB, owned.owner_id, scenario);
    expandedScenario = expansion.expanded;
  }
  const issues = validateScenario(expandedScenario);
  const counts = countIssues(issues);
  if (counts.errors > 0) return json({ ok: false, version, issues, counts }, 422);
  if (!existingBuild && expandedScenario !== scenario) {
    await putScenarioBuild(c.env.DB, owned.id, version, JSON.stringify(expandedScenario));
  }
  const token = await decryptToken(owned.token_enc, c.env.ENCRYPTION_KEY);
  const webhookUrl = `${new URL(c.req.url).origin}/${owned.id}`;
  const setRes = await tgCall(token, 'setWebhook', {
    url: webhookUrl,
    secret_token: owned.webhook_secret,
    allowed_updates: ['message', 'callback_query', 'poll_answer', 'pre_checkout_query'],
  });
  const setData = (await setRes.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!setData.ok) return json({ ok: false, version, issues, counts, error: setData.description || 'Telegram отклонил webhook' }, 502);
  const info = (await (await tgCall(token, 'getWebhookInfo', {})).json().catch(() => ({}))) as { result?: any };
  const webhook = info.result ?? {};
  if (webhook.url && webhook.url !== webhookUrl) return json({ ok: false, version, issues, counts, error: 'Telegram держит другой webhook' }, 502);
  const cmds = scenarioCommands(scenario);
  if (cmds.length) {
    const cmdData = (await (await tgCall(token, 'setMyCommands', { commands: cmds })).json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!cmdData.ok) return json({ ok: false, version, issues, counts, error: cmdData.description || 'не удалось обновить меню команд' }, 502);
  }
  await c.env.KV.put(owned.id, owned.webhook_secret).catch(() => {});
  await setPublishedVersion(c.env.DB, owned.id, version);
  await setBotActive(c.env.DB, owned.id, 1);
  await invalidateScenarioCache(c.env.KV, owned.id);
  await logEvent(c.env.DB, owned.id, null, `publish.version.v${version}`);
  return json({ ok: true, version, issues, counts, webhook });
});

app.post('/api/bots/:id/unpublish', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const steps: Step[] = [];
  const token = await decryptToken(owned.token_enc, c.env.ENCRYPTION_KEY);
  // F3-105: у VK-бота «снятие вебхука» — удаление Callback-сервера
  // (deleteCallbackServer по server_id из 0031) и выключение событий.
  // Telegram-deleteWebhook с VK-ключом раньше звался всегда — молча падал.
  const isVk = owned.platform === 'vk';
  if (isVk) {
    let ok = true;
    let detail = 'бот остановлен';
    const serverId = Number(owned.vk_callback_server_id) || 0;
    try {
      if (serverId) {
        await vkCall('groups.deleteCallbackServer', { group_id: owned.vk_group_id, server_id: serverId, api_version: '5.199' }, token);
        await setVkCallbackServerId(c.env.DB, owned.id, 0);
      }
      if (serverId) {
        await vkCall('groups.setCallbackSettings', { group_id: owned.vk_group_id, server_id: serverId, api_version: '5.199', message_new: 0, message_event: 0 }, token).catch(() => {});
      }
    } catch (e) {
      ok = false;
      detail = String((e as Error).message || 'VK не снял Callback-сервер').slice(0, 120);
    }
    steps.push({ key: 'webhook', label: 'Callback-сервер VK снят', status: ok ? 'ok' : 'fail', detail });
    await setBotActive(c.env.DB, owned.id, 0);
    await logEvent(c.env.DB, owned.id, null, 'unpublish');
    return json({ ok, steps });
  }
  const res = await tgCall(token, 'deleteWebhook', { drop_pending_updates: false });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  steps.push({
    key: 'webhook',
    label: 'Webhook снят',
    status: data.ok ? 'ok' : 'fail',
    detail: data.ok ? 'бот остановлен' : data.description || 'не удалось снять webhook',
  });
  await setBotActive(c.env.DB, owned.id, 0);
  await logEvent(c.env.DB, owned.id, null, 'unpublish');
  return json({ ok: !!data.ok, steps });
});

app.get('/api/bots/:id/status', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  let webhook: any = null;
  let commands: any[] = [];
  try {
    const token = await decryptToken(owned.token_enc, c.env.ENCRYPTION_KEY);
    const info = (await (await tgCall(token, 'getWebhookInfo', {})).json().catch(() => ({}))) as { result?: any };
    webhook = info.result ?? null;
    const cmds = (await (await tgCall(token, 'getMyCommands', {})).json().catch(() => ({}))) as { result?: any[] };
    commands = cmds.result ?? [];
  } catch {
    /* статус отдаём и без Telegram */
  }
  const publishedVersion = owned.published_version ?? null;
  return json({
    active: !!owned.active,
    name: owned.name,
    version: publishedVersion ?? 0,
    publishedVersion,
    webhook,
    commands,
  });
});

// ---------------- История версий, логи и прогон сценария ----------------

// Список сохранённых версий сценария (все они уже лежат в D1 — нужен только UI).
app.get('/api/bots/:id/versions', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  // Для UI список показывает draft-историю; опубликованный маркер берётся
  // из отдельного указателя bots.published_version.
  const versions = await listScenarioVersions(c.env.DB, owned.id);
  const publishedVersion = owned.published_version ?? null;
  return json({
    active: !!owned.active,
    publishedVersion,
    versions: versions.map((v) => ({ ...v, published: !!owned.active && v.version === publishedVersion })),
  });
});

// Откат: старый flow_json сохраняется НОВОЙ версией, история не перезаписывается.
app.post('/api/bots/:id/rollback', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const body = await c.req.json<{ version?: number }>().catch(() => null);
  const target = Number(body?.version);
  if (!Number.isInteger(target) || target < 1) return json({ error: 'version: номер версии' }, 400);

  const old = await getScenarioVersion(c.env.DB, owned.id, target);
  if (!old) return json({ error: `версия ${target} не найдена` }, 404);

  // Откат на битую версию запрещён: иначе rollback превращается в обход
  // валидации publish. Битый JSON тоже не откатываем — его даже не прочитать.
  let targetScenario: Scenario | null = null;
  try {
    targetScenario = JSON.parse(old.flow_json) as Scenario;
  } catch {
    targetScenario = null;
  }
  if (!targetScenario || !validateScenarioShape(targetScenario)) {
    return json({ error: `версия ${target} повреждена — откат невозможен` }, 422);
  }
  const rollbackIssues = validateScenario(targetScenario);
  const rollbackErrors = rollbackIssues.filter((i) => i.level === 'error');
  if (rollbackErrors.length > 0) {
    return json({ error: `версия ${target} содержит ошибки валидации — откат невозможен`, issues: rollbackIssues }, 422);
  }

  const prev = await loadScenario(c.env.DB, owned.id);
  const version = (prev?.version ?? 0) + 1;
  await saveScenario(c.env.DB, owned.id, old.name || owned.name, old.flow_json, version);

  // Билд отката: rollback на версию N использует билд N. Если его нет
  // (версия публиковалась до подсценариев или билд стёрт) — раскрываем заново
  // на лету, сохраняем и пишем в лог, что это произошло.
  let rebuilt = false;
  try {
    const oldBuild = await getScenarioBuild(c.env.DB, owned.id, target);
    let oldScenario: Scenario | null = null;
    try {
      oldScenario = JSON.parse(old.flow_json) as Scenario;
    } catch {
      oldScenario = null;
    }
    if (oldBuild) {
      await putScenarioBuild(c.env.DB, owned.id, version, oldBuild);
    } else if (oldScenario && scenarioHasSubflows(oldScenario)) {
      const expansion = await expandScenarioForOwner(c.env.DB, owned.owner_id, oldScenario);
      await putScenarioBuild(c.env.DB, owned.id, version, JSON.stringify(expansion.expanded));
      rebuilt = true;
      await logEvent(c.env.DB, owned.id, null, `rollback.rebuilt.v${target}`).catch(() => {});
    }
  } catch {
    /* билд не записался — публикация этой версии пересоберёт его */
  }

  await afterScenarioSave(c, owned.id, old.flow_json);
  await logEvent(c.env.DB, owned.id, null, `scenario.rollback.v${target}`);
  return json({ ok: true, version, rebuilt, flow_json: old.flow_json });
});

app.delete('/api/bots/:id/versions/:version', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const version = Number(c.req.param('version'));
  if (!Number.isInteger(version) || version < 1) return json({ error: 'version: номер версии' }, 400);
  const current = await loadScenario(c.env.DB, owned.id);
  const published = owned.published_version ?? null;
  if (version === published || version === current?.version) {
    return json({ error: 'Нельзя удалить текущую или опубликованную версию' }, 400);
  }
  const changes = await deleteScenarioVersion(c.env.DB, owned.id, version);
  if (!changes) return json({ error: `версия ${version} не найдена` }, 404);
  await logEvent(c.env.DB, owned.id, null, `scenario.version.deleted.v${version}`);
  return json({ ok: true, version });
});

app.delete('/api/bots/:id/versions', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const current = await loadScenario(c.env.DB, owned.id);
  const keep = [current?.version ?? 0, owned.published_version ?? 0];
  const changes = await deleteScenarioVersionsExcept(c.env.DB, owned.id, keep);
  await logEvent(c.env.DB, owned.id, null, `scenario.versions.cleared.${changes}`);
  return json({ ok: true, deleted: changes });
});

// Последние события бота — отладка сценария без Telegram.
// Чтение расширено для сотрудников (admin/moderator/ADMIN_KEY): страница
// «Пользователи» открывает логи чужих ботов. Запись (DELETE) — только владелец.
app.get('/api/bots/:id/logs', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const bot = await getBot(c.env.DB, c.req.param('id'));
  if (!bot) return json({ error: 'not found' }, 404);
  const isOwner = !!(id.user && bot.owner_id === id.user.id);
  if (!isOwner && !(await canAccessAnyBot(c, id))) return json({ error: 'forbidden' }, 403);
  const limit = Number(c.req.query('limit') ?? 100);
  const rawUser = c.req.query('userId');
  const userId = rawUser ? Number(rawUser) : null;
  const logs = await listLogs(c.env.DB, bot.id, limit, Number.isFinite(userId as number) ? (userId as number) : null);
  return json({ logs });
});

app.delete('/api/bots/:id/logs', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const deleted = await clearLogs(c.env.DB, owned.id);
  return json({ ok: true, deleted });
});

// Прогон сценария настоящим движком (runEngine) без отправок в Telegram.
// Клиент присылает всю историю вводов заново — прогон stateless и дешёвый.
app.post('/api/bots/:id/simulate', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  // F-011: прогон движка + раскрытие подсценариев — дорогой путь, 30/мин на автора.
  const limited = await minuteLimited(c, `sim:${actorId(id)}`, 30);
  if (limited) return limited;

  const body = await c.req.json<{ flow_json?: string; inputs?: string[] }>().catch(() => null);
  let scenario: Scenario;
  if (body?.flow_json) {
    try {
      const parsed = JSON.parse(body.flow_json);
      if (!validateScenarioShape(parsed)) return json({ error: 'scenario must have start + blocks' }, 400);
      scenario = parsed as Scenario;
    } catch {
      return json({ error: 'flow_json is not valid JSON' }, 400);
    }
  } else {
    const sc = await loadScenarioCached(c.env.KV, c.env.DB, owned.id);
    if (!sc) return json({ error: 'нет сценария' }, 404);
    scenario = JSON.parse(sc.flow_json) as Scenario;
  }

  // Превью ОБЯЗАНО гонять раскрытый сценарий: иначе превью врёт — автор
  // видит прогон авторского вида, а в проде вебхук исполняет билд. Тот же
  // expandScenarioForOwner, что и у публикации.
  const expansion = await expandScenarioForOwner(c.env.DB, owned.owner_id, scenario);
  if (expansion.issues.some((i) => i.level === 'error')) {
    return json({ ok: false, issues: expansion.issues, counts: countIssues(expansion.issues), log: [], pending: null, vars: {} }, 422);
  }
  scenario = expansion.expanded;

  const inputs = Array.isArray(body?.inputs) ? body!.inputs!.map(String).slice(0, 50) : [];
  return json(await simulateScenario(scenario, inputs));
});

// Заглушка базы для прогона: таблицы живут в памяти на время одного прогона,
// поэтому «сохранить заказ» → «найти заказ» работает и без реальной записи.
function makeMemDataOps(log: SimLine[]): DataOps {
  const store = new Map<string, Record<string, unknown>[]>();
  const hit = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.keys(where ?? {}).every((k) => {
      const needle = String(where[k] ?? '').trim().toLowerCase();
      if (!needle) return true;
      return String(row[k] ?? '').trim().toLowerCase().includes(needle);
    });
  return {
    async add(collectionId, fields) {
      const rows = store.get(collectionId) ?? [];
      rows.push({ ...fields });
      store.set(collectionId, rows);
      log.push({ who: 'bot', text: '[данные: запись добавлена]' });
      return `mem-${rows.length}`;
    },
    async find(collectionId, where, limit) {
      const rows = (store.get(collectionId) ?? []).filter((r) => hit(r, where));
      const out = rows.slice(-Math.max(1, Number(limit) || 10));
      log.push({ who: 'bot', text: `[данные: найдено ${out.length}]` });
      return out;
    },
    async update(collectionId, where, patch) {
      let n = 0;
      for (const r of store.get(collectionId) ?? []) {
        if (hit(r, where)) {
          Object.assign(r, patch);
          n++;
        }
      }
      log.push({ who: 'bot', text: `[данные: обновлено ${n}]` });
      return n;
    },
    async remove(collectionId, where) {
      const rows = store.get(collectionId) ?? [];
      const kept = rows.filter((r) => !hit(r, where));
      const n = rows.length - kept.length;
      store.set(collectionId, kept);
      log.push({ who: 'bot', text: `[данные: удалено ${n}]` });
      return n;
    },
  };
}

interface SimLine {
  who: 'bot' | 'user';
  text: string;
}

// Теги в прогоне живут в памяти: «поставить тег» → «условие по тегу» должно
// работать, не трогая реальную базу бота.
function makeMemTagOps(log: SimLine[]): TagOps {
  const store = new Map<number, Set<string>>();
  const at = (userId: number): Set<string> => {
    let set = store.get(userId);
    if (!set) {
      set = new Set<string>();
      store.set(userId, set);
    }
    return set;
  };
  return {
    async add(tag, userId) {
      at(userId).add(normalizeTag(tag));
      log.push({ who: 'bot', text: `[тег поставлен: ${normalizeTag(tag)}]` });
    },
    async remove(tag, userId) {
      at(userId).delete(normalizeTag(tag));
      log.push({ who: 'bot', text: `[тег снят: ${normalizeTag(tag)}]` });
    },
    async clear(userId) {
      at(userId).clear();
      log.push({ who: 'bot', text: '[теги очищены]' });
    },
    async list(userId) {
      return [...at(userId)];
    },
    async has(tag, userId) {
      return at(userId).has(normalizeTag(tag));
    },
  };
}

// Заглушки новых ops для прогона. Никакой сети и D1: состояние живёт в памяти
// одного прогона и переключается служебными вводами (member:/notmember:,
// paid:/pending:/failed:), чтобы автор мог проверить обе ветки каждого блока.
interface SimStubs {
  channels: ChannelOps;
  counters: CounterOps;
  users: UserOps;
  payments: PaymentOps;
  broadcast: BroadcastOps;
  schedules: ScheduleOps;
  setMember(v: boolean): void;
  setPayStatus(v: 'paid' | 'pending' | 'failed'): void;
  simUsers: number;
}

function makeSimStubs(log: SimLine[]): SimStubs {
  const stub: { member: boolean; payStatus: 'paid' | 'pending' | 'failed'; simUsers: number } = {
    member: true,
    payStatus: 'paid',
    simUsers: 100,
  };
  const counters = new Map<string, number>();
  const counterKey = (name: string, scope: string, userId: number) => `${scope}:${scope === 'bot' ? '' : userId}:${name}`;
  const orders = new Map<string, PaymentOrderInfo>();
  return {
    get simUsers() {
      return stub.simUsers;
    },
    setMember(v) {
      stub.member = v;
    },
    setPayStatus(v) {
      stub.payStatus = v;
    },
    channels: {
      async isMember() {
        log.push({ who: 'bot', text: `[подписка на канал: ${stub.member ? 'есть' : 'нет'}]` });
        return stub.member;
      },
    },
    counters: {
      async inc(name, scope, userId, amount) {
        const k = counterKey(name, scope, userId);
        const v = (counters.get(k) ?? 0) + Math.max(1, Math.floor(amount) || 1);
        counters.set(k, v);
        log.push({ who: 'bot', text: `[счётчик ${name}: ${v}]` });
        return v;
      },
      async dec(name, scope, userId, amount) {
        const k = counterKey(name, scope, userId);
        const v = (counters.get(k) ?? 0) - Math.max(1, Math.floor(amount) || 1);
        counters.set(k, v);
        log.push({ who: 'bot', text: `[счётчик ${name}: ${v}]` });
        return v;
      },
      async reset(name, scope, userId) {
        counters.set(counterKey(name, scope, userId), 0);
        log.push({ who: 'bot', text: `[счётчик ${name}: сброшен]` });
        return 0;
      },
      async get(name, scope, userId) {
        const v = counters.get(counterKey(name, scope, userId)) ?? 0;
        log.push({ who: 'bot', text: `[счётчик ${name}: ${v}]` });
        return v;
      },
    },
    users: {
      async profile(userId) {
        return {
          name: 'Тест Тестов',
          username: '@testuser',
          id: userId,
          tags: ['vip'],
          subscription: true,
          paidTotal: 150000,
          refCount: 3,
          firstSeen: Date.now() - 7 * 86_400_000,
        };
      },
    },
    payments: {
      async create(_connectionId, params) {
        const order: PaymentOrderInfo = {
          id: `sim-${orders.size + 1}`,
          externalId: params.orderId?.trim() || `sim-${orders.size + 1}`,
          amount: params.amount,
          currency: params.currency,
          status: 'created',
          link: `https://pay.example/sim-${orders.size + 1}`,
        };
        orders.set(order.externalId, order);
        log.push({ who: 'bot', text: `[счёт-ссылка: ${(order.amount / 100).toFixed(2)} ${order.currency}]` });
        return order;
      },
      async get(_connectionId, orderId) {
        const order = orders.get(orderId);
        if (!order) return null;
        const status = stub.payStatus;
        log.push({ who: 'bot', text: `[оплата: ${status}]` });
        return { ...order, status: status === 'pending' ? 'pending' : status };
      },
    },
    broadcast: {
      async enqueue(segment, payload) {
        // Число получателей в прогоне — симулируемая аудитория; фильтр по тегу
        // честно «отсекает» тех, у кого тега нет (в памяти тегов нет — все с тегом).
        const count = segment.tag ? Math.min(stub.simUsers, 10) : stub.simUsers;
        const capped = payload.dailyCap && payload.dailyCap > 0 ? Math.min(count, payload.dailyCap) : count;
        log.push({ who: 'bot', text: `[рассылка по сегменту: ${capped} получателей]` });
        return capped;
      },
    },
    schedules: {
      async register(def) {
        // В прогоне базы нет: показываем, что расписание принялось бы, и какой
        // cron из него получился — автор видит ошибку формата до публикации.
        const gen = scheduleToCron({
          scheduleKind: def.scheduleKind,
          atTime: def.atTime,
          weekdays: def.weekdays,
          everyMinutes: def.everyMinutes,
          cronExpr: def.cronExpr,
        });
        if (!gen.ok) {
          log.push({ who: 'bot', text: '[расписание: не получилось разобрать время]' });
          return { status: 'invalid' as const, count: 0 };
        }
        log.push({ who: 'bot', text: `[расписание зарегистрировано: ${gen.cronExpr} (${def.timezone})]` });
        return { status: 'ok' as const, count: 1 };
      },
    },
  };
}

// Тот же runEngine, что работает в бою: send* попадают в лог, http/ai/delay
// заменяются заглушкой и сценарий продолжается с next (как в dispatchOuts).
async function simulateScenario(scenario: Scenario, inputs: string[]) {
  const log: SimLine[] = [];
  const memData = makeMemDataOps(log);
  const memTags = makeMemTagOps(log);
  const memReferral = makeMemReferralOps(log);
  const stubs = makeSimStubs(log);
  const simOps = {
    channels: stubs.channels,
    counters: stubs.counters,
    users: stubs.users,
    payments: stubs.payments,
    broadcast: stubs.broadcast,
    schedules: stubs.schedules,
  };
  let cur: { currentBlock: string | null; vars: Record<string, unknown> } = { currentBlock: null, vars: {} };

  for (const text of inputs) {
    // Вводы приходят строкой. Префиксы позволяют симулировать то, что текстом
    // не передаётся: нажатие inline-кнопки и отправку контакта/геолокации.
    // Известное расхождение с боем: подпись reply-кнопки или пункта меню,
    // начинающаяся с «callback:», «phone:», «poll:», «document:» или «pay:ok»,
    // будет разобрана как служебный ввод, хотя бот принял бы её обычным текстом.
    // Экранировать нечем (в Telegram подпись — обычный текст), поэтому это
    // осознанное ограничение прогона, а не поведение движка.
    const isCallback = text.startsWith('callback:');
    const isPhone = text.startsWith('phone:');
    const isLocation = text.startsWith('location:');
    // Служебные переключатели заглушек: не апдейты, а настройка прогона.
    // member:/notmember: — членство в канале; paid:/pending:/failed: — статус
    // заказа для payment_check. В лог попадают как действие автора прогона.
    if (text === 'member:' || text === 'notmember:') {
      stubs.setMember(text === 'member:');
      log.push({ who: 'user', text: `[прогон: подписка на канал — ${text === 'member:' ? 'есть' : 'нет'}]` });
      continue;
    }
    if (text === 'paid:' || text === 'pending:' || text === 'failed:') {
      stubs.setPayStatus(text.slice(0, -1) as 'paid' | 'pending' | 'failed');
      log.push({ who: 'user', text: `[прогон: статус оплаты — ${text.slice(0, -1)}]` });
      continue;
    }
    // poll:N — ответ на опрос вариантом с индексом N (или списком «0,2»).
    const isPoll = text.startsWith('poll:');
    // pay:ok — успешная оплата счёта: в бою это апдейт successful_payment.
    const isPayOk = text === 'pay:ok';
    // Вложения: те же file_id-заглушки, что przyjмёт настоящий «Ввод».
    const attachmentKind = (['document', 'video', 'voice', 'audio', 'any'] as const).find((k) =>
      text.startsWith(`${k}:`)
    );
    log.push({
      who: 'user',
      text: isCallback
        ? `⌨ ${text.slice(9)}`
        : isPhone
        ? '📱 контакт отправлен'
        : isLocation
        ? '📍 геолокация отправлена'
        : isPoll
        ? `📊 ответ на опрос: ${text.slice(5)}`
        : isPayOk
        ? '💳 оплата прошла'
        : attachmentKind
        ? `📎 ${attachmentKind} отправлен`
        : text,
    });

    const [lat, lon] = text.slice(9).split(',');
    const update: any = isCallback
      ? { callback_query: { id: 'sim', from: { id: 1 }, data: text.slice(9), message: { chat: { id: 1 }, message_id: 7 } } }
      : isPhone
      ? { message: { chat: { id: 1 }, from: { id: 1 }, contact: { phone_number: text.slice(6) } } }
      : isLocation
      ? { message: { chat: { id: 1 }, from: { id: 1 }, location: { latitude: Number(lat) || 0, longitude: Number(lon) || 0 } } }
      : isPoll
      ? { poll_answer: { user: { id: 1 }, option_ids: text.slice(5).split(',').map((n) => Number(n.trim()) || 0) } }
      : isPayOk
      ? {
          message: {
            chat: { id: 1 },
            from: { id: 1 },
            message_id: 5,
            successful_payment: {
              currency: 'RUB',
              total_amount: 10000,
              invoice_payload: 'sim-invoice',
              provider_payment_charge_id: 'sim-charge',
              telegram_payment_charge_id: 'sim-tg-charge',
            },
          },
        }
      : attachmentKind
      ? {
          message: {
            chat: { id: 1 },
            from: { id: 1 },
            message_id: 5,
            ...(attachmentKind === 'document' ? { document: { file_id: 'sim-file', file_name: 'файл.pdf', mime_type: 'application/pdf' } } : {}),
            ...(attachmentKind === 'video' ? { video: { file_id: 'sim-video', file_name: 'видео.mp4', mime_type: 'video/mp4' } } : {}),
            ...(attachmentKind === 'voice' ? { voice: { file_id: 'sim-voice', mime_type: 'audio/ogg' } } : {}),
            ...(attachmentKind === 'audio' ? { audio: { file_id: 'sim-audio', file_name: 'трек.mp3', mime_type: 'audio/mpeg' } } : {}),
            ...(attachmentKind === 'any' ? { sticker: { file_id: 'sim-sticker' } } : {}),
          },
        }
      : { message: { chat: { id: 1 }, from: { id: 1 }, message_id: 5, text } };

    let res = await runEngine({
      scenario,
      update,
      session: { currentBlock: cur.currentBlock, vars: cur.vars },
      botUsername: 'testbot',
      data: memData,
      tags: memTags,
      referral: memReferral,
      ...simOps,
    });
    let nextResume: { next: string | null; vars: Record<string, unknown> } | null = null;

    const flush = () => {
      for (const o of res.outs) {
        const p = o.payload as any;
        if (o.method === 'sendMessage') {
          log.push({ who: 'bot', text: String(p.text ?? '') });
        } else if (o.method === 'sendPhoto' || o.method === 'sendVideo' || o.method === 'sendAudio' || o.method === 'sendDocument') {
          const kind = o.method.replace('send', '').toLowerCase();
          log.push({ who: 'bot', text: `[${kind}] ${String(p.caption ?? '')}`.trim() });
        } else if (o.method === 'sendMediaGroup') {
          // Альбом: показываем сколько медиа уйдёт и первую подпись — иначе
          // прогон выглядит так, будто блок ничего не отправил.
          const items = Array.isArray(p.media) ? p.media : [];
          const caption = items.map((m: any) => m?.caption).filter(Boolean)[0] ?? '';
          log.push({ who: 'bot', text: `[альбом из ${items.length}] ${String(caption)}`.trim() });
        } else if (o.method === 'sendInvoice') {
          // Сумма в копейках (minor units) — в прогоне показываем в валюте.
          const amounts = Array.isArray(p.prices) ? p.prices : [];
          const total = amounts.reduce((sum: number, x: any) => sum + Number(x?.amount ?? 0), 0);
          const sum = total ? (total / 100).toFixed(2) : '0';
          log.push({ who: 'bot', text: `[счёт] ${String(p.title ?? '')} — ${sum} ${String(p.currency ?? '')}`.trim() });
        } else if (o.method === 'action') {
          log.push({ who: 'bot', text: `[действие: ${String(p.kind ?? '')}]` });
        } else if (o.method === 'subscription') {
          log.push({ who: 'bot', text: `[подписка: ${String(p.subAction ?? '')}]` });
        } else if (o.method === 'delay') {
          log.push({ who: 'bot', text: `[пауза ${Number(p.seconds ?? 0)}с]` });
          nextResume = { next: p.next ?? null, vars: { ...(p.vars ?? {}) } };
        } else if (o.method === 'http' || o.method === 'ai') {
          const v: Record<string, unknown> = { ...(p.vars ?? {}) };
          if (o.method === 'http') {
            const retries = Number(p.retries) || 0;
            const pages = p.paginate ? ` x${p.paginate.maxPages ?? 10} стр.` : '';
            log.push({
              who: 'bot',
              text: `[HTTP ${p.method ?? 'GET'} ${p.url ?? ''}${pages}${retries ? `, повторов: ${retries}` : ''}]`,
            });
          } else {
            log.push({ who: 'bot', text: '[ИИ: в прогоне ответ не генерируется]' });
          }
          if (p.outVar) v[p.outVar] = '…';
          if (p.paginate && (p.collectVar || p.outVar)) v[p.collectVar || p.outVar] = [];
          nextResume = { next: p.next ?? null, vars: v };
        } else if (o.method === 'sendPoll') {
          let opts: { text?: string }[] = [];
          try {
            opts = typeof p.options === 'string' ? JSON.parse(p.options) : Array.isArray(p.options) ? p.options : [];
          } catch {
            opts = [];
          }
          log.push({ who: 'bot', text: `[опрос] ${String(p.question ?? '')} (${opts.length} вариантов)` });
        } else if (o.method === 'sendChatAction') {
          const labels: Record<string, string> = {
            typing: 'печатает…',
            upload_photo: 'загружает фото…',
            upload_document: 'загружает документ…',
            find_location: 'ищет локацию…',
            record_voice: 'записывает голосовое…',
          };
          log.push({ who: 'bot', text: `[${labels[String(p.action ?? '')] ?? String(p.action ?? 'typing')}]` });
        } else if (o.method === 'forwardMessage' || o.method === 'copyMessage') {
          log.push({ who: 'bot', text: `[переслано в ${String(p.chat_id ?? '')}]` });
        } else if (o.method === 'wait') {
          log.push({ who: 'bot', text: `[ждём ответ ${Number(p.seconds ?? 60)}с]` });
        } else if (o.method === 'answerCallbackQuery') {
          log.push({ who: 'bot', text: `[уведомление нажатия${p.text ? `: ${String(p.text)}` : ''}]` });
        } else if (o.method === 'deleteMessage') {
          log.push({ who: 'bot', text: '[удалено сообщение]' });
        } else if (o.method === 'trace') {
          // Служебная строка движка (не Telegram-вызов): прогресс цикла foreach,
          // продолжение после бюджета шагов, обрыв runaway-цикла, регистрация
          // расписания. В прогоне бюджет-resume честно продолжается — автор
          // видит поток целиком, как его доведёт крон в бою.
          if (p.kind === 'loop') log.push({ who: 'bot', text: `[цикл: ${Number(p.index ?? 0)}/${Number(p.total ?? 0)}]` });
          else if (p.kind === 'loop-deferred') log.push({ who: 'bot', text: `[цикл продолжится фоново: ${String(p.event ?? '').replace('engine.loop.deferred.', '')}]` });
          else if (p.kind === 'engine-budget-resume') {
            log.push({ who: 'bot', text: '[поток длиннее одного прохода — продолжается]' });
            nextResume = { next: (p.resumeBlockId as string) ?? null, vars: { ...(p.vars as Record<string, unknown> ?? {}) } };
          } else if (p.kind === 'engine-loop-break') log.push({ who: 'bot', text: `[бесконечный цикл прерван: ${String(p.event ?? '').replace('engine.loop.break.', '')}]` });
          else if (p.kind === 'schedule') log.push({ who: 'bot', text: `[расписание: ${String(p.status ?? '?')}]` });
        } else if (o.method === 'editMessageText' || o.method === 'editMessageReplyMarkup') {
          log.push({ who: 'bot', text: o.method === 'editMessageText' ? `[правка сообщения] ${String(p.text ?? '')}`.trim() : '[правка кнопок сообщения]' });
        }
      }
    };

    flush();
    let guard = 0;
    while (nextResume && guard++ < 30) {
      // Явный тип: TS сужает переменную до null (присваивание идёт внутри замыкания).
      const r = nextResume as { next: string | null; vars: Record<string, unknown> };
      nextResume = null;
      res = await runEngine({
        scenario,
        update: {},
        session: { currentBlock: null, vars: r.vars },
        startBlockId: r.next ?? undefined,
        botUsername: 'testbot',
        data: memData,
        tags: memTags,
        referral: memReferral,
      });
      flush();
    }
    cur = { currentBlock: res.currentBlock, vars: res.vars };
  }

  // На чём сценарий остановился — нужен тип ожидания, чтобы UI показал ввод/кнопки.
  let pending: { kind: string; prompt?: string; buttons?: { label: string; value: string }[] } | null = null;
  const b = cur.currentBlock ? scenario.blocks[cur.currentBlock] : null;
  if (b) {
    if (b.type === 'input' || b.type === 'contact') {
      // Подсказка по виду ввода: у «документ»/«фото»/... она своя (в бою её
      // шлёт движок, здесь — та же фраза для UI прогона).
      const kindPrompt: Record<string, string> = {
        photo: 'Пришлите фото',
        document: 'Пришлите документ',
        video: 'Пришлите видео',
        voice: 'Запишите голосовое сообщение',
        audio: 'Пришлите аудио',
        location: 'Отправьте геолокацию',
        any: 'Отправьте что-нибудь',
      };
      pending = {
        kind: b.type,
        prompt:
          b.params.prompt ||
          (b.type === 'contact'
            ? 'Отправьте контакт'
            : kindPrompt[String(b.params.kind ?? '')] || 'Введите значение'),
      };
    } else if (b.type === 'buttons') {
      // Reply-клавиатура приходит обычным текстом подписи (движок матчит label),
      // inline-кнопка — callback_query с data=value. Раньше превью получало сырой
      // value и отправляло его текстом: для inline-раскладки движок не находил
      // ветку и прогон навсегда залипал на блоке кнопок.
      // Блок «Меню» сюда не попадает: он не ждёт (идёт по next), его кнопки
      // превью берёт из __menu и отправляет текстом — двойного ряда не будет.
      const replyLayout = b.params.layout === 'reply';
      pending = {
        kind: 'choice',
        prompt: b.params.prompt || 'Выберите:',
        buttons: (b.params.buttons || [])
          // Кнопка-ссылка в inline-раскладке апдейта боту не присылает — нажать
          // её в бою нечего. В reply-разкладке url игнорируется движком
          // (buildKeyboard кладёт `{ text: label }`), и подпись приходит текстом,
          // поэтому такую кнопку в прогоне оставляем.
          .filter((x) => replyLayout || !x.url)
          .map((x) => ({
            label: x.label,
            value: replyLayout ? x.label : `callback:${x.value}`,
          })),
      };
    } else if (b.type === 'keyword') {
      pending = { kind: 'keyword', prompt: 'напишите фразу' };
    } else if (b.type === 'poll') {
      // Ответ опросом — отдельный тип апдейта; в прогоне его заменяет ввод
      // с префиксом poll: (индекс выбранного варианта).
      pending = {
        kind: 'poll',
        prompt: 'ответьте на опрос (ввод вида poll:0)',
        buttons: (b.params.pollOptions || []).map((x, i) => ({ label: x.text, value: `poll:${i}` })),
      };
    } else if (b.type === 'wait') {
      pending = { kind: 'wait', prompt: b.params.prompt || 'ждём любой ответ' };
    } else if (b.type === 'invoice') {
      // В прогоне платёж не проводится: успешная оплата приходит апдейтом
      // successful_payment — его и отправляет кнопка «оплачено» (ветка paid).
      // Ветка «отменено» в бою срабатывает только на невыставившийся счёт
      // (нет токена или суммы) — этот путь прогон показывает сам; закрытый
      // пользователем счёт апдейта не присылает, поэтому кнопки «отменено»
      // здесь нет — она бы вращала прогон на месте.
      pending = {
        kind: 'choice',
        prompt: 'счёт выставлен — «оплачено» проверит ветку paid',
        buttons: [{ label: 'оплачено', value: 'pay:ok' }],
      };
    }
  }

  return { log, pending, vars: cur.vars };
}

// ---------------- Данные бота: клиенты и таблицы ----------------
// У каждого бота своя база: клиенты (кто писал боту и что о нём известно) и
// коллекции — таблицы, которые автор описывает сам (заказы, заявки, записи).
// Внешние базы для этого не нужны: пишет блок «Данные», смотрит автор в интерфейсе.

function makeDataOps(db: D1Database, botId: string): DataOps {
  return {
    add: (collectionId, fields, userId) => collectionAdd(db, botId, collectionId, userId ?? null, fields),
    find: (collectionId, where, limit) => collectionFind(db, botId, collectionId, where, limit),
    update: (collectionId, where, patch) => collectionUpdate(db, botId, collectionId, where, patch),
    remove: (collectionId, where) => collectionRemove(db, botId, collectionId, where),
  };
}

// Операции с тегами пользователя (F2). Как и makeDataOps — движок получает их
// снаружи и остаётся чистым. Имя тега нормализуем на входе, чтобы в базе и в
// сравнении условия было одно и то же значение.
function makeTagOps(db: D1Database, botId: string): TagOps {
  return {
    add: async (tag, userId) => {
      await addUserTag(db, botId, userId, normalizeTag(tag));
    },
    remove: async (tag, userId) => {
      await removeUserTag(db, botId, userId, normalizeTag(tag));
    },
    clear: (userId) => clearUserTags(db, botId, userId),
    list: (userId) => listUserTags(db, botId, userId),
    has: (tag, userId) => hasUserTag(db, botId, userId, normalizeTag(tag)),
  };
}

// Публичный origin воркера: из него собираются платёжные webhook-ссылки
// (провайдер должен знать, куда слать подтверждения).
function webhookOrigin(reqUrl: string): string {
  try {
    return new URL(reqUrl).origin;
  } catch {
    return '';
  }
}

// Пакет новых ops для движка: один вызов на все наборы, чтобы webhook,
// dispatchOuts, resumeFrom и processDue передавали их одной переменной.
function makeEngineOps(
  env: Env,
  botId: string,
  token: string,
  userId: number,
  webhookBase: string
): { channels: ChannelOps; counters: CounterOps; users: UserOps; broadcast: BroadcastOps; payments: PaymentOps; schedules: ScheduleOps } {
  return {
    channels: makeChannelOps(token),
    counters: makeCounterOps(env.DB, botId),
    users: makeUserOps(env.DB, botId),
    broadcast: makeBroadcastOps(env, botId, token, userId),
    payments: makePaymentOps(env, botId, webhookBase),
    schedules: makeScheduleOps(env, botId, userId),
  };
}

// Регистрация расписаний (§4). Движок не считает время: он отдаёт определение
// блока, а здесь оно превращается в cron_expr (shared/cron.ts) и строку
// bot_schedules. Лимит MAX_SCHEDULES_PER_BOT не даёт одному боту занять весь
// тик крона; повторная регистрация того же блока — апсерт (время можно менять).
function makeScheduleOps(env: Env, botId: string, userId: number): ScheduleOps {
  return {
    async register(def: ScheduleDef) {
      const gen = scheduleToCron({
        scheduleKind: def.scheduleKind,
        atTime: def.atTime,
        weekdays: def.weekdays,
        everyMinutes: def.everyMinutes,
        cronExpr: def.cronExpr,
      });
      if (!gen.ok) {
        await logEvent(env.DB, botId, userId, `schedule.invalid.${def.blockId}`).catch(() => {});
        return { status: 'invalid' as const, count: await countBotSchedules(env.DB, botId).catch(() => 0) };
      }
      const existing = await getScheduleByBlock(env.DB, botId, def.blockId).catch(() => null);
      if (!existing) {
        const count = await countBotSchedules(env.DB, botId).catch(() => 0);
        if (count >= MAX_SCHEDULES_PER_BOT) {
          await logEvent(env.DB, botId, userId, `schedule.limit.${def.blockId}`).catch(() => {});
          return { status: 'limit' as const, count };
        }
      }
      await upsertSchedule(env.DB, {
        id: crypto.randomUUID(),
        bot_id: botId,
        block_id: def.blockId,
        cron_expr: gen.cronExpr,
        timezone: def.timezone,
        audience: def.audience,
        audience_tag: def.audienceTag,
        audience_user: def.audience === 'single' ? def.userId : null,
        created_at: Date.now(),
      });
      const count = await countBotSchedules(env.DB, botId).catch(() => 0);
      await logEvent(env.DB, botId, userId, `schedule.registered.${def.blockId}`).catch(() => {});
      return { status: 'ok' as const, count };
    },
  };
}

// ---------- новые ops наборa 2026-09 (движок остаётся чистым) ----------

// Проверка членства в канале через getChatMember. Токен передаём сюда, потому
// что канал — это не D1, а Telegram: движку важен только ответ.
function makeChannelOps(token: string): ChannelOps {
  return {
    async isMember(chatId, userId) {
      const res = await tgCall(token, 'getChatMember', { chat_id: chatId, user_id: userId });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { status?: string } };
      if (!data.ok) throw new Error('getChatMember failed');
      const status = data.result?.status ?? '';
      // Статусы Telegram: creator/administrator/member — в канале;
      // left/kicked — нет. restricted считаем «состоит», но ограничен.
      return status === 'creator' || status === 'administrator' || status === 'member' || status === 'restricted';
    },
  };
}

// Счётчики: движок отдаёт имя/область, здесь атомарные операции D1.
function makeCounterOps(db: D1Database, botId: string): CounterOps {
  return {
    inc: (name, scope, userId, amount) => counterInc(db, botId, scope, scopeIdOf(scope, userId), name, amount),
    dec: (name, scope, userId, amount) => counterDec(db, botId, scope, scopeIdOf(scope, userId), name, amount),
    reset: (name, scope, userId) => counterReset(db, botId, scope, scopeIdOf(scope, userId), name),
    get: (name, scope, userId) => counterGet(db, botId, scope, scopeIdOf(scope, userId), name),
  };
}

// scope 'bot' — счётчик один на бота, поэтому его id пустой.
function scopeIdOf(scope: 'user' | 'bot', userId: number): string {
  return scope === 'bot' ? '' : String(userId || '');
}

// Подписан ли человек на бота. Отдельный маленький запрос: тащить сюда весь
// ReferralOps ради одного факта было бы лишним round-trip'ом.
async function hasSubscriber(db: D1Database, botId: string, userId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS hit FROM subscribers WHERE bot_id = ? AND user_id = ?')
    .bind(botId, userId)
    .first<{ hit: number }>();
  return !!row?.hit;
}

// Сумма оплат пользователя в минимальных единицах. Источник — referral_payments:
// туда пишут и successful_payment, и подтверждённые вебхуки, поэтому это единая
// точка правды о деньгах пользователя.
async function paymentTotal(db: D1Database, botId: string, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM referral_payments WHERE bot_id = ? AND user_id = ?')
    .bind(botId, userId)
    .first<{ s: number }>();
  return Number(row?.s ?? 0);
}

// Профиль пользователя для user_stats и условий source: 'user'. Собираем из
// уже существующих данных: сессия (имя/@username/first_seen), теги, подписка,
// платежи и число приглашённых. Отдельной таблицы профиля нет и не нужно.
function makeUserOps(db: D1Database, botId: string): UserOps {
  return {
    async profile(userId) {
      const uid = String(userId);
      const [client, tags, subscribed, paid, refCount] = await Promise.all([
        getClient(db, botId, userId).catch(() => null),
        listUserTags(db, botId, userId).catch(() => [] as string[]),
        hasSubscriber(db, botId, userId).catch(() => false),
        paymentTotal(db, botId, uid).catch(() => 0),
        countInvited(db, botId, uid).catch(() => 0),
      ]);
      return {
        name: client?.first_name ?? '',
        username: client?.username ? `@${client.username}` : '',
        id: userId,
        tags,
        subscription: !!subscribed,
        paidTotal: Number(paid) || 0,
        refCount: Number(refCount) || 0,
        firstSeen: client?.first_seen ?? null,
      };
    },
  };
}

// Рассылка по сегменту. ВАЖНО: никогда не отправляет сообщения прямо в вебхуке —
// считает получателей, режет на пачки и кладёт их в существующую очередь
// scheduled_sends (её разгребает тот же крон processDue, что и delay).
function makeBroadcastOps(env: Env, botId: string, token: string, userId: number): BroadcastOps {
  return {
    async enqueue(segment, payload) {
      // Дневной лимит: считается по боту, живёт в broadcast_counters.
      const day = new Date().toISOString().slice(0, 10);
      const cap = Math.max(0, Math.floor(Number(payload.dailyCap) || 0));

      const users = await segmentUsers(env.DB, botId, segment);
      if (!users.length) return 0;

      // ES-10: атомарный bump ПЕРЕД постановкой в очередь (tryBumpBroadcastCounter
      // проверяет cap одним SQL). Раньше счётчик читался, очередь ставилась, и
      // bump писался после — два параллельных enqueue превышали dailyCap.
      // Бюджет списывается до постановки: сбой insertScheduledBatch оставляет
      // бюджет списанным (консервативно — гонка капа дороже редкого перерасхода).
      // Отказ — ЦЕЛИКОМ на рассылку (без прежней обрезки slice до остатка):
      // контракт tryBumpBroadcastCounter «ok=false → Дневной лимит исчерпан».
      const list = users;
      if (cap > 0) {
        const bump = await tryBumpBroadcastCounter(env.DB, botId, day, users.length, cap).catch(() => null);
        if (!bump || !bump.ok) {
          console.warn(`[broadcast] Дневной лимит рассылки исчерпан (bot ${botId}, cap ${cap}, запрошено ${users.length})`);
          await logEvent(env.DB, botId, userId, 'segment.daily_cap').catch(() => {});
          return 0;
        }
      }

      // Пачки: размер задаёт автор, но не больше существующего BROADCAST_CHUNK —
      // иначе один тик крона выдаст слишком много запросов к Telegram.
      const chunk = Math.min(
        BROADCAST_CHUNK,
        Math.max(1, Math.floor(Number(payload.chunkSize) || BROADCAST_CHUNK))
      );
      const delayMs = Math.max(0, Math.floor(Number(payload.delayMs) || 0));
      const rows: BroadcastChunk[] = [];
      let i = 0;
      for (let s = 0; s < list.length; s += chunk) {
        rows.push({
          bot_id: botId,
          user_id: userId,
          // Разносим пачки по времени: Telegram не любит залпы по 20 сообщений.
          send_at: Date.now() + i * (delayMs || 2000),
          method: 'broadcast',
          payload_json: JSON.stringify({
            text: payload.text,
            users: list.slice(s, s + chunk),
            ...(payload.mediaUrl ? { mediaUrl: payload.mediaUrl } : {}),
            ...(payload.parseMode && payload.parseMode !== 'none' ? { parseMode: payload.parseMode } : {}),
          }),
        });
        i++;
      }
      await insertScheduledBatch(env.DB, rows);
      await logEvent(env.DB, botId, userId, `segment.queued.${list.length}`).catch(() => {});
      void token;
      return list.length;
    },
  };
}

// Получатели сегмента: тег и/или условия по переменным сессии.
// Фильтра нет вовсе — значит «всем подписчикам» (это осознанное решение автора).
async function segmentUsers(db: D1Database, botId: string, segment: BroadcastSegment): Promise<number[]> {
  const tag = normalizeTag(segment.tag || '');
  let users: number[];
  if (tag) {
    users = await listUserIdsByTag(db, botId, tag, 5000).catch(() => [] as number[]);
  } else {
    users = await listSubscribers(db, botId).catch(() => [] as number[]);
  }
  const conds = (segment.conditions || []).filter((c) => c && String(c.var ?? '').trim());
  if (!conds.length) return users;
  return filterUsersByConditions(db, botId, users, conds);
}

// Условия сегмента проверяются по vars_json сессий. Сравнение — та же логика,
// что у блока «Условие» (matchesSeeders: регистр и trim не важны).
async function filterUsersByConditions(
  db: D1Database,
  botId: string,
  users: number[],
  conds: ConditionDef[]
): Promise<number[]> {
  if (!users.length) return [];
  const out: number[] = [];
  // Читаем сессии пачками по id: у D1 есть предел на число параметров, а
  // получателей может быть тысячи.
  const BATCH = 200;
  for (let i = 0; i < users.length; i += BATCH) {
    const slice = users.slice(i, i + BATCH);
    const placeholders = slice.map(() => '?').join(',');
    const rows =
      (
        await db
          .prepare(`SELECT user_id, vars_json FROM sessions WHERE bot_id = ? AND user_id IN (${placeholders})`)
          .bind(botId, ...slice)
          .all<{ user_id: number; vars_json: string }>()
          .catch(() => null)
      )?.results ?? [];
    const byId = new Map<number, Record<string, unknown>>();
    for (const r of rows) {
      try {
        byId.set(r.user_id, JSON.parse(r.vars_json || '{}') as Record<string, unknown>);
      } catch {
        byId.set(r.user_id, {});
      }
    }
    for (const uid of slice) {
      const vars = byId.get(uid) ?? {};
      const ok = conds.every((c) => {
        const op = c.op || '==';
        const left = String(vars[String(c.var)] ?? '');
        return segmentOp(left, op, String(c.value ?? ''));
      });
      if (ok) out.push(uid);
    }
  }
  return out;
}

// Операторы для фильтра сегмента. Числа сравниваются численно, строки — как
// строки; in/not_in — список через запятую. Пусто трактуется как ''.
function segmentOp(left: string, op: string, right: string): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case 'contains':
      return left.includes(right);
    case 'empty':
      return left === '';
    case 'not_empty':
      return left !== '';
    case 'starts_with':
      return right !== '' && left.startsWith(right);
    case 'ends_with':
      return right !== '' && left.endsWith(right);
    case 'in':
    case 'not_in': {
      const list = right.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const hit = list.includes(left.trim().toLowerCase());
      return op === 'in' ? hit : !hit;
    }
    case '>':
    case '<':
    case '>=':
    case '<=': {
      const ln = Number(left);
      const rn = Number(right);
      if (Number.isFinite(ln) && Number.isFinite(rn) && left.trim() !== '' && right.trim() !== '') {
        if (op === '>') return ln > rn;
        if (op === '<') return ln < rn;
        if (op === '>=') return ln >= rn;
        return ln <= rn;
      }
      if (op === '>') return left > right;
      if (op === '<') return left < right;
      if (op === '>=') return left >= right;
      return left <= right;
    }
    case 'regex': {
      try {
        return new RegExp(right).test(left);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

// ---------------- платежи: подключения владельца ----------------
//
// Принцип платформы (повторяем в каждом месте про платежи): платформа НЕ
// использует свой платёжный аккаунт, не проксирует деньги и никогда не видит
// данные карт. Каждый владелец бота подключает СВОЕГО провайдера, а платформа
// только хранит конфиг подключения (не секретный открыто, секретный —
// зашифрованным), собирает ссылки и проверяет подписи вебхуков.

// Загрузка подключения владельцем: бот должен принадлежать тому, кто просит.
async function loadOwnedBotById(c: any, botId: string): Promise<BotRow | Response> {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const bot = await getBot(c.env.DB, botId);
  if (!bot) return json({ error: 'бот не найден' }, 404);
  if (!id.admin && (!id.user || bot.owner_id !== id.user.id)) return json({ error: 'бот не найден' }, 404);
  return bot;
}

// Ожидаемая JSON-схема секретов провайдера. Всё, что не перечислено, отбрасываем:
// в secrets_enc не должно попасть что-то случайное.
const SECRET_KEYS = ['providerToken', 'secretKey', 'password1', 'password2', 'webhookSecret'] as const;

function sanitizeSecretsInput(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const k of SECRET_KEYS) {
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) out[k] = s.slice(0, 512);
  }
  return out;
}

// Маска секрета для ответа: НИКОГДА не отдаём значение, только факт наличия.
function maskSecrets(secrets: PaymentSecrets): { has: boolean; keys: string[] } {
  const keys = Object.keys(secrets).filter((k) => !!secrets[k as keyof typeof secrets]);
  return { has: keys.length > 0, keys };
}

// Секреты подключения лежат в secrets_enc ШИФРОТЕКСТОМ (AES-256-GCM):
// parseSecrets от сырого блоба молча вернул бы {}, и любая проверка подписи
// «не совпала». Сначала расшифровка, потом JSON. Пустой/битый блоб — это {}
// (подключение без секретов), а не исключение: вебхук обязан отдавать 4xx, не 500.
async function readSecrets(raw: string, key: string): Promise<PaymentSecrets> {
  if (!raw) return {};
  try {
    return parseSecrets(await decryptToken(raw, key));
  } catch {
    return {};
  }
}

// Разбор не секретного конфига: только известные поля и только строки.
function sanitizeConfigInput(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  const allowed = ['shopId', 'successUrl', 'failUrl', 'linkTemplate'];
  for (const k of allowed) {
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim().slice(0, 512);
    if (s) out[k] = s;
  }
  if ((input as Record<string, unknown>).testMode) out.testMode = '1';
  return out;
}

const PAYMENT_PROVIDERS: PaymentProvider[] = ['telegram', 'yookassa', 'robokassa', 'stripe', 'custom'];

function isPaymentProvider(v: unknown): v is PaymentProvider {
  return typeof v === 'string' && (PAYMENT_PROVIDERS as string[]).includes(v);
}

// Публичный путь вебхука: непрозрачный случайный идентификатор. Провайдеру он
// сообщается владельцем; по нему мы находим подключение, ничего не раскрывая.
// ЛЕГАСИ (миграция 0018): для маршрутизации больше не используется, значение
// по-прежнему генерируется при создании, потому что колонка NOT NULL UNIQUE.
function randomWebhookPath(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(36).padStart(2, '0');
  return s.slice(0, 32);
}

// Короткий публичный код вебхука (миграция 0022): /p/<token> вместо длинного
// /pay/:botId/:webhookPath. Алфавит без визуально неразличимых символов
// (0/O/1/l/I) — адрес вводят руками в кабинете провайдера. 10 символов из
// алфавита 31 = ~50 бит энтропии, криптослучайные байты.
const TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TOKEN_LENGTH = 10;

export function randomWebhookToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  let s = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) s += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return s;
}

// Генерация с защитой от коллизии уникального индекса: несколько попыток,
// потом честная ошибка (конфликт ~31^-10 на пару практически невозможен).
async function generateUniqueWebhookToken(db: D1Database, attempts = 5): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const token = randomWebhookToken();
    const taken = await db
      .prepare('SELECT id FROM payment_connections WHERE webhook_token = ?')
      .bind(token)
      .first<{ id: string }>();
    if (!taken) return token;
  }
  throw new Error('не удалось сгенерировать уникальный адрес вебхука');
}

// Публичный базовый адрес вебхуков: кастомный домен из PAY_WEBHOOK_BASE,
// фолбэк — origin запроса (локальная разработка, wrangler dev).
function payWebhookBase(env: Env, reqUrl: string): string {
  const configured = (env.PAY_WEBHOOK_BASE ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return webhookOrigin(reqUrl);
}

// Асинхронный: маска секрета должна показывать ИМЕНА сохранённых ключей, а они
// лежат в шифртексте — расшифровываем локально и наружу отдаём только маску.
// webhookBase отдаётся фронту, чтобы тот не хардкодил публичный хост.
async function paymentConnectionView(row: PaymentConnectionRow, key: string, webhookBase: string): Promise<Record<string, unknown>> {
  return {
    id: row.id,
    provider: row.provider,
    title: row.title,
    config: parseConfig(row.config_json),
    secrets: maskSecrets(await readSecrets(row.secrets_enc, key)),
    webhook_token: row.webhook_token ?? null,
    webhookBase,
    enabled: !!row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Ленивый бэкфилл легаси-строк (миграция 0022): у подключения без токена
// генерируем и сохраняем его одним UPDATE с guard'ом IS NULL — идемпотентно
// под конкурентными запросами. Возвращает строку уже с токеном.
async function withWebhookToken(db: D1Database, row: PaymentConnectionRow): Promise<PaymentConnectionRow> {
  if (row.webhook_token) return row;
  const token = await generateUniqueWebhookToken(db);
  const claimed = await ensureWebhookToken(db, row.id, token);
  if (claimed) return { ...row, webhook_token: token };
  // Гонка: токен записал другой запрос — перечитываем.
  const fresh = await db
    .prepare('SELECT * FROM payment_connections WHERE id = ?')
    .bind(row.id)
    .first<PaymentConnectionRow>();
  return fresh ?? { ...row, webhook_token: token };
}

// Список подключений: секреты только маской. Легаси-строки без токена
// получают его здесь (ленивый бэкфилл).
app.get('/api/bots/:id/payments/connections', async (c) => {
  const bot = await loadOwnedBotById(c, c.req.param('id'));
  if (isResponse(bot)) return bot;
  const rows = await listPaymentConnections(c.env.DB, bot.id);
  const withTokens = await Promise.all(rows.map((r) => withWebhookToken(c.env.DB, r)));
  const base = payWebhookBase(c.env, c.req.url);
  return json({ connections: await Promise.all(withTokens.map((r) => paymentConnectionView(r, c.env.ENCRYPTION_KEY, base))) });
});

// Создание подключения. Секреты принимаются ОДИН раз и шифруются сразу —
// наружу они больше не вернутся даже владельцу.
app.post('/api/bots/:id/payments/connections', async (c) => {
  const bot = await loadOwnedBotById(c, c.req.param('id'));
  if (isResponse(bot)) return bot;
  const body = await c.req.json<{ provider?: string; title?: string; config?: unknown; secrets?: unknown }>().catch(() => null);
  if (!isAllowedProvider(body?.provider)) return json({ error: "provider: telegram|yookassa|robokassa|stripe|custom" }, 400);
  const secrets = sanitizeSecretsInput(body?.secrets);
  const config = sanitizeConfigInput(body?.config);
  const now = Date.now();
  const row: PaymentConnectionRow = {
    id: crypto.randomUUID(),
    bot_id: bot.id,
    provider: body!.provider as PaymentProvider,
    title: String(body?.title ?? '').trim().slice(0, 64) || providerLabel(body!.provider as PaymentProvider),
    config_json: JSON.stringify(config),
    secrets_enc: Object.keys(secrets).length ? await encryptToken(JSON.stringify(secrets), c.env.ENCRYPTION_KEY) : '',
    webhook_path: randomWebhookPath(),
    // Новый публичный адрес вебхука /p/<token> выдаётся сразу при создании.
    webhook_token: await generateUniqueWebhookToken(c.env.DB),
    enabled: 1,
    created_at: now,
    updated_at: now,
  };
  await insertPaymentConnection(c.env.DB, row);
  await logEvent(c.env.DB, bot.id, null, `payments.connection.created.${row.provider}`).catch(() => {});
  return json({ connection: await paymentConnectionView(row, c.env.ENCRYPTION_KEY, payWebhookBase(c.env, c.req.url)) });
});

// Обновление: пустой секрет = «оставить прежний». Владелец может поправить
// заголовок или URL, не вводя ключ заново.
app.put('/api/bots/:id/payments/connections/:cid', async (c) => {
  const bot = await loadOwnedBotById(c, c.req.param('id'));
  if (isResponse(bot)) return bot;
  const cid = c.req.param('cid');
  const existing = await getPaymentConnection(c.env.DB, bot.id, cid);
  if (!existing) return json({ error: 'подключение не найдено' }, 404);
  const body = await c.req.json<{ title?: string; config?: unknown; secrets?: unknown; enabled?: unknown }>().catch(() => null);
  const patch: { title?: string; config_json?: string; secrets_enc?: string; enabled?: number } = {};
  if (body?.title !== undefined) patch.title = String(body.title).trim().slice(0, 64);
  if (body?.config !== undefined) patch.config_json = JSON.stringify(sanitizeConfigInput(body.config));
  if (body?.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
  const secrets = sanitizeSecretsInput(body?.secrets);
  if (Object.keys(secrets).length) {
    // Сливаем с уже сохранёнными: правка одного ключа не должна стирать остальные.
    const prev = await readSecrets(existing.secrets_enc, c.env.ENCRYPTION_KEY);
    const merged = { ...prev, ...secrets };
    patch.secrets_enc = await encryptToken(JSON.stringify(merged), c.env.ENCRYPTION_KEY);
  }
  const ok = await updatePaymentConnection(c.env.DB, bot.id, cid, patch);
  if (!ok) return json({ error: 'нечего обновлять' }, 400);
  const fresh = await getPaymentConnection(c.env.DB, bot.id, cid);
  await logEvent(c.env.DB, bot.id, null, 'payments.connection.updated').catch(() => {});
  return json({ connection: fresh ? await paymentConnectionView(fresh, c.env.ENCRYPTION_KEY, payWebhookBase(c.env, c.req.url)) : null });
});

// Ротация публичного адреса вебхука: старый токен мгновенно перестаёт работать
// (строка перезаписана), владелец обязан обновить адрес в кабинете провайдера.
// Владелец-scoped (loadOwnedBotById, как у соседних роутов).
app.post('/api/bots/:id/payments/connections/:cid/regenerate-webhook', async (c) => {
  const bot = await loadOwnedBotById(c, c.req.param('id'));
  if (isResponse(bot)) return bot;
  const cid = c.req.param('cid');
  const existing = await getPaymentConnection(c.env.DB, bot.id, cid);
  if (!existing) return json({ error: 'подключение не найдено' }, 404);
  const token = await generateUniqueWebhookToken(c.env.DB);
  const ok = await rotateWebhookToken(c.env.DB, bot.id, cid, token);
  if (!ok) return json({ error: 'подключение не найдено' }, 404);
  const fresh = await getPaymentConnection(c.env.DB, bot.id, cid);
  // В журнал — только факт ротации, без значений токенов.
  await logEvent(c.env.DB, bot.id, null, 'payments.connection.webhook.rotated').catch(() => {});
  return json({
    ok: true,
    webhook_token: token,
    connection: fresh ? await paymentConnectionView(fresh, c.env.ENCRYPTION_KEY, payWebhookBase(c.env, c.req.url)) : null,
  });
});

app.delete('/api/bots/:id/payments/connections/:cid', async (c) => {
  const bot = await loadOwnedBotById(c, c.req.param('id'));
  if (isResponse(bot)) return bot;
  const ok = await deletePaymentConnection(c.env.DB, bot.id, c.req.param('cid'));
  if (!ok) return json({ error: 'подключение не найдено' }, 404);
  await logEvent(c.env.DB, bot.id, null, 'payments.connection.deleted').catch(() => {});
  return json({ ok: true });
});

// Проверка подключения: честная — формат полей (validateConnectionInput) и,
// где у провайдера есть read-only API, живой запрос к нему (liveCheckConnection).
// Для Telegram Payments и custom внешнего API нет: максимум — форматная
// валидация, поэтому mode='format-only'. Значения полей и ключи не логируются.
app.post('/api/bots/:id/payments/connections/:cid/check', async (c) => {
  const bot = await loadOwnedBotById(c, c.req.param('id'));
  if (isResponse(bot)) return bot;
  const row = await getPaymentConnection(c.env.DB, bot.id, c.req.param('cid'));
  if (!row) return json({ error: 'подключение не найдено' }, 404);
  const config = parseConfig(row.config_json);
  const secrets = await readSecrets(row.secrets_enc, c.env.ENCRYPTION_KEY);
  const { problems } = validateConnectionInput({ provider: row.provider, config, secrets });
  const mode = checkModeFor(row.provider);
  let providerStatus: number | undefined;
  // Точное событие журнала: verified / format_only / provider_error / unreachable.
  let liveEvent: string | null = null;
  if (problems.length === 0 && mode === 'live') {
    const live = await liveCheckConnection(row.provider, config, secrets);
    providerStatus = live.providerStatus;
    if (live.outcome === 'verified') {
      liveEvent = 'verified';
    } else {
      // Поле, которым проверяли у провайдера: robokassa — Password2, остальные — ключ.
      problems.push({ field: row.provider === 'robokassa' ? 'password2' : 'secretKey', kind: 'provider', message: live.message });
      liveEvent = live.outcome === 'unreachable' ? 'unreachable' : 'provider_error';
    }
  }
  const ok = problems.length === 0 && (mode === 'format-only' || liveEvent === 'verified');
  if (ok && mode === 'format-only') liveEvent = 'format_only';
  await logEvent(c.env.DB, bot.id, null, `payments.connection.check.${ok ? 'ok' : 'fail'}`).catch(() => {});
  if (liveEvent) await logEvent(c.env.DB, bot.id, null, `payments.connection.check.${liveEvent}`).catch(() => {});
  return json({ ok, provider: row.provider, mode, problems, ...(providerStatus !== undefined ? { providerStatus } : {}) });
});

function isAllowedProvider(v: unknown): boolean {
  return isPaymentProvider(v);
}

function providerLabel(p: PaymentProvider): string {
  switch (p) {
    case 'telegram':
      return 'Telegram Payments';
    case 'yookassa':
      return 'ЮKassa';
    case 'robokassa':
      return 'Robokassa';
    case 'stripe':
      return 'Stripe';
    default:
      return 'Свой провайдер';
  }
}

// Платёжные операции для движка: создать заказ и прочитать его статус. Секреты
// провайдера здесь расшифровываются локально и НЕ попадают ни в ответ, ни в лог.
function makePaymentOps(env: Env, botId: string, webhookBase: string): PaymentOps {
  return {
    async create(connectionId, params): Promise<PaymentOrderInfo | null> {
      const conn = await getPaymentConnection(env.DB, botId, connectionId);
      if (!conn || !conn.enabled) return null;
      const config = parseConfig(conn.config_json);
      const secrets = await readSecrets(conn.secrets_enc, env.ENCRYPTION_KEY);
      const orderId = crypto.randomUUID();
      // external_id — то, что уходит провайдеру и возвращается в вебхуке.
      // Для Telegram Payments это payload счёта, для остальных — наш orderId.
      const externalId = params.orderId && params.orderId.trim() ? params.orderId.trim().slice(0, 64) : orderId;
      const link = await createCheckoutLink({
        provider: conn.provider,
        config,
        secrets,
        orderId: externalId,
        amount: params.amount,
        currency: params.currency,
        description: params.description,
        botWebhookBase: webhookBase,
        connectionId: conn.id,
      });
      await insertPaymentOrder(env.DB, {
        id: orderId,
        bot_id: botId,
        connection_id: conn.id,
        user_id: params.userId,
        external_id: externalId,
        amount: params.amount,
        currency: params.currency,
        status: 'created',
        // blockId/successNext: публичный вебхук после подтверждения оплаты
        // возобновляет сценарий пользователя с точки payment_link.successNext.
        payload_json: JSON.stringify({
          link,
          provider: conn.provider,
          ...(params.blockId ? { blockId: params.blockId } : {}),
          ...(params.successNext ? { successNext: params.successNext } : {}),
        }),
      });
      await logEvent(env.DB, botId, params.userId, `payment.created.${params.amount}`).catch(() => {});
      return {
        id: orderId,
        externalId,
        amount: params.amount,
        currency: params.currency,
        status: 'created',
        link: link ?? '',
        provider: conn.provider,
      };
    },

    async get(connectionId, orderRef): Promise<PaymentOrderInfo | null> {
      // Ищем и по нашему id, и по внешнему: движок кладёт в переменную
      // внешний id, а автор мог вписать и внутренний.
      const byExternal = await getPaymentOrderByExternalId(env.DB, botId, orderRef);
      const row = byExternal ?? (await getPaymentOrder(env.DB, botId, orderRef));
      if (!row || row.connection_id !== connectionId) return null;
      let link = '';
      let provider = '';
      try {
        const p = JSON.parse(row.payload_json || '{}') as { link?: string; provider?: string };
        link = String(p.link ?? '');
        provider = String(p.provider ?? '');
      } catch {
        /* payload повреждён — link/provider останутся пустыми */
      }
      return {
        id: row.id,
        externalId: row.external_id,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        link,
        provider,
      };
    },
  };
}

// ЮKassa не подписывает тело вебхука, поэтому единственный надёжный способ
// убедиться в событии — переспросить сам провайдер (API). Жёсткий IP-allowlist
// сознательно НЕ хардкодим: диапазоны ЮKassa меняются без уведомлений, а
// ложное отклонение реального платежа хуже, чем проверка через API, где
// источник истины — сам провайдер. IP отправителя уходит в лог события.
async function yookassaReverify(
  env: Env,
  config: { shopId?: string },
  secrets: { secretKey?: string },
  paymentId: string
): Promise<{ ok: boolean; status?: 'paid' | 'pending' | 'cancelled'; amount?: number; currency?: string; externalId?: string }> {
  if (!config.shopId || !secrets.secretKey || !paymentId) return { ok: false };
  try {
    const auth = btoa(`${config.shopId}:${secrets.secretKey}`);
    const res = await safeFetch(
      `https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`,
      { method: 'GET', headers: { authorization: `Basic ${auth}` } },
      env
    );
    if (!res.ok) return { ok: false };
    const data = JSON.parse(await readCapped(res)) as {
      status?: string;
      amount?: { value?: string | number; currency?: string };
      metadata?: { order_id?: string };
    };
    const status = data.status === 'succeeded' ? 'paid' : data.status === 'canceled' ? 'cancelled' : 'pending';
    return {
      ok: true,
      status,
      amount: data.amount?.value != null ? Math.round(Number(data.amount.value) * 100) : undefined,
      currency: String(data.amount?.currency ?? '').toUpperCase() || undefined,
      // id заказа берём из metadata ОТВЕТА ПРОВАЙДЕРА, а не из тела вебхука:
      // тело не подписано, и атакующий мог подставить в metadata.order_id
      // чужой заказ, оставив paymentId от своей реальной оплаты.
      externalId: data.metadata?.order_id != null ? String(data.metadata.order_id) : undefined,
    };
  } catch {
    return { ok: false };
  }
}

// ---------------- API подсценариев (библиотека владельца) ----------------
//
// Владелец-скоуп: обычный пользователь видит и правит только свои фрагменты;
// админский ключ (x-admin-key) ведёт себя как в остальных роутах — доступ ко
// всему. Чужой фрагмент — всегда 404 (не раскрываем существование).

// Имя входа/выхода: идентификатор переменной, точка разрешена (user.name).
const IO_NAME_RE = /^[A-Za-z_][\w.]*$/;

function sanitizeIo(input: unknown, what: string): { ok: true; value: SubflowIoDef[] } | { ok: false; error: string } {
  const arr = input == null ? [] : Array.isArray(input) ? input : null;
  if (!arr) return { ok: false, error: `${what}: нужен массив [{ name, description?, required? }]` };
  if (arr.length > 32) return { ok: false, error: `${what}: максимум 32` };
  const out: SubflowIoDef[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const name = String((x as any)?.name ?? '').trim().slice(0, 64);
    if (!name) return { ok: false, error: `${what}: пустое имя` };
    if (!IO_NAME_RE.test(name)) return { ok: false, error: `${what}: имя «${name}» недопустимо (латиница, цифры, _, точка; не начинается с цифры)` };
    if (seen.has(name)) return { ok: false, error: `${what}: имя «${name}» повторяется` };
    seen.add(name);
    out.push({ name, description: String((x as any)?.description ?? '').slice(0, 200), required: !!(x as any)?.required });
  }
  return { ok: true, value: out };
}

function subflowView(row: SubflowRow, usedBy?: number): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    revision: row.revision,
    flow_json: row.flow_json,
    inputs: parseIoJson(row.inputs_json),
    outputs: parseIoJson(row.outputs_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(usedBy != null ? { used_by_bots: usedBy } : {}),
  };
}

// ownerId для запроса: у админа без сессии — null (видит всё), иначе id пользователя.
function subflowOwner(id: Identity): string | null {
  return id.admin && !id.user ? null : id.user!.id;
}

app.get('/api/subflows', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owner = subflowOwner(id);
  // Админ без конкретного владельца список не получает: библиотека личная.
  if (owner == null) return json({ subflows: [] });
  const [rows, usage] = await Promise.all([
    listSubflows(c.env.DB, owner),
    subflowUsageCounts(c.env.DB, owner).catch(() => ({} as Record<string, number>)),
  ]);
  // «используют N ботов» — из одного ограниченного запроса, без N+1.
  return json({ subflows: rows.map((r) => subflowView(r, usage[r.id] ?? 0)) });
});

app.post('/api/subflows', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  if (!id.user) return json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ name?: string; description?: string; flow_json?: string; inputs?: unknown; outputs?: unknown }>().catch(() => null);
  const name = String(body?.name ?? '').trim().slice(0, 64);
  if (!name) return json({ error: 'нужно название фрагмента' }, 400);
  const flowRaw = typeof body?.flow_json === 'string' ? body.flow_json : '';
  if (!flowRaw) return json({ error: 'flow_json required' }, 400);
  if (flowRaw.length > MAX_SUBFLOW_BYTES) {
    return json({ error: `фрагмент больше ${Math.round(MAX_SUBFLOW_BYTES / 1024)} КБ — сохранить нельзя` }, 413);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(flowRaw);
  } catch {
    return json({ error: 'flow_json is not valid JSON' }, 400);
  }
  if (!validateScenarioShape(parsed)) return json({ error: 'fragment must have start + blocks' }, 400);
  const inputs = sanitizeIo(body?.inputs, 'inputs');
  if (!inputs.ok) return json({ error: inputs.error }, 400);
  const outputs = sanitizeIo(body?.outputs, 'outputs');
  if (!outputs.ok) return json({ error: outputs.error }, 400);
  const now = Date.now();
  const row: SubflowRow = {
    id: crypto.randomUUID(),
    owner_id: id.user.id,
    name,
    description: String(body?.description ?? '').trim().slice(0, 500),
    revision: 1,
    flow_json: flowRaw,
    inputs_json: JSON.stringify(inputs.value),
    outputs_json: JSON.stringify(outputs.value),
    created_at: now,
    updated_at: now,
  };
  // Первая ревизия сразу уходит в историю: восстановление работает с rev 1.
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO subflows (id, owner_id, name, description, revision, flow_json, inputs_json, outputs_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(row.id, row.owner_id, row.name, row.description, row.revision, row.flow_json, row.inputs_json, row.outputs_json, row.created_at, row.updated_at),
    c.env.DB
      .prepare(
        `INSERT INTO subflow_versions (id, subflow_id, revision, flow_json, inputs_json, outputs_json, name, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(`${row.id}:1`, row.id, 1, row.flow_json, row.inputs_json, row.outputs_json, row.name, now),
  ]);
  return json({ subflow: subflowView(row, 0) }, 201);
});

app.get('/api/subflows/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await getSubflow(c.env.DB, subflowOwner(id), c.req.param('id'));
  if (!row) return json({ error: 'фрагмент не найден' }, 404);
  return json({ subflow: subflowView(row) });
});

// Сохранение фрагмента: новая ревизия + строка истории. Боты, вызывающие
// фрагмент, НЕ меняются: их живые публикации раскрыты в scenario_builds, а
// вызовы показывают «устарел» до явного обновления автором (никогда авто).
app.put('/api/subflows/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const existing = await getSubflow(c.env.DB, subflowOwner(id), c.req.param('id'));
  if (!existing) return json({ error: 'фрагмент не найден' }, 404);
  const body = await c.req.json<{ name?: string; description?: string; flow_json?: string; inputs?: unknown; outputs?: unknown }>().catch(() => null);
  const name = body?.name !== undefined ? String(body.name).trim().slice(0, 64) : existing.name;
  if (!name) return json({ error: 'название не может быть пустым' }, 400);
  const flowRaw = body?.flow_json !== undefined ? String(body.flow_json) : existing.flow_json;
  if (flowRaw.length > MAX_SUBFLOW_BYTES) {
    return json({ error: `фрагмент больше ${Math.round(MAX_SUBFLOW_BYTES / 1024)} КБ — сохранить нельзя` }, 413);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(flowRaw);
  } catch {
    return json({ error: 'flow_json is not valid JSON' }, 400);
  }
  if (!validateScenarioShape(parsed)) return json({ error: 'fragment must have start + blocks' }, 400);
  const inputs = body?.inputs !== undefined ? sanitizeIo(body.inputs, 'inputs') : { ok: true as const, value: parseIoJson(existing.inputs_json) };
  if (!inputs.ok) return json({ error: inputs.error }, 400);
  const outputs = body?.outputs !== undefined ? sanitizeIo(body.outputs, 'outputs') : { ok: true as const, value: parseIoJson(existing.outputs_json) };
  if (!outputs.ok) return json({ error: outputs.error }, 400);
  const next: SubflowRow = {
    ...existing,
    name,
    description: body?.description !== undefined ? String(body.description).trim().slice(0, 500) : existing.description,
    flow_json: flowRaw,
    inputs_json: JSON.stringify(inputs.value),
    outputs_json: JSON.stringify(outputs.value),
  };
  const revision = await saveSubflowRevision(c.env.DB, next);
  return json({ ok: true, revision, subflow: subflowView({ ...next, revision }) });
});

app.delete('/api/subflows/:id', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await getSubflow(c.env.DB, subflowOwner(id), c.req.param('id'));
  if (!row) return json({ error: 'фрагмент не найден' }, 404);
  const ok = await deleteSubflow(c.env.DB, row.id);
  if (!ok) return json({ error: 'фрагмент не найден' }, 404);
  // Боты НЕ удаляем: вызовы становятся ошибками валидации subflow-missing с
  // id блока вызова (тот же принцип, что у «ссылки на удалённый блок»).
  return json({ ok: true });
});

app.get('/api/subflows/:id/versions', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await getSubflow(c.env.DB, subflowOwner(id), c.req.param('id'));
  if (!row) return json({ error: 'фрагмент не найден' }, 404);
  const versions = await listSubflowVersions(c.env.DB, row.id);
  return json({
    revision: row.revision,
    versions: versions.map((v) => ({ revision: v.revision, name: v.name, created_at: v.created_at, size: (v as any).size ?? 0, current: v.revision === row.revision })),
  });
});

// Восстановление ревизии: старое содержимое становится НОВОЙ ревизией —
// история не перезаписывается (как rollback сценария бота).
app.post('/api/subflows/:id/rollback', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await getSubflow(c.env.DB, subflowOwner(id), c.req.param('id'));
  if (!row) return json({ error: 'фрагмент не найден' }, 404);
  const body = await c.req.json<{ revision?: number }>().catch(() => null);
  const revision = Number(body?.revision);
  if (!Number.isInteger(revision) || revision < 1) return json({ error: 'revision: номер ревизии' }, 400);
  const v = await getSubflowVersion(c.env.DB, row.id, revision);
  if (!v) return json({ error: `ревизия ${revision} не найдена` }, 404);
  const next = await restoreSubflowRevision(c.env.DB, row.id, revision);
  if (next == null) return json({ error: `ревизия ${revision} не найдена` }, 404);
  const fresh = await getSubflow(c.env.DB, subflowOwner(id), row.id);
  return json({ ok: true, revision: next, subflow: fresh ? subflowView(fresh) : null });
});

// Прогон фрагмента ОТДЕЛЬНО от бота: настоящие движок и заглушки (как
// simulate), входы задаются образцами значений. Никакого D1/Telegram.
app.post('/api/subflows/:id/preview', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const row = await getSubflow(c.env.DB, subflowOwner(id), c.req.param('id'));
  if (!row) return json({ error: 'фрагмент не найден' }, 404);
  const body = await c.req.json<{ inputs?: Record<string, string>; steps?: string[] }>().catch(() => null);
  let frag: Scenario;
  try {
    frag = JSON.parse(row.flow_json) as Scenario;
    if (!validateScenarioShape(frag)) return json({ error: 'fragment must have start + blocks' }, 400);
  } catch {
    return json({ error: 'flow_json is not valid JSON' }, 400);
  }
  // Обёртка: синтетический вызов вокруг фрагмента — прогон идёт ЧЕРЕЗ
  // раскрытие, то есть ровно той же дорогой, что и публикация бота.
  const declaredInputs = parseIoJson(row.inputs_json);
  const sampleInputs: Record<string, string> = {};
  for (const inp of declaredInputs) {
    const v = body?.inputs?.[inp.name];
    sampleInputs[inp.name] = v != null ? String(v) : inp.name.startsWith('__') ? '' : `«${inp.name}»`;
  }
  const wrapper: Scenario = {
    version: 1,
    start: 'w_start',
    blocks: {
      w_start: { id: 'w_start', type: 'start', params: { command: '/start' }, next: 'w_call' },
      w_call: {
        id: 'w_call',
        type: 'subflow',
        params: { subflowId: row.id, alias: 'p', scope: 'isolated', inputs: sampleInputs },
        branches: { done: 'w_done', failed: 'w_fail' },
      },
      w_done: { id: 'w_done', type: 'message', params: { text: '[фрагмент выполнен]' } },
      w_fail: { id: 'w_fail', type: 'message', params: { text: '[сбой фрагмента]' } },
    },
  };
  const library: SubflowLibrary = {
    [row.id]: {
      id: row.id,
      name: row.name,
      revision: row.revision,
      flow_json: frag,
      inputs: declaredInputs,
      outputs: parseIoJson(row.outputs_json),
    },
  };
  const { scenario: expanded, issues } = expandSubflows(wrapper, library);
  if (issues.some((i) => i.level === 'error')) {
    return json({ ok: false, issues }, 422);
  }
  const steps = Array.isArray(body?.steps) ? body.steps.map(String).slice(0, 30) : ['/start'];
  if (!steps[0]) steps.unshift('/start');
  const sim = await simulateScenario(expanded, steps);
  return json({ ok: true, issues, ...sim });
});

// Сухая проверка вызовов подсценариев бота: статусы для бейджей холста
// (ok / outdated / missing / cycle). Ничего не меняет.
app.post('/api/bots/:id/subflow-check', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const body = await c.req.json<{ flow_json?: string }>().catch(() => null);
  let scenario: Scenario;
  if (body?.flow_json) {
    const parsed = parseScenarioBody(body.flow_json);
    if ('error' in parsed) return json({ error: parsed.error }, 400);
    scenario = parsed.scenario;
  } else {
    const sc = await loadScenario(c.env.DB, owned.id);
    if (!sc) return json({ error: 'нет сценария' }, 404);
    scenario = JSON.parse(sc.flow_json) as Scenario;
  }
  if (!scenarioHasSubflows(scenario)) return json({ calls: [] });
  const library = await loadSubflowLibrary(c.env.DB, owned.owner_id, scenario);
  return json({ calls: checkSubflowCalls(scenario, library) });
});

// ---------------- легаси-адрес вебхука: навсегда закрыт ----------------
//
// Старый длинный адрес /pay/:botId/:webhookPath раскрывал внутренний id бота и
// тащил workers.dev-хост в кабинет провайдера. Заменён на /p/<token>
// (миграция 0022). Роут отвечает 410 Gone БЕЗ единого обращения к D1/KV —
// событие на старый адрес не обрабатывается никогда; владелец обязан вставить
// новый адрес в кабинете провайдера (UI раздела «Оплата» об этом говорит).
app.post('/pay/:botId/:webhookPath', () =>
  json({ error: 'адрес устарел — возьмите новый в разделе «Оплата»' }, 410)
);

// ---------------- публичный платёжный вебхук ----------------
//
// POST /p/:token — сюда провайдер владельца шлёт подтверждения. token —
// короткий глобально уникальный код подключения (миграция 0022); bot id
// берётся из строки подключения, а не из URL.
// Порядок ОБЯЗАТЕЛЕН: сначала проверка подписи, потом любые чтения/записи БД
// (кроме поиска самого подключения — без него нечем проверять подпись).
// Ответы: 200 для принятого/уже обработанного события, 4xx для неверной
// подписи и неизвестного кода; НИКАКИХ 500 на битое тело — иначе провайдер
// долбит повторами. Секреты не попадают ни в один ответ и ни в один лог.
app.post('/p/:token', async (c) => {
  const token = c.req.param('token');
  try {
    const conn = await getPaymentConnectionByToken(c.env.DB, token);
    if (!conn) return json({ error: 'not found' }, 404);
    const botId = conn.bot_id;

    // Сырое тело нужно для подписи (HMAC считается по байтам, не по JSON).
    const rawBody = await c.req.text().catch(() => '');
    const config = parseConfig(conn.config_json);
    const secrets = await readSecrets(conn.secrets_enc, c.env.ENCRYPTION_KEY);
    const verified = await verifyWebhook({
      provider: conn.provider,
      connectionId: conn.id,
      botId,
      webhookPath: token,
      config,
      secrets,
      headers: c.req.raw.headers,
      rawBody,
      query: new URL(c.req.url).searchParams,
      clientIp: clientIp(c),
      now: Date.now(),
    });
    if (!verified.ok) {
      await logEvent(c.env.DB, botId, null, `payments.webhook.rejected.${conn.provider}`).catch(() => {});
      return json({ error: 'invalid signature' }, 400);
    }

    let status = verified.paymentStatus ?? 'pending';
    let amount = verified.amount;
    let currency = verified.currency;
    let externalId = String(verified.externalId ?? '');

    if (conn.provider === 'yookassa') {
      // Тело не подписано: доверяем только ответу API провайдера.
      const rev = await yookassaReverify(c.env, config, secrets, externalId);
      if (!rev.ok) {
        await logEvent(c.env.DB, botId, null, 'payments.webhook.reverify_fail').catch(() => {});
        return json({ error: 'unverified' }, 400);
      }
      status = rev.status ?? status;
      if (rev.amount != null) amount = rev.amount;
      if (rev.currency) currency = rev.currency;
      // Заказ ищем по order_id из ответа API: значение из неподписанного тела
      // вебхука могло быть подделано, чтобы подтвердить чужой заказ.
      if (rev.externalId) externalId = String(rev.externalId);
    }

    const order = externalId ? await getPaymentOrderByExternalId(c.env.DB, botId, externalId) : null;
    // Заказ не найден или принадлежит другому подключению — одинаковый 404,
    // чтобы ответ не раскрывал существование заказов.
    if (!order || order.connection_id !== conn.id) {
      await logEvent(c.env.DB, botId, null, 'payments.webhook.unknown_order').catch(() => {});
      return json({ error: 'not found' }, 404);
    }

    // Идемпотентность: повтор того же события (провайдеры ретраят агрессивно)
    // — это 200 без единой записи.
    if (order.status === 'paid') return json({ ok: true, status: 'paid' });

    // Сумме из запроса не верим: сверяем с заказом, который создал сам бот.
    if (amount != null && Number(amount) !== Number(order.amount)) {
      await logEvent(c.env.DB, botId, order.user_id, 'payments.webhook.amount_mismatch').catch(() => {});
      return json({ error: 'amount mismatch' }, 400);
    }
    if (currency && order.currency && currency.toUpperCase() !== order.currency.toUpperCase()) {
      await logEvent(c.env.DB, botId, order.user_id, 'payments.webhook.currency_mismatch').catch(() => {});
      return json({ error: 'currency mismatch' }, 400);
    }

    if (status !== 'paid') {
      // pending/failed/cancelled: фиксируем статус, сценарий не трогаем —
      // у автора для проверки есть блок payment_check.
      await updatePaymentOrderStatus(
        c.env.DB,
        botId,
        order.id,
        status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'pending'
      ).catch(() => {});
      await logEvent(c.env.DB, botId, order.user_id, `payments.webhook.status.${status}`).catch(() => {});
      return json({ ok: true, status });
    }

    // markPaymentOrderPaid атомарен (WHERE status <> 'paid'): два одинаковых
    // события в гонке дадут ровно одну успешную отметку, второй получит false.
    const marked = await markPaymentOrderPaid(c.env.DB, botId, order.id);
    if (!marked) return json({ ok: true, status: 'paid' });
    await logEvent(c.env.DB, botId, order.user_id, `payments.webhook.paid.${order.amount}`).catch(() => {});

    // Факт оплаты для реферальной системы — через существующий recordPayment,
    // чтобы first_payment/revenue-триггеры видели внешние оплаты так же,
    // как successful_payment.
    const refOps = makeReferralOps(c.env.DB, botId);
    await refOps.recordPayment(String(order.user_id), order.amount, order.currency, Date.now()).catch(() => {});

    // Переменные сессии и возобновление сценария с payment_link.successNext.
    const sess = await getSession(c.env.DB, botId, order.user_id).catch(() => null);
    const vars: Record<string, unknown> = sess?.vars_json ? JSON.parse(sess.vars_json) : {};
    vars[PAY_ORDER_VAR] = order.external_id;
    vars['payment'] = { status: 'paid', amount: order.amount, currency: order.currency, order: order.external_id };
    let currentBlock: string | null = sess?.current_block ?? null;

    let orderPayload: { successNext?: string | null } = {};
    try {
      orderPayload = JSON.parse(order.payload_json || '{}');
    } catch {
      /* payload повреждён — возобновления просто не будет */
    }
    const bot = await getBot(c.env.DB, botId).catch(() => null);
    const sc = orderPayload.successNext ? await loadScenario(c.env.DB, botId).catch(() => null) : null;
    if (bot && sc && orderPayload.successNext) {
      const scenario = JSON.parse(sc.flow_json) as Scenario;
      // Возобновляем, только если целевой блок всё ещё существует: сценарий
      // могли пересохранить между выставлением счёта и оплатой.
      if (scenario.blocks?.[orderPayload.successNext]) {
        try {
          const token = await decryptToken(bot.token_enc, c.env.ENCRYPTION_KEY);
          // Платформа бота: VK-бот после оплаты обязан слать сообщения в VK,
          // а не в Telegram (багфикс платформы: раньше шёл только tgCall).
          const orderPlatform = bot.platform === 'vk' ? 'vk' : 'telegram';
          const ops = makeEngineOps(c.env, botId, token, order.user_id, webhookOrigin(c.req.url));
          const result = await runEngine({
            scenario,
            update: {},
            session: { currentBlock: null, vars },
            startBlockId: orderPayload.successNext,
            data: makeDataOps(c.env.DB, botId),
            tags: makeTagOps(c.env.DB, botId),
            referral: refOps,
            ...ops,
          });
          const final = await dispatchOuts(
            c.env,
            token,
            botId,
            order.user_id,
            result.outs,
            { currentBlock: result.currentBlock, vars: result.vars },
            0,
            scenario,
            undefined, // botUsername
            undefined, // data
            undefined, // tags
            undefined, // referral
            ops,
            undefined, // cbqId — нет callback-контекста
            undefined, // defer
            undefined, // vkCtx
            orderPlatform
          );
          currentBlock = final.currentBlock;
          Object.assign(vars, final.vars);
        } catch {
          /* сценарий не возобновился — оплата всё равно зафиксирована */
        }
      }
    }
    await upsertSession(c.env.DB, botId, order.user_id, currentBlock, JSON.stringify(vars)).catch(() => {});
    return json({ ok: true, status: 'paid' });
  } catch {
    // Битое тело, битый JSON сессии, недоступный D1: 400, никогда не 500 —
    // иначе провайдер будет долбить повторами, а мы — падать.
    return json({ error: 'bad request' }, 400);
  }
});

// ---------------- публичный входящий вебхук (набор 2026-10) ----------------
//
// POST /wh/:token — событие внешней системы стартует сценарий с блока
// webhook_in. Токен выдаётся при публикации (bot_webhooks, миграция 0028) и
// НЕ раскрывает bot id. Тело раскладывается в wh.* переменные; пользователь
// берётся из body.user_id / body.chat_id (внешняя система знает, кому писать),
// иначе — событие без адресата отклоняется: слать «в никуда» Telegram не даст.
// Идемпотентность: event_id из тела (или заголовка X-Event-Id) — повтор того
// же события возвращает 200 без второго прохода. Ответы всегда 2xx/4xx,
// никогда 500: внешние системы ретраят агрессивно.
app.post('/wh/:token', async (c) => {
  const hookToken = c.req.param('token');
  try {
    const fails = await failCount(c.env, `wh:${hookToken}`);
    if (fails > RL_MAX) return json({ error: 'too many requests' }, 429);
    const hook = await getWebhookHookByToken(c.env.DB, hookToken);
    if (!hook) {
      await bumpFail(c.env, `wh:${hookToken}`);
      return json({ error: 'not found' }, 404);
    }
    const rawBody = await c.req.text().catch(() => '');
    let body: unknown = null;
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return json({ error: 'body must be JSON' }, 400);
      }
    }
    const obj = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const eventId = String(obj.event_id ?? c.req.header('x-event-id') ?? '').slice(0, 128);
    if (eventId) {
      const seen = await c.env.KV.get(`whseen:${hookToken}:${eventId}`).catch(() => null);
      if (seen) return json({ ok: true, duplicate: true });
    }
    const userId = Number(obj.user_id ?? obj.chat_id ?? obj.telegram_id);
    if (!Number.isFinite(userId) || userId <= 0) {
      await bumpFail(c.env, `wh:${hookToken}`);
      return json({ error: 'user_id required' }, 400);
    }
    const bot = await getBot(c.env.DB, hook.bot_id).catch(() => null);
    if (!bot) return json({ error: 'not found' }, 404);
    const sc = await loadScenario(c.env.DB, hook.bot_id).catch(() => null);
    const buildJson = sc ? await getScenarioBuild(c.env.DB, hook.bot_id, sc.version).catch(() => null) : null;
    const scenarioJson = buildJson ?? sc?.flow_json ?? null;
    if (!scenarioJson) return json({ error: 'not published' }, 409);
    const scenario = JSON.parse(scenarioJson) as Scenario;
    const entry = scenario.blocks?.[hook.scenario_block_id];
    if (!entry || entry.type !== 'webhook_in') {
      // Блок сняли или пересобрали после публикации: событие некуда вести.
      return json({ error: 'block gone' }, 409);
    }
    const vars: Record<string, unknown> = { ...extractWebhookVars(hook.fields, body) };
    vars['wh.event_id'] = eventId || '';
    const tgToken = await decryptToken(bot.token_enc, c.env.ENCRYPTION_KEY);
    const ops = makeEngineOps(c.env, hook.bot_id, tgToken, userId, webhookOrigin(c.req.url));
    const result = await runEngine({
      scenario,
      update: {},
      session: { currentBlock: null, vars: { ...vars, [CHAT_FALLBACK_VAR]: userId } },
      startBlockId: hook.scenario_block_id,
      data: makeDataOps(c.env.DB, hook.bot_id),
      tags: makeTagOps(c.env.DB, hook.bot_id),
      referral: makeReferralOps(c.env.DB, hook.bot_id),
      ...ops,
    });
    const final = await dispatchOuts(
      c.env,
      tgToken,
      hook.bot_id,
      userId,
      result.outs,
      { currentBlock: result.currentBlock, vars: result.vars },
      0,
      scenario,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      // F3-101: платформа бота — VK-боту исходящие уводятся в VK, а не в
      // Telegram (webhook_in был единственным call-сайтом без platform).
      bot.platform === 'vk' ? 'vk' : 'telegram'
    );
    await upsertSession(c.env.DB, hook.bot_id, userId, final.currentBlock, JSON.stringify(final.vars)).catch(() => {});
    await logEvent(c.env.DB, hook.bot_id, userId, `webhook_in.fired.${hook.scenario_block_id}`).catch(() => {});
    if (eventId) await c.env.KV.put(`whseen:${hookToken}:${eventId}`, '1', { expirationTtl: 86400 }).catch(() => {});
    await resetFail(c.env, `wh:${hookToken}`);
    return json({ ok: true });
  } catch {
    // Любая внутренняя ошибка — 400, не 500: внешняя система не должна
    // долбить повторами из-за нашей временной неисправности.
    return json({ error: 'bad request' }, 400);
  }
});

// Имена полей таблицы — они же имена переменных в {{...}}: только латиница/цифры/_.
const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

function parseFields(input: unknown): string[] | null {
  const arr = Array.isArray(input) ? input : [];
  if (arr.length > 20) return null;
  const out = arr.map((f) => String(f ?? '').trim()).filter(Boolean);
  if (out.length !== new Set(out).size) return null;
  if (out.some((f) => !FIELD_RE.test(f))) return null;
  return out;
}

// Значения записи режем по размеру: таблица автора не должна раздуваться
// до мегабайта на одну строку.
function sanitizeData(input: unknown, fields: string[]): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = new Set(fields);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!FIELD_RE.test(k)) return null;
    if (allowed.size && !allowed.has(k)) continue; // чужие поля не пишем
    out[k] = String(v ?? '').slice(0, 2000);
    if (Object.keys(out).length > 50) break;
  }
  return out;
}

// CSV с ';' и BOM: Excel иначе показывает русские имена кракозябрами.
const CSV_BOM = '\uFEFF';

// Начало ячейки с = + - @ (или tab/CR) в Excel и Sheets означает формулу:
// выгрузка с данными пользователей не должна её выполнять (SEC-02).
const CSV_FORMULA_START = /^[=+\-@\t\r]/;

function toCsv(header: string[], rows: string[][]): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    // Нейтрализуем формулу ведущим апострофом: ячейка остаётся текстом.
    const safe = CSV_FORMULA_START.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [header.map(esc).join(';')];
  for (const r of rows) lines.push(r.map(esc).join(';'));
  return CSV_BOM + lines.join('\r\n');
}

function csvResponse(filename: string, text: string): Response {
  return new Response(text, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Поля коллекции — это МАССИВ имён, а parseJsonSafe массивы отбрасывает
// (он для объектов переменных). Без отдельной функции список полей в ответе
// приезжал пустым объектом.
function parseFieldsJson(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function isoTs(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString() : '';
}

app.get('/api/bots/:id/clients', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const { rows, total } = await listClients(c.env.DB, owned.id, {
    q: String(c.req.query('q') ?? ''),
    limit: Number(c.req.query('limit') ?? 50),
    offset: Number(c.req.query('offset') ?? 0),
  });
  return json({
    total,
    rows: rows.map((r) => ({
      user_id: r.user_id,
      name: r.first_name ?? '',
      username: r.username ?? '',
      first_seen: r.first_seen ?? r.updated_at,
      last_seen: r.updated_at,
      block: r.current_block ?? '',
      vars: parseJsonSafe(r.vars_json),
    })),
  });
});

app.get('/api/bots/:id/clients.csv', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const { rows } = await listClients(c.env.DB, owned.id, { q: String(c.req.query('q') ?? ''), limit: 5000 });
  return csvResponse(
    `clients-${owned.id.slice(0, 8)}.csv`,
    toCsv(
      ['user_id', 'name', 'username', 'first_seen', 'last_seen', 'block', 'vars'],
      rows.map((r) => [
        String(r.user_id),
        r.first_name ?? '',
        r.username ?? '',
        isoTs(r.first_seen),
        isoTs(r.updated_at),
        r.current_block ?? '',
        r.vars_json ?? '{}',
      ])
    )
  );
});

// Правка карточки клиента руками: автор видит переменные сценария и может
// исправить значение, не заставляя человека заново проходить бота.
app.put('/api/bots/:id/clients/:userId', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId)) return json({ error: 'user_id должен быть числом' }, 400);
  const body = await c.req.json<{ vars?: Record<string, unknown> }>().catch(() => null);
  if (!body?.vars || typeof body.vars !== 'object' || Array.isArray(body.vars)) {
    return json({ error: 'нужен объект vars' }, 400);
  }
  const ok = await updateClientVars(c.env.DB, owned.id, userId, body.vars);
  if (!ok) return json({ error: 'клиент не найден' }, 404);
  return json({ ok: true });
});

// Полное удаление клиента — по его просьбе («удалите мои данные»).
// Чистим сессию, подписки, рефералку и записи в таблицах этого бота.
app.delete('/api/bots/:id/clients/:userId', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId)) return json({ error: 'user_id должен быть числом' }, 400);
  const changes = await deleteClient(c.env.DB, owned.id, userId);
  await logEvent(c.env.DB, owned.id, userId, 'client.deleted').catch(() => {});
  return json({ ok: true, changes });
});

app.get('/api/bots/:id/collections', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const [rows, counts] = await Promise.all([
    listCollections(c.env.DB, owned.id),
    countItemsByCollections(c.env.DB, owned.id),
  ]);
  return json({
    collections: rows.map((r) => ({
      id: r.id,
      name: r.name,
      fields: parseFieldsJson(r.fields_json),
      created_at: r.created_at,
      count: counts[r.id] ?? 0,
    })),
  });
});

app.post('/api/bots/:id/collections', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const body = await c.req.json<{ name?: string; fields?: unknown }>().catch(() => null);
  const name = String(body?.name ?? '').trim().slice(0, 64);
  if (!name) return json({ error: 'нужно название таблицы' }, 400);
  const fields = parseFields(body?.fields);
  if (!fields) return json({ error: 'поля: до 20 штук, латиница, цифры и _' }, 400);
  const row = {
    id: crypto.randomUUID(),
    bot_id: owned.id,
    name,
    fields_json: JSON.stringify(fields),
    created_at: Date.now(),
  };
  await insertCollection(c.env.DB, row);
  return json({ collection: { id: row.id, name, fields, created_at: row.created_at, count: 0 } });
});

app.put('/api/bots/:id/collections/:cid', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const cid = c.req.param('cid');
  const existing = await getCollection(c.env.DB, owned.id, cid);
  if (!existing) return json({ error: 'таблица не найдена' }, 404);
  const body = await c.req.json<{ name?: string; fields?: unknown }>().catch(() => null);
  const patch: { name?: string; fields_json?: string } = {};
  if (body?.name !== undefined) {
    const name = String(body.name).trim().slice(0, 64);
    if (!name) return json({ error: 'название не может быть пустым' }, 400);
    patch.name = name;
  }
  if (body?.fields !== undefined) {
    const fields = parseFields(body.fields);
    if (!fields) return json({ error: 'поля: до 20 штук, латиница, цифры и _' }, 400);
    patch.fields_json = JSON.stringify(fields);
  }
  await updateCollection(c.env.DB, owned.id, cid, patch);
  return json({ ok: true });
});

app.delete('/api/bots/:id/collections/:cid', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const cid = c.req.param('cid');
  const ok = await deleteCollection(c.env.DB, owned.id, cid);
  if (!ok) return json({ error: 'таблица не найдена' }, 404);
  return json({ ok: true });
});

app.get('/api/bots/:id/collections/:cid/items', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const cid = c.req.param('cid');
  const coll = await getCollection(c.env.DB, owned.id, cid);
  if (!coll) return json({ error: 'таблица не найдена' }, 404);
  const { rows, total } = await listCollectionItems(c.env.DB, owned.id, cid, {
    q: String(c.req.query('q') ?? ''),
    limit: Number(c.req.query('limit') ?? 50),
    offset: Number(c.req.query('offset') ?? 0),
  });
  const fields = parseFieldsJson(coll.fields_json);
  return json({
    total,
    fields,
    rows: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      data: parseJsonSafe(r.data_json),
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
});

app.get('/api/bots/:id/collections/:cid/items.csv', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const cid = c.req.param('cid');
  const coll = await getCollection(c.env.DB, owned.id, cid);
  if (!coll) return json({ error: 'таблица не найдена' }, 404);
  const fields = parseFieldsJson(coll.fields_json);
  const { rows } = await listCollectionItems(c.env.DB, owned.id, cid, { q: String(c.req.query('q') ?? ''), limit: 5000 });
  const header = ['created_at', 'user_id', ...fields];
  return csvResponse(
    `${String(coll.name).replace(/[^\wа-яёА-ЯЁ-]+/g, '_')}.csv`,
    toCsv(
      header,
      rows.map((r) => {
        const data = parseJsonSafe(r.data_json);
        return [isoTs(r.created_at), String(r.user_id ?? ''), ...fields.map((f) => String(data[f] ?? ''))];
      })
    )
  );
});

app.post('/api/bots/:id/collections/:cid/items', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const cid = c.req.param('cid');
  const coll = await getCollection(c.env.DB, owned.id, cid);
  if (!coll) return json({ error: 'таблица не найдена' }, 404);
  const fields = parseFieldsJson(coll.fields_json);
  const body = await c.req.json<{ data?: unknown }>().catch(() => null);
  const data = sanitizeData(body?.data, fields);
  if (!data) return json({ error: 'нет данных для записи' }, 400);
  const id2 = await collectionAdd(c.env.DB, owned.id, cid, null, data);
  return json({ ok: true, id: id2 });
});

app.put('/api/bots/:id/collections/:cid/items/:itemId', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const cid = c.req.param('cid');
  const itemId = c.req.param('itemId');
  const coll = await getCollection(c.env.DB, owned.id, cid);
  if (!coll) return json({ error: 'таблица не найдена' }, 404);
  const fields = parseFieldsJson(coll.fields_json);
  const existing = await getCollectionItem(c.env.DB, owned.id, cid, itemId);
  if (!existing) return json({ error: 'запись не найдена' }, 404);
  const body = await c.req.json<{ data?: unknown }>().catch(() => null);
  const data = sanitizeData(body?.data, fields);
  if (!data) return json({ error: 'нет данных для записи' }, 400);
  const updated = await updateCollectionItem(c.env.DB, owned.id, cid, itemId, JSON.stringify(data));
  if (!updated) return json({ error: 'запись не найдена' }, 404);
  return json({ ok: true });
});

app.delete('/api/bots/:id/collections/:cid/items/:itemId', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const owned = await loadOwnedBot(c, id);
  if (isResponse(owned)) return owned;
  const cid = c.req.param('cid');
  const itemId = c.req.param('itemId');
  // Проверяем владельца таблицы так же, как в PUT: иначе любой авторизованный
  // пользователь, знающий cid чужой коллекции, стирал бы её записи (SEC-01).
  const coll = await getCollection(c.env.DB, owned.id, cid);
  if (!coll) return json({ error: 'таблица не найдена' }, 404);
  const ok = await deleteCollectionItem(c.env.DB, owned.id, cid, itemId);
  if (!ok) return json({ error: 'запись не найдена' }, 404);
  return json({ ok: true });
});

// ---------------- Статусы пачкой (дашборд без N+1) ----------------
// Раньше дашборд дёргал /status на каждого бота, а тот — два запроса к Telegram.
// Здесь: один запрос на список, Telegram только при deep=true, результат кэшируется в KV.

const WH_CACHE_TTL = 1800; // 30 минут

app.post('/api/bots/statuses', async (c) => {
  const id = await auth(c);
  if (isResponse(id)) return id;
  const body = await c.req.json<{ ids?: string[]; deep?: boolean }>().catch(() => null);
  const ids = (Array.isArray(body?.ids) ? body!.ids! : []).slice(0, 50);
  const deep = !!body?.deep;
  const now = Date.now();
  const out: Record<string, unknown> = {};
  // Статусы — read-only; сотрудникам (admin/moderator/ADMIN_KEY) разрешено
  // видеть чужие боты: их показывает страница «Пользователи».
  const staff = await canAccessAnyBot(c, id);

  await Promise.all(
    ids.map(async (botId) => {
      const bot = await getBot(c.env.DB, botId).catch(() => null);
      if (!bot) {
        out[botId] = null;
        return;
      }
      if (!staff && (!id.user || bot.owner_id !== id.user.id)) {
        out[botId] = null;
        return;
      }
      const sc = await loadScenarioCached(c.env.KV, c.env.DB, botId).catch(() => null);
      const base = {
        active: bot.active,
        name: bot.name,
        version: sc?.version ?? 0,
        webhook: null as any,
        commands: [] as any[],
        checkedAt: 0,
        cached: true,
      };

      const cacheKey = `wh:${botId}`;
      let cached: { ts: number; webhook: any; commands: any[] } | null = null;
      if (!deep && c.env.KV) {
        cached = (await c.env.KV.get(cacheKey, 'json').catch(() => null)) as any;
      }

      if (cached?.ts) {
        base.webhook = cached.webhook;
        base.commands = cached.commands;
        base.checkedAt = cached.ts;
        out[botId] = base;
        return;
      }

      if (!deep) {
        // Быстрый режим: не знаем статус — не дёргаем Telegram, просто отдаём null.
        base.cached = false;
        out[botId] = base;
        return;
      }

      try {
        const token = await decryptToken(bot.token_enc, c.env.ENCRYPTION_KEY);
        const [info, cmds] = await Promise.all([
          tgCall(token, 'getWebhookInfo', {}).then((r) => r.json().catch(() => ({}))),
          tgCall(token, 'getMyCommands', {}).then((r) => r.json().catch(() => ({}))),
        ]);
        base.webhook = (info as any)?.result ?? null;
        base.commands = (cmds as any)?.result ?? [];
        base.checkedAt = now;
        base.cached = false;
        if (c.env.KV) {
          await c.env.KV.put(cacheKey, JSON.stringify({ ts: now, webhook: base.webhook, commands: base.commands }), {
            expirationTtl: WH_CACHE_TTL,
          }).catch(() => {});
        }
      } catch {
        /* Telegram недоступен — отдаём то, что есть */
      }
      out[botId] = base;
    })
  );

  return json({ statuses: out });
});

// Параметр глубокой ссылки из /start: «/start ref_123» -> «ref_123».
function extractStartParam(update: any): string | null {
  const text: string | undefined =
    typeof update?.message?.text === 'string'
      ? update.message.text
      : typeof update?.message?.caption === 'string'
      ? update.message.caption
      : undefined;
  if (!text) return null;
  const parts = text.trim().split(/\s+/);
  if (!parts.length || !parts[0].startsWith('/start')) return null;
  return parts[1] ?? null;
}

// ---------------- VK webhook entry ----------------

// VK Callback API: события группы приходят POST /vk/<botId> телом
// {type, group_id, secret, object}. Авторизация — поле secret (мы кладём туда
// webhook_secret бота при регистрации сервера в publish). Первое событие —
// confirmation: VK ждёт в теле ответа строку подтверждения бота.
// Инвариант как у Telegram-вебхука: всегда 200 (кроме подтверждения),
// ошибки не должны провоцировать повторный штурм.
app.post('/vk/:botId', async (c) => {
  const botId = c.req.param('botId');
  try {
    const rawBody = await c.req.text().catch(() => '');
    if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
      console.warn(`[vk-webhook] oversized body ${rawBody.length} bytes`);
      return json({ ok: true });
    }
    let body: any = null;
    try {
      body = rawBody.trim() ? JSON.parse(rawBody) : null;
    } catch {
      body = null;
    }
    if (!body || typeof body !== 'object') return json({ ok: true });
    const event = body as VkEvent;

    const bot = await getBot(c.env.DB, botId).catch(() => null);
    if (!bot) return json({ ok: true }); // существование бота не раскрываем
    // Подтверждение — ДО проверки secret: VK шлёт его при регистрации сервера
    // (setCallbackServer), и его объект не содержит secret. Ответ — строка
    // подтверждения бота, VK сверяет и принимает сервер.
    if (event.type === 'confirmation') {
      return new Response(bot.vk_confirmation ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
    }

    // Secret из KV (как у Telegram-вебхука): до любой другой работы с ботом.
    // Bots, созданные до миграции 0030, secret в поле не получат — их события
    // отклоняются, но это Telegram-боты: VK сюда не пишет.
    let expected: string | null = await c.env.KV.get(`vk:${botId}`).catch(() => null);
    if (expected === null) expected = bot.webhook_secret;
    if (!event.secret || !expected || !keysEqual(String(event.secret), expected)) {
      await logEvent(c.env.DB, botId, null, 'vk.webhook.forbidden').catch(() => {});
      return json({ ok: true }); // не 403: не раскрываем существование и не зовём ретраи
    }

    // Идемпотентность: VK ретраит событие, если не получил 200 за 10 с.
    // Ключ — пара (тип, id объекта), TTL 1 день, запись ДО обработки.
    // F3-516: префикс платформы — VK и Telegram-события одного бота не
    // делят дедуп-ключи (у TG свой upd:-ключ с update_id).
    const rawObj = (event.object ?? {}) as Record<string, unknown>;
    const dedupKey = `vkupd:${botId}:${event.type}:${String(rawObj.id ?? rawObj.event_id ?? (rawObj.message as Record<string, unknown> | undefined)?.id ?? '')}`;
    const seen = await c.env.KV.get(dedupKey).catch(() => null);
    if (seen) return json({ ok: true, duplicate: true });
    await c.env.KV.put(dedupKey, '1', { expirationTtl: 86400 }).catch(() => {});

    // F3-105: unpublished-бот (active=0) события не исполняет — снятие
    // Callback-сервера асинхронно у VK, между unpublish и фактическим
    // отключением могут прилететь хвостовые события.
    if (!bot.active) {
      await logEvent(c.env.DB, botId, null, 'vk.event.inactive').catch(() => {});
      return json({ ok: true });
    }
    // F3-115: сверка group_id — событие чужой группы с тем же secret не
    // должно исполняться этим ботом (защита от конфликта ключей/ошибок).
    if (bot.vk_group_id && Number(event.group_id) !== Number(bot.vk_group_id)) {
      await logEvent(c.env.DB, botId, null, 'vk.event.group_mismatch').catch(() => {});
      return json({ ok: true });
    }

    // Сценарий (KV-кэш) и токен. Битый token_enc — 200 + лог, как у Telegram.
    const sc = await loadScenarioCached(c.env.KV, c.env.DB, botId);
    if (!sc) {
      await logEvent(c.env.DB, botId, null, 'bot.no_scenario').catch(() => {});
      return json({ ok: true });
    }
    let token: string;
    try {
      token = await decryptToken(bot.token_enc, c.env.ENCRYPTION_KEY);
    } catch {
      await logEvent(c.env.DB, botId, null, 'bot.token_broken').catch(() => {});
      return json({ ok: true });
    }
    const scenario = JSON.parse(sc.flow_json) as Scenario;

    // События, которые мы не обрабатываем: подтверждены 200, чтобы VK не
    // ретраил (wallposts и прочее включаются отдельными настройками группы).
    if (event.type !== 'message_new' && event.type !== 'message_event') {
      await logEvent(c.env.DB, botId, null, `vk.event.ignored.${event.type ?? '?'}`).catch(() => {});
      return json({ ok: true });
    }

    // api_version 5.131: message_new приходит как {type, group_id, object:{message:{...}}}
    // (официальный пример VK). message_event — плоский {object:{...}}. Принимаем обе формы.
    const rawObject = (event.object ?? {}) as Record<string, unknown>;
    const object = (event.type === 'message_new' && rawObject.message && typeof rawObject.message === 'object'
      ? rawObject.message
      : rawObject) as Record<string, unknown>;
    // message_new → Telegram-форма message; message_event → callback_query.
    // Движок работает с Telegram-формой — его код не трогаем.
    const update =
      event.type === 'message_new'
        ? vkMessageToTelegramUpdate(object)
        : vkEventToTelegramUpdate(object);
    // F3-108: входящие вложения VK (attachments[]) маппятся в Telegram-форму
    // апдейта — photo-URL крупнейшего размера и location. Без этого блок
    // input-photo на VK валидацию проходил, но апдейт «висел вечно».
    if (event.type === 'message_new') {
      const atts = vkExtractAttachments(object);
      const msg = (update as { message?: Record<string, unknown> }).message;
      if (msg) {
        if (atts.photos.length) msg.photo = atts.photos.map((url) => [{ file_id: url }]);
        if (atts.geo) msg.location = atts.geo;
      }
    }
    const userId = event.type === 'message_new' ? Number(object.from_id ?? object.peer_id ?? 0) : Number(object.user_id ?? 0);
    if (!Number.isFinite(userId) || userId <= 0) return json({ ok: true });

    // Стартовое сообщение VK: /start команда или просто первое сообщение.
    // (в VK нет «start-param» реферальных ссылок — глубже не копаем.)

    const sessRow = await getSessionCas(c.env.DB, botId, userId);
    const session = {
      currentBlock: sessRow?.current_block ?? null,
      vars: sessRow?.vars_json ? JSON.parse(sessRow.vars_json) : {},
    };

    const dataOps = makeDataOps(c.env.DB, botId);
    const tagOps = makeTagOps(c.env.DB, botId);
    const referralOps = makeReferralOps(c.env.DB, botId);
    const engineOps = makeEngineOps(c.env, botId, token, userId, webhookOrigin(c.req.url));
    const result = await runEngine({ scenario, update, session, data: dataOps, tags: tagOps, referral: referralOps, ...engineOps });

    // VK-контекст для answerCallbackQuery (messages.sendMessageEventAnswer):
    // event_id и user_id из входящего события.
    const vkCtx = event.type === 'message_event' ? { eventId: String(object.event_id ?? ''), userId } : null;
    const cbqId = event.type === 'message_event' ? String(object.event_id ?? '') : undefined;

    const execCtx = (c as any).executionCtx;
    const deferred = makeDeferred(execCtx);
    const final = await dispatchOuts(
      c.env,
      token,
      botId,
      userId,
      result.outs,
      { currentBlock: result.currentBlock, vars: result.vars },
      0,
      scenario,
      undefined,
      dataOps,
      tagOps,
      referralOps,
      engineOps,
      cbqId,
      deferred.defer,
      vkCtx,
      'vk'
    );

    // Персист сессии — тем же CAS-паттерном, что Telegram-вебхук.
    const casBaseVars = sessRow ? (JSON.parse(sessRow.vars_json) as Record<string, unknown>) : null;
    const casBaseUpdatedAt = sessRow ? Number(sessRow.updated_at) : null;
    const persist = (async () => {
      try {
        await upsertSessionCas(c.env.DB, {
          botId,
          userId,
          currentBlock: final.currentBlock,
          varsJson: JSON.stringify(final.vars),
          baseVars: casBaseVars,
          baseUpdatedAt: casBaseUpdatedAt != null && Number.isFinite(casBaseUpdatedAt) ? casBaseUpdatedAt : null,
        });
        // Профиль: у VK это from_id + имя (придёт в объекте с fields при
        // включённых расширенных событиях; без имени пишем только id).
        // step-лог — сэмплированный (раз в минуту на бота+юзера).
        await logStepSampled(c.env.KV, c.env.DB, botId, userId, `step.${final.currentBlock ?? 'end'}`);
      } catch {
        /* сессия не записалась — следующий заход пойдёт заново */
      }
    })();
    if (execCtx && typeof execCtx.waitUntil === 'function') execCtx.waitUntil(persist);
    else await persist;
    await deferred.flush();
    return json({ ok: true });
  } catch {
    // Внутренняя ошибка — 200: VK не должен долбить повторами.
    return json({ ok: true });
  }
});

// ---------------- Telegram webhook entry ----------------

// F-014: потолок тела апдейта (Telegram-апдейты редко больше 100 КБ).
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024; // 1 МБ

app.post('/:botId', async (c) => {
  const botId = c.req.param('botId');
  const secret = c.req.header('x-telegram-bot-api-secret-token');

  // Webhook auth BEFORE any D1 lookup so we never reveal bot existence.
  // Mapping (bot_id -> webhook_secret) lives in KV; fall back to D1 for bots
  // created before KV existed (seeded on next setWebhook).
  // Single D1 lookup for the bot row: used for webhook auth and everything after.
  let expected: string | null = await c.env.KV.get(botId).catch(() => null);
  let bot: BotRow | null = expected === null ? await getBot(c.env.DB, botId) : null;
  if (expected === null && !bot) return json({ error: 'forbidden' }, 403); // unknown bot, no detail
  if (expected === null) expected = bot!.webhook_secret;
  // F-007 (аудит 18.10): constant-time, как ADMIN_KEY — единый паттерн.
  if (!secret || !expected || !keysEqual(secret, expected)) return json({ error: 'forbidden' }, 403);

  // KV already authenticated the secret but the bot row may be missing (edge case).
  if (!bot) bot = await getBot(c.env.DB, botId);
  if (!bot) return json({ ok: true }); // secret matched but no bot row — ack silently

  // F-014: тело апдейта больше 1 МБ не парсим. Инвариант вебхука: всегда 200 —
  // иначе Telegram ретраит мусор и жжёт CPU изолята. Апдейты редко больше 100 КБ.
  // content-length проверяется первым (дёшево), но в части рантаймов заголовка
  // нет — тогда страховкой служит длина прочитанного текста ДО JSON.parse.
  const contentLength = Number(c.req.header('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    console.warn(`[webhook] oversized body ${contentLength} bytes for bot ${botId}`);
    await logEvent(c.env.DB, botId, null, 'webhook.oversized').catch(() => {});
    return json({ ok: true });
  }

  const rawBody = await c.req.text().catch(() => '');
  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    console.warn(`[webhook] oversized body ${rawBody.length} bytes for bot ${botId}`);
    await logEvent(c.env.DB, botId, null, 'webhook.oversized').catch(() => {});
    return json({ ok: true });
  }
  let update: any = null;
  try {
    update = rawBody.trim() ? JSON.parse(rawBody) : null;
  } catch {
    update = null;
  }
  if (!update) return json({ ok: true });

  // F-006 (аудит 18.10): битый token_enc (ротация ENCRYPTION_KEY, порча строки)
  // без try давал 500 на каждый апдейт и бесконечные ретраи Telegram. Теперь —
  // 200 + лог; вебхук не снимаем, чтобы разовый сбой не глушил бота навсегда
  // (при ротации ключа владелец перепубликует бота — секрет и токен перезапишутся).
  let token: string;
  try {
    token = await decryptToken(bot.token_enc, c.env.ENCRYPTION_KEY);
  } catch {
    await logEvent(c.env.DB, botId, null, 'bot.token_broken').catch(() => {});
    return json({ ok: true });
  }

  // F-001 (аудит 18.10): идемпотентность вебхука. Telegram ретраит апдейт при
  // таймауте (медленный сценарий: цепочка отправок > 15 с) — без дедупа движок
  // исполняется повторно: дубли сообщений и двойные записи в таблицы. Паттерн
  // тот же, что у /wh/:token (whseen:): ключ upd:<bot>:<update_id>, TTL 1 день,
  // ранний выход. Пишем ДО обработки: при падении isolate ретрай получит
  // duplicate вместо второго исполнения (лучше пропустить, чем продублировать).
  const updateId = update?.update_id;
  if (updateId !== undefined && updateId !== null) {
    const seenKey = `upd:${botId}:${updateId}`;
    const seen = await c.env.KV.get(seenKey).catch(() => null);
    if (seen) return json({ ok: true, duplicate: true });
    await c.env.KV.put(seenKey, '1', { expirationTtl: 86400 }).catch(() => {});
  }

  // Сценарий берём из KV-кэша (кладётся при первом чтении, сбрасывается на сохранении):
  // иначе D1 опрашивается на каждый входящий апдейт.

  // ---- pre_checkout_query: обязательно ответить OK за 10 секунд, иначе ----
  // ---- Telegram отменит платёж. Сценарий для этого не нужен:           ----
  // ---- проверка реальной суммы делается в блоке «Оплата».              ----
  // F-041: для mini-платежей (payload 'mini:<id>') сверяем сумму с pending-
  // строкой mini_payments — Telegram для XTR сумму на нашей стороне не
  // валидирует. Сценарные платежи (payment_link, orderId) — прежнее
  // безусловное ok: их сумма проверяется блоком «Оплата».
  if (update?.pre_checkout_query?.id) {
    const pcq = update.pre_checkout_query;
    const miniId = parseMiniPayPayload(pcq.invoice_payload);
    let ok = true;
    if (miniId) {
      const payRow = await getMiniPaymentByPayload(c.env.DB, miniPaymentPayload(miniId)).catch(() => null);
      ok = !!payRow
        && payRow.status === 'pending'
        && Number(pcq.total_amount) === Number(payRow.amount)
        && String(pcq.currency) === 'XTR';
    }
    try {
      await tgCall(token, 'answerPreCheckoutQuery', {
        pre_checkout_query_id: pcq.id,
        ok,
        ...(ok ? {} : { error_message: 'Не удалось подтвердить платёж, попробуйте ещё раз' }),
      });
    } catch {
      /* если не ответили — Telegram сам отменит; ничего не падает */
    }
    if (miniId) {
      await logEvent(c.env.DB, botId, Number(pcq.from?.id) || null, ok ? 'mini.pay.precheckout_ok' : 'mini.pay.precheckout_reject').catch(() => {});
    }
    return json({ ok: true });
  }

  // F-021 (аудит 18.10): ответ на опрос/квиз приходит poll_answer-апдейтом —
  // без этой ветки userId=0, сессия пишется на user_id 0, и ожидающий
  // poll/quiz-блок конкретного пользователя не находится никогда.
  const userId: number =
    update?.message?.from?.id ??
    update?.callback_query?.from?.id ??
    update?.poll_answer?.user?.id ??
    0;

  // F-041: успешная оплата Stars-счёта мини-аппа (payload 'mini:<id>').
  // ОБРАБАТЫВАЕТСЯ ДО загрузки сценария: у бота с мини-аппом сценария может
  // не быть вовсе, а платёж обязан фиксироваться. Идемпотентность по
  // charge_id: ретрай Telegram не даёт повторных эффектов. Сценарий не
  // возобновляется (mini-payload не сценарный) и recordPayment не вызывается
  // (это не заказ сценарного payment_link).
  const miniPayment = update?.message?.successful_payment;
  const miniPaymentId = miniPayment ? parseMiniPayPayload(miniPayment.invoice_payload) : null;
  if (miniPaymentId) {
    const chargeId = String(miniPayment.telegram_payment_charge_id ?? '');
    const marked = await markMiniPaymentPaid(c.env.DB, miniPaymentPayload(miniPaymentId), chargeId, Date.now()).catch(() => false);
    if (marked) {
      await logEvent(c.env.DB, botId, userId || null, `mini.payment.paid.${Number(miniPayment.total_amount) || 0}`).catch(() => {});
    } else {
      await logEvent(c.env.DB, botId, userId || null, 'mini.payment.duplicate').catch(() => {});
    }
    return json({ ok: true });
  }

  // Сценарий и сессия не зависят друг от друга — читаем параллельно (минус
  // один round-trip на апдейт). При отсутствии сценария чтение сессии лишнее,
  // но дешёвое и ни на что не влияет. F-002: чтение CAS-вариантом — с
  // updated_at (метка версии строки); персист в конце запроса сверит её и при
  // параллельной записи наложит только СВОЙ diff переменных (upsertSessionCas).
  const [sc, sessRow] = await Promise.all([
    loadScenarioCached(c.env.KV, c.env.DB, botId),
    getSessionCas(c.env.DB, botId, userId),
  ]);
  if (!sc) {
    // Bot exists but has no scenario yet — answer instead of staying silent.
    const chatId =
      update?.message?.chat?.id ??
      update?.callback_query?.message?.chat?.id ??
      update?.callback_query?.from?.id;
    if (chatId) {
      try {
        await tgCall(token, 'sendMessage', {
          chat_id: chatId,
          text: 'Бот находится в разработке. Попробуйте позже.',
        });
      } catch {
        /* ignore delivery errors for the stub */
      }
    }
    await logEvent(c.env.DB, botId, null, 'bot.no_scenario');
    return json({ ok: true });
  }
  const scenario = JSON.parse(sc.flow_json) as Scenario;

  const session = {
    currentBlock: sessRow?.current_block ?? null,
    vars: sessRow?.vars_json ? JSON.parse(sessRow.vars_json) : {},
  };

  // ---- реферальный вход ----
  // Платформа НЕ начисляет бонусов: она только фиксирует, кто кого пригласил,
  // и кладёт {{ref.inviter}} / {{ref.count}} в переменные. Что с ними делать —
  // автор бота собирает сам из обычных блоков (condition / action / setvar).
  const startParam = extractStartParam(update);
  // Флаг наличия блока реферальной системы посчитан заранее (при сохранении
  // сценария) — искать подстроку в flow_json на каждое сообщение слишком дорого.
  const wantsReferral = !!startParam?.startsWith('ref_') || sc.has_referral || bot.has_referral === 1;
  if (wantsReferral) {
    // ref_<id>[_<payload>]: id пригласившего — до первого подчёркивания.
    const inviter = parseRefStartParam(startParam).referrerId;
    if (inviter && inviter !== String(userId)) {
      await recordReferral(c.env.DB, {
        id: crypto.randomUUID(),
        bot_id: botId,
        inviter_user_id: inviter,
        invited_user_id: String(userId),
        created_at: Date.now(),
        depth: 1,
      }).catch(() => false);
    }
    // Берём пригласившего из базы, а не из ссылки: если пользователь уже
    // засчитан за кем-то, повторный переход по чужой ссылке это не перебьёт.
    // recordReferral выше уже отработал — referralContext видит свежую строку.
    // Оба чтения (inviter + count) — один round-trip вместо двух.
    const refCtx = await referralContext(c.env.DB, botId, String(userId));
    if (refCtx.inviter || inviter) session.vars[REF_INVITER_VAR] = refCtx.inviter ?? inviter;
    session.vars[REF_COUNT_VAR] = refCtx.invitedCount;
  }

  // @username бота: нужен блоку «Реферальная ссылка». Если его ещё нет
  // (бот ни разу не публиковался), забираем у Telegram один раз и запоминаем.
  let botUsername = bot.bot_username ?? null;
  if (!botUsername && wantsReferral) {
    try {
      const meRes = await tgCall(token, 'getMe', {});
      const me = (await meRes.json().catch(() => ({}))) as { result?: { username?: string } };
      if (me.result?.username) {
        botUsername = me.result.username;
        await setBotUsername(c.env.DB, botId, String(botUsername));
      }
    } catch {
      /* не критично — ссылка просто не соберётся */
    }
  }

  // Операции с таблицами бота: блок «Данные» ходит в D1 через них же.
  const dataOps = makeDataOps(c.env.DB, botId);
  const tagOps = makeTagOps(c.env.DB, botId);
  const referralOps = makeReferralOps(c.env.DB, botId);
  // Новые ops набора 2026-09: движок остаётся чистым, всё внешнее — здесь.
  const engineOps = makeEngineOps(c.env, botId, token, userId, webhookOrigin(c.req.url));
  // Успешная оплата — факт для реферальной системы: пишем сразу, чтобы
  // first_payment / revenue-метрики видели её в этом же апдейте.
  const payment = update?.message?.successful_payment;
  if (payment) {
    await referralOps
      .recordPayment(String(userId), Number(payment.total_amount) || 0, String(payment.currency || 'RUB'), Date.now())
      .catch(() => {});
  }
  const result = await runEngine({ scenario, update, session, botUsername, data: dataOps, tags: tagOps, referral: referralOps, ...engineOps });

  // Движок сам мог ответить на callback (cbToast/cbAlert) — тогда фолбэк
  // недопустим: Telegram принимает только ОДИН answerCallbackQuery на апдейт,
  // второй вернёт ошибку «query is too old» и напугает автора в логах.
  const cbAnswered = result.outs.some((o) => o.method === 'answerCallbackQuery');

  // «Часики» на inline-кнопке снимаем СРАЗУ после движка, до разбора исходящих:
  // раньше фолбэк стоял в persist-блоке и спиннер висел всю отправку сообщений.
  // Ошибка ответа не должна ронять апдейт.
  if (update?.callback_query && !cbAnswered) {
    await tgCall(token, 'answerCallbackQuery', { callback_query_id: update.callback_query.id }).catch(() => {});
  }

  // Не-критичные логи (http.ok, delay.scheduled.* и т.п.) уносим с пути
  // ответа: collector кладёт их в waitUntil, Telegram получает 200 быстрее.
  const execCtx = (c as any).executionCtx;
  const deferred = makeDeferred(execCtx);

  const final = await dispatchOuts(
    c.env,
    token,
    botId,
    userId,
    result.outs,
    { currentBlock: result.currentBlock, vars: result.vars },
    0,
    scenario,
    botUsername,
    dataOps,
    tagOps,
    referralOps,
    engineOps,
    typeof update?.callback_query?.id === 'string' ? update.callback_query.id : undefined,
    deferred.defer
  );

  // Ответ Telegram не должен ждать запись сессии и лога: отдаём 200 сразу,
  // а персист уносим в waitUntil (Workers дожидается его после ответа).
  // F-002: пишем через upsertSessionCas с базовыми значениями из чтения в
  // начале запроса — параллельный апдейт (двойной тап, сообщение+callback)
  // больше не затирает чужие переменные: вместо перезаписи накладывается
  // только diff этого запроса ('merged').
  const casBaseVars = sessRow ? (JSON.parse(sessRow.vars_json) as Record<string, unknown>) : null;
  const casBaseUpdatedAt = sessRow ? Number(sessRow.updated_at) : null;
  const persist = (async () => {
    try {
      await upsertSessionCas(c.env.DB, {
        botId,
        userId,
        currentBlock: final.currentBlock,
        varsJson: JSON.stringify(final.vars),
        baseVars: casBaseVars,
        baseUpdatedAt: casBaseUpdatedAt != null && Number.isFinite(casBaseUpdatedAt) ? casBaseUpdatedAt : null,
      });
      // Профиль клиента (имя/@username) — из самого апдейта: иначе в базе
      // клиентов были бы одни цифры и авторам пришлось бы угадывать, кто это.
      // Отдельным UPDATE ПОСЛЕ CAS-записи: insert-ветка upsertSessionCas
      // профильных колонок не знает (sessionAndLogStmts больше не на пути).
      const from: any = update?.message?.from ?? update?.callback_query?.from ?? null;
      if (from?.first_name || from?.username) {
        await c.env.DB
          .prepare('UPDATE sessions SET first_name = COALESCE(?, first_name), username = COALESCE(?, username) WHERE bot_id = ? AND user_id = ?')
          .bind(from?.first_name ?? null, from?.username ?? null, botId, userId)
          .run()
          .catch(() => {});
      }
      // step-лог — сэмплированный: раз в минуту на бота+юзера (иначе logs
      // растут линейно трафику и съедают квоту D1 между чистками).
      await logStepSampled(c.env.KV, c.env.DB, botId, userId, `step.${final.currentBlock ?? 'end'}`);
    } catch {
      /* сессия не записалась — следующий апдейт пойдёт по сценарию заново */
    }
  })();

  if (execCtx && typeof execCtx.waitUntil === 'function') execCtx.waitUntil(persist);
  else await persist;
  // Без executionCtx (тесты, локальный прогон) отложенные логи дожидаемся
  // здесь — поведение остаётся корректным: к концу запроса всё записано.
  await deferred.flush();

  return json({ ok: true });
});

// ---------------- http: повторы и постраничный обход ----------------

// Значение из одного http-запроса: текст или JSON (+ jsonPath). Ошибки сети
// и 5xx повторяются с экспоненциальной задержкой; retries=0 — прежнее
// поведение (ровно один запрос).
const HTTP_BUDGET_MS = 50_000; // Telegram ждёт ответ 60 с — оставляем запас.

function backoffDelay(attempt: number, baseMs: number): number {
  // attempt: 0,1,2... baseMs — пауза автора (0 = быстрые повторы по 500 мс).
  const base = baseMs > 0 ? baseMs : 500;
  return Math.min(8_000, base * 2 ** attempt);
}

async function httpFetchOnce(env: Env, p: {
  method?: string;
  headersJson?: string;
  bodyJson?: string;
  jsonPath?: string;
}, url: string): Promise<{ value: unknown; parsed: unknown | null; status: number }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (p.headersJson) Object.assign(headers, JSON.parse(p.headersJson));
  const init: RequestInit = { method: p.method || 'GET', headers };
  if ((p.method || 'GET') !== 'GET' && p.bodyJson) init.body = p.bodyJson;
  const res = await safeFetch(url, init, env);
  const text = await readCapped(res);
  let parsed: unknown | null = null;
  let value: unknown = text;
  try {
    parsed = JSON.parse(text);
    value = p.jsonPath ? pickPath(parsed, p.jsonPath) : parsed;
  } catch {
    /* не JSON — отдаём текст, как раньше */
  }
  return { value, parsed, status: res.status };
}

// Один запрос с ретраями; возвращает и значение, и разобранный JSON (нужно
// пагинации для nextCursorPath). Повторяем только сетевые ошибки и 5xx.
// strict (пагинация) — не-2xx после повторов это ошибка; легаси-путь (без
// paginate) обязан вести себя как раньше: тело любого ответа уходит в outVar.
async function httpFetchWithRetries(
  env: Env,
  p: { method?: string; headersJson?: string; bodyJson?: string; jsonPath?: string; retries?: number; backoffMs?: number },
  url: string,
  strict = false
): Promise<{ value: unknown; parsed: unknown | null }> {
  const attempts = Math.max(0, Math.min(5, Math.floor(Number(p.retries) || 0)));
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      const got = await httpFetchOnce(env, p, url);
      if (got.status >= 500 && attempt < attempts) {
        await sleep(backoffDelay(attempt, Number(p.backoffMs) || 0));
        continue;
      }
      if (strict && (got.status < 200 || got.status >= 300)) throw new Error(`http ${got.status}`);
      return { value: got.value, parsed: got.parsed };
    } catch (e) {
      lastErr = e;
      if (attempt < attempts) await sleep(backoffDelay(attempt, Number(p.backoffMs) || 0));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('http failed');
}

async function httpFetchValue(env: Env, p: {
  method?: string;
  headersJson?: string;
  bodyJson?: string;
  jsonPath?: string;
  retries?: number;
  backoffMs?: number;
}, url: string): Promise<unknown> {
  return (await httpFetchWithRetries(env, p, url)).value;
}

interface NormalizedPagination {
  kind: 'page' | 'offset' | 'cursor';
  param: string;
  start: number;
  step: number;
  maxPages: number;
  cursorPath?: string;
  nextCursorPath?: string;
  delayMs: number;
}

// Постраничный обход: каждый ответ добавляется в collected (массив значений
// jsonPath — обычно списки элементов). Обрыв по бюджету времени НЕ ошибка:
// возвращаем частичный результат и точку продолжения (__http_page), автор
// может продолжить обход следующим блоком http.
async function httpPaginate(
  env: Env,
  botId: string,
  userId: number,
  p: {
    url?: string;
    method?: string;
    headersJson?: string;
    bodyJson?: string;
    jsonPath?: string;
    retries?: number;
    backoffMs?: number;
    paginate?: NormalizedPagination | null;
  },
  vars: Record<string, unknown>
): Promise<{ collected: unknown[]; last: unknown; truncated: Record<string, unknown> | null }> {
  const pg = p.paginate as NormalizedPagination;
  const startedAt = Date.now();
  const collected: unknown[] = [];
  // Продолжение прежнего обхода: курсор/номер страницы из __http_page.
  const resumeState = vars[HTTP_PAGE_VAR];
  const resumeFrom2 =
    resumeState && typeof resumeState === 'object' && String((resumeState as any).url ?? '') === String(p.url ?? '')
      ? (resumeState as Record<string, unknown>)
      : null;
  let page = resumeFrom2 && Number.isFinite(Number(resumeFrom2.page)) ? Number(resumeFrom2.page) : pg.start;
  let cursor = resumeFrom2 ? String(resumeFrom2.cursor ?? '') : '';
  let last: unknown = '';
  let pages = 0;
  let truncated: Record<string, unknown> | null = null;

  for (;;) {
    if (pages >= pg.maxPages) break;
    if (Date.now() - startedAt > HTTP_BUDGET_MS) {
      truncated = { url: String(p.url ?? ''), page, cursor, reason: 'budget' };
      await logEvent(env.DB, botId, userId, `http.paginate.budget.${pages}`).catch(() => {});
      break;
    }
    const url = new URL(String(p.url ?? ''));
    if (pg.kind === 'cursor') {
      // Первая страница — без курсора; дальше — nextCursorPath из ответа.
      if (cursor) url.searchParams.set(pg.param, cursor);
    } else if (pg.kind === 'offset') {
      url.searchParams.set(pg.param, String(page));
    } else {
      url.searchParams.set(pg.param, String(page));
    }
    let got: { value: unknown; parsed: unknown | null };
    try {
      got = await httpFetchWithRetries(env, p, url.toString(), true);
    } catch {
      // Страница не загрузилась: обрыв — не потеря уже собранного.
      truncated = { url: String(p.url ?? ''), page, cursor, reason: 'error' };
      await logEvent(env.DB, botId, userId, `http.paginate.error.${pages}`).catch(() => {});
      break;
    }
    pages++;
    const item = got.value;
    last = item;
    collected.push(item);
    // Пустая страница (пустой список/строка) — естественный конец обхода.
    const isEmpty =
      item == null ||
      item === '' ||
      (Array.isArray(item) && item.length === 0) ||
      (typeof item === 'object' && !Array.isArray(item) && Object.keys(item as object).length === 0);
    if (isEmpty) break;
    if (pg.kind === 'cursor') {
      const nextCursor = pg.nextCursorPath && got.parsed != null ? pickPath(got.parsed, pg.nextCursorPath) : '';
      cursor = String(nextCursor ?? '');
      if (!cursor) break;
    } else {
      page += pg.step;
    }
    if (pg.delayMs > 0) await sleep(Math.min(5_000, pg.delayMs));
  }
  await logEvent(env.DB, botId, userId, `http.paginate.${pages}`).catch(() => {});
  return { collected, last, truncated };
}

// Walks the engine output: sends messages, performs async actions (http/ai/delay)
// and resumes the flow afterwards if needed.
//
// ops — пакет новых операций (каналы/счётчики/профили/рассылки/платежи):
// прокидывается в resumeFrom, чтобы возобновлённый сценарий имел те же
// возможности, что и первый проход. cbqId — id callback-запроса текущего
// апдейта: движок выпускает answerCallbackQuery без него (он id не знает),
// подставляем здесь и только на первом проходе (в resume callback'а уже нет).
type EngineOps = ReturnType<typeof makeEngineOps>;

// Служебная переменная: сколько раз поток уже продолжался фоново после
// исчерпания бюджета шагов (§1). Живёт в vars между resume-проходами;
// сбрасывается, когда проход завершается без нового отложения.
const DEFER_COUNT_VAR = '__budget_resumes';

// Отложенные записи: не-критичные логи не должны держать ответ Telegram.
// С executionCtx промис сразу уезжает в waitUntil (Workers исполняет его
// после отправки ответа); без ctx (тесты, локальные прогоны) промисы
// копятся и flush() дожидается их до конца запроса — поведение то же.
type DeferFn = (p: Promise<unknown>) => void;
function makeDeferred(execCtx: { waitUntil?: (p: Promise<unknown>) => void } | undefined | null): {
  defer: DeferFn;
  flush: () => Promise<void>;
} {
  const pending: Promise<unknown>[] = [];
  const canWait = !!execCtx && typeof execCtx.waitUntil === 'function';
  return {
    defer(p) {
      const safe = p.catch(() => {});
      if (canWait) execCtx!.waitUntil!(safe);
      else pending.push(safe);
    },
    async flush() {
      await Promise.allSettled(pending);
    },
  };
}

// Сэмплирование step-логов: раньше step.<block> писался в logs на КАЖДЫЙ
// входящий апдейт (персист сессии) — таблица росла линейно трафику бота и
// между тиками чистки съедала квоту D1. Теперь запись не чаще раза в
// STEP_LOG_MIN_INTERVAL_MS на бота+юзера: KV-флаг с TTL гасит повторы,
// ошибки KV молча отключают сэмплирование (логи пишутся как раньше —
// потерять логи хуже, чем сэкономить запись). Прочие события
// (payments.*, publish.*, bot.*) — не сэмплируются: их мало и они значимы.
const STEP_LOG_MIN_INTERVAL_MS = 60_000;
async function logStepSampled(kv: KVNamespace | undefined, db: D1Database, botId: string, userId: number, event: string): Promise<void> {
  if (!kv) {
    await logEvent(db, botId, userId, event);
    return;
  }
  const key = `steplog:${botId}:${userId}`;
  try {
    const prev = await kv.get(key);
    if (prev !== null) return; // уже писали в окне — пропускаем
    await kv.put(key, '1', { expirationTtl: Math.ceil(STEP_LOG_MIN_INTERVAL_MS / 1000) });
  } catch {
    /* кэш недоступен — пишем без сэмплирования */
  }
  await logEvent(db, botId, userId, event);
}

async function dispatchOuts(
  env: Env,
  token: string,
  botId: string,
  userId: number,
  outs: { method: string; payload: Record<string, unknown> }[],
  state: { currentBlock: string | null; vars: Record<string, unknown> },
  depth = 0,
  scenario?: Scenario | null,
  botUsername?: string | null,
  data?: DataOps,
  tags?: TagOps,
  referral?: ReferralOps,
  ops?: EngineOps,
  cbqId?: string,
  defer?: DeferFn,
  vkCtx?: { eventId: string; userId: number } | null,
  platform?: 'telegram' | 'vk'
): Promise<{ currentBlock: string | null; vars: Record<string, unknown> }> {
  // Платформа прохода: явный аргумент (кроны читают из BotRow) или вывод из
  // VK-контекста (вебхук VK). Telegram-пути передают и то и другое пустым —
  // поведение прежнее.
  // Не-критичный лог: с defer-коллектором запись уезжает с пути ответа
  // (await мгновенный), без коллектора (кроны, легаси-вызовы) — честный
  // await как раньше. Ошибки лога глотаем в обеих ветках.
  const logEvt = (event: string): Promise<void> => {
    const p = logEvent(env.DB, botId, userId, event).catch(() => {});
    if (defer) {
      defer(p);
      return Promise.resolve();
    }
    return p;
  };
  // Платформа бота определяет транспорт исходящих: VK-боты уходят через
  // platformCall (vk.ts), Telegram — через tgCall как раньше. Платформа не
  // протаскивается параметром сквозь все ветки: определяем один раз по факту
  // наличия VK-контекста (vkCtx передаёт только VK-вебхук) — все остальные
  // call-сайты (кроны, резюмы) читают её из BotRow своим чтением (см.
  // platformOf ниже). Здесь достаточно булева: текущий проход VK?
  const isVk = platform === 'vk' || !!vkCtx;
  // group_id группы VK для upload-цепочек (photos.getMessagesUploadServer).
  // Достаётся лениво один раз на проход и только для VK: лишний SELECT не
  // трогает Telegram-путь.
  let vkGroupId: number | null | undefined;
  const vkGroupOpts = async (): Promise<{ vkGroupId?: number | null }> => {
    if (!isVk) return {};
    if (vkGroupId === undefined) {
      const botRow = await getBot(env.DB, botId).catch(() => null);
      vkGroupId = botRow?.vk_group_id ?? null;
    }
    return { vkGroupId };
  };
  // §6: прежний обрыв `if (depth > 5) return state;` молча рвал поток после
  // ~5 последовательных http/ai блоков. Теперь рекурсия ограничена
  // MAX_ASYNC_CHAIN, а ДО достижения этого порога хвост цепочки откладывается
  // в resumeFrom (scheduled_sends, method 'resume') — поток продолжается
  // следующим тиком крона, а не теряется. Эта строка — страховка на случай
  // прямого вызова с аномальной глубиной: resumeFrom откладывает раньше.
  if (depth > MAX_ASYNC_CHAIN) return state;
  let current = state;
  // Было ли в этом проходе отложенное продолжение (§1/§6): если нет — поток
  // дошёл до естественного конца, и счётчик отложений можно снять.
  let sawDefer = false;
  // id последнего отправленного ботом сообщения: нужно deleteBotMessage.
  // Пишем и в current.vars (персистится сессией), и в vars возобновлений.
  let botMsg: { chatId: number; messageId: number } | null = null;
  const rememberBotMsg = (payload: Record<string, unknown>, res: Response) => {
    res
      .json()
      .then((data: any) => {
        // VK: platformCall кладёт conversation_message_id в result.message_id —
        // форма едина с Telegram, отдельной ветки не нужно.
        const mid = Number(data?.result?.message_id);
        if (data?.ok && Number.isFinite(mid) && mid > 0) {
          botMsg = { chatId: Number(payload.chat_id ?? userId), messageId: mid };
          current.vars[BOT_MSG_VAR] = botMsg;
        }
      })
      .catch(() => {});
  };
  const withBotMsg = (vars: Record<string, unknown>): Record<string, unknown> =>
    botMsg ? { ...vars, [BOT_MSG_VAR]: botMsg } : vars;
  for (const out of outs) {
    if (out.method === 'action') {
      await handleAction(env, token, botId, userId, out.payload);
      continue;
    }
    // Служебные маркеры движка (§1/§2): продолжение после исчерпания бюджета
    // шагов, обрыв runaway-цикла, прерванный цикл. Движок чистый — решение
    // «что делать с остатком потока» принимает воркер: budget-resume кладёт
    // { resumeBlockId, vars } в scheduled_sends (method 'resume', сразу), и
    // крон продолжает поток следующим тиком. Раньше guardCutoff никто не читал
    // и сессия парковалась навсегда без единого лога.
    if (out.method === 'trace') {
      const p = out.payload as { kind?: string; event?: string; resumeBlockId?: string | null; vars?: Record<string, unknown> };
      if (p.kind === 'engine-budget-resume' && p.resumeBlockId) {
        sawDefer = true;
        const vars = { ...(p.vars ?? {}) };
        const defers = Math.floor(Number(vars[DEFER_COUNT_VAR]) || 0);
        if (defers >= MAX_BUDGET_RESUMES) {
          // Предохранитель от бесконечной эстафеты: прогресс каждого прохода
          // гарантирован (иначе сработал бы loop-guard), но поток длиннее
          // MAX_BUDGET_RESUMES × MAX_ENGINE_STEPS шагов останавливаем явно.
          delete vars[DEFER_COUNT_VAR];
          await logEvt('engine.budget.gaveup');
        } else {
          vars[DEFER_COUNT_VAR] = defers + 1;
          await insertScheduled(env.DB, botId, userId, Date.now(), 'resume', JSON.stringify({ resumeBlockId: p.resumeBlockId, vars })).catch(() => {});
          await logEvt(p.event || `engine.budget.resume.${p.resumeBlockId}`);
          // Сессия больше не «паркуется» на середине потока: продолжение
          // уехало в очередь, а следующий апдейт пользователя не должен
          // стартовать с того же блока (иначе поток задвоился бы).
          current.currentBlock = null;
        }
      } else if (p.kind === 'engine-loop-break' || p.kind === 'loop-deferred') {
        if (p.event) await logEvt(p.event);
      }
      continue;
    }
    if (out.method === 'delay') {
      const p = out.payload as { seconds?: number; next?: string | null; vars?: Record<string, unknown> };
      const sendAt = Date.now() + Math.max(0, Number(p.seconds) || 0) * 1000;
      await insertScheduled(env.DB, botId, userId, sendAt, 'resume', JSON.stringify({ resumeBlockId: p.next ?? null, vars: p.vars ?? {} }));
      await logEvt(`delay.scheduled.${p.seconds ?? 0}s`);
      continue;
    }
    if (out.method === 'subscription') {
      const sub = out.payload as { subAction?: string };
      if (sub.subAction === 'subscribe') await subscribe(env.DB, botId, userId);
      else if (sub.subAction === 'unsubscribe') await unsubscribe(env.DB, botId, userId);
      await logEvt(`subscription.${sub.subAction ?? '?'}`);
      continue;
    }
    if (out.method === 'http') {
      const p = out.payload as {
        url?: string;
        method?: string;
        headersJson?: string;
        bodyJson?: string;
        jsonPath?: string;
        outVar?: string;
        retries?: number;
        backoffMs?: number;
        collectVar?: string;
        paginate?: NormalizedPagination | null;
        next?: string | null;
        vars?: Record<string, unknown>;
      };
      const vars: Record<string, unknown> = withBotMsg({ ...(p.vars ?? {}) });
      let value: unknown = '';
      try {
        if (p.paginate) {
          // Постраничный обход: page/offset двигают число в query-параметре,
          // cursor берёт следующий курсор из ответа. Всё упирается в бюджет
          // времени (60 с на запрос у Telegram): недообойдённый обход кладёт
          // частичный результат и точку продолжения в __http_page.
          const walk = await httpPaginate(env, botId, userId, p, vars);
          if (p.collectVar) vars[p.collectVar] = walk.collected;
          if (p.outVar) vars[p.outVar] = p.collectVar ? walk.last : walk.collected;
          if (walk.truncated) vars[HTTP_PAGE_VAR] = walk.truncated;
          value = walk.collected;
        } else {
          value = await httpFetchValue(env, p, String(p.url));
        }
      } catch {
        await logEvt('http.error');
      }
      if (!p.paginate && p.outVar) vars[p.outVar] = value ?? '';
      if (!p.paginate) await logEvt('http.ok');
      current = await resumeFrom(env, token, botId, userId, p.next ?? null, vars, depth, scenario, botUsername, data, tags, referral, ops, defer, vkCtx, platform);
      continue;
    }
    if (out.method === 'ai') {
      const p = out.payload as {
        prompt?: string;
        system?: string;
        model?: string;
        outVar?: string;
        reply?: boolean;
        chatId?: number | null;
        historyVar?: string;
        historyTurns?: number;
        persistHistoryTo?: string;
        next?: string | null;
        vars?: Record<string, unknown>;
      };
      const vars: Record<string, unknown> = withBotMsg({ ...(p.vars ?? {}) });
      // Память диалога (§5): opt-in через historyVar. Нет переменной — вызов
      // ровно как раньше (system + один промпт). История живёт в vars и
      // переживает проходы; persistHistoryTo дублирует её в коллекцию, чтобы
      // она пережила сброс сессии (пишем через те же data-операции).
      const historyVar = String(p.historyVar ?? '').trim();
      const turns = clampTurns(p.historyTurns);
      const history = historyVar ? normalizeHistory(vars[historyVar], turns) : [];
      const assembled = assembleAiMessages(p.system || '', p.prompt || '', history);
      if (assembled.dropped > 0) await logEvt(`ai.history.truncated.${assembled.dropped}`);
      const answer = await aiComplete(env, p.system || '', p.prompt || '', p.model || '', fetch, assembled.messages);
      if (p.outVar) vars[p.outVar] = answer;
      if (historyVar) {
        vars[historyVar] = appendTurns(assembled.keptHistory, p.prompt || '', answer, turns);
        const coll = String(p.persistHistoryTo ?? '').trim();
        if (coll && data) {
          // Персист истории — best-effort: сбой записи не должен рвать диалог.
          await data
            .add(coll, { user_id: userId, history: JSON.stringify(vars[historyVar]), updated_at: Date.now() }, userId)
            .catch(() => null);
        }
      }
      if (p.reply && answer) {
        const chatId = p.chatId ?? userId;
        // F3-102: платформенный вызов — VK-боту ответ уходит в VK
        // (раньше прямой tgCall оставлял VK-бота молчащим).
        const send = isVk
          ? await platformCall('vk', token, 'sendMessage', { chat_id: chatId, text: answer }).catch(() => null)
          : await tgCall(token, 'sendMessage', { chat_id: chatId, text: answer }).catch(() => null);
        if (send) await rememberBotMsg({ chat_id: chatId }, send);
      }
      await logEvt(answer ? 'ai.ok' : 'ai.empty');
      current = await resumeFrom(env, token, botId, userId, p.next ?? null, vars, depth, scenario, botUsername, data, tags, referral, ops, defer, vkCtx, platform);
      continue;
    }
    // Ожидание с таймаутом: кладём задачу в существующую scheduled_sends
    // (method 'wait_timeout'), её разгребает тот же крон processDue. Задача
    // срабатывает только если сессия всё ещё стоит на этом блоке И nonce не
    // сменился — иначе молча удаляется (таймаут не должен firing twice).
    if (out.method === 'wait') {
      const p = out.payload as {
        blockId?: string;
        timeoutTarget?: string | null;
        nonce?: string;
        vars?: Record<string, unknown>;
        seconds?: number;
        maxWaitMinutes?: number;
        reminderText?: string;
        chatId?: number | null;
      };
      const seconds = Math.max(1, Number(p.seconds) || 60);
      const capSec = Number(p.maxWaitMinutes) > 0 ? Number(p.maxWaitMinutes) * 60 : 0;
      const waitMs = Math.min(seconds, capSec || seconds) * 1000;
      const payloadJson = JSON.stringify({
        blockId: p.blockId,
        timeoutTarget: p.timeoutTarget ?? null,
        nonce: p.nonce,
        vars: withBotMsg({ ...(p.vars ?? {}) }),
      });
      await insertScheduled(env.DB, botId, userId, Date.now() + waitMs, 'wait_timeout', payloadJson);
      // Напоминание — отдельная строка той же очереди на середине ожидания:
      // processDue шлёт его только если пользователь всё ещё молчит (тот же
      // nonce и current_block). Новый крон не создаём — механизм существующий.
      const reminder = String(p.reminderText ?? '').trim();
      if (reminder && p.chatId != null && waitMs > 4000) {
        await insertScheduled(
          env.DB,
          botId,
          userId,
          Date.now() + Math.floor(waitMs / 2),
          'wait_reminder',
          JSON.stringify({ blockId: p.blockId, nonce: p.nonce, chatId: p.chatId, text: reminder })
        );
      }
      await logEvt(`wait.scheduled.${Math.round(waitMs / 1000)}s`);
      continue;
    }
    // Правка сообщения с ветками (набор 2026-10): движок не знает результат
    // tgCall, поэтому ветку по ошибке Telegram выбирает воркер: слишком старое
    // (48 ч), не найдено (удалено/чужой чат), остальное — ok. «message is not
    // modified» — штатная ситуация (тот же текст): это ok, не ошибка.
    if (out.method === 'edit_message') {
      const p = out.payload as {
        chatId?: number;
        messageId?: number;
        text?: string;
        buttons?: { label?: string; value?: string; url?: string }[] | null;
        branches?: { ok?: string | null; too_old?: string | null; not_found?: string | null };
        vars?: Record<string, unknown>;
      };
      const vars: Record<string, unknown> = withBotMsg({ ...(p.vars ?? {}) });
      let branch: string | null | undefined = p.branches?.not_found ?? null;
      if (p.chatId != null && p.messageId != null) {
        const kb = p.buttons?.length
          ? { inline_keyboard: [p.buttons.map((b) => (b.url ? { text: b.label || b.value || '', url: b.url } : { text: b.label || b.value || '', callback_data: b.value || '' }))] }
          : undefined;
        const method = p.text ? 'editMessageText' : 'editMessageReplyMarkup';
        const payload: Record<string, unknown> = { chat_id: p.chatId, message_id: p.messageId };
        if (p.text) payload.text = p.text;
        if (kb) payload.reply_markup = kb;
        // VK: editMessageText→messages.edit (cmid). Ветки ошибок (too_old =
        // VK 909, not_found = VK 15/910) — платформенный вызов вернёт не-ok,
        // разбор ниже общий. «message is not modified» — у VK ответ всегда
        // ок/ошибка без описания, not_modified-ветку VK не проходит.
        const res = isVk
          ? await platformCall('vk', token, method, payload).catch(() => null)
          : await tgCall(token, method, payload).catch(() => null);
        if (res && res.ok) {
          branch = p.branches?.ok ?? null;
          await rememberBotMsg({ chat_id: p.chatId }, res);
        } else if (res) {
          const desc = String(((await res.json().catch(() => ({}))) as { description?: string }).description ?? '');
          if (desc.includes('message is not modified')) branch = p.branches?.ok ?? null;
          else if (/too old|can't be edited|message to edit not found|MESSAGE_ID_INVALID/i.test(desc)) {
            branch = /not found|MESSAGE_ID_INVALID/i.test(desc) ? p.branches?.not_found ?? null : p.branches?.too_old ?? null;
            await logEvt(/not found|MESSAGE_ID_INVALID/i.test(desc) ? 'edit.not_found' : 'edit.too_old');
          } else {
            branch = p.branches?.not_found ?? null;
            await logEvt('edit.error');
          }
        } else {
          await logEvt('edit.error');
        }
      } else {
        await logEvt('edit.no_ref');
      }
      current = await resumeFrom(env, token, botId, userId, branch ?? null, vars, depth, scenario, botUsername, data, tags, referral, ops, defer, vkCtx, platform);
      continue;
    }
    // ИИ-классификатор (набор 2026-10): модель выбирает метку из списка; ответ
    // парсит чистая функция (регистр, границы слова, «Метка:»), неразборчивый
    // ответ уходит в резервную метку. Метка кладётся в переменную автора.
    if (out.method === 'ai_classify') {
      const p = out.payload as {
        prompt?: string;
        labels?: string[];
        fallback?: string;
        outVar?: string;
        branches?: Record<string, string | null>;
        vars?: Record<string, unknown>;
      };
      const vars: Record<string, unknown> = withBotMsg({ ...(p.vars ?? {}) });
      const answer = await aiComplete(env, '', p.prompt || '', '', fetch, undefined).catch(() => '');
      const label = parseClassifyAnswer(answer, p.labels || [], p.fallback || 'other');
      if (p.outVar) vars[p.outVar] = label;
      await logEvt(answer ? `ai_classify.${label}` : 'ai_classify.empty');
      current = await resumeFrom(env, token, botId, userId, p.branches?.[label] ?? null, vars, depth, scenario, botUsername, data, tags, referral, ops, defer, vkCtx, platform);
      continue;
    }
    // Дедлайн (набор 2026-10): фоновая задача в существующей очереди
    // scheduled_sends (method 'deadline'). В момент срабатывания крон читает
    // ЖИВУЮ сессию: переменная-флаг отмены установлена — ветка done без
    // сообщения; нет — текст и ветка expired. Сессия не стоит на ожидании
    // (блок не пауза), поэтому защита от повтора — как у wait_timeout:
    // сверка current_block не нужна, задача одноразовая и удаляется сразу.
    if (out.method === 'deadline') {
      const p = out.payload as {
        blockId?: string;
        atMs?: number;
        cancelVar?: string;
        text?: string;
        branches?: { done?: string | null; expired?: string | null };
        chatId?: number | null;
      };
      const atMs = Math.max(Date.now() + 1000, Number(p.atMs) || Date.now() + 60000);
      await insertScheduled(
        env.DB,
        botId,
        userId,
        atMs,
        'deadline',
        JSON.stringify({
          blockId: p.blockId,
          cancelVar: p.cancelVar || '',
          text: p.text || '',
          branches: p.branches ?? {},
          chatId: p.chatId ?? null,
        })
      );
      await logEvt('deadline.scheduled');
      continue;
    }
    // Ответ на callback: движок не знает callback_query_id, подставляем здесь.
    // Без id вызывать Telegram бессмысленно (ошибка «query id is empty»).
    // VK: answerCallbackQuery = messages.sendMessageEventAnswer — требует
    // event_id входящего события (vkCtx), без него тоже пропускаем.
    if (out.method === 'answerCallbackQuery') {
      if (isVk) {
        if (vkCtx && cbqId) {
          const toast = typeof out.payload?.text === 'string' ? String(out.payload.text) : undefined;
          try {
            await vkCall('messages.sendMessageEventAnswer', vkEventAnswerParams(cbqId, vkCtx.userId, toast), token);
          } catch {
            /* не критично: кнопка не останется зависшей, событие одноразовое */
          }
        }
      } else if (cbqId) {
        await tgCall(token, 'answerCallbackQuery', { callback_query_id: cbqId, ...out.payload }).catch(() => {});
      }
      continue;
    }
    // Удаление сообщения: ошибки (старше 48 ч, нет прав) логируем и глотаем —
    // удаление не должно рвать сценарий.
    if (out.method === 'deleteMessage') {
      const res = isVk ? await platformCall('vk', token, 'deleteMessage', out.payload).catch(() => null) : await tgCall(token, 'deleteMessage', out.payload).catch(() => null);
      if (!res || !res.ok) await logEvt('delete.error');
      continue;
    }
    // Правка сообщения на месте. «message is not modified» — штатная ситуация
    // (автор нажал кнопку, ведущую на тот же текст): логируем, не ретраим.
    if (out.method === 'editMessageText' || out.method === 'editMessageReplyMarkup') {
      const res = isVk ? await platformCall('vk', token, out.method, out.payload).catch(() => null) : await tgCall(token, out.method, out.payload).catch(() => null);
      if (res && !res.ok) {
        const body = (await res.json().catch(() => ({}))) as { description?: string };
        const notModified = String(body?.description ?? '').includes('message is not modified');
        await logEvt(notModified ? 'edit.not_modified' : 'edit.error');
      }
      continue;
    }
    if (out.method === 'sendChatAction') {
      // Индикатор «печатает…»:best-effort, ошибка не важна (чат мог закрыться).
      await platformCall(isVk ? 'vk' : 'telegram', token, 'sendChatAction', out.payload).catch(() => {});
      continue;
    }
    if (out.method === 'sendPoll') {
      const res = isVk ? await platformCall('vk', token, 'sendPoll', out.payload).catch(() => null) : await tgCall(token, 'sendPoll', out.payload).catch(() => null);
      if (!res || !res.ok) {
        // F-025: причина отказа (вопрос >300, вариант >100, битый correct_option_id)
        // — в observability рядом с poll.error.
        const body = res ? ((await res.json().catch(() => ({}))) as { description?: string }) : null;
        if (body?.description) console.warn(`[send] sendPoll: ${String(body.description).slice(0, 300)}`, { botId, userId });
        await logEvt('poll.error');
      }
      continue;
    }
    if (out.method === 'forwardMessage' || out.method === 'copyMessage') {
      const res = isVk ? await platformCall('vk', token, out.method, out.payload).catch(() => null) : await tgCall(token, out.method, out.payload).catch(() => null);
      if (!res || !res.ok) await logEvt('forward.error');
      continue;
    }
    // sendAudio приходит только из блока «Цепочка» — альбом аудио не умеет.
    if (
      out.method === 'sendMessage' ||
      out.method === 'sendPhoto' ||
      out.method === 'sendVideo' ||
      out.method === 'sendAudio' ||
      out.method === 'sendDocument'
    ) {
      try {
        const res = isVk
          ? await platformCall('vk', token, out.method, out.payload, await vkGroupOpts())
          : await tgCall(token, out.method, out.payload);
        // F-025/F-026: Telegram отклонил отправку (400 — текст/вопрос длиннее
        // лимита, чат закрыт, parse_mode битый). logEvent не пишет detail в БД,
        // поэтому причина уходит в console.warn (observability) рядом с
        // существующим событием send.error; схему logs не меняем.
        // F-028: 429 логируем отдельно с retry_after — автор видит троттлинг.
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
          if (res.status === 429) {
            console.warn(`[send] 429 ${out.method}: retry_after=${body?.parameters?.retry_after ?? '?'}`, { botId, userId });
            await logEvt(`send.rate_limited.${Number(body?.parameters?.retry_after) || 0}s`);
          } else {
            console.warn(`[send] ${res.status} ${out.method}: ${String(body?.description ?? '').slice(0, 300)}`, { botId, userId });
            await logEvt('send.error');
          }
        } else {
          // id отправленного сообщения — для deleteBotMessage ({{__bot_msg}}).
          rememberBotMsg(out.payload, res);
        }
      } catch {
        // Telegram недоступен или отклонил отправку. Падать 500 нельзя:
        // иначе Telegram начнёт повторять апдейт и завалит бота.
        await logEvt('send.error');
      }
    } else if (out.method === 'sendMediaGroup') {
      // Альбом: media должен быть сериализован как JSON-строка для Telegram API.
      // VK: альбомов нет — текст-фолбэк через translateOutgoing (если в media
      // есть caption), иначе просто пропускаем (валидация уже не пропустила бы
      // media_group на VK-боте; это страховка рантайма).
      try {
        const media = out.payload?.media;
        if (isVk) {
          // VK: альбом = загрузка каждого фото upload-цепочкой + один
          // messages.send со списком attachment (vkSendMediaGroup).
          await platformCall('vk', token, 'sendMediaGroup', out.payload, await vkGroupOpts());
        } else {
          await tgCall(token, 'sendMediaGroup', {
            chat_id: out.payload?.chat_id,
            media: typeof media === 'string' ? media : JSON.stringify(media ?? []),
          });
        }
      } catch {
        await logEvt('media_group.error');
      }
    } else if (out.method === 'sendInvoice') {
      // Платёжный счёт. provider_token обязателен — если его нет в блоке,
      // берём из зашифрованного секрета платёжного подключения (connectionId).
      // VK: нативных инвойсов нет — валидация не пропустит invoice-блок на
      // VK-боте, это страховка рантайма (sendInvoice VK-боту → текст-фолбэк
      // с описанием, ссылки платит payment_link с внешним провайдером).
      const payload = { ...out.payload };
      try {
        if (!payload.provider_token && payload.connectionId && ops) {
          const conn = await getPaymentConnection(env.DB, botId, String(payload.connectionId));
          if (conn && conn.provider === 'telegram') {
            const secrets = await readSecrets(conn.secrets_enc, env.ENCRYPTION_KEY);
            if (secrets.providerToken) payload.provider_token = secrets.providerToken;
          }
        }
        delete payload.connectionId;
        if (!payload.provider_token) throw new Error('no provider_token');
        await platformCall(isVk ? 'vk' : 'telegram', token, 'sendInvoice', payload);
      } catch {
        // Типичные ошибки: неверный provider_token, не включены Payments в BotFather.
        // Падать нельзя — пользователю хотя бы скажем, что счёт не выставлен.
        try {
          await platformCall(isVk ? 'vk' : 'telegram', token, 'sendMessage', {
            chat_id: out.payload?.chat_id,
            text: 'Не получилось выставить счёт. Попробуйте позже.',
          });
        } catch {
          /* ignore */
        }
        await logEvt('invoice.error');
      }
    }
  }
  if (botMsg) current.vars[BOT_MSG_VAR] = botMsg;
  // Проход завершился без нового отложения — счётчик продолжений больше не
  // нужен (иначе он копился бы между несвязанными инцидентами одного юзера).
  if (!sawDefer) delete current.vars[DEFER_COUNT_VAR];
  return current;
}

// Continue the scenario from a given block (used after http/ai/delay completes).
async function resumeFrom(
  env: Env,
  token: string,
  botId: string,
  userId: number,
  blockId: string | null,
  vars: Record<string, unknown>,
  depth: number,
  scenario?: Scenario | null,
  botUsername?: string | null,
  data?: DataOps,
  tags?: TagOps,
  referral?: ReferralOps,
  ops?: EngineOps,
  defer?: DeferFn,
  vkCtx?: { eventId: string; userId: number } | null,
  platform?: 'telegram' | 'vk'
): Promise<{ currentBlock: string | null; vars: Record<string, unknown> }> {
  if (!blockId) return { currentBlock: null, vars };
  // §6: цепочка http/ai длиннее MAX_ASYNC_CHAIN не обрывается молча, а
  // откладывается в scheduled_sends (method 'resume', сразу) — тот же
  // механизм, что у §1. Почему не бесконечная рекурсия в одном запросе:
  // Telegram ждёт ответ вебхука 60 с (TG_TIMEOUT_MS = 15 с на один вызов),
  // каждый шаг цепочки — это внешний запрос (http/ai) плюс отправки в
  // Telegram; 25 вложенных проходов ещё укладываются в бюджет запроса, а
  // остаток честно доезжает кроном (тик раз в минуту) без потери переменных.
  if (depth >= MAX_ASYNC_CHAIN) {
    await insertScheduled(env.DB, botId, userId, Date.now(), 'resume', JSON.stringify({ resumeBlockId: blockId, vars })).catch(() => {});
    await logEvent(env.DB, botId, userId, `async.chain.deferred.${depth}`).catch(() => {});
    return { currentBlock: null, vars };
  }
  // Reuse the scenario already loaded for this request; only hit D1 when resuming
  // from a separate trigger (e.g. the delay cron), where a newer version may exist.
  let scn = scenario;
  if (!scn) {
    const sc = await loadScenario(env.DB, botId);
    if (!sc) return { currentBlock: null, vars };
    scn = JSON.parse(sc.flow_json) as Scenario;
  }
  const res = await runEngine({
    scenario: scn,
    update: {},
    session: { currentBlock: null, vars },
    startBlockId: blockId,
    botUsername,
    data,
    tags,
    referral,
    ...(ops ?? {}),
  });
  return dispatchOuts(env, token, botId, userId, res.outs, { currentBlock: res.currentBlock, vars: res.vars }, depth + 1, scn, botUsername, data, tags, referral, ops, undefined, defer, vkCtx, platform);
}

// system + prompt — легаси-путь (один промпт, без истории). Когда вызывающий
// передал messages (§5, память диалога), используем их напрямую: там уже
// [system?, ...history, {role:'user', content: prompt}] с учётом бюджета 8 КБ.
async function aiComplete(
  env: Env,
  system: string,
  prompt: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
  messages?: Array<{ role: string; content: string }>
): Promise<string> {
  if (!env.AI_API_KEY) return '';
  const base = (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const modelId = model || env.AI_MODEL || 'gpt-4o-mini';
  const body = messages ?? [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
      body: JSON.stringify({ model: modelId, messages: body }),
      signal: AbortSignal.timeout(TG_TIMEOUT_MS),
    });
    if (!res.ok) return '';
    const data = JSON.parse(await readCapped(res)) as any;
    return String(data?.choices?.[0]?.message?.content ?? '');
  } catch {
    return '';
  }
}

async function handleAction(env: Env, token: string, botId: string, userId: number, payload: Record<string, unknown>) {
  const kind = payload.kind;
  if (kind === 'webhook') {
    try {
      const res = await safeFetch(
        String(payload.url),
        {
          method: (payload.method as string) || 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bot_id: botId, user_id: userId, vars: payload.vars ?? {} }),
        },
        env
      );
      await readCapped(res);
    } catch {
      await logEvent(env.DB, botId, userId, 'action.webhook.error').catch(() => {});
    }
  } else if (kind === 'notify') {
    if (env.ADMIN_TG_ID) {
      await tgCall(token, 'sendMessage', {
        chat_id: env.ADMIN_TG_ID,
        text: `[bot ${botId}] ${payload.notifyText ?? 'уведомление'}`,
      });
    }
  } else if (kind === 'broadcast') {
    const text = String(payload.broadcastText ?? '');
    const subs = await listSubscribers(env.DB, botId);
    await sendBroadcast(env, token, botId, userId, text, subs);
  }
  // 'delay' is handled in the webhook loop (scheduled resume), not here.
}

// Рассылка ВСЕГДА идёт через scheduled_sends. Раньше до 20 подписчиков
// отправлялись прямо в обработчике вебхука: 20 последовательных запросов к
// Telegram легко превышали 60 секунд, после чего Telegram повторял апдейт и
// получатель видел сообщение дважды.
const BROADCAST_CHUNK = 20;

async function sendBroadcast(
  env: Env,
  _token: string,
  botId: string,
  userId: number,
  text: string,
  subs: number[]
): Promise<void> {
  if (!subs.length) {
    await logEvent(env.DB, botId, userId, 'broadcast.sent.0');
    return;
  }
  const rows: BroadcastChunk[] = [];
  let i = 0;
  for (let s = 0; s < subs.length; s += BROADCAST_CHUNK) {
    rows.push({
      bot_id: botId,
      user_id: userId,
      send_at: Date.now() + i * 2000,
      method: 'broadcast',
      payload_json: JSON.stringify({ text, users: subs.slice(s, s + BROADCAST_CHUNK) }),
    });
    i++;
  }
  await insertScheduledBatch(env.DB, rows);
  await logEvent(env.DB, botId, userId, `broadcast.queued.${subs.length}`);
}

// Process due delayed sends (called from the cron trigger).
//
// Ретраи: раньше любое исключение внутри обработки удаляло задачу — временная
// недоступность Telegram или D1 означала, что отложенное сообщение или пачка
// рассылки просто исчезли. Теперь ошибки делятся на два типа:
//   • фатальные (бота нет, сценария нет, мусор в payload) — удаляем сразу;
//   • всё остальное — увеличиваем счётчик и перепланируем с паузой,
//     и только после MAX_ATTEMPTS выбрасываем задачу.
const MAX_ATTEMPTS = 5;

function retryDelayMs(attempt: number): number {
  // 1 мин → 2 → 4 → 8 (крон тикает раз в минуту, поэтому минимум — минута)
  return Math.min(8 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

// Ошибка, после которой повторять бессмысленно.
class FatalJobError extends Error {}

// Параллельность отправки рассылки в processDue: 8 одновременных вызовов
// Telegram API — с запасом под лимитом ~30 msg/s на бота. Не путать с
// BROADCAST_CHUNK выше (размер пачки подписчиков при постановке в очередь).
const BROADCAST_PARALLEL = 8;

// ---------------- расписания (§4) ----------------

// Тик крона: выбирает живые bot_schedules, считает срабатывания
// (shared/cron.ts, минутная гранулярность, зона автора) и ставит работу в
// существующую очередь scheduled_sends. Двойной тик в одну минуту не
// дублирует отправку: markScheduleRun атомарна (WHERE last_run_at < ?) —
// победитель ровно один. Блок, пропавший из опубликованной сборки или
// замороженный автором, глушится (enabled = 0) с логом — без error-loop.
async function processSchedules(env: Env, nowMs: number): Promise<number> {
  const rows = await listEnabledSchedules(env.DB).catch(() => [] as BotScheduleRow[]);
  let fired = 0;
  for (const row of rows) {
    try {
      if (!isScheduleDue(row, nowMs)) continue;
      const bot = await getBot(env.DB, row.bot_id);
      if (!bot || !bot.active) continue; // бот удалён/выключен — строка глушится каскадом или останется до включения
      const sc = await loadScenario(env.DB, row.bot_id);
      if (!sc) {
        await disableSchedule(env.DB, row.id);
        await logEvent(env.DB, row.bot_id, row.audience_user, `schedule.disabled.${row.block_id}`).catch(() => {});
        continue;
      }
      let scenario: Scenario;
      try {
        scenario = JSON.parse(sc.flow_json) as Scenario;
      } catch {
        await disableSchedule(env.DB, row.id);
        continue;
      }
      const block = scenario.blocks?.[row.block_id];
      if (!block || block.params?.disabled) {
        // Блок удалён из сборки или заморожен — расписание больше не живое.
        await disableSchedule(env.DB, row.id);
        await logEvent(env.DB, row.bot_id, row.audience_user, `schedule.disabled.${row.block_id}`).catch(() => {});
        continue;
      }
      // Атомарный захват минуты: два тика (или два изолята) — один победитель.
      const won = await markScheduleRun(env.DB, row.id, nowMs);
      if (!won) continue;

      // Поток запуска — next блока регистрации (сам блок повторно не
      // выполняется: он бы перерегистрировал расписание).
      const resumeBlockId = block.next ?? null;
      if (!resumeBlockId) {
        await logEvent(env.DB, row.bot_id, row.audience_user, `schedule.noflow.${row.block_id}`).catch(() => {});
        continue;
      }

      if (row.audience === 'single') {
        const uid = Number(row.audience_user) || 0;
        if (!uid) {
          await logEvent(env.DB, row.bot_id, 0, `schedule.nouser.${row.block_id}`).catch(() => {});
          continue;
        }
        // __chat = uid: в личных чатах id чата совпадает с id пользователя —
        // resume-проход без апдейта знает, куда слать сообщения.
        await insertScheduled(env.DB, row.bot_id, uid, nowMs, 'resume', JSON.stringify({ resumeBlockId, vars: { [CHAT_FALLBACK_VAR]: uid }, schedule: row.block_id }));
        await logEvent(env.DB, row.bot_id, uid, `schedule.fired.${row.block_id}.single`).catch(() => {});
        fired++;
        continue;
      }

      // all / tag: пачки через ту же очередь. Получатели — ТЕКУЩИЙ список на
      // момент срабатывания (никакого backfill прошлых запусков для новых
      // подписчиков). Потолок на бота за тик — MAX_SCHEDULE_RECIPIENTS_PER_TICK.
      const users = row.audience === 'tag'
        ? await listUserIdsByTag(env.DB, row.bot_id, normalizeTag(row.audience_tag), MAX_SCHEDULE_RECIPIENTS_PER_TICK).catch(() => [] as number[])
        : await listSubscribers(env.DB, row.bot_id).catch(() => [] as number[]);
      const list = users.slice(0, MAX_SCHEDULE_RECIPIENTS_PER_TICK);
      const chunks: BroadcastChunk[] = [];
      for (let s = 0; s < list.length; s += SCHEDULE_RUN_CHUNK) {
        chunks.push({
          bot_id: row.bot_id,
          // Владелец пачки — audience_user блока регистрации (или 0):
          // user_id в scheduled_sends NOT NULL, а logs требуют автора.
          user_id: Number(row.audience_user) || 0,
          send_at: nowMs + Math.floor(s / SCHEDULE_RUN_CHUNK) * SCHEDULE_RUN_STAGGER_MS,
          method: 'schedule_run',
          payload_json: JSON.stringify({ resumeBlockId, users: list.slice(s, s + SCHEDULE_RUN_CHUNK), schedule: row.block_id }),
        });
      }
      if (chunks.length) await insertScheduledBatch(env.DB, chunks);
      await logEvent(env.DB, row.bot_id, Number(row.audience_user) || 0, `schedule.fired.${row.block_id}.${list.length}`).catch(() => {});
      fired += list.length ? 1 : 0;
    } catch {
      // Одно расписание не должно рвать весь тик: попробуем в следующую минуту.
      await logEvent(env.DB, row.bot_id, row.audience_user, 'schedule.tick.error').catch(() => {});
    }
  }
  return fired;
}

async function processDue(env: Env): Promise<{ processed: number; retried: number; dropped: number }> {
  const due = await dueScheduled(env.DB, Date.now());
  let processed = 0;
  let retried = 0;
  let dropped = 0;

  for (const row of due) {
    // F-013: атомарный захват ДО обработки. Два тика крона (или два изолята)
    // выбирают одни и те же due-строки; claimScheduledSend отдаёт задачу ровно
    // одному — проигравший пропускает её молча (не processed, не retry).
    const claimed = await claimScheduledSend(env.DB, row.id, Date.now()).catch(() => true);
    if (!claimed) continue;
    try {
      const bot = await getBot(env.DB, row.bot_id);
      if (!bot) throw new FatalJobError('бот удалён');
      const token = await decryptToken(bot.token_enc, env.ENCRYPTION_KEY);
      // Платформа бота: крон не знает контекста вебхука, поэтому транспорт
      // выбирается по строке бота. VK-ботам НЕ передаём vkCtx (event_id кнопок
      // недоступен из крона — answerCallbackQuery там и не нужен).
      const platform = bot.platform === 'vk' ? 'vk' : 'telegram';

      let payload: any;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        throw new FatalJobError('payload не парсится');
      }

      // Пачка рассылки: просто отправляем сообщение списку получателей,
      // движок здесь не нужен. mediaUrl/parseMode приходят из сегментной
      // рассылки (makeBroadcastOps); у старой рассылки их нет — поведение прежнее.
      if (row.method === 'broadcast') {
        const data = payload as { text?: string; users?: number[]; mediaUrl?: string; parseMode?: string };
        const extra: Record<string, unknown> = {};
        if (data.parseMode && data.parseMode !== 'none') extra.parse_mode = data.parseMode;
        let sent = 0;
        // Отправка порциями по 8: последовательно 1000 получателей — это
        // 1000 × RTT. Лимит Telegram ~30 msg/s на бота, 8 параллельных
        // под ним с запасом. Семантика sent прежняя: считается каждый
        // неполучивший исключение вызов (fulfilled с ответом не-ok тоже
        // считается — как раньше считался не бросающий tgCall).
        const users = data.users ?? [];
        // F-028: получатели, которых Telegram отбил 429, возвращаются в
        // очередь отдельным payload (remaining) — ушедшие не дублируются.
        const remaining: number[] = [];
        let rateLimitSec = 0;
        for (let i = 0; i < users.length; i += BROADCAST_PARALLEL) {
          const chunk = users.slice(i, i + BROADCAST_PARALLEL);
          const results = await Promise.allSettled(
            chunk.map((uid) =>
              // Кроссплатформенная рассылка: Telegram — tgCallChecked (429-
              // семантика F-028 сохранена), VK — platformCall (VK сам не 429:
              // его ошибки брошены VkApiError и попадут в общий retry-цикл).
              data.mediaUrl
                ? platform === 'vk'
                  ? platformCall('vk', token, 'sendPhoto', { chat_id: uid, photo: data.mediaUrl, caption: data.text ?? '', ...extra })
                  : tgCallChecked(token, 'sendPhoto', { chat_id: uid, photo: data.mediaUrl, caption: data.text ?? '', ...extra })
                : platform === 'vk'
                ? platformCall('vk', token, 'sendMessage', { chat_id: uid, text: data.text ?? '', ...extra })
                : tgCallChecked(token, 'sendMessage', { chat_id: uid, text: data.text ?? '', ...extra })
            )
          );
          // отдельного получателя могли заблокировать — идём дальше
          for (let j = 0; j < results.length; j++) {
            const r = results[j];
            if (r.status === 'fulfilled') sent++;
            else if (r.reason instanceof TgRateLimitError) {
              remaining.push(chunk[j]);
              rateLimitSec = Math.max(rateLimitSec, r.reason.retryAfterSec);
            }
          }
        }
        if (remaining.length) {
          // 429 — НЕ попытка: attempts не растёт, задача переносится на
          // now + retry_after и освобождает захват (следующий тик её увидит).
          await rescheduleScheduledSend(env.DB, row.id, Date.now() + rateLimitSec * 1000, JSON.stringify({ ...data, users: remaining }));
          await logEvent(env.DB, row.bot_id, row.user_id, `broadcast.rate_limited.${remaining.length}.${rateLimitSec}s`);
          processed++;
          continue;
        }
        await logEvent(env.DB, row.bot_id, row.user_id, `broadcast.chunk.${sent}`);
        await deleteScheduled(env.DB, row.id);
        processed++;
        continue;
      }

      // Плановый запуск потока (§4): пачка получателей расписания, каждому —
      // полноценный проход движка с resumeBlockId. В отличие от 'broadcast'
      // здесь не готовый текст, а сценарий: пользователи получают персональные
      // ветки (условия, данные, счётчики работают).
      if (row.method === 'schedule_run') {
        const data = payload as { resumeBlockId?: string | null; users?: number[] };
        const sc = await loadScenario(env.DB, row.bot_id);
        if (!sc) throw new FatalJobError('сценария нет');
        const scenario = JSON.parse(sc.flow_json) as Scenario;
        const resumeBlockId = data.resumeBlockId ?? null;
        if (!resumeBlockId || !scenario.blocks?.[resumeBlockId]) {
          // Поток пересобрали, цель пропала — задача бессмысленна, не ретраим.
          throw new FatalJobError('блок запуска исчез');
        }
        const users = data.users ?? [];
        for (const uid of users) {
          const ops = makeEngineOps(env, row.bot_id, token, uid, '');
          const result = await runEngine({
            scenario,
            update: {},
            // __chat = uid: личный чат, куда слать плановые сообщения.
            session: { currentBlock: null, vars: { [CHAT_FALLBACK_VAR]: uid } },
            startBlockId: resumeBlockId,
            data: makeDataOps(env.DB, row.bot_id),
            tags: makeTagOps(env.DB, row.bot_id),
            referral: makeReferralOps(env.DB, row.bot_id),
            ...ops,
          });
          const final = await dispatchOuts(env, token, row.bot_id, uid, result.outs, { currentBlock: result.currentBlock, vars: result.vars }, 0, scenario, undefined, undefined, undefined, undefined, ops, undefined, undefined, undefined, platform);
          // Плановый запуск НЕ трогает интерактивную сессию пользователя:
          // currentBlock записываем только если сессии нет или она пуста —
          // иначе digest-рассылка переставила бы пользователя посреди диалога.
          const sess = await getSession(env.DB, row.bot_id, uid).catch(() => null);
          if (!sess || !sess.current_block) {
            await upsertSession(env.DB, row.bot_id, uid, final.currentBlock, JSON.stringify(final.vars));
          }
          await logEvent(env.DB, row.bot_id, uid, `schedule.run.${row.id}`).catch(() => {});
        }
        await deleteScheduled(env.DB, row.id);
        processed++;
        continue;
      }

      // Дедлайн (набор 2026-10). Задача одноразовая: удаляется сразу. Живая
      // сессия решает ветку: переменная-флаг отмены установлена и не '0'/'false'
      // — возобновляем с done БЕЗ сообщения (пользователь успел: оплатил,
      // подтвердил); иначе шлём deadlineText и возобновляем с expired. Сессии
      // нет или пользователь ушёл из диалога — expired всё равно честнее тишины:
      // автор сам решает, что писать в этой ветке.
      if (row.method === 'deadline') {
        const d = payload as {
          blockId?: string;
          cancelVar?: string;
          text?: string;
          branches?: { done?: string | null; expired?: string | null };
          chatId?: number | null;
        };
        const sess = await getSession(env.DB, row.bot_id, row.user_id).catch(() => null);
        const vars: Record<string, unknown> = sess?.vars_json ? JSON.parse(sess.vars_json) : {};
        const cancelled = deadlineBranch(vars, String(d.cancelVar || '')) === 'done';
        const target = cancelled ? d.branches?.done ?? null : d.branches?.expired ?? null;
        if (!cancelled && d.text && d.chatId != null) {
          await platformCall(platform, token, 'sendMessage', { chat_id: d.chatId, text: d.text }).catch(() => null);
        }
        await logEvent(env.DB, row.bot_id, row.user_id, cancelled ? 'deadline.done' : 'deadline.expired').catch(() => {});
        if (!target) {
          await deleteScheduled(env.DB, row.id);
          processed++;
          continue;
        }
        const sc = await loadScenario(env.DB, row.bot_id);
        if (!sc) throw new FatalJobError('сценария нет');
        const scenario = JSON.parse(sc.flow_json) as Scenario;
        if (!scenario.blocks?.[target]) throw new FatalJobError('ветка дедлайна исчезла');
        const ops = makeEngineOps(env, row.bot_id, token, row.user_id, '');
        const result = await runEngine({
          scenario,
          update: {},
          session: { currentBlock: null, vars: { ...vars, [CHAT_FALLBACK_VAR]: d.chatId ?? vars[CHAT_FALLBACK_VAR] ?? row.user_id } },
          startBlockId: target,
          data: makeDataOps(env.DB, row.bot_id),
          tags: makeTagOps(env.DB, row.bot_id),
          referral: makeReferralOps(env.DB, row.bot_id),
          ...ops,
        });
        const final = await dispatchOuts(env, token, row.bot_id, row.user_id, result.outs, { currentBlock: result.currentBlock, vars: result.vars }, 0, scenario, undefined, undefined, undefined, undefined, ops, undefined, undefined, undefined, platform);
        await upsertSession(env.DB, row.bot_id, row.user_id, final.currentBlock, JSON.stringify(final.vars));
        await deleteScheduled(env.DB, row.id);
        processed++;
        continue;
      }

      // Таймаут блока «Ожидание». Срабатывает только если сессия ВСЁ ЕЩЁ стоит
      // на этом блоке и nonce не сменился: пользователь мог ответить (движок
      // удаляет __wait.* и уходит по ветке reply) или сценарий ушёл дальше —
      // тогда задача молча удаляется. Это защита от двойного срабатывания.
      if (row.method === 'wait_timeout') {
        const w = payload as { blockId?: string; timeoutTarget?: string | null; nonce?: string; vars?: Record<string, unknown> };
        const sess = await getSession(env.DB, row.bot_id, row.user_id);
        const stillWaiting =
          !!sess &&
          sess.current_block === w.blockId &&
          String((sess.vars_json ? JSON.parse(sess.vars_json) : {})[waitVar(String(w.blockId))] ?? '') === String(w.nonce ?? '');
        if (!stillWaiting) {
          await deleteScheduled(env.DB, row.id);
          await logEvent(env.DB, row.bot_id, row.user_id, 'wait.timeout.stale').catch(() => {});
          processed++;
          continue;
        }
        const sc = await loadScenario(env.DB, row.bot_id);
        if (!sc) throw new FatalJobError('сценария нет');
        const scenario = JSON.parse(sc.flow_json) as Scenario;
        const ops = makeEngineOps(env, row.bot_id, token, row.user_id, '');
        // __wait.* снимается до возобновления: ветка timeout не должна
        // оставить аренду, иначе повторный заход на блок её не перезапишет.
        const vars = { ...(w.vars ?? {}) };
        delete vars[waitVar(String(w.blockId))];
        const result = await runEngine({
          scenario,
          update: {},
          session: { currentBlock: null, vars },
          startBlockId: w.timeoutTarget ?? undefined,
          data: makeDataOps(env.DB, row.bot_id),
          tags: makeTagOps(env.DB, row.bot_id),
          referral: makeReferralOps(env.DB, row.bot_id),
          ...ops,
        });
        const final = await dispatchOuts(
          env,
          token,
          row.bot_id,
          row.user_id,
          result.outs,
          { currentBlock: result.currentBlock, vars: result.vars },
          0,
          scenario,
          undefined,
          undefined,
          undefined,
          undefined,
          ops,
          undefined,
          undefined,
          undefined,
          platform
        );
        await upsertSession(env.DB, row.bot_id, row.user_id, final.currentBlock, JSON.stringify(final.vars));
        await logEvent(env.DB, row.bot_id, row.user_id, `wait.timeout.fired.${w.blockId}`);
        await deleteScheduled(env.DB, row.id);
        processed++;
        continue;
      }

      // Напоминание в середине ожидания: отправляется только если пользователь
      // всё ещё молчит (тот же блок и nonce). Движок не нужен — просто текст.
      if (row.method === 'wait_reminder') {
        const w = payload as { blockId?: string; nonce?: string; chatId?: number; text?: string };
        const sess = await getSession(env.DB, row.bot_id, row.user_id);
        const stillWaiting =
          !!sess &&
          sess.current_block === w.blockId &&
          String((sess.vars_json ? JSON.parse(sess.vars_json) : {})[waitVar(String(w.blockId))] ?? '') === String(w.nonce ?? '');
        if (stillWaiting && w.chatId != null && w.text) {
          await platformCall(platform, token, 'sendMessage', { chat_id: w.chatId, text: w.text }).catch(() => {});
          await logEvent(env.DB, row.bot_id, row.user_id, `wait.reminder.${w.blockId}`).catch(() => {});
        }
        await deleteScheduled(env.DB, row.id);
        processed++;
        continue;
      }

      const data = payload as { resumeBlockId?: string | null; vars?: Record<string, unknown> };
      const sc = await loadScenario(env.DB, row.bot_id);
      if (!sc) throw new FatalJobError('сценария нет');
      const scenario = JSON.parse(sc.flow_json) as Scenario;
      const cronDataOps = makeDataOps(env.DB, row.bot_id);
      const cronTagOps = makeTagOps(env.DB, row.bot_id);
      const cronReferralOps = makeReferralOps(env.DB, row.bot_id);
      const cronOps = makeEngineOps(env, row.bot_id, token, row.user_id, '');
      const result = await runEngine({
        scenario,
        update: {},
        session: { currentBlock: null, vars: data.vars ?? {} },
        startBlockId: data.resumeBlockId ?? undefined,
        data: cronDataOps,
        tags: cronTagOps,
        referral: cronReferralOps,
        ...cronOps,
      });
      const final = await dispatchOuts(
        env,
        token,
        row.bot_id,
        row.user_id,
        result.outs,
        { currentBlock: result.currentBlock, vars: result.vars },
        0,
        scenario,
        undefined,
        cronDataOps,
        cronTagOps,
        cronReferralOps,
        cronOps,
        undefined,
        undefined,
        undefined,
        platform
      );
      await upsertSession(env.DB, row.bot_id, row.user_id, final.currentBlock, JSON.stringify(final.vars));
      await logEvent(env.DB, row.bot_id, row.user_id, `delay.resume.${data.resumeBlockId ?? 'end'}`);
      await deleteScheduled(env.DB, row.id);
      processed++;
    } catch (e: any) {
      if (e instanceof FatalJobError) {
        await deleteScheduled(env.DB, row.id).catch(() => {});
        await logEvent(env.DB, row.bot_id, row.user_id, 'scheduled.dropped').catch(() => {});
        dropped++;
        continue;
      }
      // F-028: 429 от Telegram — не сбой задачи, а просьба подождать. Попытку
      // не тратим: переносим send_at на retry_after и освобождаем захват.
      if (e instanceof TgRateLimitError) {
        await rescheduleScheduledSend(env.DB, row.id, Date.now() + e.retryAfterSec * 1000).catch(() => {});
        await logEvent(env.DB, row.bot_id, row.user_id, `scheduled.rate_limited.${e.retryAfterSec}s`).catch(() => {});
        retried++;
        continue;
      }
      const attempt = await bumpScheduledAttempt(env.DB, row.id).catch(() => MAX_ATTEMPTS);
      if (attempt >= MAX_ATTEMPTS) {
        await deleteScheduled(env.DB, row.id).catch(() => {});
        await logEvent(env.DB, row.bot_id, row.user_id, 'scheduled.gaveup').catch(() => {});
        dropped++;
        continue;
      }
      // Крон тикает раз в минуту — откладываем, чтобы не долбить Telegram
      // тем же запросом каждую минуту подряд. Захват освобождаем
      // (rescheduleScheduledSend): иначе перенесённая задача невидима для
      // dueScheduled до истечения stale-окна захвата.
      const delay = retryDelayMs(attempt);
      await rescheduleScheduledSend(env.DB, row.id, Date.now() + delay).catch(() => {});
      await logEvent(env.DB, row.bot_id, row.user_id, `scheduled.retry.${attempt}`).catch(() => {});
      retried++;
    }
  }
  return { processed, retried, dropped };
}

// ---------------- Cron (delayed sends) ----------------

// Чистка логов — ровно в 03:00 UTC, время берём из scheduledTime крон-события.
// Раньше решение принималось по ключу KV, который читался на КАЖДОМ тике
// (1440 чтений в день впустую). Крон может продублировать тик или пропустить
// минуту — чистка идемпотентна (DELETE ... WHERE ts < ?), двойной прогон
// безвреден, а пропущенный день догонится следующим тиком 03:00.
function isLogsCleanupTick(at: Date): boolean {
  return at.getUTCHours() === 3 && at.getUTCMinutes() === 0;
}

export default {
  fetch: (req: Request, env: Env, ctx: any) => app.fetch(req, env, ctx),
  async scheduled(event: any, env: Env) {
    // Расписания (§4) считаем ДО processDue: пачки schedule_run, поставленные
    // этим тиком (send_at = now), разгребутся здесь же, без лишней минуты ожидания.
    const nowMs = event?.scheduledTime ? new Date(event.scheduledTime).getTime() : Date.now();
    let schedules = 0;
    try {
      schedules = await processSchedules(env, nowMs);
    } catch {
      /* сбой расписаний не должен рвать обработку очереди */
    }
    const r = await processDue(env);
    // Логи растут бесконечно и тормозят аналитику — чистим раз в сутки
    // (окно 30 дней), best-effort.
    let cleaned = 0;
    try {
      const at = event?.scheduledTime ? new Date(event.scheduledTime) : new Date();
      if (isLogsCleanupTick(at)) {
        cleaned = await deleteOldLogs(env.DB, Date.now() - 30 * 86_400_000);
      }
    } catch {
      /* чистка best-effort: не вышло — догонит следующий тик 03:00 */
    }
    const summary = `processed ${r.processed}, retried ${r.retried}, dropped ${r.dropped}${schedules ? `, schedules ${schedules}` : ''}`;
    if (r.retried || r.dropped) console.warn(`[cron] ${summary}`);
    return new Response(`${summary}${cleaned ? `, cleaned ${cleaned} logs` : ''}`);
  },
};

export const _testOnly = { aiComplete, isBlockedHost, safeFetch, toCsv, markSkillLevelChosen, simulateScenario, randomWebhookToken, generateUniqueWebhookToken, normalizeLoginParam, isLogsCleanupTick, processSchedules, makeBroadcastOps, processDue };
