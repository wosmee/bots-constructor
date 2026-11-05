// VK-вебхук: подтверждение, secret, message_new/message_event через движок,
// отправка в VK API (messages.send). Harness — паттерн tests/worker-callback.test.ts
// (фейковый D1 по подстрокам SQL, KV-стаб, vi.stubGlobal fetch).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../worker/src/index';
import { encryptToken } from '../worker/src/crypto';
import type { Scenario } from '../shared/types';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const BOT_ID = 'bot-vk-1';
const SECRET = 'vksec-1';
const VK_CONFIRM = 'conf123';

function vkScenario(): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: { id: 'b', type: 'buttons', params: { prompt: 'жми', buttons: [{ label: 'ОК', value: 'ok' }] }, branches: { ok: 'm' } },
      m: { id: 'm', type: 'message', params: { text: 'дальше' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    },
  } as Scenario;
}

const flow = JSON.stringify(vkScenario());

function makeEnv(sessionBlock: string | null = null) {
  const store = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
        bind(...args: unknown[]) { stmt.args = args; return stmt; },
        async first<T>() {
          if (sql.includes('FROM bots')) {
            return {
              id: BOT_ID, owner_id: 'u1', name: 'VK Bot',
              token_enc: await encryptToken('vktoken123', KEY),
              webhook_secret: SECRET, active: 1, created_at: 1,
              platform: 'vk', vk_group_id: 12345, vk_confirmation: VK_CONFIRM,
              vk_screen_name: 'testgroup', has_referral: 0, published_version: 1,
            } as T;
          }
          if (sql.includes('FROM sessions')) {
            return (sessionBlock ? { current_block: sessionBlock, vars_json: '{}', updated_at: 1 } : null) as T;
          }
          if (sql.includes('flow_json')) {
            return { flow_json: flow, version: 1, has_referral: 0 } as T;
          }
          return null;
        },
        async all<T>() { return [] as T[]; },
        async run() { return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
    async batch(stmts: Array<{ run?: () => Promise<unknown> }> = []) { for (const s of stmts) await s?.run?.(); return []; },
  };
  const kv = {
    async get(key: string) {
      if (key === `vk:${BOT_ID}`) return SECRET;
      if (key.startsWith('sc:')) return store.get(key) ?? null;
      if (key.startsWith('vkupd:')) return store.get(key) ?? null;
      return null;
    },
    async put(key: string, value: string) { store.set(key, value); },
  };
  return { DB: db, KV: kv, ENCRYPTION_KEY: KEY, ADMIN_KEY: 'test-admin-key', ENVIRONMENT: 'test' } as any;
}

// Перехват VK API: собираем вызовы (метод + разобранные params).
const vkCalls: { method: string; params: Record<string, string> }[] = [];
beforeEach(() => {
  vkCalls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.startsWith('https://api.vk.com/method/')) {
      const method = u.slice('https://api.vk.com/method/'.length);
      const params = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')));
      vkCalls.push({ method, params });
      return new Response(JSON.stringify({ response: { ok: true } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function postVk(env: any, body: unknown) {
  const req = new Request(`https://test.example/vk/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (worker as any).fetch(req, env, { waitUntil: async (p: Promise<unknown>) => { await p; } });
}

describe('VK-вебхук', () => {
  it('confirmation-событие → 200 с телом-строкой подтверждения бота', async () => {
    const res = await postVk(makeEnv(), { type: 'confirmation', group_id: 12345 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(VK_CONFIRM);
  });
  it('confirmation для неизвестного бота → 200 ok, без раскрытия', async () => {
    const req = new Request('https://test.example/vk/unknown-bot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'confirmation', group_id: 1 }),
    });
    const res = await (worker as any).fetch(req, makeEnv(), {});
    expect(res.status).toBe(200);
  });

  it('неверный secret → 200 ok, движок не запускается, в VK ничего не уходит', async () => {
    const res = await postVk(makeEnv(), {
      type: 'message_new',
      group_id: 12345,
      secret: 'wrong',
      object: { from_id: 77, peer_id: 77, conversation_message_id: 1, text: 'hi' },
    });
    expect(res.status).toBe(200);
    expect(vkCalls).toHaveLength(0);
  });

  it('message_new: движок идёт по сценарию, сообщение уходит в VK messages.send', async () => {
    const res = await postVk(makeEnv(), {
      type: 'message_new',
      group_id: 12345,
      secret: SECRET,
      object: { from_id: 77, peer_id: 77, conversation_message_id: 1, text: 'hi', date: 1700000000 },
    });
    expect(res.status).toBe(200);
    const sends = vkCalls.filter((c) => c.method === 'messages.send');
    expect(sends.length).toBeGreaterThan(0);
    // Первый message: приглашение «жми» с callback-кнопкой
    expect(Number(sends[0].params.peer_id)).toBe(77);
    expect(String(sends[0].params.message)).toContain('жми');
    const kb = JSON.parse(String(sends[0].params.keyboard));
    expect(kb.inline).toBe(true);
    expect(kb.buttons[0][0].action.type).toBe('callback');
    expect(kb.buttons[0][0].action.payload).toBe('ok');
  });

  it('message_new вложенной формы 5.131 (object.message): движок идёт, from_id берётся из вложения', async () => {
    // Официальный формат VK Callback API 5.131: {type, group_id, secret, object:{message:{...}}}
    const res = await postVk(makeEnv(), {
      type: 'message_new',
      group_id: 12345,
      secret: SECRET,
      object: { message: { from_id: 77, peer_id: 77, conversation_message_id: 9, text: 'hi', date: 1700000000 } },
    });
    expect(res.status).toBe(200);
    const sends = vkCalls.filter((c) => c.method === 'messages.send');
    expect(sends.length).toBeGreaterThan(0);
    expect(Number(sends[0].params.peer_id)).toBe(77);
    expect(String(sends[0].params.message)).toContain('жми');
  });

  it('message_event: кнопка «ok» ведёт по ветке (сессия на блоке кнопок)', async () => {
    // Сессия припаркована на блоке b (как после первого сообщения).
    const res = await postVk(makeEnv('b'), {
      type: 'message_event',
      group_id: 12345,
      secret: SECRET,
      object: { user_id: 77, peer_id: 77, conversation_message_id: 5, event_id: 'evt-9', payload: 'ok' },
    });
    expect(res.status).toBe(200);
    // Сообщение ветки ok («дальше») уходит в VK
    const sends = vkCalls.filter((c) => c.method === 'messages.send');
    expect(sends.some((s) => String(s.params.message).includes('дальше'))).toBe(true);
  });

  it('неизвестный тип события (wall_post_new) → 200, движок и VK не дёргаются', async () => {
    const res = await postVk(makeEnv(), {
      type: 'wall_post_new',
      group_id: 12345,
      secret: SECRET,
      object: { id: 3 },
    });
    expect(res.status).toBe(200);
    expect(vkCalls).toHaveLength(0);
  });

  it('повторное событие (тот же id) → duplicate, второй отправки нет', async () => {
    const env = makeEnv();
    const body = {
      type: 'message_new',
      group_id: 12345,
      secret: SECRET,
      object: { from_id: 77, peer_id: 77, conversation_message_id: 42, text: 'hi', date: 1700000000 },
    };
    await postVk(env, body);
    const first = vkCalls.filter((c) => c.method === 'messages.send').length;
    const res = await postVk(env, body);
    expect(res.status).toBe(200);
    expect(vkCalls.filter((c) => c.method === 'messages.send').length).toBe(first);
  });

  // ---- итерация 2026-10-30: forward / edit / delete / {{__bot_msg}} / медиа ----

  it('message_new: блок forward шлёт messages.send с forward-JSON', async () => {
    const fwdScn: Scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'f' },
        f: { id: 'f', type: 'forward', params: { forwardMode: 'forward' }, branches: { ok: 'e', failed: 'e' } },
        e: { id: 'e', type: 'end', params: {} },
      },
    } as Scenario;
    const env = makeEnv();
    const env2 = {
      ...env,
      DB: {
        ...env.DB,
        prepare(sql: string) {
          if (sql.includes('flow_json')) {
            return {
              bind() { return this; },
              async first<T>() {
                return { flow_json: JSON.stringify(fwdScn), version: 1, has_referral: 0 } as T;
              },
            };
          }
          return env.DB.prepare(sql);
        },
      },
    };
    // fromMessageId = conversation_message_id входящего (42), chat_id = from_id (77)
    const res = await postVk(env2, {
      type: 'message_new',
      group_id: 12345,
      secret: SECRET,
      object: { from_id: 77, peer_id: 77, conversation_message_id: 42, text: 'hi', date: 1700000000 },
    });
    expect(res.status).toBe(200);
    const sends = vkCalls.filter((c) => c.method === 'messages.send' && c.params.forward);
    expect(sends.length).toBeGreaterThan(0);
    const fwd = JSON.parse(sends[0].params.forward);
    expect(fwd.conversation_message_ids).toEqual([42]);
  });

  function editDeleteScenario(botMsgInSession: boolean): Scenario {
    // botMsgInSession: имитируем устойчивую сессию (воркер записал __bot_msg
    // после предыдущего апдейта) — delete_message читает её из vars сессии.
    // Сценарий без сессии: delete без __bot_msg — no-op (не падает).
    return {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: botMsgInSession ? 'dm' : 'm' },
        m: { id: 'm', type: 'message', params: { text: 'первое' }, next: 'dm' },
        dm: {
          id: 'dm',
          type: 'delete_message',
          params: { msgRefVar: '__bot_msg' },
          next: 'e',
        },
        e: { id: 'e', type: 'end', params: {} },
      },
    } as Scenario;
  }

  function envWithFlow(env: any, sc: Scenario, sessionVars?: Record<string, unknown>, sessionBlock: string | null = 's') {
    // sessionVars + sessionBlock: сессия с переменными и точкой парковки.
    return {
      ...env,
      DB: {
        ...env.DB,
        prepare(sql: string) {
          if (sql.includes('FROM sessions') && sessionVars) {
            const stmt = {
              bind() { return stmt; },
              async first<T>() {
                return { current_block: sessionBlock, vars_json: JSON.stringify(sessionVars), updated_at: 1 } as T;
              },
            };
            return stmt;
          }
          if (sql.includes('flow_json')) {
            const stmt = {
              bind() { return stmt; },
              async first<T>() {
                return { flow_json: JSON.stringify(sc), version: 1, has_referral: 0 } as T;
              },
            };
            return stmt;
          }
          return env.DB.prepare(sql);
        },
      },
    };
  }

  it('delete_message через {{__bot_msg}} сессии: messages.delete с cmids', async () => {
    const env = makeEnv();
    // Сессия есть, но current_block пуст (бот дошёл до конца в прошлом
    // прогоне, воркер записал __bot_msg в vars): /start идёт по fresh-start,
    // внутренние '__' (включая __bot_msg) переживают сброс — delete срабатывает.
    const env2 = envWithFlow(env, editDeleteScenario(true), { __bot_msg: { chatId: 77, messageId: 55 } }, null);
    const res = await postVk(env2, {
      type: 'message_new',
      group_id: 12345,
      secret: SECRET,
      object: { from_id: 77, peer_id: 77, conversation_message_id: 1, text: '/start', date: 1700000000 },
    });
    expect(res.status).toBe(200);
    const dels = vkCalls.filter((c) => c.method === 'messages.delete');
    expect(dels.length).toBe(1);
    expect(Number(dels[0].params.peer_id)).toBe(77);
    expect(String(dels[0].params.cmids)).toBe('55');
    expect(Number(dels[0].params.delete_for_all)).toBe(1);
  });

  function mediaScenario(): Scenario {
    return {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'p' },
        p: {
          id: 'p',
          type: 'media',
          params: { mediaType: 'photo', mediaUrl: 'https://cdn.example.com/pic.jpg', caption: 'наша картинка' },
          next: 'e',
        },
        e: { id: 'e', type: 'end', params: {} },
      },
    } as Scenario;
  }

  it('media (photo): upload-цепочка photos.* → messages.send с attachment', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const fetchMock = async (url: any, init: any) => {
      const u = String(url);
      if (u === 'https://cdn.example.com/pic.jpg') {
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (u.startsWith('https://api.vk.com/method/photos.getMessagesUploadServer')) {
        return new Response(JSON.stringify({ response: { upload_url: 'https://pu.vk.com/upload' } }), { status: 200 });
      }
      if (u === 'https://pu.vk.com/upload') {
        return new Response(
          JSON.stringify({ server: 1, photo: '[]', hash: 'h1' }),
          { status: 200 }
        );
      }
      if (u.startsWith('https://api.vk.com/method/photos.saveMessagesPhoto')) {
        return new Response(
          JSON.stringify({ response: [{ id: 456, owner_id: -12345, access_key: 'key1' }] }),
          { status: 200 }
        );
      }
      if (u.startsWith('https://api.vk.com/method/')) {
        const method = u.slice('https://api.vk.com/method/'.length);
        const params = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')));
        vkCalls.push({ method, params });
        if (method === 'messages.send') {
          // VK отвечает числом — conversation_message_id
          return new Response(JSON.stringify({ response: 999 }), { status: 200 });
        }
        return new Response(JSON.stringify({ response: { ok: true } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
    vi.stubGlobal('fetch', vi.fn(fetchMock));

    const env = makeEnv();
    const env2 = {
      ...env,
      DB: {
        ...env.DB,
        prepare(sql: string) {
          if (sql.includes('flow_json')) {
            return {
              bind() { return this; },
              async first<T>() {
                return { flow_json: JSON.stringify(mediaScenario()), version: 1, has_referral: 0 } as T;
              },
            };
          }
          return env.DB.prepare(sql);
        },
      },
    };
    const res = await postVk(env2, {
      type: 'message_new',
      group_id: 12345,
      secret: SECRET,
      object: { from_id: 77, peer_id: 77, conversation_message_id: 1, text: 'hi', date: 1700000000 },
    });
    expect(res.status).toBe(200);
    const sends = vkCalls.filter((c) => c.method === 'messages.send');
    expect(sends.length).toBe(1);
    expect(sends[0].params.attachment).toBe('photo-12345_456_key1');
    expect(String(sends[0].params.message)).toContain('наша картинка');
    expect(Number(sends[0].params.peer_id)).toBe(77);
  });

  it('message_new с фото от пользователя: URL Largest в vars.last_photo не падает', async () => {
    // Входящие attachments не роняют вебхук (vkExtractAttachments в слое входа).
    const res = await postVk(makeEnv(), {
      type: 'message_new',
      group_id: 12345,
      secret: SECRET,
      object: {
        from_id: 77,
        peer_id: 77,
        conversation_message_id: 88,
        text: 'фото',
        date: 1700000000,
        attachments: [{ type: 'photo', photo: { id: 5, sizes: [{ type: 'x', url: 'https://cdn/x.jpg' }] } }],
      },
    });
    expect(res.status).toBe(200);
    const sends = vkCalls.filter((c) => c.method === 'messages.send');
    expect(sends.length).toBeGreaterThan(0);
  });
});
