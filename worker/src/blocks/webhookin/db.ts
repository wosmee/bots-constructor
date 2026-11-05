// Webhook-in db-слой (миграция 0028): bot_webhooks — хуки, зарегистрированные
// блоками webhook_in. Поиск входящего запроса идёт по token (уникален на всю
// таблицу: bot id в URL не участвует, как у платёжного webhook_token),
// очистка — по bot_id (удаление бота / снятие публикации).
//
// fields хранится JSON-массивом имён; битый JSON читается как [] — тело
// целиком уходит в wh.body, сценарий не падает на порче строки.

export interface WebhookHookRow {
  id: string;
  bot_id: string;
  token: string;
  scenario_block_id: string;
  fields: string[];
  created_at: number;
}

// Строка таблицы: fields — сырой JSON-текст.
interface HookDbRow {
  id: string;
  bot_id: string;
  token: string;
  scenario_block_id: string;
  fields: string;
  created_at: number;
}

function parseFields(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function toRow(r: HookDbRow): WebhookHookRow {
  return {
    id: r.id,
    bot_id: r.bot_id,
    token: r.token,
    scenario_block_id: r.scenario_block_id,
    fields: parseFields(r.fields),
    created_at: Number(r.created_at),
  };
}

export async function createWebhookHook(
  db: D1Database,
  input: { id: string; botId: string; token: string; blockId: string; fields: string[] }
): Promise<void> {
  await db
    .prepare('INSERT INTO bot_webhooks (id, bot_id, token, scenario_block_id, fields, created_at) VALUES (?,?,?,?,?,?)')
    .bind(input.id, input.botId, input.token, input.blockId, JSON.stringify(input.fields ?? []), Date.now())
    .run();
}

export async function getWebhookHookByToken(db: D1Database, token: string): Promise<WebhookHookRow | null> {
  const r = await db.prepare('SELECT * FROM bot_webhooks WHERE token = ?').bind(token).first<HookDbRow>();
  return r ? toRow(r) : null;
}

export async function listWebhookHooks(db: D1Database, botId: string): Promise<WebhookHookRow[]> {
  const rows =
    (
      await db
        .prepare('SELECT * FROM bot_webhooks WHERE bot_id = ? ORDER BY created_at DESC')
        .bind(botId)
        .all<HookDbRow>()
    ).results ?? [];
  return rows.map(toRow);
}

export async function deleteWebhookHooksForBot(db: D1Database, botId: string): Promise<void> {
  await db.prepare('DELETE FROM bot_webhooks WHERE bot_id = ?').bind(botId).run();
}
