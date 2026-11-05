import type { D1Database, D1PreparedStatement, KVNamespace } from '@cloudflare/workers-types';
import type { Scenario } from '../../shared/types';
import { scenarioHasReferral } from '../../shared/graph';
import { FIND_SCAN_LIMIT, FIND_HARD_CAP } from '../../shared/limits';

export interface BotRow {
  id: string;
  owner_id: string;
  name: string;
  token_enc: string;
  webhook_secret: string;
  active: number;
  created_at: number;
  bot_username?: string | null; // @username из getMe — нужен для реферальных ссылок
  has_referral?: number | null; // в сценарии есть блок «Рефералка» (считается при сохранении)
  published_version?: number | null;
  // Платформа бота. У всех строк, созданных до миграции 0030, — 'telegram'
  // (дефолт колонки), так что undefined трактуем как Telegram.
  platform?: 'telegram' | 'vk' | null;
  vk_group_id?: number | null; // id группы VK (для bots VK)
  vk_confirmation?: string | null; // строка подтверждения VK Callback API
  vk_screen_name?: string | null; // короткое имя группы (vk.me/<screen_name>)
  // 0031: server_id Callback-сервера VK (groups.addCallbackServer). Нужен
  // editCallbackServer/setCallbackSettings/deleteCallbackServer нового API.
  vk_callback_server_id?: number | null;
}

export async function getBot(db: D1Database, botId: string): Promise<BotRow | null> {
  return (await db.prepare('SELECT * FROM bots WHERE id = ?').bind(botId).first<BotRow>()) ?? null;
}

export interface BotListItem {
  id: string;
  name: string;
  owner_id: string;
  active: number;
  created_at: number;
  // Логин владельца, если он есть в accounts. У админских ботов владельца может
  // не быть ('admin') — тогда поле пустое, а UI показывает owner_id.
  owner_login?: string | null;
  // Платформа бота: 'vk' или 'telegram' (дефолт для старых строк).
  platform?: 'telegram' | 'vk' | null;
}

// ownerId = null -> все боты. Режим «весь список» в роутах не используется:
// дашборд всегда скоупится владельцем (у платформенной сессии это
// ADMIN_OWNER_ID = 'admin'), а поиск по чужим аккаунтам живёт в /api/admin/*.
// Пагинация: limit/offset опциональны — без них отдаётся весь список (старые
// клиенты и все внутренние вызовы получают прежнее поведение). total — для
// UI, чтобы рисовать «показано N из M» без отдельного запроса COUNT.
export async function listBots(
  db: D1Database,
  ownerId?: string | null,
  page?: { limit: number; offset: number }
): Promise<{ bots: BotListItem[]; total: number }> {
  // Логин владельца берём LEFT JOIN'ом: у ботов платформенной сессии
  // (owner_id = 'admin') аккаунта нет, owner_login остаётся пустым, и UI не
  // выдаёт их за боты вошедшего пользователя.
  const SELECT = `SELECT b.id, b.name, b.owner_id, b.active, b.created_at, a.login AS owner_login, b.platform
                  FROM bots b LEFT JOIN accounts a ON a.id = b.owner_id`;
  const where = ownerId ? 'WHERE b.owner_id = ?' : '';
  const binds = ownerId ? [ownerId] : [];
  if (page && Number.isInteger(page.limit) && page.limit > 0 && Number.isInteger(page.offset) && page.offset >= 0) {
    const total = (await db
      .prepare(`SELECT COUNT(*) AS n FROM bots b ${where}`)
      .bind(...binds)
      .first<{ n: number }>())?.n ?? 0;
    const rows = (
      (await db
        .prepare(`${SELECT} ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`)
        .bind(...binds, page.limit, page.offset)
        .all<BotListItem>()) ?? { results: [] }
    ).results;
    return { bots: rows, total: Number(total) };
  }
  const rows = (
    (await db
      .prepare(`${SELECT} ${where} ORDER BY b.created_at DESC`)
      .bind(...binds)
      .all<BotListItem>()) ?? { results: [] }
  ).results;
  return { bots: rows, total: rows.length };
}

// Боты аккаунта вместе с токенами: нужно F-017 (удаление аккаунта) — снять
// вебхук в Telegram может только владелец токена. listBots токенов не отдаёт
// сознательно (каталог); этот запрос — единственный потребитель, вызывается
// один раз на удаление аккаунта.
export async function listBotsWithTokens(
  db: D1Database,
  ownerId: string
): Promise<{ id: string; token_enc: string }[]> {
  const rows = (
    (await db
      .prepare('SELECT id, token_enc FROM bots WHERE owner_id = ?')
      .bind(ownerId)
      .all<{ id: string; token_enc: string }>()) ?? { results: [] }
  ).results;
  return rows;
}

export interface OwnerBotSummary {
  id: string;
  name: string;
  active: number;
  created_at: number;
  published_version: number | null;
  // Свежайшая сохранённая версия сценария (черновик); null, если сохранений нет.
  scenario_version: number | null;
}

// Боты аккаунта для страницы сотрудника: одним запросом, со статусом версий.
// scenario_version — подзапросом MAX(version) по scenarios, published_version —
// указатель публикации в bots (миграция 0011).
export async function listOwnerBotsForAdmin(db: D1Database, ownerId: string): Promise<OwnerBotSummary[]> {
  const rows = (
    (await db
      .prepare(
        `SELECT b.id, b.name, b.active, b.created_at, b.published_version,
                (SELECT MAX(version) FROM scenarios s WHERE s.bot_id = b.id) AS scenario_version
         FROM bots b WHERE b.owner_id = ? ORDER BY b.created_at DESC`
      )
      .bind(ownerId)
      .all<OwnerBotSummary>()) ?? { results: [] }
  ).results;
  return rows.map((r) => ({
    ...r,
    published_version: r.published_version == null ? null : Number(r.published_version),
    scenario_version: r.scenario_version == null ? null : Number(r.scenario_version),
  }));
}

// ---------------- platform accounts ----------------

export interface AccountRow {
  id: string;
  login: string;
  pass_hash: string;
  created_at: number;
}

export async function getAccountByLogin(db: D1Database, login: string): Promise<AccountRow | null> {
  return (
    (await db.prepare('SELECT id, login, pass_hash, created_at FROM accounts WHERE login = ?').bind(login).first<AccountRow>()) ?? null
  );
}

// Роль пользователя: 'user' | 'moderator' | 'admin'.
// admin/moderator могут удалять любые шаблоны каталога.
export async function getAccountRole(db: D1Database, userId: string): Promise<string> {
  const r = await db.prepare('SELECT role FROM accounts WHERE id = ?').bind(userId).first<{ role: string }>();
  return r?.role ?? 'user';
}

export async function insertAccount(db: D1Database, acc: AccountRow): Promise<void> {
  await db
    .prepare('INSERT INTO accounts (id, login, pass_hash, created_at) VALUES (?,?,?,?)')
    .bind(acc.id, acc.login, acc.pass_hash, acc.created_at)
    .run();
}

// ---------------- support desk ----------------

export interface SupportTicketRow {
  id: string;
  author_user_id: string;
  author_login: string;
  bot_id: string | null;
  kind: string;
  subject: string;
  status: 'new' | 'in_progress' | 'closed';
  assignee_user_id: string | null;
  created_at: number;
  updated_at: number;
  last_message_at: number;
  // Сквозной номер обращения (#1, #2, …). NULL у легаси-строк до миграции 0023 —
  // они не перенумеровываются, UI показывает короткий id.
  number?: number | null;
}

export interface SupportMessageRow {
  id: string;
  ticket_id: string;
  author_role: 'user' | 'staff';
  author_user_id: string;
  author_login: string;
  body: string;
  created_at: number;
}

export async function createSupportTicket(db: D1Database, ticket: SupportTicketRow, message: SupportMessageRow): Promise<void> {
  // Номер выдаётся АТОМАРНО в том же statement, что и вставка: подзапрос
  // MAX+1 вычисляется внутри транзакции INSERT, а уникальный индекс
  // idx_support_tickets_number страхует от дублей при гонке.
  await db.batch([
    db.prepare(`INSERT INTO support_tickets
      (id, number, author_user_id, author_login, bot_id, kind, subject, status, assignee_user_id, created_at, updated_at, last_message_at)
      VALUES (?,(SELECT COALESCE(MAX(number), 0) + 1 FROM support_tickets),?,?,?,?,?,?,?,?,?,?)`).bind(
      ticket.id, ticket.author_user_id, ticket.author_login, ticket.bot_id, ticket.kind, ticket.subject, ticket.status,
      ticket.assignee_user_id, ticket.created_at, ticket.updated_at, ticket.last_message_at
    ),
    db.prepare(`INSERT INTO support_messages
      (id, ticket_id, author_role, author_user_id, author_login, body, created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
      message.id, message.ticket_id, message.author_role, message.author_user_id, message.author_login, message.body, message.created_at
    ),
  ]);
}

export async function listSupportTickets(
  db: D1Database,
  opts: { authorUserId?: string; assigneeUserId?: string; status?: string; kind?: string; q?: string; number?: number | string; assignee?: string; limit?: number; offset?: number } = {}
): Promise<{ tickets: SupportTicketRow[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.authorUserId) { where.push('t.author_user_id = ?'); args.push(opts.authorUserId); }
  if (opts.status && ['new', 'in_progress', 'closed'].includes(opts.status)) { where.push('t.status = ?'); args.push(opts.status); }
  if (opts.kind) { where.push('t.kind = ?'); args.push(opts.kind); }
  // Явный фильтр по номеру обращения (#N). Невалидное значение — пустая
  // выборка, а не «показать всё».
  if (opts.number != null && opts.number !== '') {
    const n = Number(opts.number);
    if (Number.isInteger(n) && n > 0) { where.push('t.number = ?'); args.push(n); }
    else where.push('1 = 0');
  }
  if (opts.assignee === 'mine') {
    if (opts.assigneeUserId ?? opts.authorUserId) {
      where.push('t.assignee_user_id = ?');
      args.push(opts.assigneeUserId ?? opts.authorUserId);
    } else {
      where.push('1 = 0');
    }
  }
  if (opts.assignee === 'unassigned') where.push('t.assignee_user_id IS NULL');
  const qTrim = opts.q?.trim() ?? '';
  if (qTrim) {
    const like = `%${qTrim.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    // Голое число или «#123» дополнительно ищет по номеру обращения;
    // LIKE-поведение (тема/автор/текст) сохраняется в обоих случаях.
    // Легаси-строки с number = NULL числовое совпадение не получают.
    const numMatch = /^#?(\d+)$/.exec(qTrim);
    if (numMatch) {
      where.push(`(t.number = ? OR t.subject LIKE ? ESCAPE '\\' OR t.author_login LIKE ? ESCAPE '\\' OR EXISTS
        (SELECT 1 FROM support_messages sm WHERE sm.ticket_id = t.id AND sm.body LIKE ? ESCAPE '\\'))`);
      args.push(Number(numMatch[1]), like, like, like);
    } else {
      where.push(`(t.subject LIKE ? ESCAPE '\\' OR t.author_login LIKE ? ESCAPE '\\' OR EXISTS
        (SELECT 1 FROM support_messages sm WHERE sm.ticket_id = t.id AND sm.body LIKE ? ESCAPE '\\'))`);
      args.push(like, like, like);
    }
  }
  const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM support_tickets t ${condition}`).bind(...args).first<{ n: number }>();
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const tickets = ((await db.prepare(`SELECT t.* FROM support_tickets t ${condition} ORDER BY t.last_message_at DESC LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset).all<SupportTicketRow>()).results ?? []);
  return { tickets, total: Number(total?.n ?? 0) };
}

export async function getSupportTicket(db: D1Database, id: string): Promise<SupportTicketRow | null> {
  return (await db.prepare('SELECT * FROM support_tickets WHERE id = ?').bind(id).first<SupportTicketRow>()) ?? null;
}

export async function listSupportMessages(db: D1Database, ticketId: string): Promise<SupportMessageRow[]> {
  return (await db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC').bind(ticketId).all<SupportMessageRow>()).results ?? [];
}

export async function addSupportMessage(db: D1Database, message: SupportMessageRow, status?: SupportTicketRow['status']): Promise<void> {
  const now = message.created_at;
  await db.batch([
    db.prepare(`INSERT INTO support_messages (id, ticket_id, author_role, author_user_id, author_login, body, created_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(message.id, message.ticket_id, message.author_role, message.author_user_id, message.author_login, message.body, now),
    db.prepare(`UPDATE support_tickets SET updated_at = ?, last_message_at = ?${status ? ', status = ?' : ''} WHERE id = ?`)
      .bind(...(status ? [now, now, status, message.ticket_id] : [now, now, message.ticket_id])),
  ]);
}

export async function setTicketStatus(db: D1Database, id: string, status: SupportTicketRow['status']): Promise<boolean> {
  return changesOf(await db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').bind(status, Date.now(), id).run()) > 0;
}

export async function assignTicket(db: D1Database, id: string, assigneeUserId: string): Promise<boolean> {
  return changesOf(await db.prepare(`UPDATE support_tickets SET assignee_user_id = ?, status = 'in_progress', updated_at = ?
    WHERE id = ? AND (assignee_user_id IS NULL OR assignee_user_id = ?)`).bind(assigneeUserId, Date.now(), id, assigneeUserId).run()) > 0;
}

export async function countOpenTickets(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'new'").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function setBotActive(db: D1Database, botId: string, active: 0 | 1): Promise<void> {
  await db.prepare('UPDATE bots SET active = ? WHERE id = ?').bind(active, botId).run();
}

export async function setBotName(db: D1Database, botId: string, name: string): Promise<void> {
  await db.prepare('UPDATE bots SET name = ? WHERE id = ?').bind(name, botId).run();
}

// @username бота нужен для реферальных ссылок. Заполняется при публикации (getMe).
export async function setBotUsername(db: D1Database, botId: string, username: string): Promise<void> {
  if (!username) return;
  await db.prepare('UPDATE bots SET bot_username = ? WHERE id = ?').bind(username, botId).run();
}

// 0031: server_id Callback-сервера VK — сохраняется после groups.addCallbackServer.
export async function setVkCallbackServerId(db: D1Database, botId: string, serverId: number): Promise<void> {
  await db.prepare('UPDATE bots SET vk_callback_server_id = ? WHERE id = ?').bind(serverId, botId).run();
}

export async function loadScenario(db: D1Database, botId: string): Promise<{ flow_json: string; version: number } | null> {
  return (
    (await db
      .prepare('SELECT flow_json, version FROM scenarios WHERE bot_id = ? ORDER BY version DESC LIMIT 1')
      .bind(botId)
      .first<{ flow_json: string; version: number }>()) ?? null
  );
}

export async function loadScenarioVersion(
  db: D1Database,
  botId: string,
  version: number
): Promise<{ flow_json: string; version: number } | null> {
  return (
    (await db
      .prepare('SELECT flow_json, version FROM scenarios WHERE bot_id = ? AND version = ?')
      .bind(botId, version)
      .first<{ flow_json: string; version: number }>()) ?? null
  );
}

export async function loadPublishedScenario(
  db: D1Database,
  botId: string
): Promise<{ flow_json: string; version: number } | null> {
  // Рантайм-артефакт: если для опубликованной версии есть РАСКРЫТЫЙ билд
  // (scenario_builds, миграция 0021), вебхук исполняет именно его — движок
  // никогда не видит авторские блоки subflow. Бот без строки билда (все боты
  // до подсценариев) грузится ровно как раньше: та же строка scenarios.
  const build = await db
    .prepare(
      'SELECT sb.flow_json, sb.version FROM scenario_builds sb JOIN bots b ON b.id = sb.bot_id AND sb.version = b.published_version WHERE sb.bot_id = ?'
    )
    .bind(botId)
    .first<{ flow_json: string; version: number }>();
  if (build) return build;
  const pointed = await db
    .prepare(
      'SELECT s.flow_json, s.version FROM scenarios s JOIN bots b ON b.id = s.bot_id AND s.version = b.published_version WHERE s.bot_id = ?'
    )
    .bind(botId)
    .first<{ flow_json: string; version: number }>();
  if (pointed) return pointed;
  const bot = await db.prepare('SELECT active, published_version FROM bots WHERE id = ?').bind(botId).first<{ active: number; published_version: number | null }>();
  // Legacy rows have no pointer. They must be published once before they can go live.
  if (!bot?.active || bot.published_version == null) return null;
  return null;
}

export async function setPublishedVersion(db: D1Database, botId: string, version: number | null): Promise<void> {
  await db.prepare('UPDATE bots SET published_version = ? WHERE id = ?').bind(version, botId).run();
}

export async function saveScenario(
  db: D1Database,
  botId: string,
  name: string,
  flowJson: string,
  version: number
): Promise<void> {
  await db
    .prepare('INSERT INTO scenarios (id, bot_id, name, flow_json, version, updated_at) VALUES (?,?,?,?,?,?)')
    .bind(`${botId}:${version}`, botId, name, flowJson, version, Date.now())
    .run();
}

export async function getSession(
  db: D1Database,
  botId: string,
  userId: number
): Promise<{ current_block: string | null; vars_json: string } | null> {
  return (
    (await db
      .prepare('SELECT current_block, vars_json FROM sessions WHERE bot_id = ? AND user_id = ?')
      .bind(botId, userId)
      .first<{ current_block: string | null; vars_json: string }>()) ?? null
  );
}

export async function upsertSession(
  db: D1Database,
  botId: string,
  userId: number,
  currentBlock: string | null,
  varsJson: string
): Promise<void> {
  // Профиль (first_name/username) сюда не приходит — вызов из крона. Имя из
  // прошлого апдейта сохраняет COALESCE, а для search_text профиль читаем
  // отдельным запросом: SQLite lowering по кириллице не умеет, а нам нужен
  // регистронезависимый поиск и по «пётр», и по «Пётр».
  const prev = await db
    .prepare('SELECT first_name, username FROM sessions WHERE bot_id = ? AND user_id = ?')
    .bind(botId, userId)
    .first<{ first_name: string | null; username: string | null }>()
    .catch(() => null);
  await db
    .prepare(
      `INSERT INTO sessions (bot_id, user_id, current_block, vars_json, updated_at, search_text) VALUES (?,?,?,?,?,?)
       ON CONFLICT(bot_id, user_id) DO UPDATE SET
         current_block = excluded.current_block,
         vars_json = excluded.vars_json,
         updated_at = excluded.updated_at,
         first_name = COALESCE(sessions.first_name, excluded.first_name),
         username = COALESCE(sessions.username, excluded.username),
         first_seen = COALESCE(sessions.first_seen, excluded.first_seen),
         search_text = excluded.search_text`
    )
    .bind(botId, userId, currentBlock, varsJson, Date.now(), searchTextOf(prev?.first_name, prev?.username, varsJson))
    .run();
}

// ---------------- CAS-запись сессии (F-002) ----------------
//
// Два параллельных апдейта одного пользователя (двойной тап по inline-кнопкам,
// сообщение + callback одновременно) раньше читали одну сессию и писали
// независимо — одна из записей переменных терялась, пользователь «откатывался»
// по сценарию. upsertSessionCas пишет с условием на updated_at, прочитанный в
// начале запроса (оптимистичная блокировка):
//   • 'cas'    — строка не менялась с базового чтения, запись применена как есть;
//   • 'merged' — сессию успели изменить параллельно: берём СВЕЖУЮ строку и
//                накладываем только те ключи, которые наш запрос реально менял
//                (diff новых vars против baseVars, включая удаления) — чужие
//                параллельные правки не затираются;
//   • 'insert' — сессии не было (ни в базовом чтении, ни в перечитывании).
// Ограничение: updated_at в миллисекундах — две записи в одну миллисекунду
// CAS не различит; для вебхук-потока Telegram это приемлемо (апдейты одного
// пользователя обрабатываются последовательно чаще, чем в пределах 1 мс).

export interface SessionCasBase {
  current_block: string | null;
  vars_json: string;
  updated_at: number;
}

// Базовое чтение для CAS: то же, что getSession, плюс updated_at (метка
// версии). Вызывается В НАЧАЛЕ обработки апдейта, до прогонов движка.
export async function getSessionCas(
  db: D1Database,
  botId: string,
  userId: number
): Promise<SessionCasBase | null> {
  return (
    (await db
      .prepare('SELECT current_block, vars_json, updated_at FROM sessions WHERE bot_id = ? AND user_id = ?')
      .bind(botId, userId)
      .first<SessionCasBase>()) ?? null
  );
}

export interface UpsertSessionCasOpts {
  botId: string;
  userId: number;
  currentBlock: string | null;
  varsJson: string;
  // vars сессии и updated_at из базового чтения (getSessionCas) в начале
  // запроса. base == null — сессии тогда не было.
  baseVars: Record<string, unknown> | null;
  baseUpdatedAt: number | null;
}

function parseVars(json: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(json ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export async function upsertSessionCas(
  db: D1Database,
  opts: UpsertSessionCasOpts
): Promise<{ status: 'cas' | 'merged' | 'insert'; updatedAt: number }> {
  const { botId, userId, currentBlock, varsJson, baseVars, baseUpdatedAt } = opts;
  const now = Date.now();
  // Профиль для search_text — как в upsertSession: SQLite lowering по
  // кириллице не умеет, строка поиска считается в JS.
  const prev = await db
    .prepare('SELECT first_name, username FROM sessions WHERE bot_id = ? AND user_id = ?')
    .bind(botId, userId)
    .first<{ first_name: string | null; username: string | null }>()
    .catch(() => null);

  if (baseUpdatedAt != null) {
    const res = await db
      .prepare(
        `UPDATE sessions SET current_block = ?, vars_json = ?, updated_at = ?, search_text = ?
         WHERE bot_id = ? AND user_id = ? AND updated_at = ?`
      )
      .bind(currentBlock, varsJson, now, searchTextOf(prev?.first_name, prev?.username, varsJson), botId, userId, baseUpdatedAt)
      .run();
    if (changesOf(res) > 0) return { status: 'cas', updatedAt: now };
  }

  // CAS не сработал: сессию изменили параллельно (или её не было в базовом
  // чтении). Перечитываем свежую строку.
  const fresh = await db
    .prepare('SELECT vars_json, updated_at FROM sessions WHERE bot_id = ? AND user_id = ?')
    .bind(botId, userId)
    .first<{ vars_json: string; updated_at: number }>()
    .catch(() => null);

  if (!fresh) {
    // Сессии нет ни в базовом чтении, ни сейчас — обычный upsert (тот же SQL,
    // что в upsertSession, но с уже вычисленным now, чтобы возврат был точен).
    await db
      .prepare(
        `INSERT INTO sessions (bot_id, user_id, current_block, vars_json, updated_at, search_text) VALUES (?,?,?,?,?,?)
         ON CONFLICT(bot_id, user_id) DO UPDATE SET
           current_block = excluded.current_block,
           vars_json = excluded.vars_json,
           updated_at = excluded.updated_at,
           first_name = COALESCE(sessions.first_name, excluded.first_name),
           username = COALESCE(sessions.username, excluded.username),
           first_seen = COALESCE(sessions.first_seen, excluded.first_seen),
           search_text = excluded.search_text`
      )
      .bind(botId, userId, currentBlock, varsJson, now, searchTextOf(prev?.first_name, prev?.username, varsJson))
      .run();
    return { status: 'insert', updatedAt: now };
  }

  // Overlay: чем новые vars отличаются от базовых (включая удалённые ключи).
  // Накладываем только его — чужие параллельные правки свежей строки остаются.
  const base = baseVars ?? {};
  const next = parseVars(varsJson);
  const freshVars = parseVars(fresh.vars_json);
  const merged: Record<string, unknown> = { ...freshVars };
  for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const inBase = k in base;
    const inNext = k in next;
    if (inBase && !inNext) delete merged[k]; // наш запрос удалил ключ
    else if (inNext && (!inBase || !sameValue(base[k], next[k]))) merged[k] = next[k];
  }
  const mergedJson = JSON.stringify(merged);
  await db
    .prepare(
      `UPDATE sessions SET current_block = ?, vars_json = ?, updated_at = ?, search_text = ?
       WHERE bot_id = ? AND user_id = ?`
    )
    .bind(currentBlock, mergedJson, now, searchTextOf(prev?.first_name, prev?.username, mergedJson), botId, userId)
    .run();
  return { status: 'merged', updatedAt: now };
}

// Строка для поиска: приводим к нижнему регистру в JS, потому что SQLite
// понимает регистр только у латиницы — поиск «пётр» по «Пётр» иначе молчал.
// Из JSON берём только значения, без ключей: иначе запрос «city» находил
// буквально все записи таблицы.
function valuesText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return t;
    try {
      v = JSON.parse(t) as unknown;
    } catch {
      return t;
    }
  }
  if (typeof v !== 'object') return String(v);
  return Object.values(v as Record<string, unknown>)
    .map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x ?? '')))
    .join(' ');
}

export function searchTextOf(...parts: unknown[]): string {
  return parts
    .map((p) => valuesText(p))
    .join(' ')
    .toLowerCase();
}

// WS-15: экранирование метасимволов LIKE (\, %, _) для пользовательского
// поискового запроса. Используется вместе с `ESCAPE '\'` в SQL — без него
// «%» в запросе работал как wildcard и расширял выдачу.
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// D1 кладёт количество затронутых строк в result.meta.changes. Чтение
// result.changes напрямую давало 0 — и PUT/DELETE отвечали «не найдено»
// при реально применённом изменении.
function changesOf(res: unknown): number {
  const r = res as { meta?: { changes?: number }; changes?: number } | null;
  if (!r) return 0;
  return Number(r.meta?.changes ?? r.changes ?? 0);
}

// ---------------- клиенты бота (кто писал боту и что о нём известно) ----------------

export interface ClientRow {
  user_id: number;
  first_name: string | null;
  username: string | null;
  first_seen: number | null;
  updated_at: number;
  current_block: string | null;
  vars_json: string;
}

// Поиск по id профиля, имени, @username и по содержимому переменных: авторам
// чаще всего нужно «найди всех, у кого город Москва» — а это лежит в vars_json.
export async function listClients(
  db: D1Database,
  botId: string,
  opts: { q?: string; limit?: number; offset?: number } = {}
): Promise<{ rows: ClientRow[]; total: number }> {
  // Верхний предел — выгрузка в CSV: страница в UI просит 50, экспорт — всё сразу.
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 5000);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const q = (opts.q ?? '').trim();
  const like = `%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  // Ищем по search_text (уже в нижнем регистре) — так «пётр» находит «Пётр».
  const where = q
    ? `AND (COALESCE(search_text,'') LIKE ? ESCAPE '\\' OR CAST(user_id AS TEXT) LIKE ? ESCAPE '\\' OR COALESCE(first_name,'') LIKE ? ESCAPE '\\' OR COALESCE(username,'') LIKE ? ESCAPE '\\')`
    : '';
  const args: unknown[] = [botId];
  if (q) args.push(like, like, like, like);
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE bot_id = ? ${where}`)
    .bind(...args)
    .first<{ n: number }>();
  const rows =
    (
      await db
        .prepare(
          `SELECT user_id, first_name, username, first_seen, updated_at, current_block, vars_json
           FROM sessions WHERE bot_id = ? ${where}
           ORDER BY updated_at DESC LIMIT ? OFFSET ?`
        )
        .bind(...args, limit, offset)
        .all<ClientRow>()
    ).results ?? [];
  return { rows, total: Number(totalRow?.n ?? 0) };
}

export async function getClient(db: D1Database, botId: string, userId: number): Promise<ClientRow | null> {
  return (
    (await db
      .prepare(
        `SELECT user_id, first_name, username, first_seen, updated_at, current_block, vars_json
         FROM sessions WHERE bot_id = ? AND user_id = ?`
      )
      .bind(botId, userId)
      .first<ClientRow>()) ?? null
  );
}

// Правка карточки клиента руками: автор может исправить переменную, не переигрывая сценарий.
// Здесь же — «забыть клиента»: если vars пустые, стираем и подписку с рефералкой.
export async function updateClientVars(
  db: D1Database,
  botId: string,
  userId: number,
  vars: Record<string, unknown>
): Promise<boolean> {
  // search_text пересчитываем сразу: иначе после ручной правки переменной
  // клиент пропадал из поиска до следующего апдейта из Telegram. Считаем его
  // в JS — SQLite lowering по кириллице не делает.
  const prev = await db
    .prepare('SELECT first_name, username FROM sessions WHERE bot_id = ? AND user_id = ?')
    .bind(botId, userId)
    .first<{ first_name: string | null; username: string | null }>()
    .catch(() => null);
  const varsJson = JSON.stringify(vars ?? {});
  const res = await db
    .prepare('UPDATE sessions SET vars_json = ?, updated_at = ?, search_text = ? WHERE bot_id = ? AND user_id = ?')
    .bind(varsJson, Date.now(), searchTextOf(prev?.first_name, prev?.username, varsJson), botId, userId)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

// Полное удаление клиента: по просьбе человека из Telegram («удали мои данные»).
// Чистим всё, что связано с ним у этого бота, включая записи в коллекциях.
export async function deleteClient(db: D1Database, botId: string, userId: number): Promise<number> {
  const stmts = [
    db.prepare('DELETE FROM sessions WHERE bot_id = ? AND user_id = ?').bind(botId, userId),
    db.prepare('DELETE FROM subscribers WHERE bot_id = ? AND user_id = ?').bind(botId, userId),
    db.prepare('DELETE FROM referrals WHERE bot_id = ? AND (invited_user_id = ? OR inviter_user_id = ?)').bind(
      botId,
      String(userId),
      String(userId)
    ),
    db.prepare('DELETE FROM collection_items WHERE bot_id = ? AND user_id = ?').bind(botId, userId),
    // Теги пользователя тоже его данные: «удали мои данные» должно их снять.
    db.prepare('DELETE FROM user_tags WHERE bot_id = ? AND user_id = ?').bind(botId, userId),
  ];
  // Ошибку не глотаем: молчаливый сбой удаления данных клиента («удали мои
  // данные») хуже явного 500 — иначе запрос выглядит выполненным.
  const res = await db.batch(stmts).catch((e) => {
    console.error('[db] deleteClient batch failed:', e);
    throw e;
  });
  return res.reduce((sum: number, r: unknown) => sum + changesOf(r), 0);
}

// ---------------- коллекции (таблицы автора) ----------------

export interface CollectionRow {
  id: string;
  bot_id: string;
  name: string;
  fields_json: string;
  created_at: number;
}

export interface CollectionItemRow {
  id: string;
  collection_id: string;
  bot_id: string;
  user_id: number | null;
  data_json: string;
  created_at: number;
  updated_at: number;
}

export async function listCollections(db: D1Database, botId: string): Promise<CollectionRow[]> {
  const rows =
    (
      await db
        .prepare('SELECT id, bot_id, name, fields_json, created_at FROM collections WHERE bot_id = ? ORDER BY created_at')
        .bind(botId)
        .all<CollectionRow>()
    ).results ?? [];
  return rows;
}

export async function getCollection(db: D1Database, botId: string, id: string): Promise<CollectionRow | null> {
  return (
    (await db
      .prepare('SELECT id, bot_id, name, fields_json, created_at FROM collections WHERE bot_id = ? AND id = ?')
      .bind(botId, id)
      .first<CollectionRow>()) ?? null
  );
}

export async function insertCollection(
  db: D1Database,
  row: { id: string; bot_id: string; name: string; fields_json: string; created_at: number }
): Promise<void> {
  await db
    .prepare('INSERT INTO collections (id, bot_id, name, fields_json, created_at) VALUES (?,?,?,?,?)')
    .bind(row.id, row.bot_id, row.name, row.fields_json, row.created_at)
    .run();
}

export async function updateCollection(
  db: D1Database,
  botId: string,
  id: string,
  patch: { name?: string; fields_json?: string }
): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name);
  }
  if (patch.fields_json !== undefined) {
    sets.push('fields_json = ?');
    args.push(patch.fields_json);
  }
  if (!sets.length) return false;
  const res = await db
    .prepare(`UPDATE collections SET ${sets.join(', ')} WHERE bot_id = ? AND id = ?`)
    .bind(...args, botId, id)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

export async function deleteCollection(db: D1Database, botId: string, id: string): Promise<boolean> {
  await db
    .prepare('DELETE FROM collection_items WHERE bot_id = ? AND collection_id = ?')
    .bind(botId, id)
    .run()
    .catch(() => null);
  const res = await db
    .prepare('DELETE FROM collections WHERE bot_id = ? AND id = ?')
    .bind(botId, id)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

export async function listCollectionItems(
  db: D1Database,
  botId: string,
  collectionId: string,
  opts: { q?: string; limit?: number; offset?: number } = {}
): Promise<{ rows: CollectionItemRow[]; total: number }> {
  // 5000 — потолок для выгрузки в CSV; страница в UI просит 50.
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 5000);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const q = (opts.q ?? '').trim();
  const like = `%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const where = q
    ? `AND (COALESCE(search_text,'') LIKE ? ESCAPE '\\' OR CAST(user_id AS TEXT) LIKE ? ESCAPE '\\')`
    : '';
  const args: unknown[] = [collectionId, botId];
  if (q) args.push(like, like);
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ? AND bot_id = ? ${where}`)
    .bind(...args)
    .first<{ n: number }>();
  const rows =
    (
      await db
        .prepare(
          `SELECT id, collection_id, bot_id, user_id, data_json, created_at, updated_at
           FROM collection_items WHERE collection_id = ? AND bot_id = ? ${where}
           ORDER BY created_at DESC LIMIT ? OFFSET ?`
        )
        .bind(...args, limit, offset)
        .all<CollectionItemRow>()
    ).results ?? [];
  return { rows, total: Number(totalRow?.n ?? 0) };
}

export async function getCollectionItem(
  db: D1Database,
  botId: string,
  collectionId: string,
  itemId: string
): Promise<CollectionItemRow | null> {
  return (
    (await db
      .prepare(
        `SELECT id, collection_id, bot_id, user_id, data_json, created_at, updated_at
         FROM collection_items WHERE collection_id = ? AND bot_id = ? AND id = ?`
      )
      .bind(collectionId, botId, itemId)
      .first<CollectionItemRow>()) ?? null
  );
}

export async function insertCollectionItem(
  db: D1Database,
  row: {
    id: string;
    collection_id: string;
    bot_id: string;
    user_id: number | null;
    data_json: string;
    created_at: number;
    updated_at: number;
    search_text?: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO collection_items (id, collection_id, bot_id, user_id, data_json, created_at, updated_at, search_text)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .bind(
      row.id,
      row.collection_id,
      row.bot_id,
      row.user_id,
      row.data_json,
      row.created_at,
      row.updated_at,
      row.search_text ?? searchTextOf(row.data_json)
    )
    .run();
}

export async function updateCollectionItem(
  db: D1Database,
  botId: string,
  collectionId: string,
  itemId: string,
  dataJson: string
): Promise<boolean> {
  const res = await db
    .prepare(
      'UPDATE collection_items SET data_json = ?, updated_at = ?, search_text = ? WHERE collection_id = ? AND bot_id = ? AND id = ?'
    )
    .bind(dataJson, Date.now(), searchTextOf(dataJson), collectionId, botId, itemId)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

export async function deleteCollectionItem(
  db: D1Database,
  botId: string,
  collectionId: string,
  itemId: string
): Promise<boolean> {
  const res = await db
    .prepare(
      `DELETE FROM collection_items
       WHERE id = ? AND collection_id = ?
       AND collection_id IN (SELECT id FROM collections WHERE bot_id = ?)`
    )
    .bind(itemId, collectionId, botId)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

// ---------------- операции блоков «Данные» ----------------
// Движок не умеет ходить в D1 сам (он чистый), поэтому операции передаются ему
// колбэком. SQL-префильтр по search_text сужает выборку, затем читаем пачку
// самых новых записей и окончательно фильтруем в JS: состав полей у коллекции
// произвольный, а SQL по JSON получался бы ломким.

// Значение считается совпадающим, если равно по строке (регистр и пробелы не важны).
function matches(haystack: unknown, needle: string): boolean {
  if (needle === '') return true;
  const a = String(haystack ?? '').trim().toLowerCase();
  const b = needle.trim().toLowerCase();
  if (!b) return true;
  return a === b || a.includes(b);
}

// SQL-префильтр: по одному «AND search_text LIKE ?» на каждое непустое значение
// where. search_text — lowercased-конкатенация значений полей, поэтому LIKE может
// дать кросс-полевое ложное срабатывание; итог всё равно решает matches() ниже.
// Экранировать %/_ не нужно: они лишь расширяют SQL-выборку (superset), а JS
// re-verify гарантирует точность. Пустые значения матчат всё уже в matches() —
// для них префильтр не добавляем.
//
// F-038: ключ 'id' — исключение. where={id: …} это путь record_form в
// мини-аппах (update/delete конкретной строки по её PRIMARY KEY), а
// search_text строится только из ЗНАЧЕНИЙ полей data_json — PK туда не
// входит. Раньше такой запрос упирался в LIKE-префильтр и молча менял 0 строк.
// Теперь id дополнительно матчится точным равенством с PRIMARY KEY
// («id = ? OR search_text LIKE ?»): OR сохраняет старое поведение для
// авторских таблиц, у которых в данных есть СВОЁ поле id (блоки «Данные»
// искали его через search_text), и чинит путь мини-аппа.
function wherePrefilter(where: Record<string, unknown>): { sql: string; args: string[] } {
  const parts: string[] = [];
  const args: string[] = [];
  for (const [k, v] of Object.entries(where ?? {})) {
    const raw = String(v ?? '').trim();
    if (!raw) continue;
    if (k === 'id') {
      parts.push('AND (id = ? OR search_text LIKE ?)');
      args.push(raw, `%${raw.toLowerCase()}%`);
      continue;
    }
    parts.push('AND search_text LIKE ?');
    args.push(`%${raw.toLowerCase()}%`);
  }
  return { sql: parts.length ? ` ${parts.join(' ')}` : '', args };
}

// F-038: совпадение строки с where в JS-фильтре. Ключ 'id' матчится либо с
// PRIMARY KEY строки (точное равенство — UUID не терпит includes()), либо с
// полем data.id по общим правилам matches(). Остальные ключи — как раньше.
function rowMatchesWhere(r: { id?: unknown }, data: Record<string, unknown>, keys: string[], where: Record<string, unknown>): boolean {
  return keys.every((k) => {
    if (k !== 'id') return matches(data[k], String(where[k] ?? ''));
    const v = String(where[k] ?? '').trim();
    if (!v) return true;
    return r.id != null && String(r.id) === v ? true : matches(data.id, v);
  });
}

// Общая загрузка строк для find/update/remove: префильтр + защита от runaway.
// Грузим на одну строку больше потолка: если вернулось FIND_HARD_CAP + 1,
// оставляем самые новые FIND_HARD_CAP (сортировка created_at DESC) и пишем лог
// data.scan.capped.<n> — автор бота видит, что поиск был частичным.
async function loadScanRows<T>(
  db: D1Database,
  botId: string,
  collectionId: string,
  where: Record<string, unknown>,
  selectCols: string
): Promise<T[]> {
  const pre = wherePrefilter(where);
  const fetchLimit = Math.min(FIND_SCAN_LIMIT, FIND_HARD_CAP) + 1;
  const rows =
    (
      await db
        .prepare(
          `SELECT ${selectCols} FROM collection_items WHERE collection_id = ? AND bot_id = ?${pre.sql} ORDER BY created_at DESC LIMIT ?`
        )
        .bind(collectionId, botId, ...pre.args, fetchLimit)
        .all<T>()
    ).results ?? [];
  if (rows.length > FIND_HARD_CAP) {
    await logEvent(db, botId, null, `data.scan.capped.${FIND_HARD_CAP}`).catch(() => {});
    return rows.slice(0, FIND_HARD_CAP);
  }
  return rows;
}

export async function collectionAdd(
  db: D1Database,
  botId: string,
  collectionId: string,
  userId: number | null,
  data: Record<string, unknown>
): Promise<string | null> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await insertCollectionItem(db, {
    id,
    collection_id: collectionId,
    bot_id: botId,
    user_id: userId,
    data_json: JSON.stringify(data ?? {}),
    created_at: now,
    updated_at: now,
    search_text: searchTextOf(data),
  });
  return id;
}

export async function collectionFind(
  db: D1Database,
  botId: string,
  collectionId: string,
  where: Record<string, unknown>,
  limit: number
): Promise<Record<string, unknown>[]> {
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
  // id в выборке нужен для F-038: where={id} сверяется с PRIMARY KEY строки.
  const rows = await loadScanRows<{ id: string; data_json: string }>(db, botId, collectionId, where, 'id, data_json');
  const keys = Object.keys(where ?? {});
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(r.data_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (rowMatchesWhere(r, data, keys, where)) out.push(data);
    if (out.length >= lim) break;
  }
  return out;
}

export async function collectionUpdate(
  db: D1Database,
  botId: string,
  collectionId: string,
  where: Record<string, unknown>,
  patch: Record<string, unknown>
): Promise<number> {
  const rows = await loadScanRows<{ id: string; data_json: string }>(db, botId, collectionId, where, 'id, data_json');
  const keys = Object.keys(where ?? {});
  let n = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(r.data_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!rowMatchesWhere(r, data, keys, where)) continue;
    const next = JSON.stringify({ ...data, ...patch });
    stmts.push(
      db
        .prepare('UPDATE collection_items SET data_json = ?, updated_at = ?, search_text = ? WHERE id = ? AND bot_id = ?')
        .bind(next, Date.now(), searchTextOf(next), r.id, botId)
    );
    n++;
    if (n >= 25) break; // не даём одному блоку переписать всю таблицу за раз
  }
  if (stmts.length)
    await db.batch(stmts).catch((e) => {
      console.error('[db] collectionUpdate batch failed:', e);
      throw e;
    });
  return n;
}

export async function collectionRemove(db: D1Database, botId: string, collectionId: string, where: Record<string, unknown>): Promise<number> {
  const rows = await loadScanRows<{ id: string; data_json: string }>(db, botId, collectionId, where, 'id, data_json');
  const keys = Object.keys(where ?? {});
  const ids: string[] = [];
  for (const r of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(r.data_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (rowMatchesWhere(r, data, keys, where)) ids.push(r.id);
    if (ids.length >= 25) break;
  }
  if (!ids.length) return 0;
  await db
    .batch(ids.map((id) => db.prepare('DELETE FROM collection_items WHERE id = ? AND bot_id = ?').bind(id, botId)))
    .catch((e) => {
      console.error('[db] collectionRemove batch failed:', e);
      throw e;
    });
  return ids.length;
}

// Сколько записей в каждой таблице бота — одним запросом вместо N (для списка коллекций).
export async function countItemsByCollections(db: D1Database, botId: string): Promise<Record<string, number>> {
  const rows =
    (
      await db
        .prepare('SELECT collection_id, COUNT(*) AS n FROM collection_items WHERE bot_id = ? GROUP BY collection_id')
        .bind(botId)
        .all<{ collection_id: string; n: number }>()
    ).results ?? [];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.collection_id] = Number(r.n ?? 0);
  return out;
}

// ---------------- теги пользователей (F2) ----------------
// Метки на человека у конкретного бота. Имя тега всегда приходит уже
// нормализованным (normalizeTag в shared/types.ts) — здесь повторно не чистим,
// иначе сравнение в движке и в базе могли бы разойтись.

export async function addUserTag(db: D1Database, botId: string, userId: number, tag: string): Promise<void> {
  if (!tag) return;
  await db
    .prepare('INSERT OR IGNORE INTO user_tags (bot_id, user_id, tag, created_at) VALUES (?,?,?,?)')
    .bind(botId, userId, tag, Date.now())
    .run();
}

export async function removeUserTag(db: D1Database, botId: string, userId: number, tag: string): Promise<void> {
  if (!tag) return;
  await db.prepare('DELETE FROM user_tags WHERE bot_id = ? AND user_id = ? AND tag = ?').bind(botId, userId, tag).run();
}

export async function clearUserTags(db: D1Database, botId: string, userId: number): Promise<void> {
  await db.prepare('DELETE FROM user_tags WHERE bot_id = ? AND user_id = ?').bind(botId, userId).run();
}

export async function listUserTags(db: D1Database, botId: string, userId: number): Promise<string[]> {
  const rows =
    (
      await db
        .prepare('SELECT tag FROM user_tags WHERE bot_id = ? AND user_id = ? ORDER BY tag')
        .bind(botId, userId)
        .all<{ tag: string }>()
    ).results ?? [];
  return rows.map((r) => r.tag);
}

export async function hasUserTag(db: D1Database, botId: string, userId: number, tag: string): Promise<boolean> {
  if (!tag) return false;
  const row = await db
    .prepare('SELECT 1 AS ok FROM user_tags WHERE bot_id = ? AND user_id = ? AND tag = ? LIMIT 1')
    .bind(botId, userId, tag)
    .first<{ ok: number }>();
  return !!row;
}

// Кто носит тег. Пока не вызывается из сценариев: это заготовка под рассылку по
// сегменту — чтобы следующая фича не требовала ещё одной миграции.
export async function listUserIdsByTag(db: D1Database, botId: string, tag: string, limit = 1000): Promise<number[]> {
  if (!tag) return [];
  const rows =
    (
      await db
        .prepare('SELECT user_id FROM user_tags WHERE bot_id = ? AND tag = ? ORDER BY created_at DESC LIMIT ?')
        .bind(botId, tag, Math.min(Math.max(Number(limit) || 1000, 1), 5000))
        .all<{ user_id: number }>()
    ).results ?? [];
  return rows.map((r) => r.user_id);
}

// ---------------- черновики сценария на сервере (F9) ----------------
// Черновик — это несохранённые правки автора. Он привязан к боту (то есть к
// аккаунту), а не к браузеру: тот же черновик подхватится на любом устройстве.
// Хранится отдельно от scenarios, чтобы не перетереть сохранённую версию.

export async function getScenarioDraft(
  db: D1Database,
  botId: string
): Promise<{ flow_json: string; updated_at: number } | null> {
  return (
    (await db
      .prepare('SELECT flow_json, updated_at FROM scenario_drafts WHERE bot_id = ?')
      .bind(botId)
      .first<{ flow_json: string; updated_at: number }>()) ?? null
  );
}

export async function putScenarioDraft(db: D1Database, botId: string, flowJson: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO scenario_drafts (bot_id, flow_json, updated_at) VALUES (?,?,?)
       ON CONFLICT(bot_id) DO UPDATE SET flow_json = excluded.flow_json, updated_at = excluded.updated_at`
    )
    .bind(botId, flowJson, Date.now())
    .run();
}

export async function deleteScenarioDraft(db: D1Database, botId: string): Promise<void> {
  await db.prepare('DELETE FROM scenario_drafts WHERE bot_id = ?').bind(botId).run();
}

export async function logEvent(db: D1Database, botId: string, userId: number | null, event: string): Promise<void> {
  await db.prepare('INSERT INTO logs (bot_id, user_id, event, ts) VALUES (?,?,?,?)').bind(botId, userId, event, Date.now()).run();
}

// ---- subscribers ----
export async function subscribe(db: D1Database, botId: string, userId: number): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO subscribers (bot_id, user_id, created_at) VALUES (?,?,?)')
    .bind(botId, userId, Date.now())
    .run();
}
export async function unsubscribe(db: D1Database, botId: string, userId: number): Promise<void> {
  await db.prepare('DELETE FROM subscribers WHERE bot_id = ? AND user_id = ?').bind(botId, userId).run();
}
export async function listSubscribers(db: D1Database, botId: string): Promise<number[]> {
  const rows = (await db.prepare('SELECT user_id FROM subscribers WHERE bot_id = ?').bind(botId).all<{ user_id: number }>()).results ?? [];
  return rows.map((r) => r.user_id);
}
// ---- scheduled (delayed) sends ----
export async function insertScheduled(
  db: D1Database,
  botId: string,
  userId: number,
  sendAt: number,
  method: string,
  payloadJson: string
): Promise<void> {
  await db
    .prepare('INSERT INTO scheduled_sends (bot_id, user_id, send_at, method, payload_json, created_at) VALUES (?,?,?,?,?,?)')
    .bind(botId, userId, sendAt, method, payloadJson, Date.now())
    .run();
}
// F-013: захват задачи перед обработкой. CF cron at-least-once: дублирующий
// тик или два изолята раньше выбирали одни и те же due-строки и отправляли
// сообщение дважды. Теперь dueScheduled возвращает свободные и «зависшие»
// (захваченные дольше CLAIM_STALE_MS назад — изолят умер посреди обработки),
// а обработчик ОБЯЗАН начать с claimScheduledSend: атомарный UPDATE даёт
// ровно одного победителя (паттерн markScheduleRun для bot_schedules).
export const SCHEDULED_CLAIM_STALE_MS = 600_000; // 10 минут

export async function dueScheduled(db: D1Database, now: number): Promise<
  { id: number; bot_id: string; user_id: number; method: string; payload_json: string }[]
> {
  const rows = (
    await db
      .prepare(
        `SELECT id, bot_id, user_id, method, payload_json FROM scheduled_sends
         WHERE send_at <= ? AND (claimed_at IS NULL OR claimed_at < ?)
         ORDER BY send_at ASC LIMIT 50`
      )
      .bind(now, now - SCHEDULED_CLAIM_STALE_MS)
      .all<{ id: number; bot_id: string; user_id: number; method: string; payload_json: string }>()
  ).results ?? [];
  return rows;
}

// Атомарный захват задачи: true только если claimed_at сдвинулся (был пуст
// или завис дольше SCHEDULED_CLAIM_STALE_MS). Два параллельных тика — только
// один победитель; проигравший пропускает строку.
export async function claimScheduledSend(db: D1Database, id: number, nowMs: number): Promise<boolean> {
  const res = await db
    .prepare('UPDATE scheduled_sends SET claimed_at = ? WHERE id = ? AND (claimed_at IS NULL OR claimed_at < ?)')
    .bind(nowMs, id, nowMs - SCHEDULED_CLAIM_STALE_MS)
    .run();
  return changesOf(res) > 0;
}

export async function deleteScheduled(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM scheduled_sends WHERE id = ?').bind(id).run();
}

// ---- расписания (§4, миграция 0027) ----
// Блок schedule регистрирует строку; крон раз в минуту выбирает живые и
// считает срабатывания (shared/cron.ts). last_run_at обновляется атомарно
// (WHERE last_run_at < ?) — повторный/дублирующий тик не срабатывает дважды.

export interface BotScheduleRow {
  id: string;
  bot_id: string;
  block_id: string;
  cron_expr: string;
  timezone: string;
  audience: 'all' | 'tag' | 'single';
  audience_tag: string;
  audience_user: number | null;
  enabled: number;
  last_run_at: number | null;
  created_at: number;
}

export async function upsertSchedule(
  db: D1Database,
  row: {
    id: string;
    bot_id: string;
    block_id: string;
    cron_expr: string;
    timezone: string;
    audience: string;
    audience_tag: string;
    audience_user: number | null;
    created_at: number;
  }
): Promise<void> {
  // UNIQUE(bot_id, block_id): повторная регистрация того же блока перезаписывает
  // параметры (автор мог поменять время), но last_run_at сохраняется — перенос
  // расписания не даёт ему мгновенно сработать повторно.
  await db
    .prepare(
      `INSERT INTO bot_schedules (id, bot_id, block_id, cron_expr, timezone, audience, audience_tag, audience_user, enabled, last_run_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,NULL,?)
       ON CONFLICT (bot_id, block_id) DO UPDATE SET
         cron_expr = excluded.cron_expr,
         timezone = excluded.timezone,
         audience = excluded.audience,
         audience_tag = excluded.audience_tag,
         audience_user = excluded.audience_user,
         enabled = 1`
    )
    .bind(row.id, row.bot_id, row.block_id, row.cron_expr, row.timezone, row.audience, row.audience_tag, row.audience_user, row.created_at)
    .run();
}

export async function countBotSchedules(db: D1Database, botId: string): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM bot_schedules WHERE bot_id = ?').bind(botId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

export async function getScheduleByBlock(db: D1Database, botId: string, blockId: string): Promise<BotScheduleRow | null> {
  return (
    (await db.prepare('SELECT * FROM bot_schedules WHERE bot_id = ? AND block_id = ?').bind(botId, blockId).first<BotScheduleRow>()) ?? null
  );
}

export async function listEnabledSchedules(db: D1Database, limit = 2000): Promise<BotScheduleRow[]> {
  const rows = (
    await db
      .prepare('SELECT * FROM bot_schedules WHERE enabled = 1 ORDER BY bot_id, created_at LIMIT ?')
      .bind(limit)
      .all<BotScheduleRow>()
  ).results ?? [];
  return rows;
}

// Атомарная отметка срабатывания: вернёт true только если last_run_at сдвинулся
// (был меньше fireAt или пуст). Два параллельных тика — только один победитель.
export async function markScheduleRun(db: D1Database, id: string, fireAt: number): Promise<boolean> {
  const res = await db
    .prepare('UPDATE bot_schedules SET last_run_at = ? WHERE id = ? AND (last_run_at IS NULL OR last_run_at < ?)')
    .bind(fireAt, id, fireAt)
    .run();
  return changesOf(res) > 0;
}

// Расписание, чей блок пропал из опубликованной сборки, глушится с логом —
// без error-loop (крон не должен каждую минуту спотыкаться о мёртвую строку).
export async function disableSchedule(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE bot_schedules SET enabled = 0 WHERE id = ?').bind(id).run();
}

export async function deleteSchedulesByBot(db: D1Database, botId: string): Promise<void> {
  await db.prepare('DELETE FROM bot_schedules WHERE bot_id = ?').bind(botId).run();
}

// ---- referrals ----
// Бонус за приглашение НЕ зашит в платформу: движок только фиксирует связь и
// кладёт {{ref.link}} / {{ref.inviter}} / {{ref.count}} в переменные сценария,
// а автор бота собирает ветку награды из обычных блоков.

export interface ReferralRow {
  id: string;
  bot_id: string;
  inviter_user_id: string;
  invited_user_id: string;
  created_at: number;
  depth: number;
}

// Возвращает false, если этот пользователь уже был засчитан за другим
// пригласившим (уникальность bot_id + invited_user_id).
export async function recordReferral(db: D1Database, ref: ReferralRow): Promise<boolean> {
  const res = await db
    .prepare(
      'INSERT OR IGNORE INTO referrals (id, bot_id, inviter_user_id, invited_user_id, created_at, depth) VALUES (?,?,?,?,?,?)'
    )
    .bind(ref.id, ref.bot_id, ref.inviter_user_id, ref.invited_user_id, ref.created_at, ref.depth)
    .run();
  return (res as any)?.changes > 0;
}

export async function findInviter(db: D1Database, botId: string, invitedUserId: string): Promise<string | null> {
  const r = await db
    .prepare('SELECT inviter_user_id FROM referrals WHERE bot_id = ? AND invited_user_id = ?')
    .bind(botId, invitedUserId)
    .first<{ inviter_user_id: string }>();
  return r?.inviter_user_id ?? null;
}

export async function countInvited(db: D1Database, botId: string, inviterUserId: string): Promise<number> {
  const r = await db
    .prepare('SELECT COUNT(*) AS c FROM referrals WHERE bot_id = ? AND inviter_user_id = ?')
    .bind(botId, inviterUserId)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Пригласивший + число приглашённых ОДНИМ round-trip'ом: оба значения лежат
// в одной таблице referrals и нужны вебхуку на каждом апдейте. Два отдельных
// SELECT'а (findInviter + countInvited) дают вдвое больше обращений к D1.
export async function referralContext(
  db: D1Database,
  botId: string,
  userId: string
): Promise<{ inviter: string | null; invitedCount: number }> {
  const r = await db
    .prepare(
      'SELECT (SELECT inviter_user_id FROM referrals WHERE bot_id = ?1 AND invited_user_id = ?2) AS inviter, ' +
        '(SELECT COUNT(*) FROM referrals WHERE bot_id = ?1 AND inviter_user_id = ?2) AS c'
    )
    .bind(botId, userId)
    .first<{ inviter: string | null; c: number | null }>();
  return { inviter: r?.inviter ?? null, invitedCount: Number(r?.c ?? 0) };
}

export async function referralStats(db: D1Database, botId: string): Promise<{ total: number; byInviter: Record<string, number> }> {
  const rows =
    (
      await db
        .prepare('SELECT inviter_user_id, COUNT(*) AS c FROM referrals WHERE bot_id = ? GROUP BY inviter_user_id')
        .bind(botId)
        .all<{ inviter_user_id: string; c: number }>()
    ).results ?? [];
  const byInviter: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byInviter[r.inviter_user_id] = r.c;
    total += r.c;
  }
  return { total, byInviter };
}

// ---- user settings (per-user, синхронизируются между устройствами) ----

export type ThemeName = 'dark' | 'light';
export type LangName = 'ru' | 'en';
export type SkillLevel = 'high' | 'medium' | 'low';

export interface UserSettings {
  theme: ThemeName;
  hints_enabled: boolean;
  language: LangName;
  feature_whatif: boolean;
  feature_conflicts: boolean;
  feature_sleep: boolean;
  // Показывать секцию «Продвинутое» в палитре блоков (миграция 0020).
  // false — прежнее поведение: продвинутые блоки скрыты.
  advanced_blocks: boolean;
  /** '' — уровень ещё не выбран (фронт показывает экран выбора). */
  skill_level: SkillLevel | '';
  /** Раскрытие групп палитры: одна за раз («аккордеон») или сколько угодно. */
  palette_mode: PaletteMode;
  // Когда уровень был выбран. null/undefined — ещё ни разу: тогда и показываем
  // стартовый экран. Смотреть на пустой skill_level нельзя: пока настройки
  // грузятся, он пуст у всех, и модалка мигает у тех, у кого уровень есть (F8).
  skill_level_set_at: number | null;
  // Когда пользователь прошёл тур «соберите первого бота». Живёт на аккаунте,
  // а не в localStorage: иначе тур возвращается на новом устройстве (F9).
  tour_done_at: number | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  hints_enabled: true,
  language: 'ru',
  feature_whatif: true,
  feature_conflicts: true,
  feature_sleep: true,
  advanced_blocks: false,
  skill_level: '',
  palette_mode: 'accordion',
  skill_level_set_at: null,
  tour_done_at: null,
};

export type PaletteMode = 'accordion' | 'free';

export function isValidPaletteMode(v: unknown): v is PaletteMode {
  return v === 'accordion' || v === 'free';
}

export function normalizePaletteMode(v: unknown): PaletteMode {
  return v === 'free' ? 'free' : 'accordion';
}

const SKILL_VALUES: (SkillLevel | '')[] = ['', 'high', 'medium', 'low'];

export function isValidSkillLevel(v: unknown): v is SkillLevel | '' {
  return SKILL_VALUES.includes(v as SkillLevel | '');
}

export function normalizeSkillLevel(v: unknown): SkillLevel | '' {
  return SKILL_VALUES.includes(v as SkillLevel | '') ? (v as SkillLevel | '') : '';
}

interface SettingsRow {
  user_id: string;
  theme: string;
  hints_enabled: number;
  language: string;
  feature_whatif: number;
  feature_conflicts: number;
  feature_sleep: number;
  advanced_blocks?: number | null;
  skill_level?: string | null;
  palette_mode?: string | null;
  skill_level_set_at?: number | null;
  tour_done_at?: number | null;
  updated_at: number;
}

// Приводим необязательное числовое поле к числу или null: из D1 может прийти
// undefined (старая строка/легаси-схема), null или строка.
function numberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToSettings(r: SettingsRow | null): UserSettings {
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    theme: r.theme === 'light' ? 'light' : 'dark',
    hints_enabled: !!r.hints_enabled,
    language: r.language === 'en' ? 'en' : 'ru',
    feature_whatif: !!r.feature_whatif,
    feature_conflicts: !!r.feature_conflicts,
    feature_sleep: !!r.feature_sleep,
    // Старая строка без колонки (до миграции 0020) — false, прежнее поведение.
    advanced_blocks: !!r.advanced_blocks,
    skill_level: normalizeSkillLevel(r.skill_level),
    palette_mode: normalizePaletteMode(r.palette_mode),
    skill_level_set_at: numberOrNull(r.skill_level_set_at),
    tour_done_at: numberOrNull(r.tour_done_at),
  };
}

export async function getSettings(db: D1Database, userId: string): Promise<UserSettings> {
  const r = await db
    .prepare('SELECT * FROM user_settings WHERE user_id = ?')
    .bind(userId)
    .first<SettingsRow>();
  return rowToSettings(r ?? null);
}

// Мержим частичный патч с существующей записью и возвращаем полный набор.
export async function putSettings(db: D1Database, userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  const prevRow = await db
    .prepare('SELECT * FROM user_settings WHERE user_id = ?')
    .bind(userId)
    .first<SettingsRow>();
  const prev = rowToSettings(prevRow ?? null);
  const next: UserSettings = {
    theme: patch.theme ?? prev.theme,
    hints_enabled: patch.hints_enabled ?? prev.hints_enabled,
    language: patch.language ?? prev.language,
    feature_whatif: patch.feature_whatif ?? prev.feature_whatif,
    feature_conflicts: patch.feature_conflicts ?? prev.feature_conflicts,
    feature_sleep: patch.feature_sleep ?? prev.feature_sleep,
    advanced_blocks: patch.advanced_blocks ?? prev.advanced_blocks,
    skill_level: patch.skill_level ?? prev.skill_level,
    palette_mode: patch.palette_mode ?? prev.palette_mode,
    // Эти два поля не приходят из пользовательского тела запроса обычным
    // путём — их ставит сервер (момент выбора уровня и прохождения тура).
    // Дата выбора уровня пишется РОВНО ОДИН РАЗ: по ней решается, показывать ли
    // стартовый экран, поэтому смена уровня в Настройках не должна её сдвигать.
    skill_level_set_at:
      prev.skill_level_set_at ?? (patch.skill_level_set_at !== undefined ? patch.skill_level_set_at : null),
    tour_done_at: patch.tour_done_at !== undefined ? patch.tour_done_at : prev.tour_done_at,
  };
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, theme, hints_enabled, language, feature_whatif, feature_conflicts, feature_sleep, advanced_blocks, skill_level, palette_mode, skill_level_set_at, tour_done_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         theme = excluded.theme, hints_enabled = excluded.hints_enabled, language = excluded.language,
         feature_whatif = excluded.feature_whatif, feature_conflicts = excluded.feature_conflicts,
         feature_sleep = excluded.feature_sleep, advanced_blocks = excluded.advanced_blocks,
         skill_level = excluded.skill_level,
         palette_mode = excluded.palette_mode,
         skill_level_set_at = excluded.skill_level_set_at,
         tour_done_at = excluded.tour_done_at,
         updated_at = excluded.updated_at`
    )
    .bind(
      userId,
      next.theme,
      next.hints_enabled ? 1 : 0,
      next.language,
      next.feature_whatif ? 1 : 0,
      next.feature_conflicts ? 1 : 0,
      next.feature_sleep ? 1 : 0,
      next.advanced_blocks ? 1 : 0,
      next.skill_level,
      next.palette_mode,
      next.skill_level_set_at,
      next.tour_done_at,
      Date.now()
    )
    .run();
  return next;
}

// ---- templates (глобальный каталог) ----

export interface TemplateRow {
  id: string;
  author_user_id: string;
  title: string;
  description: string;
  tags: string; // JSON array
  scenario_json: string;
  created_at: number;
  uses_count: number;
  likes_count: number;
}

export type TemplateListItem = Omit<TemplateRow, 'scenario_json' | 'tags'> & { tags: string[] };

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function toListItem(r: TemplateRow): TemplateListItem {
  const { scenario_json: _ignored, ...rest } = r;
  return { ...rest, tags: parseTags(r.tags) };
}

export async function listTemplates(
  db: D1Database,
  opts: { sort?: string; q?: string; tag?: string } = {}
): Promise<TemplateListItem[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  const q = (opts.q || '').trim();
  if (q) {
    // WS-15: % и _ в запросе — литералы, не метасимволы (как в support/clients).
    where.push(`(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')`);
    const like = `%${escapeLike(q)}%`;
    binds.push(like, like, like);
  }
  if (opts.tag) {
    // P-R01: тот же escapeLike, что в q-ветке — % и _ в имени тега литералы,
    // а кавычка в теге не ломает JSON-подобный шаблон LIKE.
    where.push(`tags LIKE ? ESCAPE '\\'`);
    binds.push(`%"${escapeLike(opts.tag)}"%`);
  }
  const orderBy =
    opts.sort === 'popularity'
      ? 'ORDER BY (uses_count + likes_count) DESC, created_at DESC'
      : 'ORDER BY created_at DESC';
  const sql = `SELECT id, author_user_id, title, description, tags, created_at, uses_count, likes_count
               FROM templates ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${orderBy} LIMIT 200`;
  let stmt: any = db.prepare(sql);
  if (binds.length) stmt = stmt.bind(...binds);
  const rows: TemplateRow[] = ((await stmt.all()).results ?? []) as TemplateRow[];
  return rows.map(toListItem);
}

export async function getTemplate(db: D1Database, id: string): Promise<TemplateRow | null> {
  return (await db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<TemplateRow>()) ?? null;
}

export async function insertTemplate(db: D1Database, t: TemplateRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO templates (id, author_user_id, title, description, tags, scenario_json, created_at, uses_count, likes_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(t.id, t.author_user_id, t.title, t.description, t.tags, t.scenario_json, t.created_at, t.uses_count, t.likes_count)
    .run();
}

export async function bumpTemplateUses(db: D1Database, id: string): Promise<number> {
  await db.prepare('UPDATE templates SET uses_count = uses_count + 1 WHERE id = ?').bind(id).run();
  const r = await db.prepare('SELECT uses_count FROM templates WHERE id = ?').bind(id).first<{ uses_count: number }>();
  return r?.uses_count ?? 0;
}

export async function bumpTemplateLikes(db: D1Database, id: string): Promise<number> {
  await db.prepare('UPDATE templates SET likes_count = likes_count + 1 WHERE id = ?').bind(id).run();
  const r = await db.prepare('SELECT likes_count FROM templates WHERE id = ?').bind(id).first<{ likes_count: number }>();
  return r?.likes_count ?? 0;
}

export async function deleteTemplate(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM templates WHERE id = ?').bind(id).run();
  return (res as any)?.changes > 0;
}

// ---- analytics ----
// One round-trip instead of 4: the three log/scenario counts plus subscribers
// collapse into a single SELECT of scalar subqueries (reusing ?1 throughout).
export async function stats(
  db: D1Database,
  botId: string
): Promise<{ users: number; steps: number; lastScenarios: number; subscribers: number }> {
  const r = (await db
    .prepare(`
      SELECT
        (SELECT COUNT(DISTINCT user_id) FROM logs WHERE bot_id = ?1 AND user_id IS NOT NULL) AS users,
        (SELECT COUNT(*) FROM logs WHERE bot_id = ?1 AND event LIKE 'step.%') AS steps,
        (SELECT COUNT(*) FROM scenarios WHERE bot_id = ?1) AS lastScenarios,
        (SELECT COUNT(*) FROM subscribers WHERE bot_id = ?1) AS subscribers
    `)
    .bind(botId)
    .first<{ users: number; steps: number; lastScenarios: number; subscribers: number }>()) ?? null;
  return {
    users: r?.users ?? 0,
    steps: r?.steps ?? 0,
    lastScenarios: r?.lastScenarios ?? 0,
    subscribers: r?.subscribers ?? 0,
  };
}

// ---------------- scenario cache (KV) ----------------
// Сценарий читается на КАЖДЫЙ входящий апдейт, а меняется редко. Держим в KV
// готовый flow_json вместе с посчитанными флагами, чтобы hot-path не ходил в D1
// и не искал подстроки в JSON. Кэш живёт час — на случай, если инвалидация
// (сброс при сохранении) по какой-то причине не прошла.

export interface CachedScenario {
  version: number;
  flow_json: string;
  has_referral: boolean;
}

const SC_PREFIX = 'sc:';
const SC_TTL = 3600;

export async function loadScenarioCached(
  kv: KVNamespace | undefined,
  db: D1Database,
  botId: string
): Promise<CachedScenario | null> {
  if (kv) {
    try {
      const raw = await kv.get(`${SC_PREFIX}${botId}`, 'json');
      if (raw && typeof raw === 'object' && typeof (raw as CachedScenario).flow_json === 'string') {
        return raw as CachedScenario;
      }
    } catch {
      /* кэш недоступен — читаем из D1 */
    }
  }
  const sc = await loadPublishedScenario(db, botId);
  if (!sc) return null;
  // Флаг считаем по типам блоков (scenarioHasReferral), а не подстрокой:
  // «referral_track» содержит «referral» как префикс, но подстрочный поиск
  // `"referral"` (с кавычкой) его не находит — бонусы молча не работали бы.
  let hasReferral = false;
  try {
    hasReferral = scenarioHasReferral(JSON.parse(sc.flow_json) as Scenario);
  } catch {
    hasReferral = sc.flow_json.includes('"referral"');
  }
  const cached: CachedScenario = {
    version: sc.version,
    flow_json: sc.flow_json,
    has_referral: hasReferral,
  };
  if (kv) {
    try {
      await kv.put(`${SC_PREFIX}${botId}`, JSON.stringify(cached), { expirationTtl: SC_TTL });
    } catch {
      /* кэш недоступен — просто работаем без него */
    }
  }
  return cached;
}

// Вызывается после каждого сохранения/публикации/отката версии.
export async function invalidateScenarioCache(kv: KVNamespace | undefined, botId: string): Promise<void> {
  if (!kv) return;
  try {
    await kv.delete(`${SC_PREFIX}${botId}`);
  } catch {
    /* не критично: кэш истечёт сам через TTL */
  }
}

// ---------------- batched hot-path writes ----------------
// upsertSession + logEvent уходят в D1 одним round-trip'ом (db.batch) и не
// блокируют ответ Telegram — их выполняет ctx.waitUntil.

export function sessionAndLogStmts(
  db: D1Database,
  botId: string,
  userId: number,
  currentBlock: string | null,
  varsJson: string,
  event: string,
  // Профиль клиента (имя/@username) приходит только из вебхука. Если его нет —
  // COALESCE оставит уже записанные значения, а не затрёт их пустотой.
  profile?: { firstName?: string | null; username?: string | null }
): D1PreparedStatement[] {
  const now = Date.now();
  const first = profile?.firstName ?? null;
  const user = profile?.username ?? null;
  return [
    db
      .prepare(
        `INSERT INTO sessions (bot_id, user_id, current_block, vars_json, updated_at, first_name, username, first_seen, search_text)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(bot_id, user_id) DO UPDATE SET
           current_block = excluded.current_block,
           vars_json = excluded.vars_json,
           updated_at = excluded.updated_at,
           first_name = COALESCE(excluded.first_name, sessions.first_name),
           username = COALESCE(excluded.username, sessions.username),
           first_seen = COALESCE(sessions.first_seen, excluded.first_seen),
           search_text = excluded.search_text`
      )
      .bind(botId, userId, currentBlock, varsJson, now, first, user, now, searchTextOf(first, user, varsJson)),
    db.prepare('INSERT INTO logs (bot_id, user_id, event, ts) VALUES (?,?,?,?)').bind(botId, userId, event, now),
  ];
}

// ---------------- versions (история сценария) ----------------

export interface ScenarioVersionRow {
  version: number;
  name: string;
  updated_at: number;
  size: number;
  published?: boolean;
}

export async function listScenarioVersions(db: D1Database, botId: string, limit = 30): Promise<ScenarioVersionRow[]> {
  const rows =
    (
      await db
        .prepare(
          'SELECT s.version, s.name, s.updated_at, LENGTH(s.flow_json) AS size, 0 AS published FROM scenarios s WHERE s.bot_id = ? ORDER BY s.version DESC LIMIT ?'
        )
        .bind(botId, limit)
        .all<ScenarioVersionRow>()
    ).results ?? [];
  return rows;
}

export async function getScenarioVersion(
  db: D1Database,
  botId: string,
  version: number
): Promise<{ flow_json: string; name: string } | null> {
  return (
    (await db
      .prepare('SELECT flow_json, name FROM scenarios WHERE bot_id = ? AND version = ?')
      .bind(botId, version)
      .first<{ flow_json: string; name: string }>()) ?? null
  );
}

export async function deleteScenarioVersion(db: D1Database, botId: string, version: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM scenarios
       WHERE bot_id = ? AND version = ?
         AND version <> (SELECT version FROM scenarios WHERE bot_id = ? ORDER BY version DESC LIMIT 1)
         AND version <> COALESCE((SELECT published_version FROM bots WHERE id = ?), -1)`
    )
    .bind(botId, version, botId, botId)
    .run();
  return changesOf(result);
}

export async function deleteScenarioVersionsExcept(db: D1Database, botId: string, keepVersions: number[]): Promise<number> {
  const keep = keepVersions.filter((v) => Number.isInteger(v) && v > 0);
  const keepCondition = keep.length ? ` AND version NOT IN (${keep.map(() => '?').join(',')})` : '';
  const result = await db
    .prepare(
      `DELETE FROM scenarios
       WHERE bot_id = ?${keepCondition}
         AND version <> (SELECT version FROM scenarios WHERE bot_id = ? ORDER BY version DESC LIMIT 1)
         AND version <> COALESCE((SELECT published_version FROM bots WHERE id = ?), -1)`
    )
    .bind(botId, ...keep, botId, botId)
    .run();
  return changesOf(result);
}

// ---------------- logs (отладка сценария) ----------------

export interface LogRow {
  id: number;
  user_id: number | null;
  event: string;
  ts: number;
}

export async function listLogs(
  db: D1Database,
  botId: string,
  limit = 100,
  userId?: number | null
): Promise<LogRow[]> {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  if (userId != null) {
    const rows =
      (
        await db
          .prepare('SELECT id, user_id, event, ts FROM logs WHERE bot_id = ? AND user_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
          .bind(botId, userId, lim)
          .all<LogRow>()
      ).results ?? [];
    return rows;
  }
  const rows =
    (
      await db
        .prepare('SELECT id, user_id, event, ts FROM logs WHERE bot_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
        .bind(botId, lim)
        .all<LogRow>()
    ).results ?? [];
  return rows;
}

export async function clearLogs(db: D1Database, botId: string): Promise<number> {
  const result = await db.prepare('DELETE FROM logs WHERE bot_id = ?').bind(botId).run();
  return changesOf(result);
}

// ---------------- сводные логи владельца (страница «Пользователи») ----------------

export interface OwnerLogRow extends LogRow {
  bot_id: string;
  bot_name: string;
}

// Логи ВСЕХ ботов одного аккаунта: logs.bot_id -> bots.owner_id. Прямой связи
// аккаунт <-> logs нет (logs.user_id — это Telegram-клиент), поэтому JOIN через
// bots. Порядок как у listLogs: ts DESC, id DESC. limit зажат до 500.
export async function listLogsByOwner(
  db: D1Database,
  ownerId: string,
  opts: { limit?: number; botId?: string; userId?: number | null } = {}
): Promise<OwnerLogRow[]> {
  const lim = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const where: string[] = ['b.owner_id = ?'];
  const args: unknown[] = [ownerId];
  if (opts.botId) {
    where.push('l.bot_id = ?');
    args.push(opts.botId);
  }
  if (opts.userId != null) {
    where.push('l.user_id = ?');
    args.push(opts.userId);
  }
  const rows =
    (
      await db
        .prepare(
          `SELECT l.id, l.bot_id, b.name AS bot_name, l.user_id, l.event, l.ts
           FROM logs l JOIN bots b ON b.id = l.bot_id
           WHERE ${where.join(' AND ')}
           ORDER BY l.ts DESC, l.id DESC LIMIT ?`
        )
        .bind(...args, lim)
        .all<OwnerLogRow>()
    ).results ?? [];
  return rows;
}

// Сколько всего событий в логах ботов владельца — для блока «итоги» на
// странице сотрудника.
export async function countLogsByOwner(db: D1Database, ownerId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM logs l JOIN bots b ON b.id = l.bot_id WHERE b.owner_id = ?')
    .bind(ownerId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

// Свежайшая версия сценария бота (черновик), без чтения flow_json.
export async function getLatestScenarioVersion(db: D1Database, botId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT MAX(version) AS v FROM scenarios WHERE bot_id = ?')
    .bind(botId)
    .first<{ v: number | null }>();
  return row?.v == null ? null : Number(row.v);
}

// Логи растут бесконечно и со временем начинают тормозить аналитику.
// Крон раз в сутки стирает всё старше 30 дней.
export async function deleteOldLogs(db: D1Database, olderThanTs: number): Promise<number> {
  const res = await db.prepare('DELETE FROM logs WHERE ts < ?').bind(olderThanTs).run().catch(() => null);
  return (res as any)?.changes ?? 0;
}

// ---------------- broadcasts (рассылка пачками) ----------------
// Большую рассылку нельзя слать в одном запросе: упрёмся в лимит воркера.
// Режем подписчиков на пачки и кладём в существующую таблицу scheduled_sends.

export interface BroadcastChunk {
  bot_id: string;
  user_id: number;
  send_at: number;
  method: string;
  payload_json: string;
  created_at?: number;
}

export async function insertScheduledBatch(db: D1Database, rows: BroadcastChunk[]): Promise<void> {
  if (!rows.length) return;
  const stmts = rows.map((r) =>
    db
      .prepare('INSERT INTO scheduled_sends (bot_id, user_id, send_at, method, payload_json, created_at) VALUES (?,?,?,?,?,?)')
      .bind(r.bot_id, r.user_id, r.send_at, r.method, r.payload_json, r.created_at ?? Date.now())
  );
  await db.batch(stmts);
}

// ---------------- referral flag ----------------
// Флаг «в сценарии есть блок рефералки» считается один раз при сохранении —
// иначе webhook-обработчик обязан парсить весь JSON на каждое сообщение.

export async function setBotReferralFlag(db: D1Database, botId: string, flag: boolean): Promise<void> {
  await db.prepare('UPDATE bots SET has_referral = ? WHERE id = ?').bind(flag ? 1 : 0, botId).run();
}

// ---------------- сохранение сценария без новой версии ----------------
// Автосохранение дёргает PUT на каждое движение мышью. Раньше каждый такой
// вызов писал новую строку в scenarios: история версий превращалась в кашу из
// одинаковых копий. Позиции блоков перезаписываем в текущей версии.
export async function updateScenarioJson(
  db: D1Database,
  botId: string,
  version: number,
  name: string,
  flowJson: string
): Promise<void> {
  await db
    .prepare('UPDATE scenarios SET name = ?, flow_json = ?, updated_at = ? WHERE bot_id = ? AND version = ?')
    .bind(name, flowJson, Date.now(), botId, version)
    .run();
}

// ---------------- аккаунты ----------------
export async function setAccountPassword(db: D1Database, userId: string, passHash: string): Promise<void> {
  await db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').bind(passHash, userId).run();
}

// ---------------- удаление бота ----------------
// Каскад вручную: внешних ключей в схеме нет, поэтому без этого удаление
// бота оставляло бы сирот в сценариях, сессиях, логах и рассылках.
export async function deleteBotCascade(db: D1Database, botId: string): Promise<void> {
  // Снапшоты публикаций мини-аппов (0025) живут на mini_app_id без bot_id —
  // удаляются подзапросом ДО самих mini_apps, иначе после их удаления
  // подзапрос уже ничего не найдёт. batch исполняет statements по порядку.
  await db
    .prepare('DELETE FROM mini_app_versions WHERE mini_app_id IN (SELECT id FROM mini_apps WHERE bot_id = ?)')
    .bind(botId)
    .run();
  const tables = [
    'scenarios',
    'sessions',
    'logs',
    'subscribers',
    'scheduled_sends',
    'referrals',
    'collections',
    'collection_items',
    'user_tags',
    'scenario_drafts',
    'payment_orders',
    'payment_connections',
    // Счётчики и реферальные начисления (миграции 0017/0019) тоже живут на bot_id.
    'counters',
    'broadcast_counters',
    'referral_bonuses',
    'referral_payments',
    'referral_tournaments',
    'referral_tournament_entries',
    // Раскрытые билды — артефакты версий сценария, уходят вместе с ними.
    'scenario_builds',
    // Расписания (§4): крон не должен fire'ить по удалённому боту.
    'bot_schedules',
    // Мини-аппы (0025/0026): опубликованный JSON и usage-счётчики не должны
    // переживать бота. versions удалены подзапросом выше, до этого списка.
    'mini_apps',
    'mini_app_usage',
    // Журнал Stars-платежей мини-аппов (0029).
    'mini_payments',
    // Входящие вебхуки (0028): token глобально UNIQUE, сирота заняла бы слот.
    'bot_webhooks',
  ];
  await db.batch(tables.map((t) => db.prepare(`DELETE FROM ${t} WHERE bot_id = ?`).bind(botId)));
  await db.prepare('DELETE FROM bots WHERE id = ?').bind(botId).run();
}

// Полное удаление аккаунта. Таблицы связаны без FK, поэтому порядок важен:
// сперва дочерние записи ботов и тикетов, затем сами боты и, в конце, аккаунт.
// Имена таблиц фиксированы в коде; пользовательские значения всегда bind-параметры.
export async function deleteAccountCascade(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE author_user_id = ?)').bind(userId),
    db.prepare('DELETE FROM support_tickets WHERE author_user_id = ?').bind(userId),
    db.prepare('DELETE FROM collection_items WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM collections WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM user_tags WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM scenario_drafts WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM scenario_builds WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM payment_orders WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM payment_connections WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM sessions WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM subscribers WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM scheduled_sends WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM logs WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM scenarios WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM referrals WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?) OR inviter_user_id = ? OR invited_user_id = ?').bind(userId, userId, userId),
    // Счётчики и реферальные начисления (0017/0019) — до удаления самих ботов:
    // подзапрос SELECT id FROM bots после него уже ничего не найдёт.
    db.prepare('DELETE FROM counters WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM broadcast_counters WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM referral_bonuses WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM referral_payments WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM referral_tournaments WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM referral_tournament_entries WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM bot_schedules WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    // Мини-аппы (0025/0026) и входящие вебхуки (0028) — тоже до удаления bots:
    // подзапрос SELECT id FROM bots после него уже ничего не найдёт.
    // Снапшоты версий идут первыми: у mini_app_versions нет bot_id, только
    // mini_app_id, поэтому вложенный подзапрос через mini_apps того же владельца.
    db.prepare('DELETE FROM mini_app_versions WHERE mini_app_id IN (SELECT id FROM mini_apps WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?))').bind(userId),
    db.prepare('DELETE FROM mini_apps WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM mini_app_usage WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM mini_payments WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM bot_webhooks WHERE bot_id IN (SELECT id FROM bots WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM bots WHERE owner_id = ?').bind(userId),
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM templates WHERE author_user_id = ?').bind(userId),
    // Библиотека подсценариев принадлежит аккаунту и уходит вместе с ним.
    db.prepare('DELETE FROM subflow_versions WHERE subflow_id IN (SELECT id FROM subflows WHERE owner_id = ?)').bind(userId),
    db.prepare('DELETE FROM subflows WHERE owner_id = ?').bind(userId),
    db.prepare('DELETE FROM accounts WHERE id = ?').bind(userId),
  ]);
}

// ---------------- повторы отложенных отправок ----------------
// Раньше любая ошибка в кроне удаляла задачу: минутный сбой Telegram или D1 —
// и отложенное сообщение (или целая рассылка) терялось молча. Теперь задача
// живёт до MAX_ATTEMPTS, а пауза между попытками растёт.
export async function bumpScheduledAttempt(db: D1Database, id: number): Promise<number> {
  const row = await db
    .prepare('SELECT attempts FROM scheduled_sends WHERE id = ?')
    .bind(id)
    .first<{ attempts: number | null }>();
  const next = (row?.attempts ?? 0) + 1;
  await db.prepare('UPDATE scheduled_sends SET attempts = ? WHERE id = ?').bind(next, id).run();
  return next;
}

export async function rescheduleScheduled(db: D1Database, id: number, sendAt: number): Promise<void> {
  await db.prepare('UPDATE scheduled_sends SET send_at = ? WHERE id = ?').bind(sendAt, id).run();
}

// F-028/F-013: перенос задачи с освобождением захвата. После claimScheduledSend
// строка скрыта от dueScheduled на SCHEDULED_CLAIM_STALE_MS — обычный
// rescheduleScheduled оставил бы перенесённую задачу невидимой для следующего
// тика. claimed_at сбрасывается, чтобы крон сразу увидел строку в новое время.
// payloadJson передаётся при 429-переносе рассылки: в очередь возвращается
// только НЕотправленный остаток получателей (ушедшие не дублируются).
export async function rescheduleScheduledSend(
  db: D1Database,
  id: number,
  sendAt: number,
  payloadJson?: string
): Promise<void> {
  if (payloadJson !== undefined) {
    await db
      .prepare('UPDATE scheduled_sends SET send_at = ?, payload_json = ?, claimed_at = NULL WHERE id = ?')
      .bind(sendAt, payloadJson, id)
      .run();
    return;
  }
  await db
    .prepare('UPDATE scheduled_sends SET send_at = ?, claimed_at = NULL WHERE id = ?')
    .bind(sendAt, id)
    .run();
}

// ---------------- индекс сессий пользователя ----------------
// KV сам по себе не умеет «удалить все сессии аккаунта» — ключи живут по
// одному на токен. Держим список токенов пользователя, чтобы «выйти на всех
// устройствах» и смена пароля реально гасили чужие входы.
const SESSION_INDEX_TTL = 60 * 60 * 24 * 30;
const MAX_TRACKED_SESSIONS = 25;

async function readSessionIndex(kv: KVNamespace, userId: string): Promise<string[]> {
  const raw = await kv.get(`sidx:${userId}`).catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

async function writeSessionIndex(kv: KVNamespace, userId: string, tokens: string[]): Promise<void> {
  if (!tokens.length) {
    await kv.delete(`sidx:${userId}`).catch(() => {});
    return;
  }
  await kv.put(`sidx:${userId}`, JSON.stringify(tokens), { expirationTtl: SESSION_INDEX_TTL }).catch(() => {});
}

export async function indexUserSession(kv: KVNamespace, userId: string, token: string): Promise<void> {
  if (!token) return;
  const tokens = await readSessionIndex(kv, userId);
  if (!tokens.includes(token)) tokens.push(token);
  // Список растёт только до разумного предела: старые токены и так протухнут.
  await writeSessionIndex(kv, userId, tokens.slice(-MAX_TRACKED_SESSIONS));
}

export async function forgetUserSession(kv: KVNamespace, userId: string, token: string): Promise<void> {
  if (!token) return;
  const tokens = await readSessionIndex(kv, userId);
  await writeSessionIndex(kv, userId, tokens.filter((t) => t !== token));
}

/** Гасит все сессии аккаунта. Возвращает количество погашенных токенов. */
export async function dropUserSessions(kv: KVNamespace, userId: string): Promise<number> {
  const tokens = await readSessionIndex(kv, userId);
  await Promise.all(tokens.map((t) => kv.delete(`sess:${t}`).catch(() => {})));
  await writeSessionIndex(kv, userId, []);
  return tokens.length;
}

// ---------------- счётчики сценария (0019) ----------------
// Блоки «Инкремент» / «Декремент» / «Сброс» двигают одно число на пользователя
// или на бота целиком. Пишем одним UPSERT'ом, а не «прочитал -> прибавил ->
// записал»: клиент может нажать кнопку дважды подряд, и при двух запросах второе
// нажатие перетёрло бы результат первого. Здесь же значение не ограничиваем
// нулём — декремент может увести счётчик в минус, и это осознанно: нижнюю
// границу («осталось не меньше 0») автор задаёт условием в сценарии, а не
// хранилище, иначе откатить вниз уже нельзя было бы.

// scope 'bot' означает «всего в боте»: пользователя в таком счётчике нет, поэтому
// ключом всегда идёт пустая строка, каким бы ни был переданный scopeId. Контракт
// держим внутри функций — иначе вызов с чужим scopeId создал бы вторую копию
// бот-счётчика, и половина инкрементов ушла бы мимо.
function counterKey(scope: 'user' | 'bot', scopeId: string): string {
  return scope === 'bot' ? '' : String(scopeId ?? '');
}

// amount приходит из сценария, то есть может оказаться дробным, строкой или NaN
// (переменная не задана). D1 записал бы такое как NULL или мусор, поэтому
// нормализуем сами: NaN -> 0, дробное -> ближайшее целое.
function counterAmount(amount: number): number {
  const n = Math.round(Number(amount));
  return Number.isFinite(n) ? n : 0;
}

// Прибавить к счётчику. Возвращает значение ПОСЛЕ записи — сценарий часто решает
// «хватит или нет» сразу по возврату блока, без отдельного чтения.
//
// Возврат идёт вторым запросом (SELECT), а не через RETURNING: поддержка RETURNING
// в D1 зависит от версии wrangler/платформы, а это не то, чего стоит ждать в
// продакшене при живом боте. Один лишний SELECT дешевле молча сломанного блока.
export async function counterInc(
  db: D1Database,
  botId: string,
  scope: 'user' | 'bot',
  scopeId: string,
  name: string,
  amount: number
): Promise<number> {
  await db
    .prepare(
      `INSERT INTO counters (bot_id, scope, scope_id, name, value, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(bot_id, scope, scope_id, name)
       DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`
    )
    .bind(botId, scope, counterKey(scope, scopeId), name, counterAmount(amount), Date.now())
    .run();
  return counterGet(db, botId, scope, scopeId, name);
}

// Уменьшить счётчик. Значение не зажимаем нулём: минус — валидное состояние
// (см. комментарий к секции), и «-amount» уходит в тот же атомарный UPSERT.
export async function counterDec(
  db: D1Database,
  botId: string,
  scope: 'user' | 'bot',
  scopeId: string,
  name: string,
  amount: number
): Promise<number> {
  await db
    .prepare(
      `INSERT INTO counters (bot_id, scope, scope_id, name, value, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(bot_id, scope, scope_id, name)
       DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`
    )
    .bind(botId, scope, counterKey(scope, scopeId), name, -counterAmount(amount), Date.now())
    .run();
  return counterGet(db, botId, scope, scopeId, name);
}

// Обнулить счётчик. Именно UPSERT с value = 0, а не UPDATE: у нового клиента
// строки ещё нет, и «сброс» должен создавать её, а не молча ничего не делать.
export async function counterReset(
  db: D1Database,
  botId: string,
  scope: 'user' | 'bot',
  scopeId: string,
  name: string
): Promise<number> {
  await db
    .prepare(
      `INSERT INTO counters (bot_id, scope, scope_id, name, value, updated_at)
       VALUES (?,?,?,?,0,?)
       ON CONFLICT(bot_id, scope, scope_id, name)
       DO UPDATE SET value = 0, updated_at = excluded.updated_at`
    )
    .bind(botId, scope, counterKey(scope, scopeId), name, Date.now())
    .run();
  return counterGet(db, botId, scope, scopeId, name);
}

// Прочитать счётчик. Несуществующая запись — это 0, а не null: для сценария
// «сколько раз клиент что-то сделал» ноль и «строки нет» — одно и то же, и
// автору не нужно ставить проверку на пустоту после каждого чтения.
export async function counterGet(
  db: D1Database,
  botId: string,
  scope: 'user' | 'bot',
  scopeId: string,
  name: string
): Promise<number> {
  const row = await db
    .prepare('SELECT value FROM counters WHERE bot_id = ? AND scope = ? AND scope_id = ? AND name = ?')
    .bind(botId, scope, counterKey(scope, scopeId), name)
    .first<{ value: number }>();
  const v = Number(row?.value ?? 0);
  return Number.isFinite(v) ? v : 0;
}

// Дневной остаток рассылки (dailyCap). Счётчик живёт на бота, а не на
// пользователя: лимит ограничивает суммарный объём за сутки, поэтому попытки
// считать его по каждому получателю отдельно не сработали бы вовсе.
// day — 'YYYY-MM-DD' в UTC; бот не знает часового пояса клиента, значит сутки
// здесь технические.
export async function bumpBroadcastCounter(db: D1Database, botId: string, day: string, amount: number): Promise<number> {
  await db
    .prepare(
      `INSERT INTO broadcast_counters (bot_id, day, sent, updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(bot_id, day)
       DO UPDATE SET sent = sent + excluded.sent, updated_at = excluded.updated_at`
    )
    .bind(botId, day, counterAmount(amount), Date.now())
    .run();
  return getBroadcastCounter(db, botId, day);
}

// ES-10: атомарный bump дневного счётчика рассылки с проверкой капа ОДНИМ SQL.
// Старый путь (getBroadcastCounter → постановка в очередь → bumpBroadcastCounter)
// читал счётчик дважды и писал после постановки — два параллельных enqueue
// превышали dailyCap. Здесь уперт с условием: строка обновляется только если
// сумма не превышает cap, иначе changes = 0 (ok: false).
//   ok: true  — счётчик увеличен (или строка создана), count = значение ПОСЛЕ;
//   ok: false — cap превышен (или строка уже на пределе), запись НЕ менялась.
// inc <= 0 не принимаем: бюджет рассылки — положительное число.
// Синтаксис «DO UPDATE ... WHERE» работает в SQLite 3.24+ (D1 — свежее),
// транзакция не понадобилась (проверено на node:sqlite).
export async function tryBumpBroadcastCounter(
  db: D1Database,
  botId: string,
  day: string,
  inc: number,
  cap: number
): Promise<{ ok: boolean; count: number }> {
  const n = counterAmount(inc);
  if (n <= 0) {
    const current = await getBroadcastCounter(db, botId, day);
    return { ok: false, count: current };
  }
  const now = Date.now();
  const res = await db
    .prepare(
      `INSERT INTO broadcast_counters (bot_id, day, sent, updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(bot_id, day)
       DO UPDATE SET sent = sent + excluded.sent, updated_at = excluded.updated_at
       WHERE sent + excluded.sent <= ?`
    )
    .bind(botId, day, n, now, counterAmount(cap))
    .run();
  const count = await getBroadcastCounter(db, botId, day);
  // Первая вставка дня не проверяет cap (insert-ветка upsert'а не имеет WHERE):
  // сверяем итог сами — если даже один инкремент выше капа, строку откатываем.
  if (changesOf(res) === 0) return { ok: false, count };
  if (count > counterAmount(cap)) {
    await db.prepare('UPDATE broadcast_counters SET sent = sent - ?, updated_at = ? WHERE bot_id = ? AND day = ?')
      .bind(n, now, botId, day)
      .run().catch(() => {});
    return { ok: false, count: count - n };
  }
  return { ok: true, count };
}

// Отправлено за день. Дня ещё нет в таблице — значит отправок не было, 0.
export async function getBroadcastCounter(db: D1Database, botId: string, day: string): Promise<number> {
  const row = await db
    .prepare('SELECT sent FROM broadcast_counters WHERE bot_id = ? AND day = ?')
    .bind(botId, day)
    .first<{ sent: number }>();
  const v = Number(row?.sent ?? 0);
  return Number.isFinite(v) ? v : 0;
}

// ---------------- платежи (миграция 0018) ----------------
//
// Принцип платформы: она НЕ использует свой платёжный аккаунт, не проксирует
// деньги и никогда не видит данные карт. Каждый владелец бота подключает СВОЕГО
// провайдера, а платформа только хранит конфиг подключения (не секретный —
// открыто, секретный — зашифрованным), собирает ссылки и проверяет подписи
// вебхуков. Ни одна функция ниже не возвращает секрет наружу: secrets_enc
// расшифровывается только в момент обращения к провайдеру.

export type PaymentProvider = 'telegram' | 'yookassa' | 'robokassa' | 'stripe' | 'custom';

export interface PaymentConnectionRow {
  id: string;
  bot_id: string;
  provider: PaymentProvider;
  title: string;
  config_json: string;
  secrets_enc: string;
  // Легаси-путь вебхука (миграция 0018). Для маршрутизации больше не
  // используется — роут /pay/:botId/:webhookPath отвечает 410. Колонка
  // сохраняется: в D1 удаление колонки = пересборка таблицы.
  webhook_path: string;
  // Короткий публичный код (миграция 0022): адрес вебхука /p/<token>.
  // NULL у легаси-строк до ленивого бэкфилла.
  webhook_token: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface PaymentOrderRow {
  id: string;
  bot_id: string;
  connection_id: string;
  user_id: number;
  external_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'cancelled';
  payload_json: string;
  paid_at: number | null;
  created_at: number;
  updated_at: number;
}

export async function listPaymentConnections(db: D1Database, botId: string): Promise<PaymentConnectionRow[]> {
  const rows =
    (
      await db
        .prepare('SELECT * FROM payment_connections WHERE bot_id = ? ORDER BY created_at')
        .bind(botId)
        .all<PaymentConnectionRow>()
    ).results ?? [];
  return rows;
}

export async function getPaymentConnection(
  db: D1Database,
  botId: string,
  id: string
): Promise<PaymentConnectionRow | null> {
  return (
    (await db
      .prepare('SELECT * FROM payment_connections WHERE bot_id = ? AND id = ?')
      .bind(botId, id)
      .first<PaymentConnectionRow>()) ?? null
  );
}

export async function insertPaymentConnection(db: D1Database, row: PaymentConnectionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO payment_connections
       (id, bot_id, provider, title, config_json, secrets_enc, webhook_path, webhook_token, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      row.id,
      row.bot_id,
      row.provider,
      row.title,
      row.config_json,
      row.secrets_enc,
      row.webhook_path,
      row.webhook_token,
      row.enabled,
      row.created_at,
      row.updated_at
    )
    .run();
}

// Частичное обновление: пустой секрет означает «оставить прежний» — владелец
// правит, например, заголовок, и не обязан заново вводить ключ.
export async function updatePaymentConnection(
  db: D1Database,
  botId: string,
  id: string,
  patch: { title?: string; config_json?: string; secrets_enc?: string; enabled?: number }
): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    args.push(patch.title);
  }
  if (patch.config_json !== undefined) {
    sets.push('config_json = ?');
    args.push(patch.config_json);
  }
  if (patch.secrets_enc) {
    sets.push('secrets_enc = ?');
    args.push(patch.secrets_enc);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    args.push(patch.enabled ? 1 : 0);
  }
  if (!sets.length) return false;
  sets.push('updated_at = ?');
  args.push(Date.now());
  const res = await db
    .prepare(`UPDATE payment_connections SET ${sets.join(', ')} WHERE bot_id = ? AND id = ?`)
    .bind(...args, botId, id)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

export async function deletePaymentConnection(db: D1Database, botId: string, id: string): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM payment_connections WHERE bot_id = ? AND id = ?')
    .bind(botId, id)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

// Поиск подключения по ПУБЛИЧНОМУ пути вебхука. botId передаётся отдельно и
// сверяется: путь уникален глобально, но принимать чужой вебхук нельзя.
// ЛЕГАСИ: роут /pay/:botId/:webhookPath отключён (410), функция оставлена для
// тестов и обратной совместимости кода.
export async function getPaymentConnectionByPath(
  db: D1Database,
  botId: string,
  path: string
): Promise<PaymentConnectionRow | null> {
  if (!path) return null;
  return (
    (await db
      .prepare('SELECT * FROM payment_connections WHERE bot_id = ? AND webhook_path = ? AND enabled = 1')
      .bind(botId, path)
      .first<PaymentConnectionRow>()) ?? null
  );
}

// Поиск подключения по короткому публичному коду /p/<token>. Код глобально
// уникален (bot id из URL исчез), поэтому botId не нужен — он берётся из строки.
// enabled = 1 обязателен: отключённое подключение не принимает вебхуки.
export async function getPaymentConnectionByToken(
  db: D1Database,
  token: string
): Promise<PaymentConnectionRow | null> {
  if (!token) return null;
  return (
    (await db
      .prepare('SELECT * FROM payment_connections WHERE webhook_token = ? AND enabled = 1')
      .bind(token)
      .first<PaymentConnectionRow>()) ?? null
  );
}

// Ленивый бэкфилл: выдать токен строке без него. Guard `webhook_token IS NULL`
// делает UPDATE идемпотентным — при гонке двух запросов токен запишет один,
// второй получит changes=0 и перечитает готовое значение.
export async function ensureWebhookToken(
  db: D1Database,
  id: string,
  token: string
): Promise<boolean> {
  const res = await db
    .prepare('UPDATE payment_connections SET webhook_token = ?, updated_at = ? WHERE id = ? AND webhook_token IS NULL')
    .bind(token, Date.now(), id)
    .run();
  return changesOf(res) > 0;
}

// Ротация токена: старый адрес сразу перестаёт работать (строка перезаписана).
export async function rotateWebhookToken(
  db: D1Database,
  botId: string,
  id: string,
  token: string
): Promise<boolean> {
  const res = await db
    .prepare('UPDATE payment_connections SET webhook_token = ?, updated_at = ? WHERE bot_id = ? AND id = ?')
    .bind(token, Date.now(), botId, id)
    .run();
  return changesOf(res) > 0;
}

export async function insertPaymentOrder(
  db: D1Database,
  row: {
    id: string;
    bot_id: string;
    connection_id: string;
    user_id: number;
    external_id: string;
    amount: number;
    currency: string;
    status: PaymentOrderRow['status'];
    payload_json?: string;
  }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO payment_orders
       (id, bot_id, connection_id, user_id, external_id, amount, currency, status, payload_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      row.id,
      row.bot_id,
      row.connection_id,
      row.user_id,
      row.external_id,
      Math.round(row.amount) || 0,
      row.currency,
      row.status,
      row.payload_json ?? '{}',
      now,
      now
    )
    .run();
}

export async function getPaymentOrder(db: D1Database, botId: string, orderId: string): Promise<PaymentOrderRow | null> {
  return (
    (await db
      .prepare('SELECT * FROM payment_orders WHERE bot_id = ? AND id = ?')
      .bind(botId, orderId)
      .first<PaymentOrderRow>()) ?? null
  );
}

export async function getPaymentOrderByExternalId(
  db: D1Database,
  botId: string,
  externalId: string
): Promise<PaymentOrderRow | null> {
  return (
    (await db
      .prepare('SELECT * FROM payment_orders WHERE bot_id = ? AND external_id = ?')
      .bind(botId, externalId)
      .first<PaymentOrderRow>()) ?? null
  );
}

// Отметка «оплачено». WHERE status <> 'paid' делает операцию идемпотентной:
// провайдеры повторяют вебхуки агрессивно, и второй вызов не должен ничего
// менять (0 изменённых строк = событие уже обработано).
export async function markPaymentOrderPaid(db: D1Database, botId: string, orderId: string): Promise<boolean> {
  const now = Date.now();
  const res = await db
    .prepare(
      `UPDATE payment_orders SET status = 'paid', paid_at = ?, updated_at = ?
       WHERE bot_id = ? AND id = ? AND status <> 'paid'`
    )
    .bind(now, now, botId, orderId)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

export async function updatePaymentOrderStatus(
  db: D1Database,
  botId: string,
  orderId: string,
  status: PaymentOrderRow['status']
): Promise<boolean> {
  const res = await db
    .prepare('UPDATE payment_orders SET status = ?, updated_at = ? WHERE bot_id = ? AND id = ?')
    .bind(status, Date.now(), botId, orderId)
    .run()
    .catch(() => null);
  return changesOf(res) > 0;
}

export async function listPaymentOrdersForUser(
  db: D1Database,
  botId: string,
  userId: number,
  limit = 20
): Promise<PaymentOrderRow[]> {
  const rows =
    (
      await db
        .prepare('SELECT * FROM payment_orders WHERE bot_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?')
        .bind(botId, userId, Math.min(Math.max(Number(limit) || 20, 1), 100))
        .all<PaymentOrderRow>()
    ).results ?? [];
  return rows;
}

// Каскад удаления бота: платёжные подключения — его данные, и они должны
// уходить вместе с ботом (иначе останутся «живые» вебхуки удалённого бота).
export async function deletePaymentDataForBot(db: D1Database, botId: string): Promise<void> {
  await db
    .batch([
      db.prepare('DELETE FROM payment_orders WHERE bot_id = ?').bind(botId),
      db.prepare('DELETE FROM payment_connections WHERE bot_id = ?').bind(botId),
    ])
    .catch((e) => {
      console.error('[db] deletePaymentDataForBot batch failed:', e);
      throw e;
    });
}

// ---------------- подсценарии (миграция 0021) ----------------
//
// Библиотека фрагментов аккаунта. Все запросы скоупятся по owner_id: бот может
// вызывать ТОЛЬКО фрагменты своего владельца, и это правило enforced здесь,
// а не только в UI.

export interface SubflowRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  revision: number;
  flow_json: string;
  inputs_json: string;
  outputs_json: string;
  created_at: number;
  updated_at: number;
}

export interface SubflowVersionRow {
  id: string;
  subflow_id: string;
  revision: number;
  flow_json: string;
  inputs_json: string;
  outputs_json: string;
  name: string;
  created_at: number;
}

export async function listSubflows(db: D1Database, ownerId: string): Promise<SubflowRow[]> {
  const rows =
    (
      await db
        .prepare('SELECT * FROM subflows WHERE owner_id = ? ORDER BY updated_at DESC')
        .bind(ownerId)
        .all<SubflowRow>()
    ).results ?? [];
  return rows;
}

export async function getSubflow(db: D1Database, ownerId: string | null, id: string): Promise<SubflowRow | null> {
  // ownerId = null — админский доступ (как в остальных роутах).
  const row =
    (await db.prepare('SELECT * FROM subflows WHERE id = ?').bind(id).first<SubflowRow>()) ?? null;
  if (!row) return null;
  if (ownerId !== null && row.owner_id !== ownerId) return null;
  return row;
}

export async function insertSubflow(db: D1Database, row: SubflowRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subflows (id, owner_id, name, description, revision, flow_json, inputs_json, outputs_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(row.id, row.owner_id, row.name, row.description, row.revision, row.flow_json, row.inputs_json, row.outputs_json, row.created_at, row.updated_at)
    .run();
}

// Сохранение фрагмента = новая ревизия + строка истории. Одним батчем: история
// не должна расходиться с текущим состоянием даже при частичном сбое.
export async function saveSubflowRevision(
  db: D1Database,
  row: SubflowRow
): Promise<number> {
  const now = Date.now();
  const revision = row.revision + 1;
  await db
    .batch([
      db
        .prepare(
          `UPDATE subflows SET name = ?, description = ?, flow_json = ?, inputs_json = ?, outputs_json = ?, revision = ?, updated_at = ? WHERE id = ?`
        )
        .bind(row.name, row.description, row.flow_json, row.inputs_json, row.outputs_json, revision, now, row.id),
      db
        .prepare(
          `INSERT INTO subflow_versions (id, subflow_id, revision, flow_json, inputs_json, outputs_json, name, created_at)
           VALUES (?,?,?,?,?,?,?,?)`
        )
        .bind(`${row.id}:${revision}`, row.id, revision, row.flow_json, row.inputs_json, row.outputs_json, row.name, now),
    ])
    .catch((e) => {
      console.error('[db] saveSubflowRevision batch failed:', e);
      throw e;
    });
  return revision;
}

export async function listSubflowVersions(db: D1Database, subflowId: string, limit = 50): Promise<SubflowVersionRow[]> {
  const rows =
    (
      await db
        .prepare('SELECT id, subflow_id, revision, name, created_at, LENGTH(flow_json) AS size FROM subflow_versions WHERE subflow_id = ? ORDER BY revision DESC LIMIT ?')
        .bind(subflowId, Math.min(Math.max(Number(limit) || 50, 1), 200))
        .all<SubflowVersionRow>()
    ).results ?? [];
  return rows;
}

export async function getSubflowVersion(db: D1Database, subflowId: string, revision: number): Promise<SubflowVersionRow | null> {
  return (
    (await db
      .prepare('SELECT * FROM subflow_versions WHERE subflow_id = ? AND revision = ?')
      .bind(subflowId, revision)
      .first<SubflowVersionRow>()) ?? null
  );
}

// Восстановление ревизии: копирует старое содержимое в subflows НОВОЙ ревизией
// (история не перезаписывается — как rollback сценария бота).
export async function restoreSubflowRevision(db: D1Database, subflowId: string, revision: number): Promise<number | null> {
  const v = await getSubflowVersion(db, subflowId, revision);
  const cur = await db.prepare('SELECT revision FROM subflows WHERE id = ?').bind(subflowId).first<{ revision: number }>();
  if (!v || !cur) return null;
  const next = Number(cur.revision) + 1;
  const now = Date.now();
  await db
    .batch([
      db
        .prepare('UPDATE subflows SET flow_json = ?, inputs_json = ?, outputs_json = ?, revision = ?, updated_at = ? WHERE id = ?')
        .bind(v.flow_json, v.inputs_json, v.outputs_json, next, now, subflowId),
      db
        .prepare(
          `INSERT INTO subflow_versions (id, subflow_id, revision, flow_json, inputs_json, outputs_json, name, created_at)
           VALUES (?,?,?,?,?,?,?,?)`
        )
        .bind(`${subflowId}:${next}`, subflowId, next, v.flow_json, v.inputs_json, v.outputs_json, v.name, now),
    ])
    .catch((e) => {
      console.error('[db] restoreSubflowRevision batch failed:', e);
      throw e;
    });
  return next;
}

export async function deleteSubflow(db: D1Database, subflowId: string): Promise<boolean> {
  // Удаление НЕ трогает боты: ссылки остаются в сценариях и становятся
  // ошибками валидации (subflow-missing) с id блока вызова — как «ссылка на
  // удалённый блок» сегодня.
  await db.prepare('DELETE FROM subflow_versions WHERE subflow_id = ?').bind(subflowId).run().catch(() => null);
  const res = await db.prepare('DELETE FROM subflows WHERE id = ?').bind(subflowId).run().catch(() => null);
  return changesOf(res) > 0;
}

// Сколько ботов владельца используют каждый фрагмент. ОДИН ограниченный
// запрос на все фрагменты (никакого N+1): берём последнюю версию сценария
// каждого бота и считаем вхождения id в flow_json в JS (id — UUID, подстрока
// `"subflowId":"<id>"` не может случайно совпасть).
export async function subflowUsageCounts(db: D1Database, ownerId: string): Promise<Record<string, number>> {
  const rows =
    (
      await db
        .prepare(
          `SELECT flow_json FROM scenarios s
           WHERE s.bot_id IN (SELECT id FROM bots WHERE owner_id = ?)
             AND s.version = (SELECT MAX(version) FROM scenarios s2 WHERE s2.bot_id = s.bot_id)
           LIMIT 200`
        )
        .bind(ownerId)
        .all<{ flow_json: string }>()
    ).results ?? [];
  const counts: Record<string, number> = {};
  const re = /"subflowId"\s*:\s*"([0-9a-fA-F-]{8,})"/g;
  for (const r of rows) {
    const seen = new Set<string>();
    for (const m of String(r.flow_json ?? '').matchAll(re)) seen.add(m[1]);
    for (const id of seen) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

// ---------------- scenario_builds (раскрытые артефакты публикации) ----------------

export async function putScenarioBuild(db: D1Database, botId: string, version: number, flowJson: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO scenario_builds (bot_id, version, flow_json, built_at) VALUES (?,?,?,?)
       ON CONFLICT(bot_id, version) DO UPDATE SET flow_json = excluded.flow_json, built_at = excluded.built_at`
    )
    .bind(botId, version, flowJson, Date.now())
    .run();
}

export async function getScenarioBuild(db: D1Database, botId: string, version: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT flow_json FROM scenario_builds WHERE bot_id = ? AND version = ?')
    .bind(botId, version)
    .first<{ flow_json: string }>();
  return row?.flow_json ?? null;
}

// ---------------- мини-аппы (миграция 0025) ----------------
//
// Мини-апп привязан к боту и хранит черновик + опубликованную схему (JSON из
// shared/miniapp.ts). Публикация пишет снапшот в mini_app_versions с
// revision = max + 1 — история не перезаписывается (как у subflow_versions).

export interface MiniAppRow {
  id: string;
  bot_id: string;
  owner_id: string;
  name: string;
  slug: string;
  access_rule_json: string;
  draft_json: string;
  published_json: string | null;
  created_at: number;
  updated_at: number;
}

export async function createMiniApp(
  db: D1Database,
  args: { id: string; botId: string; ownerId: string; name: string; slug: string; accessRuleJson: string; draftJson: string }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO mini_apps (id, bot_id, owner_id, name, slug, access_rule_json, draft_json, published_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(args.id, args.botId, args.ownerId, args.name, args.slug, args.accessRuleJson, args.draftJson, null, now, now)
    .run();
}

export async function getMiniApp(db: D1Database, id: string): Promise<MiniAppRow | null> {
  return (await db.prepare('SELECT * FROM mini_apps WHERE id = ?').bind(id).first<MiniAppRow>()) ?? null;
}

export async function getMiniAppBySlug(db: D1Database, botId: string, slug: string): Promise<MiniAppRow | null> {
  return (
    (await db.prepare('SELECT * FROM mini_apps WHERE bot_id = ? AND slug = ?').bind(botId, slug).first<MiniAppRow>()) ?? null
  );
}

export async function listMiniAppsByBot(db: D1Database, botId: string): Promise<MiniAppRow[]> {
  const rows =
    (
      await db
        .prepare('SELECT * FROM mini_apps WHERE bot_id = ? ORDER BY created_at DESC')
        .bind(botId)
        .all<MiniAppRow>()
    ).results ?? [];
  return rows;
}

export interface MiniAppListItem {
  id: string;
  bot_id: string;
  bot_name: string;
  bot_username: string | null;
  name: string;
  slug: string;
  published: number;
  updated_at: number;
}

export async function listMiniAppsByOwner(db: D1Database, ownerId: string): Promise<MiniAppListItem[]> {
  const rows = (
    await db
      .prepare(
        `SELECT m.id, m.bot_id, b.name AS bot_name, b.bot_username,
                m.name, m.slug, (m.published_json IS NOT NULL) AS published, m.updated_at
         FROM mini_apps m JOIN bots b ON b.id = m.bot_id
         WHERE m.owner_id = ? ORDER BY m.updated_at DESC`
      )
      .bind(ownerId)
      .all<MiniAppListItem>()
  ).results ?? [];
  return rows;
}

export async function updateMiniAppDraft(db: D1Database, id: string, draftJson: string, name?: string): Promise<void> {
  const now = Date.now();
  if (name != null) {
    await db
      .prepare('UPDATE mini_apps SET name = ?, draft_json = ?, updated_at = ? WHERE id = ?')
      .bind(name, draftJson, now, id)
      .run();
    return;
  }
  await db
    .prepare('UPDATE mini_apps SET draft_json = ?, updated_at = ? WHERE id = ?')
    .bind(draftJson, now, id)
    .run();
}

// Публикация = published_json в mini_apps + неизменяемый снапшот в
// mini_app_versions. Одним батчем: указатель публикации и история не должны
// разойтись даже при частичном сбое. Возвращает новый revision.
export async function publishMiniApp(db: D1Database, id: string, publishedJson: string): Promise<number> {
  const cur = await db.prepare('SELECT id FROM mini_apps WHERE id = ?').bind(id).first<{ id: string }>();
  if (!cur) throw new Error('mini app not found');
  const last = await db
    .prepare('SELECT COALESCE(MAX(revision), 0) AS rev FROM mini_app_versions WHERE mini_app_id = ?')
    .bind(id)
    .first<{ rev: number }>();
  const revision = Number(last?.rev ?? 0) + 1;
  const now = Date.now();
  await db
    .batch([
      db.prepare('UPDATE mini_apps SET published_json = ?, updated_at = ? WHERE id = ?').bind(publishedJson, now, id),
      db
        .prepare(
          `INSERT INTO mini_app_versions (id, mini_app_id, revision, published_json, created_at)
           VALUES (?,?,?,?,?)`
        )
        .bind(`${id}:${revision}`, id, revision, publishedJson, now),
    ])
    .catch((e) => {
      console.error('[db] publishMiniApp batch failed:', e);
      throw e;
    });
  return revision;
}

export async function listMiniAppVersions(
  db: D1Database,
  miniAppId: string
): Promise<{ id: string; revision: number; created_at: number }[]> {
  const rows =
    (
      await db
        .prepare('SELECT id, revision, created_at FROM mini_app_versions WHERE mini_app_id = ? ORDER BY revision DESC')
        .bind(miniAppId)
        .all<{ id: string; revision: number; created_at: number }>()
    ).results ?? [];
  return rows;
}

export async function getMiniAppVersion(db: D1Database, miniAppId: string, revision: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT published_json FROM mini_app_versions WHERE mini_app_id = ? AND revision = ?')
    .bind(miniAppId, revision)
    .first<{ published_json: string }>();
  return row?.published_json ?? null;
}

// Каскад без FK: снапшоты удаляются тем же батчем, что и сам апп.
export async function deleteMiniApp(db: D1Database, id: string): Promise<void> {
  await db
    .batch([
      db.prepare('DELETE FROM mini_app_versions WHERE mini_app_id = ?').bind(id),
      db.prepare('DELETE FROM mini_apps WHERE id = ?').bind(id),
    ])
    .catch((e) => {
      console.error('[db] deleteMiniApp batch failed:', e);
      throw e;
    });
}

// ---------------- usage мини-аппов (миграции 0026 + 0029) ----------------
//
// Таблица после 0029: PK (bot_id, user_id, date). Дневной счётчик AI живёт на
// пару «пользователь + сутки» (F-039: раньше лимит был общим на бота — один
// посетитель исчерпывал бюджет всем). Медиа-байты Filebase — агрегат на бота:
// пишутся в служебную строку (user_id = 0, date = ''), читаются суммой SUM по
// всем строкам бота. Оба перехода (первое обращение / новое значение) — один
// атомарный UPSERT по полному PK; возврат значения ПОСЛЕ записи отдельным
// SELECT: RETURNING в D1 зависит от версии платформы (резон counterInc выше).

export interface MiniAppUsageRow {
  media_bytes: number;
}

// Служебная строка медиа-квоты: user_id = 0 не является валидным Telegram id.
const MINI_USAGE_BOT_ROW_USER = 0;
const MINI_USAGE_BOT_ROW_DATE = '';

// Строк ещё нет — значит ни байт, ни генераций: null отличаем от «нулей»
// намеренно, вызывающий код решает, показывать ли счётчик вообще.
export async function getMiniAppUsage(db: D1Database, botId: string): Promise<MiniAppUsageRow | null> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(media_bytes), 0) AS media_bytes FROM mini_app_usage WHERE bot_id = ?')
    .bind(botId)
    .first<{ n: number; media_bytes: number }>();
  if (!row || Number(row.n) === 0) return null;
  const v = Number(row.media_bytes ?? 0);
  return { media_bytes: Number.isFinite(v) ? v : 0 };
}

// Прибавить медиа-байты бота (загрузка — плюс, удаление — минус). Ниже нуля
// счётчик не уходит, иначе одно удаление «в минус» навсегда съедало бы часть
// квоты. delta биндится дважды: в insert-ветку — зажатая MAX(0, ?) (новая
// строка не должна стартовать с минуса), а в update-ветку — сырым параметром:
// excluded.media_bytes приходит уже зажатым, и отрицательный delta (освобождение
// квоты при удалении файла) через него не применить. Сумму от минуса защищает
// MAX(0, ...) в update-ветке. Возврат — сумма по боту (строки юзеров после
// 0029 media_bytes не несут, но SUM честнее, чем чтение одной строки).
export async function addMiniAppMediaBytes(db: D1Database, botId: string, delta: number): Promise<number> {
  const n = counterAmount(delta);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO mini_app_usage (bot_id, user_id, date, media_bytes, ai_count, updated_at)
       VALUES (?,?,?,MAX(0, ?),0,?)
       ON CONFLICT(bot_id, user_id, date)
       DO UPDATE SET media_bytes = MAX(0, media_bytes + ?), updated_at = excluded.updated_at`
    )
    .bind(botId, MINI_USAGE_BOT_ROW_USER, MINI_USAGE_BOT_ROW_DATE, n, now, n)
    .run();
  const row = await db
    .prepare('SELECT COALESCE(SUM(media_bytes), 0) AS media_bytes FROM mini_app_usage WHERE bot_id = ?')
    .bind(botId)
    .first<{ media_bytes: number }>();
  const v = Number(row?.media_bytes ?? 0);
  return Number.isFinite(v) ? v : 0;
}

// Шагнуть дневной счётчик AI-генераций ПОЛЬЗОВАТЕЛЯ (F-039) и вернуть значение
// ПОСЛЕ записи: вызывающий код сразу сравнивает его с MINI_LIMITS.aiPerUserDay.
// today — 'YYYY-MM-DD' (UTC, как day у bumpBroadcastCounter). Сутки входят в PK:
// новая дата — новая строка, CASE WHEN по дате больше не нужен. Переход
// решается внутри SQL, а не чтением-сравнением-записью, чтобы два параллельных
// запроса не сбросили счётчик друг у друга.
// userId пока опционален (дефолт 0 = старая бот-строка): текущий вызов в
// index.ts не передаёт пользователя, интегратор следующей волны переключит его
// на rt.ctx.userId — до этого момента лимит остаётся общим на бота, НО схема
// уже пер-user и поведение прод-кода не сломано.
export async function bumpMiniAppAiCount(db: D1Database, botId: string, today: string, userId = MINI_USAGE_BOT_ROW_USER): Promise<number> {
  await db
    .prepare(
      `INSERT INTO mini_app_usage (bot_id, user_id, date, media_bytes, ai_count, updated_at)
       VALUES (?,?,?,0,1,?)
       ON CONFLICT(bot_id, user_id, date)
       DO UPDATE SET ai_count = ai_count + 1, updated_at = excluded.updated_at`
    )
    .bind(botId, userId, today, Date.now())
    .run();
  return getMiniAppAiCount(db, botId, today, userId);
}

// Дневной счётчик AI конкретного пользователя без записи. userId = 0 —
// агрегатная бот-строка (совместимость со старыми вызовами).
export async function getMiniAppAiCount(db: D1Database, botId: string, today: string, userId = MINI_USAGE_BOT_ROW_USER): Promise<number> {
  const row = await db
    .prepare('SELECT ai_count FROM mini_app_usage WHERE bot_id = ? AND user_id = ? AND date = ?')
    .bind(botId, userId, today)
    .first<{ ai_count: number }>();
  const v = Number(row?.ai_count ?? 0);
  return Number.isFinite(v) ? v : 0;
}

// ---------------- журнал платежей мини-аппов (F-041, миграция 0029) ----------------
// Stars-счёт мини-аппа: строка создаётся ДО sendInvoice (payload 'mini:<id>'
// уникален), pre_checkout_query сверяет с ней сумму, successful_payment
// идемпотентно отмечает paid по charge_id.

export interface MiniPaymentRow {
  id: string;
  bot_id: string;
  app_id: string;
  user_id: number;
  amount: number;
  payload: string;
  charge_id: string | null;
  status: 'pending' | 'paid';
  created_at: number;
  paid_at: number | null;
}

const MINI_PAYMENT_COLS = 'id, bot_id, app_id, user_id, amount, payload, charge_id, status, created_at, paid_at';

export async function createMiniPayment(
  db: D1Database,
  row: { id: string; bot_id: string; app_id: string; user_id: number; amount: number; payload: string; created_at: number }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mini_payments (id, bot_id, app_id, user_id, amount, payload, status, created_at)
       VALUES (?,?,?,?,?,?,'pending',?)`
    )
    .bind(row.id, row.bot_id, row.app_id, row.user_id, row.amount, row.payload, row.created_at)
    .run();
}

export async function deleteMiniPayment(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM mini_payments WHERE id = ?').bind(id).run();
}

export async function getMiniPaymentByPayload(db: D1Database, payload: string): Promise<MiniPaymentRow | null> {
  return (
    (await db
      .prepare(`SELECT ${MINI_PAYMENT_COLS} FROM mini_payments WHERE payload = ?`)
      .bind(payload)
      .first<MiniPaymentRow>()) ?? null
  );
}

export async function getMiniPaymentByCharge(db: D1Database, chargeId: string): Promise<MiniPaymentRow | null> {
  if (!chargeId) return null;
  return (
    (await db
      .prepare(`SELECT ${MINI_PAYMENT_COLS} FROM mini_payments WHERE charge_id = ?`)
      .bind(chargeId)
      .first<MiniPaymentRow>()) ?? null
  );
}

// Идемпотентная отметка оплаты: true только если строка реально стала paid
// (паттерн markPaymentOrderPaid). Повтор successful_payment (ретрай Telegram)
// вернёт false — вызывающий не пишет двойных эффектов.
export async function markMiniPaymentPaid(
  db: D1Database,
  payload: string,
  chargeId: string,
  paidAt: number
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE mini_payments SET status = 'paid', charge_id = ?, paid_at = ?
       WHERE payload = ? AND status <> 'paid' AND charge_id IS NULL`
    )
    .bind(chargeId, paidAt, payload)
    .run();
  return changesOf(res) > 0;
}
