// Движок набора 2026-09: по блоку на кейс (happy path + ветка ошибки),
// callback-UX (toast/alert/edit), удаления сообщений и «сценарий без ops
// не рвётся». Ops — простые фейки в памяти: движок чистый, D1/сети нет.
import { describe, it, expect } from 'vitest';
import { runEngine, type SessionState, type ChannelOps, type CounterOps, type UserOps, type BroadcastOps, type PaymentOps } from '../worker/src/engine';
import type { Scenario } from '../shared/types';

function sc(blocks: Scenario['blocks'], start = 's'): Scenario {
  return { version: 1, start, blocks } as Scenario;
}

const msgUpdate = (text: string, userId = 2, messageId = 5) => ({
  message: { chat: { id: userId }, from: { id: userId }, message_id: messageId, text },
});

const cbUpdate = (data: string, userId = 2) => ({
  callback_query: { id: 'cb1', from: { id: userId }, data, message: { chat: { id: userId }, message_id: 9 } },
});

// Вход без «свежего старта»: /start (и любой апдейт без currentBlock) сбрасывает
// vars — это старое поведение движка, оно здесь не под тестом. Поэтому заходим
// через startBlockId: vars теста переживают вход. Если в сессии есть ожидающий
// блок (poll/buttons/wait), идём обычным путём через апдейт.
function run(scenario: Scenario, update: any, session: SessionState = { currentBlock: null, vars: {} }, ops: Record<string, unknown> = {}) {
  const startBlockId = session.currentBlock ? undefined : scenario.start;
  return runEngine({ scenario, update, session, startBlockId, botUsername: 'testbot', ...ops } as any);
}

const texts = (outs: { method: string; payload: any }[]) => outs.filter((o) => o.method === 'sendMessage').map((o) => o.payload.text);

// ---------------- poll ----------------

describe('runEngine: poll', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'p' },
    p: {
      id: 'p',
      type: 'poll',
      params: { question: 'Цвет?', pollOptions: [{ id: 'a', text: 'Красный' }, { id: 'b', text: 'Синий' }], correctOptionId: 'b' },
      branches: { answered: 'ok', skipped: 'skip' },
    },
    ok: { id: 'ok', type: 'message', params: { text: 'спасибо' } },
    skip: { id: 'skip', type: 'message', params: { text: 'пропустил' } },
  });

  it('выпускает sendPoll (quiz: correct_option_id — индекс) и встаёт на ожидание', async () => {
    const res = await run(scn, msgUpdate('/start'));
    const poll = res.outs.find((o) => o.method === 'sendPoll');
    expect(poll).toBeTruthy();
    expect(poll!.payload.type).toBe('quiz');
    expect(poll!.payload.correct_option_id).toBe(1); // id 'b' → индекс 1
    expect(JSON.parse(String(poll!.payload.options)).map((o: any) => o.text)).toEqual(['Красный', 'Синий']);
    expect(res.currentBlock).toBe('p');
  });

  it('poll_answer пишет poll.answer/poll.options и идёт в answered', async () => {
    const res = await run(scn, { poll_answer: { user: { id: 2 }, option_ids: [1] } }, { currentBlock: 'p', vars: {} });
    expect(res.vars['poll.answer']).toBe('Синий');
    expect(res.vars['poll.options']).toBe('1');
    expect(texts(res.outs)).toContain('спасибо');
  });

  it('другой апдейт во время ожидания — ветка skipped', async () => {
    const res = await run(scn, msgUpdate('не хочу'), { currentBlock: 'p', vars: {} });
    expect(texts(res.outs)).toContain('пропустил');
  });

  it('без вариантов — skipped, sendPoll не выпускается', async () => {
    const bad = sc({
      s: { id: 's', type: 'start', params: {}, next: 'p' },
      p: { id: 'p', type: 'poll', params: { question: '?', pollOptions: [] }, branches: { skipped: 'skip' } },
      skip: { id: 'skip', type: 'message', params: { text: 'пропустил' } },
    });
    const res = await run(bad, msgUpdate('/start'));
    expect(res.outs.some((o) => o.method === 'sendPoll')).toBe(false);
    expect(texts(res.outs)).toContain('пропустил');
  });
});

// ---------------- forward ----------------

describe('runEngine: forward', () => {
  it('forwardMode по умолчанию — forwardMessage', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'f' },
      f: { id: 'f', type: 'forward', params: { toChatId: '@chan' }, branches: { ok: 'e' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('привет', 2, 77));
    const fwd = res.outs.find((o) => o.method === 'forwardMessage');
    expect(fwd).toBeTruthy();
    expect(fwd!.payload).toMatchObject({ chat_id: '@chan', from_chat_id: 2, message_id: 77 });
  });

  it('copy — copyMessage', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'f' },
      f: { id: 'f', type: 'forward', params: { forwardMode: 'copy', toChatId: '-100123' }, branches: { ok: 'e' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('привет', 2, 8));
    expect(res.outs.some((o) => o.method === 'copyMessage')).toBe(true);
  });

  it('text — sendMessage с forwardText и {{var}}', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'f' },
      f: { id: 'f', type: 'forward', params: { forwardMode: 'text', forwardText: 'привет {{name}}', toChatId: '@chan' }, branches: { ok: 'e' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('привет'), { currentBlock: null, vars: { name: 'Иван' } });
    expect(texts(res.outs)).toContain('привет Иван');
  });

  it('нет toChatId и нет from — ветка failed', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'f' },
      f: { id: 'f', type: 'forward', params: {}, branches: { ok: 'e', failed: 'fail' } },
      fail: { id: 'fail', type: 'message', params: { text: 'не вышло' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    // resume без апдейта: ни chatId, ни incoming message — пересылать нечего.
    const res = await runEngine({ scenario: scn, update: {}, session: { currentBlock: null, vars: {} }, startBlockId: 'f' } as any);
    expect(texts(res.outs)).toContain('не вышло');
  });
});

// ---------------- chat_action ----------------

describe('runEngine: chat_action', () => {
  it('sendChatAction и продолжение по next', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'ca' },
      ca: { id: 'ca', type: 'chat_action', params: { chatAction: 'upload_photo' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'готово' } },
    });
    const res = await run(scn, msgUpdate('/start'));
    expect(res.outs.find((o) => o.method === 'sendChatAction')!.payload.action).toBe('upload_photo');
    expect(texts(res.outs)).toContain('готово');
  });
});

// ---------------- wait ----------------

describe('runEngine: wait', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'w' },
    w: { id: 'w', type: 'wait', params: { seconds: 90, prompt: 'жду', reminderText: 'ау?' }, branches: { reply: 'r', timeout: 't' } },
    r: { id: 'r', type: 'message', params: { text: 'ответил' } },
    t: { id: 't', type: 'message', params: { text: 'таймаут' } },
  });

  it('выпускает wait-payload с nonce, секундами и напоминанием; встаёт на себя', async () => {
    const res = await run(scn, msgUpdate('/start'));
    const w = res.outs.find((o) => o.method === 'wait');
    expect(w).toBeTruthy();
    expect(w!.payload).toMatchObject({ blockId: 'w', timeoutTarget: 't', seconds: 90, reminderText: 'ау?' });
    expect(String(w!.payload.nonce).length).toBeGreaterThan(5);
    expect(res.currentBlock).toBe('w');
    expect(res.vars['__wait.w']).toBe(w!.payload.nonce);
    expect(texts(res.outs)).toContain('жду'); // prompt отправлен
  });

  it('ответ (сообщение) снимает nonce и идёт в reply', async () => {
    const res = await run(scn, msgUpdate('вот'), { currentBlock: 'w', vars: { '__wait.w': 'n1' } });
    expect(texts(res.outs)).toContain('ответил');
    expect(res.vars['__wait.w']).toBeUndefined();
  });

  it('callback тоже считается ответом', async () => {
    const cbScn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'w' },
      w: { id: 'w', type: 'wait', params: { seconds: 30 }, branches: { reply: 'r', timeout: 't' } },
      r: { id: 'r', type: 'message', params: { text: 'ответил' } },
      t: { id: 't', type: 'end', params: {} },
    });
    const res = await run(cbScn, cbUpdate('x'), { currentBlock: 'w', vars: { '__wait.w': 'n1' } });
    expect(texts(res.outs)).toContain('ответил');
  });

  it('deleteUserMessage в wait удаляет входящее', async () => {
    const d = sc({
      s: { id: 's', type: 'start', params: {}, next: 'w' },
      w: { id: 'w', type: 'wait', params: { seconds: 30, deleteUserMessage: true }, branches: { reply: 'r', timeout: 'r' } },
      r: { id: 'r', type: 'end', params: {} },
    });
    const res = await run(d, msgUpdate('сообщение', 2, 42));
    expect(res.outs.find((o) => o.method === 'deleteMessage')!.payload.message_id).toBe(42);
  });
});

// ---------------- channel_check ----------------

describe('runEngine: channel_check', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'ch' },
    ch: { id: 'ch', type: 'channel_check', params: { channelId: '@chan', cacheMinutes: 10 }, branches: { member: 'yes', not_member: 'no', error: 'err' } },
    yes: { id: 'yes', type: 'message', params: { text: 'состоит' } },
    no: { id: 'no', type: 'message', params: { text: 'не состоит' } },
    err: { id: 'err', type: 'message', params: { text: 'ошибка' } },
  });

  function fakeChannels(member: boolean): { ops: ChannelOps; calls: () => number } {
    let n = 0;
    return {
      ops: { async isMember() { n++; return member; } },
      calls: () => n,
    };
  }

  it('member/not_member по ответу ops + кэш в переменных', async () => {
    const yes = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { channels: fakeChannels(true).ops });
    expect(texts(yes.outs)).toContain('состоит');
    expect((yes.vars['__channel.ch'] as any).member).toBe(true);
    const no = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { channels: fakeChannels(false).ops });
    expect(texts(no.outs)).toContain('не состоит');
  });

  it('кэш действует: второй проход не зовёт ops', async () => {
    const ch = fakeChannels(true);
    const first = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { channels: ch.ops });
    const cachedVars = { ...first.vars };
    // Второй заход с тем же состоянием переменных — из кэша.
    await run(scn, msgUpdate('/start'), { currentBlock: null, vars: cachedVars }, { channels: ch.ops });
    expect(ch.calls()).toBe(1);
  });

  it('ошибка ops — ветка error', async () => {
    const ops: ChannelOps = { async isMember() { throw new Error('boom'); } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { channels: ops });
    expect(texts(res.outs)).toContain('ошибка');
  });

  it('без ops — ветка error (сценарий не рвётся)', async () => {
    const res = await run(scn, msgUpdate('/start'));
    expect(texts(res.outs)).toContain('ошибка');
  });
});

// ---------------- segment_broadcast ----------------

describe('runEngine: segment_broadcast', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'sb' },
    sb: { id: 'sb', type: 'segment_broadcast', params: { segmentText: 'рассылка {{tag}}', segmentTag: 'vip', chunkSize: 5 }, branches: { queued: 'q', empty: 'z' } },
    q: { id: 'q', type: 'message', params: { text: 'в очереди' } },
    z: { id: 'z', type: 'message', params: { text: 'пусто' } },
  });

  it('enqueue > 0 — ветка queued, __broadcast_count, сегмент с нормализованным тегом', async () => {
    let gotSegment: any = null;
    const ops: BroadcastOps = { async enqueue(segment) { gotSegment = segment; return 3; } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { tag: 'vip' } }, { broadcast: ops });
    expect(texts(res.outs)).toContain('в очереди');
    expect(res.vars['__broadcast_count']).toBe(3);
    expect(gotSegment.tag).toBe('vip');
  });

  it('enqueue = 0 — ветка empty', async () => {
    const ops: BroadcastOps = { async enqueue() { return 0; } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { broadcast: ops });
    expect(texts(res.outs)).toContain('пусто');
  });

  it('enqueue бросает — ветка empty, без исключения', async () => {
    const ops: BroadcastOps = { async enqueue() { throw new Error('db down'); } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { broadcast: ops });
    expect(texts(res.outs)).toContain('пусто');
  });

  it('без ops — ветка empty', async () => {
    const res = await run(scn, msgUpdate('/start'));
    expect(texts(res.outs)).toContain('пусто');
  });
});

// ---------------- user_stats ----------------

describe('runEngine: user_stats', () => {
  const profile = {
    name: 'Иван', username: '@ivan', id: 2, tags: ['vip', 'pro'],
    subscription: true, paidTotal: 15000, refCount: 3, firstSeen: 1000,
  };

  it('раскладывает user.* и отправляет шаблон', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'u' },
      u: { id: 'u', type: 'user_stats', params: { template: '{{user.name}} | {{user.tags}} | {{user.paid_total}}' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const ops: UserOps = { async profile() { return profile; } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { users: ops });
    expect(res.vars['user.name']).toBe('Иван');
    expect(res.vars['user.tags']).toBe('vip, pro');
    expect(res.vars['user.subscription']).toBe(1);
    expect(res.vars['user.paid_total']).toBe(15000);
    expect(texts(res.outs)).toContain('Иван | vip, pro | 15000');
  });

  it('profile бросает — идём по next без переменных, шаблон с пустыми', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'u' },
      u: { id: 'u', type: 'user_stats', params: { template: 'имя: {{user.name}}' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const ops: UserOps = { async profile() { throw new Error('no db'); } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { users: ops });
    expect(texts(res.outs).join('|')).toContain('имя:');
    expect(res.currentBlock).toBeNull();
  });

  it('outPrefix меняет имена переменных', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'u' },
      u: { id: 'u', type: 'user_stats', params: { outPrefix: 'client' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const ops: UserOps = { async profile() { return profile; } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { users: ops });
    expect(res.vars['client.name']).toBe('Иван');
    expect(res.vars['user.name']).toBeUndefined();
  });
});

// ---------------- payment_link / payment_check ----------------

describe('runEngine: payment_link', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'pl' },
    pl: { id: 'pl', type: 'payment_link', params: { connectionId: 'c1', amount: '15000', currency: 'rub', description: 'Курс {{n}}' }, branches: { created: 'ok', failed: 'fail' } },
    ok: { id: 'ok', type: 'message', params: { text: 'ссылка {{pay.link}}' } },
    fail: { id: 'fail', type: 'message', params: { text: 'не вышло' } },
  });

  it('create → ссылка в pay.link, заказ в pay.order, ветка created', async () => {
    let got: any = null;
    const ops: PaymentOps = {
      async create(connectionId, params) { got = { connectionId, ...params }; return { id: 'o1', externalId: 'ext-1', amount: 15000, currency: 'RUB', status: 'created', link: 'https://pay/x', provider: 'custom' }; },
      async get() { return null; },
    };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { n: 5 } }, { payments: ops });
    expect(got).toMatchObject({ connectionId: 'c1', amount: 15000, currency: 'RUB', description: 'Курс 5', userId: 2 });
    expect(res.vars['pay.link']).toBe('https://pay/x');
    expect(res.vars['pay.order']).toBe('ext-1');
    expect(texts(res.outs)).toContain('ссылка https://pay/x');
  });

  it('telegram-подключение без ссылки — движок сам выставляет sendInvoice', async () => {
    const ops: PaymentOps = {
      async create() { return { id: 'o1', externalId: 'ext-1', amount: 15000, currency: 'RUB', status: 'created', link: '', provider: 'telegram' }; },
      async get() { return null; },
    };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { payments: ops });
    const inv = res.outs.find((o) => o.method === 'sendInvoice');
    expect(inv).toBeTruthy();
    expect(inv!.payload.connectionId).toBe('c1');
    expect(inv!.payload.prices).toEqual([{ label: 'Оплата', amount: 15000 }]);
  });

  it('create = null или бросает — ветка failed', async () => {
    const nullOps: PaymentOps = { async create() { return null; }, async get() { return null; } };
    const r1 = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { payments: nullOps });
    expect(texts(r1.outs)).toContain('не вышло');
    const throwOps: PaymentOps = { async create() { throw new Error('x'); }, async get() { return null; } };
    const r2 = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { payments: throwOps });
    expect(texts(r2.outs)).toContain('не вышло');
  });

  it('без connectionId или amount<=0 — ветка failed без вызова ops', async () => {
    const bad = sc({
      s: { id: 's', type: 'start', params: {}, next: 'pl' },
      pl: { id: 'pl', type: 'payment_link', params: { amount: 0 }, branches: { created: 'ok', failed: 'fail' } },
      ok: { id: 'ok', type: 'end', params: {} },
      fail: { id: 'fail', type: 'message', params: { text: 'не вышло' } },
    });
    let called = false;
    const ops: PaymentOps = { async create() { called = true; return null; }, async get() { return null; } };
    const res = await run(bad, msgUpdate('/start'), { currentBlock: null, vars: {} }, { payments: ops });
    expect(called).toBe(false);
    expect(texts(res.outs)).toContain('не вышло');
  });
});

describe('runEngine: payment_check', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'pc' },
    pc: { id: 'pc', type: 'payment_check', params: { connectionId: 'c1', orderIdVar: 'pay.order' }, branches: { paid: 'p', pending: 'w', failed: 'f' } },
    p: { id: 'p', type: 'message', params: { text: 'оплачено' } },
    w: { id: 'w', type: 'message', params: { text: 'ждём' } },
    f: { id: 'f', type: 'message', params: { text: 'не оплачено' } },
  });

  const mkOps = (status: string): PaymentOps => ({
    async create() { return null; },
    async get() { return { id: 'o1', externalId: 'ext-1', amount: 100, currency: 'RUB', status: status as any, link: '' }; },
  });

  it('paid/pending/failed по статусу заказа + vars.payment', async () => {
    const paid = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { 'pay.order': 'ext-1' } }, { payments: mkOps('paid') });
    expect(texts(paid.outs)).toContain('оплачено');
    expect((paid.vars['payment'] as any).status).toBe('paid');
    const pending = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { 'pay.order': 'ext-1' } }, { payments: mkOps('pending') });
    expect(texts(pending.outs)).toContain('ждём');
    const failed = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { 'pay.order': 'ext-1' } }, { payments: mkOps('failed') });
    expect(texts(failed.outs)).toContain('не оплачено');
  });

  it('без orderId в переменных — ветка failed, ops не зовётся', async () => {
    let called = false;
    const ops: PaymentOps = { async create() { return null; }, async get() { called = true; return null; } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { payments: ops });
    expect(called).toBe(false);
    expect(texts(res.outs)).toContain('не оплачено');
  });
});

// ---------------- foreach ----------------

describe('runEngine: foreach', () => {
  function loopScn(maxIterations?: number) {
    return sc({
      s: { id: 's', type: 'start', params: {}, next: 'fe' },
      fe: { id: 'fe', type: 'foreach', params: { listVar: 'items', ...(maxIterations ? { maxIterations } : {}) }, branches: { each: 'body', done: 'done' } },
      body: { id: 'body', type: 'message', params: { text: 'эл {{item}} №{{i}}' }, next: 'fe' },
      done: { id: 'done', type: 'message', params: { text: 'конец' } },
    });
  }

  it('три итерации по JSON-списку, затем done и чистка __loop', async () => {
    const scn = loopScn();
    let res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { items: '["a","b","c"]' } });
    // Одна итерация за проход — остальные через ре-вход (как в бою между апдейтами).
    expect(texts(res.outs)).toContain('эл a №0');
    let session: SessionState = { currentBlock: res.currentBlock, vars: res.vars };
    const seen = ['эл a №0'];
    for (let i = 0; i < 10 && session.currentBlock !== 'done'; i++) {
      res = await runEngine({ scenario: scn, update: {}, session, startBlockId: 'fe' } as any);
      seen.push(...texts(res.outs));
      session = { currentBlock: res.currentBlock, vars: res.vars };
    }
    expect(seen).toContain('эл b №1');
    expect(seen).toContain('эл c №2');
    expect(seen).toContain('конец');
    expect(session.vars['__loop.fe']).toBeUndefined();
  });

  it('пустой список — сразу done', async () => {
    const res = await run(loopScn(), msgUpdate('/start'), { currentBlock: null, vars: { items: '' } });
    expect(texts(res.outs)).toContain('конец');
  });

  it('maxIterations режет длинный список', async () => {
    const scn = loopScn(2);
    const items = Array.from({ length: 50 }, (_, i) => `i${i}`);
    let session: SessionState = { currentBlock: null, vars: { items } };
    let res = await run(scn, msgUpdate('/start'), session);
    session = { currentBlock: res.currentBlock, vars: res.vars };
    let msgs = texts(res.outs);
    for (let i = 0; i < 10 && session.currentBlock && session.currentBlock !== 'done'; i++) {
      res = await runEngine({ scenario: scn, update: {}, session, startBlockId: 'fe' } as any);
      msgs = msgs.concat(texts(res.outs));
      session = { currentBlock: res.currentBlock, vars: res.vars };
    }
    expect(msgs.filter((t) => t.startsWith('эл '))).toHaveLength(2);
    expect(msgs).toContain('конец');
  });

  it('запятые в строке — тоже список', async () => {
    const res = await run(loopScn(), msgUpdate('/start'), { currentBlock: null, vars: { items: 'x,y' } });
    expect(texts(res.outs)).toContain('эл x №0');
  });
});

// ---------------- random_text ----------------

describe('runEngine: random_text', () => {
  it('взвешенный выбор: weight=0 вариант не берётся, outVar и send', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'rt' },
      rt: { id: 'rt', type: 'random_text', params: { variants: [{ text: 'А', weight: 100 }, { text: 'Б', weight: 0 }], outVar: 'picked' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('/start'));
    expect(res.vars['picked']).toBe('А');
    expect(texts(res.outs)).toContain('А');
  });

  it('send=false — только переменная', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'rt' },
      rt: { id: 'rt', type: 'random_text', params: { variants: [{ text: 'А' }], outVar: 'picked', send: false }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('/start'));
    expect(res.vars['picked']).toBe('А');
    expect(texts(res.outs)).toHaveLength(0);
  });

  it('пустые варианты — просто next', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'rt' },
      rt: { id: 'rt', type: 'random_text', params: { variants: [] }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'дальше' } },
    });
    const res = await run(scn, msgUpdate('/start'));
    expect(texts(res.outs)).toContain('дальше');
  });
});

// ---------------- assert ----------------

describe('runEngine: assert', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'as' },
    as: { id: 'as', type: 'assert', params: { condVar: 'x', op: '==', condValue: '1', failMessage: 'икс не единица' }, branches: { pass: 'p', fail: 'f' } },
    p: { id: 'p', type: 'message', params: { text: 'прошло' } },
    f: { id: 'f', type: 'message', params: { text: 'провал' } },
  });

  it('условие верно — pass', async () => {
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { x: '1' } });
    expect(texts(res.outs)).toContain('прошло');
  });

  it('условие неверно — fail + failMessage', async () => {
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { x: '2' } });
    expect(texts(res.outs)).toContain('провал');
    expect(texts(res.outs)).toContain('икс не единица');
  });
});

// ---------------- counter ----------------

describe('runEngine: counter', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'cn' },
    cn: { id: 'cn', type: 'counter', params: { counterName: 'hits', counterScope: 'user', counterOp: 'inc', amount: 2, counterMax: 5, outVar: 'hits' }, branches: { ok: 'o', limit_reached: 'l' } },
    o: { id: 'o', type: 'message', params: { text: 'ок {{hits}}' } },
    l: { id: 'l', type: 'message', params: { text: 'лимит' } },
  });

  function fakeCounters(value: number): CounterOps {
    return {
      async inc() { return value; },
      async dec() { return value; },
      async reset() { return 0; },
      async get() { return value; },
    };
  }

  it('значение ниже порога — ok, значение в outVar', async () => {
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { counters: fakeCounters(2) });
    expect(res.vars['hits']).toBe(2);
    expect(texts(res.outs)).toContain('ок 2');
  });

  it('значение >= counterMax — ветка limit_reached', async () => {
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { counters: fakeCounters(5) });
    expect(texts(res.outs)).toContain('лимит');
  });

  it('без имени счётчика или без ops — passthrough по ветке ok', async () => {
    const res = await run(scn, msgUpdate('/start'));
    expect(texts(res.outs).join('|')).toContain('ок');
  });

  it('ops бросает — passthrough, без исключения', async () => {
    const ops: CounterOps = {
      async inc() { throw new Error('db'); },
      async dec() { throw new Error('db'); },
      async reset() { throw new Error('db'); },
      async get() { throw new Error('db'); },
    };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { counters: ops });
    expect(texts(res.outs).join('|')).toContain('ок');
  });
});

// ---------------- callback UX (TASK 2) ----------------

describe('runEngine: callback UX', () => {
  const btns = (extra: Record<string, unknown>) =>
    sc({
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: { id: 'b', type: 'buttons', params: { prompt: 'жми', buttons: [{ label: 'ОК', value: 'ok' }], ...extra }, branches: { ok: 'm' } },
      m: { id: 'm', type: 'message', params: { text: 'продолжаем' } },
    });

  it('cbToast → один answerCallbackQuery без alert', async () => {
    const res = await run(btns({ cbToast: 'готово' }), cbUpdate('ok'), { currentBlock: 'b', vars: {} });
    const ans = res.outs.filter((o) => o.method === 'answerCallbackQuery');
    expect(ans).toHaveLength(1);
    expect(ans[0].payload).toMatchObject({ text: 'готово', show_alert: false });
  });

  it('cbAlert → show_alert true', async () => {
    const res = await run(btns({ cbAlert: 'внимание' }), cbUpdate('ok'), { currentBlock: 'b', vars: {} });
    const ans = res.outs.filter((o) => o.method === 'answerCallbackQuery');
    expect(ans).toHaveLength(1);
    expect(ans[0].payload.show_alert).toBe(true);
  });

  it('оба заданы — alert приоритетнее, ответ ровно один', async () => {
    const res = await run(btns({ cbToast: 't', cbAlert: 'a' }), cbUpdate('ok'), { currentBlock: 'b', vars: {} });
    const ans = res.outs.filter((o) => o.method === 'answerCallbackQuery');
    expect(ans).toHaveLength(1);
    expect(ans[0].payload).toMatchObject({ text: 'a', show_alert: true });
  });

  it('updateMode edit правит сообщение по __cb_msg', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: { id: 'b', type: 'buttons', params: { prompt: 'жми', buttons: [{ label: 'ОК', value: 'ok' }] }, branches: { ok: 'm' } },
      m: { id: 'm', type: 'message', params: { text: 'новый текст', updateMode: 'edit' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, cbUpdate('ok'), { currentBlock: 'b', vars: {} });
    const edit = res.outs.find((o) => o.method === 'editMessageText');
    expect(edit).toBeTruthy();
    expect(edit!.payload).toMatchObject({ chat_id: 2, message_id: 9, text: 'новый текст' });
    expect(res.outs.some((o) => o.method === 'sendMessage' && o.payload.text === 'новый текст')).toBe(false);
  });

  it('без __cb_msg (обычное сообщение) — edit деградирует в sendMessage', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'текст', updateMode: 'edit' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('/start'));
    expect(texts(res.outs)).toContain('текст');
  });
});

// ---------------- удаления (TASK 3) ----------------

describe('runEngine: deleteBotMessage', () => {
  it('__bot_msg → deleteMessage и переменная стирается', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'ок', deleteBotMessage: true }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { __bot_msg: { chatId: 7, messageId: 11 } } });
    const del = res.outs.find((o) => o.method === 'deleteMessage');
    expect(del!.payload).toMatchObject({ chat_id: 7, message_id: 11 });
    expect(res.vars['__bot_msg']).toBeUndefined();
  });

  it('без __bot_msg — тихо пропускается', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'ок', deleteBotMessage: true }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('/start'));
    expect(res.outs.some((o) => o.method === 'deleteMessage')).toBe(false);
    expect(texts(res.outs)).toContain('ок');
  });

  it('deleteUserMessage на message-блоке удаляет входящее сообщение', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'ок', deleteUserMessage: true }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('привет', 2, 123));
    // Удаление входит ПЕРЕД ответом: порядок — контракт pushDeletes.
    expect(res.outs[0]).toEqual({ method: 'deleteMessage', payload: { chat_id: 2, message_id: 123 } });
    expect(texts(res.outs)).toContain('ок');
  });
});

// ---------------- добор контрактов из спецификации набора 2026-09 ----------------

describe('runEngine: добор контрактов новых блоков', () => {
  it('poll: дефолты is_anonymous/multiple и викторина по correctOptionId', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'p' },
      p: {
        id: 'p', type: 'poll',
        params: { question: 'q', pollOptions: [{ text: 'А' }, { id: 'x', text: 'Б' }], multiple: true, correctOptionId: 'x' },
        branches: { answered: 'ok', skipped: 'sk' },
      },
      ok: { id: 'ok', type: 'end', params: {} },
      sk: { id: 'sk', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('/start'));
    const p = res.outs.find((o) => o.method === 'sendPoll')!;
    expect(p.payload.is_anonymous).toBe(true); // дефолт
    expect(p.payload.allows_multiple_answers).toBe(true); // из params.multiple
    expect(p.payload.type).toBe('quiz');
    expect(p.payload.correct_option_id).toBe(1); // ИНДЕКС варианта 'x', не id
    expect(p.payload.options).toBe(JSON.stringify([{ text: 'А' }, { text: 'Б' }]));
    expect(res.currentBlock).toBe('p'); // ждёт poll_answer

    // anonymous: false уважается
    const anon = sc({
      s: { id: 's', type: 'start', params: {}, next: 'p' },
      p: { id: 'p', type: 'poll', params: { question: 'q', pollOptions: [{ text: 'А' }, { text: 'Б' }], anonymous: false } },
    });
    const res2 = await run(anon, msgUpdate('/start'));
    expect(res2.outs[0].payload.is_anonymous).toBe(false);
  });

  it('poll_answer с несколькими выборами: тексты через «, », индексы через «,»', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'p' },
      p: { id: 'p', type: 'poll', params: { question: 'q', pollOptions: [{ text: 'А' }, { text: 'Б' }, { text: 'В' }] }, branches: { answered: 'ok', skipped: 'sk' } },
      ok: { id: 'ok', type: 'end', params: {} },
      sk: { id: 'sk', type: 'end', params: {} },
    });
    const res = await run(scn, { poll_answer: { user: { id: 2 }, option_ids: [0, 2] } }, { currentBlock: 'p', vars: {} });
    expect(res.vars['poll.answer']).toBe('А, В');
    expect(res.vars['poll.options']).toBe('0,2');
  });

  it('forward: числовой toChatId приводится к числу, {{var}} интерполируется', async () => {
    const num = sc({
      s: { id: 's', type: 'start', params: {}, next: 'f' },
      f: { id: 'f', type: 'forward', params: { toChatId: '-1001234567890' }, branches: { ok: 'e' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(num, msgUpdate('x', 2, 7));
    expect(res.outs.find((o) => o.method === 'forwardMessage')!.payload.chat_id).toBe(-1001234567890);

    const byVar = sc({
      s: { id: 's', type: 'start', params: {}, next: 'f' },
      f: { id: 'f', type: 'forward', params: { toChatId: '{{target}}' }, branches: { ok: 'e' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res2 = await runEngine({ scenario: byVar, update: msgUpdate('x', 2, 7), session: { currentBlock: null, vars: { target: '@chan' } }, startBlockId: 'f' } as any);
    expect(res2.outs.find((o) => o.method === 'forwardMessage')!.payload.chat_id).toBe('@chan');
  });

  it('forward: fromVar переопределяет источник message_id', async () => {
    const scn = sc({
      f: { id: 'f', type: 'forward', params: { toChatId: '@chan', fromVar: 'mid' }, branches: { ok: 'e', failed: 'e' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    // Апдейт без message_id — пересылать нечего, если fromVar не задан; с ним — есть.
    const res = await runEngine({ scenario: scn, update: { message: { chat: { id: 2 }, from: { id: 2 }, text: 'x' } }, session: { currentBlock: null, vars: { mid: '55' } }, startBlockId: 'f' } as any);
    expect(res.outs.find((o) => o.method === 'forwardMessage')!.payload.message_id).toBe(55);
  });

  it('wait: секунды по умолчанию 60, ноль и мусор — тоже 60, отрицательные — минимум 1', async () => {
    const waitOf = (params: Record<string, unknown>) => sc({
      w: { id: 'w', type: 'wait', params, branches: { reply: 'r', timeout: 't' } },
      r: { id: 'r', type: 'end', params: {} },
      t: { id: 't', type: 'end', params: {} },
    });
    const force = async (params: Record<string, unknown>) => {
      const res = await runEngine({ scenario: waitOf(params), update: {}, session: { currentBlock: null, vars: {} }, startBlockId: 'w' } as any);
      return res.outs.find((o) => o.method === 'wait')!.payload.seconds;
    };
    expect(await force({})).toBe(60);
    expect(await force({ seconds: 0 })).toBe(60);
    expect(await force({ seconds: -5 })).toBe(1);
    expect(await force({ seconds: 90 })).toBe(90);
  });

  it('channel_check: без channelId — ветка error, ops не вызывается', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'ch' },
      ch: { id: 'ch', type: 'channel_check', params: {}, branches: { member: 'y', not_member: 'n', error: 'err' } },
      y: { id: 'y', type: 'end', params: {} },
      n: { id: 'n', type: 'end', params: {} },
      err: { id: 'err', type: 'message', params: { text: 'ошибка' } },
    });
    let called = false;
    const ops: ChannelOps = { async isMember() { called = true; return true; } };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { channels: ops });
    expect(called).toBe(false);
    expect(texts(res.outs)).toContain('ошибка');
  });

  it('channel_check: cacheMinutes 0 отключает кэш — ops вызывается повторно', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'ch' },
      ch: { id: 'ch', type: 'channel_check', params: { channelId: '@chan', cacheMinutes: 0 }, branches: { member: 'y', not_member: 'n', error: 'e' } },
      y: { id: 'y', type: 'end', params: {} },
      n: { id: 'n', type: 'end', params: {} },
      e: { id: 'e', type: 'end', params: {} },
    });
    let n = 0;
    const ops: ChannelOps = { async isMember() { n++; return true; } };
    const first = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { channels: ops });
    await run(scn, msgUpdate('/start'), { currentBlock: null, vars: first.vars }, { channels: ops });
    expect(n).toBe(2);
  });

  it('segment_broadcast: сегмент с нормализованным тегом и интерполированными условиями, payload целиком', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'sb' },
      sb: {
        id: 'sb', type: 'segment_broadcast',
        params: {
          segmentTag: ' VIP ', segmentText: 'текст {{name}}', segmentMediaUrl: 'https://x.jpg',
          parseMode: 'HTML', chunkSize: 50, delayMs: 100, dailyCap: 10,
          segmentWhere: [{ source: 'var', var: 'plan', op: '==', value: '{{wanted}}' }],
        },
        branches: { queued: 'q', empty: 'z' },
      },
      q: { id: 'q', type: 'end', params: {} },
      z: { id: 'z', type: 'end', params: {} },
    });
    let seg: any = null;
    let payload: any = null;
    const ops: BroadcastOps = { async enqueue(s, p) { seg = s; payload = p; return 2; } };
    await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { name: 'Иван', wanted: 'pro' } }, { broadcast: ops });
    expect(seg.tag).toBe('vip');
    expect(seg.conditions).toEqual([{ source: 'var', var: 'plan', op: '==', value: 'pro' }]);
    expect(payload).toEqual({ text: 'текст Иван', mediaUrl: 'https://x.jpg', parseMode: 'HTML', chunkSize: 50, delayMs: 100, dailyCap: 10 });
  });

  it('user_stats: полный набор user.* включая firstSeen null и subscription false', async () => {
    const scn = sc({
      u: { id: 'u', type: 'user_stats', params: { template: '{{user.subscription}}/{{user.first_seen}}' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'дальше' } },
    });
    const ops: UserOps = {
      async profile() { return { name: 'А', username: 'a', id: 9, tags: [], subscription: false, paidTotal: 0, refCount: 0, firstSeen: null }; },
    };
    const res = await runEngine({ scenario: scn, update: msgUpdate('/start'), session: { currentBlock: null, vars: {} }, startBlockId: 'u', users: ops } as any);
    expect(res.vars['user.subscription']).toBe(0);
    expect(res.vars['user.first_seen']).toBe('');
    expect(res.vars['user.username']).toBe('a');
    expect(res.vars['user.id']).toBe(9);
    expect(res.vars['user.tags']).toBe('');
    expect(texts(res.outs)[0]).toBe('0/');
    expect(texts(res.outs)).toContain('дальше');
  });

  it('user_stats без шаблона: сообщений нет, поток идёт по next', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'u' },
      u: { id: 'u', type: 'user_stats', params: {}, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'дальше' } },
    });
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} }, { users: { async profile() { return { name: 'А', username: 'a', id: 9, tags: [], subscription: false, paidTotal: 0, refCount: 0, firstSeen: null }; } } });
    expect(res.outs).toEqual([{ method: 'sendMessage', payload: { chat_id: 2, text: 'дальше' } }]);
  });

  it('payment_link: create получает округлённую сумму, валюту в верхнем регистре, description, userId и orderId из vars', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'pl' },
      pl: {
        id: 'pl', type: 'payment_link',
        params: { connectionId: 'c1', amount: '1500.6', currency: 'rub', description: 'Заказ {{item}}', orderIdVar: 'oid', linkVar: 'my.link' },
        branches: { created: 'ok', failed: 'fail' },
      },
      ok: { id: 'ok', type: 'end', params: {} },
      fail: { id: 'fail', type: 'end', params: {} },
    });
    let got: any = null;
    const ops: PaymentOps = {
      async create(conn, params) { got = { conn, params }; return { id: 'o', externalId: 'ext-9', amount: 1501, currency: 'RUB', status: 'created', link: 'https://pay/y' }; },
      async get() { return null; },
    };
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { item: 'Маникюр', oid: 'order-42' } }, { payments: ops });
    expect(got.conn).toBe('c1');
    expect(got.params).toEqual(expect.objectContaining({
      amount: 1501, // Math.round(1500.6)
      currency: 'RUB', // uppercased
      description: 'Заказ Маникюр',
      userId: 2,
      orderId: 'order-42',
    }));
    // Свой linkVar — ссылка в него; pay.order — всегда externalId; orderIdVar перезаписывается externalId.
    expect(res.vars['my.link']).toBe('https://pay/y');
    expect(res.vars['pay.link']).toBeUndefined();
    expect(res.vars['pay.order']).toBe('ext-9');
    expect(res.vars['oid']).toBe('ext-9');
  });

  it('payment_check: статусы created/cancelled, заказ null и ошибка ops — соответствующие ветки', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'pc' },
      pc: { id: 'pc', type: 'payment_check', params: { connectionId: 'c1' }, branches: { paid: 'p', pending: 'w', failed: 'f' } },
      p: { id: 'p', type: 'message', params: { text: 'оплачено' } },
      w: { id: 'w', type: 'message', params: { text: 'ждём' } },
      f: { id: 'f', type: 'message', params: { text: 'не оплачено' } },
    });
    const runCheck = (order: any, throwIt = false) => {
      const ops: PaymentOps = {
        async create() { return null; },
        async get() { if (throwIt) throw new Error('boom'); return order; },
      };
      return run(scn, msgUpdate('/start'), { currentBlock: null, vars: { 'pay.order': 'ext-1' } }, { payments: ops });
    };
    const mk = (status: string) => ({ id: 'o', externalId: 'ext-1', amount: 100, currency: 'RUB', status, link: '' });
    expect(texts((await runCheck(mk('created'))).outs)).toContain('ждём');
    expect(texts((await runCheck(mk('cancelled'))).outs)).toContain('не оплачено');
    expect(texts((await runCheck(null)).outs)).toContain('не оплачено');
    expect(texts((await runCheck(null, true)).outs)).toContain('не оплачено');
    const paid = await runCheck(mk('paid'));
    expect(paid.vars['payment']).toEqual({ status: 'paid', amount: 100, currency: 'RUB', order: 'ext-1' });
  });

  it('payment_check: orderIdVar задаёт источник номера заказа', async () => {
    const scn = sc({
      pc: { id: 'pc', type: 'payment_check', params: { connectionId: 'c1', orderIdVar: 'oid' }, branches: { paid: 'p', pending: 'w', failed: 'f' } },
      p: { id: 'p', type: 'end', params: {} },
      w: { id: 'w', type: 'end', params: {} },
      f: { id: 'f', type: 'end', params: {} },
    });
    let gotOrderId = '';
    const ops: PaymentOps = {
      async create() { return null; },
      async get(_c, orderId) { gotOrderId = orderId; return { id: 'o', externalId: orderId, amount: 1, currency: 'RUB', status: 'paid', link: '' }; },
    };
    await runEngine({ scenario: scn, update: msgUpdate('/start'), session: { currentBlock: null, vars: { oid: 'ext-77' } }, startBlockId: 'pc', payments: ops } as any);
    expect(gotOrderId).toBe('ext-77');
  });

  it('foreach: строка через запятую, JSON-строка и массив разбираются одинаково', async () => {
    // Тело БЕЗ возврата в foreach: один runEngine — ровно одна итерация,
    // иначе движок прокрутит весь список за проход и vars не поймаешь.
    const scn = sc({
      fe: { id: 'fe', type: 'foreach', params: { listVar: 'list', itemVar: 'x', indexVar: 'n' }, branches: { each: 'em', done: 'dn' } },
      em: { id: 'em', type: 'message', params: { text: '{{n}}:{{x}}' } },
      dn: { id: 'dn', type: 'end', params: {} },
    });
    const first = async (list: unknown) => {
      const res = await runEngine({ scenario: scn, update: {}, session: { currentBlock: null, vars: { list } }, startBlockId: 'fe' } as any);
      return [texts(res.outs)[0], res.vars['__loop.fe']];
    };
    expect(await first('a, b, c')).toEqual(['0:a', { items: ['a', 'b', 'c'], index: 1 }]);
    expect(await first('["p","q"]')).toEqual(['0:p', { items: ['p', 'q'], index: 1 }]);
    expect(await first(['p', 'q'])).toEqual(['0:p', { items: ['p', 'q'], index: 1 }]);
  });

  it('foreach: дефолтный потолок 100 итераций', async () => {
    const scn = sc({
      fe: { id: 'fe', type: 'foreach', params: { listVar: 'list' }, branches: { each: 'em', done: 'dn' } },
      em: { id: 'em', type: 'message', params: { text: 'эл' }, next: 'fe' },
      dn: { id: 'dn', type: 'message', params: { text: 'конец' } },
    });
    // Состояние после 100 итераций: следующий вход обязан уйти в done и
    // удалить переменную цикла.
    const res = await runEngine({
      scenario: scn, update: {},
      session: { currentBlock: null, vars: { ['__loop.fe']: { items: new Array(150).fill('x'), index: 100 } } },
      startBlockId: 'fe',
    } as any);
    expect(texts(res.outs)).toContain('конец');
    expect(res.vars['__loop.fe']).toBeUndefined();
  });

  it('assert: пустой failMessage — дефолтный текст «Проверка не пройдена.»', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'sv' },
      sv: { id: 'sv', type: 'setvar', params: { assignVar: 'a', expr: '1' }, next: 'as' },
      as: { id: 'as', type: 'assert', params: { condVar: 'a', op: '==', condValue: '2' }, branches: { pass: 'p', fail: 'f' } },
      p: { id: 'p', type: 'end', params: {} },
      f: { id: 'f', type: 'end', params: {} },
    });
    const res = await run(scn, msgUpdate('/start'));
    expect(texts(res.outs)).toContain('Проверка не пройдена.');
  });

  it('assert: составные conditions с logic or/and — тот же контракт, что у condition', async () => {
    const of = (logic: 'or' | 'and') => sc({
      s: { id: 's', type: 'start', params: {}, next: 'sv' },
      sv: { id: 'sv', type: 'setvar', params: { assignVar: 'a', expr: '1' }, next: 'as' },
      as: {
        id: 'as', type: 'assert',
        params: { logic, conditions: [{ source: 'var', var: 'a', op: '==', value: '1' }, { source: 'var', var: 'a', op: '==', value: '99' }], failMessage: 'упс' },
        branches: { pass: 'p', fail: 'f' },
      },
      p: { id: 'p', type: 'message', params: { text: 'прошло' } },
      f: { id: 'f', type: 'message', params: { text: 'упало' } },
    });
    expect(texts((await run(of('or'), msgUpdate('/start'))).outs)).toContain('прошло');
    expect(texts((await run(of('and'), msgUpdate('/start'))).outs)).toContain('упало');
  });

  it('counter: ops получают (name, scope, userId, amount) для всех четырёх операций', async () => {
    const calls: { op: string; args: unknown[] }[] = [];
    const rec = (op: string) => (...args: unknown[]) => { calls.push({ op, args }); return Promise.resolve(3); };
    const ops = { inc: rec('inc'), dec: rec('dec'), reset: rec('reset'), get: rec('get') } as unknown as CounterOps;
    const counterOf = (params: Record<string, unknown>) => sc({
      cn: { id: 'cn', type: 'counter', params, branches: { ok: 'e', limit_reached: 'e' } },
      e: { id: 'e', type: 'end', params: {} },
    });
    const runC = (params: Record<string, unknown>) =>
      runEngine({ scenario: counterOf(params), update: msgUpdate('/start'), session: { currentBlock: null, vars: {} }, startBlockId: 'cn', counters: ops } as any);
    await runC({ counterName: 'n', counterOp: 'inc', amount: 2 });
    await runC({ counterName: 'n', counterOp: 'dec', amount: 4, counterScope: 'bot' });
    await runC({ counterName: 'n', counterOp: 'reset' });
    await runC({ counterName: 'n', counterOp: 'get' });
    expect(calls).toEqual([
      { op: 'inc', args: ['n', 'user', 2, 2] },
      { op: 'dec', args: ['n', 'bot', 2, 4] },
      { op: 'reset', args: ['n', 'user', 2] },
      { op: 'get', args: ['n', 'user', 2] },
    ]);
  });

  it('buttons c updateMode edit и пустым промптом — editMessageReplyMarkup', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: { id: 'b', type: 'buttons', params: { prompt: 'жми', buttons: [{ label: 'ОК', value: 'ok' }] }, branches: { ok: 't' } },
      t: {
        id: 't', type: 'buttons',
        params: { prompt: '', updateMode: 'edit', buttons: [{ label: 'A', value: 'a' }] },
        branches: { a: 't' },
      },
    });
    const res = await run(scn, cbUpdate('ok'), { currentBlock: 'b', vars: {} });
    expect(res.outs).toEqual([
      {
        method: 'editMessageReplyMarkup',
        payload: { chat_id: 2, message_id: 9, reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'a' }]] } },
      },
    ]);
    expect(res.currentBlock).toBe('t');
  });

  it('сценарий из всех шести ops-блоков БЕЗ интерфейсов проходит без единого исключения', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'cc' },
      cc: { id: 'cc', type: 'channel_check', params: { channelId: '@chan' }, branches: { error: 'sb' } },
      sb: { id: 'sb', type: 'segment_broadcast', params: { segmentText: 'Привет' }, branches: { empty: 'us' } },
      us: { id: 'us', type: 'user_stats', params: { template: 'имя {{user.name}}' }, next: 'pl' },
      pl: { id: 'pl', type: 'payment_link', params: { connectionId: 'c1', amount: 100 }, branches: { failed: 'pc' } },
      pc: { id: 'pc', type: 'payment_check', params: { connectionId: 'c1' }, branches: { failed: 'cnt' } },
      cnt: { id: 'cnt', type: 'counter', params: { counterName: 'x' }, branches: { ok: 'm' } },
      m: { id: 'm', type: 'message', params: { text: 'дошли' } },
    });
    const res = await run(scn, msgUpdate('/start'));
    // user_stats без профиля отправляет шаблон с пустой подстановкой и идёт по
    // next; остальные блоки расходятся по своим «нет данных» веткам.
    expect(res.outs).toEqual([
      { method: 'sendMessage', payload: { chat_id: 2, text: 'имя ' } },
      { method: 'sendMessage', payload: { chat_id: 2, text: 'дошли' } },
    ]);
  });
});
