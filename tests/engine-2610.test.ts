// Движок набора 2026-10: правка/удаление сообщений, викторина, язык, дедлайн,
// ИИ-классификатор, входящий вебхук, геопозиция. Фейков D1 нет: движок чистый,
// асинхронные операции уходят outs'ами (их исполняет воркер), поэтому тесты
// проверяют ФОРМУ outs и выбор веток, а не сеть.
import { describe, it, expect } from 'vitest';
import { runEngine, type SessionState } from '../worker/src/engine';
import type { Scenario } from '../shared/types';

function sc(blocks: Scenario['blocks'], start = 's'): Scenario {
  return { version: 1, start, blocks } as Scenario;
}

const msgUpdate = (text: string, userId = 2, messageId = 5, extra: Record<string, unknown> = {}) => ({
  message: { chat: { id: userId }, from: { id: userId, language_code: 'ru-RU' }, message_id: messageId, text, ...extra },
});

function run(scenario: Scenario, update: any, session: SessionState = { currentBlock: null, vars: {} }, ops: Record<string, unknown> = {}) {
  const startBlockId = session.currentBlock ? undefined : scenario.start;
  return runEngine({ scenario, update, session, startBlockId, botUsername: 'testbot', ...ops } as any);
}

const texts = (outs: { method: string; payload: any }[]) => outs.filter((o) => o.method === 'sendMessage').map((o) => o.payload.text);

// ---------------- edit_message / delete_message ----------------

describe('runEngine: edit_message', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'e' },
    e: {
      id: 'e',
      type: 'edit_message',
      params: { msgRefVar: '', editText: 'Готово ✓' },
      branches: { ok: 'ok', too_old: 'old', not_found: 'nf' },
    },
    ok: { id: 'ok', type: 'message', params: { text: 'исправлено' } },
    old: { id: 'old', type: 'message', params: { text: 'старое' } },
    nf: { id: 'nf', type: 'message', params: { text: 'не найдено' } },
  });

  it('пустой msgRefVar = {{__bot_msg}}: outs edit_message с целью из переменной', async () => {
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { __bot_msg: { chatId: 2, messageId: 77 } } });
    const out = res.outs.find((o) => o.method === 'edit_message');
    expect(out).toBeTruthy();
    expect(out!.payload.chatId).toBe(2);
    expect(out!.payload.messageId).toBe(77);
    expect(out!.payload.text).toBe('Готово ✓');
    expect(out!.payload.branches).toEqual({ ok: 'ok', too_old: 'old', not_found: 'nf' });
    // Поток остановлен на блоке: ветку выберет воркер после tgCall.
    expect(res.currentBlock).toBe('e');
  });

  it('числовой id в переменной + текущий чат', async () => {
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { __bot_msg: 42 } });
    const out = res.outs.find((o) => o.method === 'edit_message');
    expect(out!.payload.messageId).toBe(42);
    expect(out!.payload.chatId).toBe(2); // чат из апдейта
  });

  it('цели нет — ветка not_found без outs правки', async () => {
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} });
    expect(res.outs.some((o) => o.method === 'edit_message')).toBe(false);
    expect(texts(res.outs)).toContain('не найдено');
  });
});

describe('runEngine: delete_message', () => {
  it('цель есть — deleteMessage и проход по next', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'd' },
      d: { id: 'd', type: 'delete_message', params: { msgRefVar: '' }, next: 'n' },
      n: { id: 'n', type: 'message', params: { text: 'дальше' } },
    });
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: { __bot_msg: { chatId: 2, messageId: 9 } } });
    const out = res.outs.find((o) => o.method === 'deleteMessage');
    expect(out).toBeTruthy();
    expect(out!.payload.message_id).toBe(9);
    expect(texts(res.outs)).toContain('дальше');
  });

  it('цели нет — тихо по next (удаление не рвёт сценарий)', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'd' },
      d: { id: 'd', type: 'delete_message', params: { msgRefVar: '' }, next: 'n' },
      n: { id: 'n', type: 'message', params: { text: 'дальше' } },
    });
    const res = await run(scn, msgUpdate('/start'), { currentBlock: null, vars: {} });
    expect(res.outs.some((o) => o.method === 'deleteMessage')).toBe(false);
    expect(texts(res.outs)).toContain('дальше');
  });
});

// ---------------- quiz ----------------

describe('runEngine: quiz', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'q' },
    q: {
      id: 'q',
      type: 'quiz',
      params: {
        question: 'Сколько сохнет?',
        pollOptions: [{ id: 'a', text: '1' }, { id: 'b', text: '3' }],
        correctOptionId: 'b',
        quizFailText: 'Неверно: три дня.',
      },
      branches: { passed: 'pass', failed: 'fail' },
    },
    pass: { id: 'pass', type: 'message', params: { text: 'записываю' } },
    fail: { id: 'fail', type: 'message', params: { text: 'пересдача' } },
  });

  it('sendPoll в quiz-режиме с correct_option_id и ждёт ответ', async () => {
    const res = await run(scn, msgUpdate('/start'));
    const poll = res.outs.find((o) => o.method === 'sendPoll');
    expect(poll!.payload.type).toBe('quiz');
    expect(poll!.payload.correct_option_id).toBe(1);
    expect(poll!.payload.allows_multiple_answers).toBe(false);
    expect(res.currentBlock).toBe('q');
  });

  it('верный ответ — passed без пояснения', async () => {
    const res = await run(scn, { poll_answer: { user: { id: 2 }, option_ids: [1] } }, { currentBlock: 'q', vars: {} });
    expect(texts(res.outs)).toContain('записываю');
    expect(texts(res.outs)).not.toContain('Неверно: три дня.');
  });

  it('неверный ответ — failed И текст пояснения', async () => {
    const res = await run(scn, { poll_answer: { user: { id: 2 }, option_ids: [0] } }, { currentBlock: 'q', vars: {} });
    expect(texts(res.outs)).toContain('Неверно: три дня.');
    expect(texts(res.outs)).toContain('пересдача');
  });

  it('другой апдейт во время ожидания — failed', async () => {
    const res = await run(scn, msgUpdate('не буду'), { currentBlock: 'q', vars: {} });
    expect(texts(res.outs)).toContain('пересдача');
  });

  it('без правильного варианта — failed, sendPoll не выпускается', async () => {
    const bad = sc({
      s: { id: 's', type: 'start', params: {}, next: 'q' },
      q: { id: 'q', type: 'quiz', params: { question: '?', pollOptions: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], correctOptionId: '' }, branches: { failed: 'fail' } },
      fail: { id: 'fail', type: 'message', params: { text: 'пересдача' } },
    });
    const res = await run(bad, msgUpdate('/start'));
    expect(res.outs.some((o) => o.method === 'sendPoll')).toBe(false);
    expect(texts(res.outs)).toContain('пересдача');
  });
});

// ---------------- language ----------------

describe('runEngine: language', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'l' },
    l: { id: 'l', type: 'language', params: { langCodes: ['ru', 'en'] }, branches: { ru: 'ru', en: 'en', fallback: 'fb' } },
    ru: { id: 'ru', type: 'message', params: { text: 'привет' } },
    en: { id: 'en', type: 'message', params: { text: 'hello' } },
    fb: { id: 'fb', type: 'message', params: { text: 'other' } },
  });

  it('ru-RU из апдейта → ветка ru и user.lang = ru', async () => {
    const res = await run(scn, msgUpdate('/start'));
    expect(res.vars['user.lang']).toBe('ru');
    expect(texts(res.outs)).toContain('привет');
  });

  it('незнакомый язык → fallback', async () => {
    const upd = { message: { chat: { id: 2 }, from: { id: 2, language_code: 'de-DE' }, message_id: 5, text: '/start' } };
    const res = await run(scn, upd);
    expect(res.vars['user.lang']).toBe('de');
    expect(texts(res.outs)).toContain('other');
  });

  it('апдейт без языка → fallback, не падение', async () => {
    const upd = { message: { chat: { id: 2 }, from: { id: 2 }, message_id: 5, text: '/start' } };
    const res = await run(scn, upd);
    expect(texts(res.outs)).toContain('other');
  });
});

// ---------------- timer_deadline ----------------

describe('runEngine: timer_deadline', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 't' },
    t: {
      id: 't',
      type: 'timer_deadline',
      params: { deadlineAt: '2030-01-01T10:00', cancelVar: 'paid', deadlineText: 'Срок вышел' },
      branches: { done: 'done', expired: 'exp' },
      next: 'n',
    },
    n: { id: 'n', type: 'message', params: { text: 'ссылка на оплату' } },
    done: { id: 'done', type: 'message', params: { text: 'успел' } },
    exp: { id: 'exp', type: 'message', params: { text: 'вышел' } },
  });

  it('НЕ пауза: поток идёт по next сразу, дедлайн уносится outs-задачей', async () => {
    const res = await run(scn, msgUpdate('/start'));
    const out = res.outs.find((o) => o.method === 'deadline');
    expect(out).toBeTruthy();
    expect(out!.payload.branches).toEqual({ done: 'done', expired: 'exp' });
    expect(out!.payload.cancelVar).toBe('paid');
    expect(Number(out!.payload.atMs)).toBeGreaterThan(Date.now());
    // Диалог не заморожен: пользователь получил ссылку сразу.
    expect(texts(res.outs)).toContain('ссылка на оплату');
    expect(res.currentBlock).toBeNull();
  });

  it('битый срок — честный проход по done без задачи', async () => {
    const bad = sc({
      s: { id: 's', type: 'start', params: {}, next: 't' },
      t: { id: 't', type: 'timer_deadline', params: { deadlineAt: 'не дата' }, branches: { done: 'done', expired: 'exp' }, next: 'n' },
      n: { id: 'n', type: 'message', params: { text: 'мимо' } },
      done: { id: 'done', type: 'message', params: { text: 'успел' } },
    });
    const res = await run(bad, msgUpdate('/start'));
    expect(res.outs.some((o) => o.method === 'deadline')).toBe(false);
    expect(texts(res.outs)).toContain('успел');
  });
});

// ---------------- ai_classify ----------------

describe('runEngine: ai_classify', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'c' },
    c: {
      id: 'c',
      type: 'ai_classify',
      params: { classifyLabels: ['lead', 'spam'], classifyFallbackLabel: 'other', classifyOutVar: 'ai.label' },
      branches: { lead: 'lead', spam: 'spam', other: 'other' },
    },
    lead: { id: 'lead', type: 'message', params: { text: 'лид' } },
    spam: { id: 'spam', type: 'message', params: { text: 'спам' } },
    other: { id: 'other', type: 'message', params: { text: 'прочее' } },
  });

  it('выпускает задачу с метками, ветками и входом из текста апдейта', async () => {
    const res = await run(scn, msgUpdate('хочу прайс'));
    const out = res.outs.find((o) => o.method === 'ai_classify');
    expect(out).toBeTruthy();
    expect(out!.payload.labels).toEqual(['lead', 'spam']);
    expect(out!.payload.fallback).toBe('other');
    expect(out!.payload.outVar).toBe('ai.label');
    expect(String(out!.payload.prompt)).toContain('хочу прайс');
    expect(out!.payload.branches).toEqual({ lead: 'lead', spam: 'spam', other: 'other' });
    expect(res.currentBlock).toBe('c');
  });

  it('без меток — прозрачный проход по next', async () => {
    const bad = sc({
      s: { id: 's', type: 'start', params: {}, next: 'c' },
      c: { id: 'c', type: 'ai_classify', params: { classifyLabels: [] }, next: 'n' },
      n: { id: 'n', type: 'message', params: { text: 'мимо' } },
    });
    const res = await run(bad, msgUpdate('текст'));
    expect(res.outs.some((o) => o.method === 'ai_classify')).toBe(false);
    expect(texts(res.outs)).toContain('мимо');
  });
});

// ---------------- location ----------------

describe('runEngine: location', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'g' },
    g: { id: 'g', type: 'location', params: { locationPrompt: 'Где вы?' }, branches: { sent: 'sent', declined: 'dec' } },
    sent: { id: 'sent', type: 'message', params: { text: 'координаты есть' } },
    dec: { id: 'dec', type: 'message', params: { text: 'отказ' } },
  });

  it('просит гео reply-клавиатурой и ждёт', async () => {
    const res = await run(scn, msgUpdate('/start'));
    const out = res.outs.find((o) => o.method === 'sendMessage');
    expect(out!.payload.reply_markup.keyboard[0][0].request_location).toBe(true);
    expect(out!.payload.text).toBe('Где вы?');
    expect(res.currentBlock).toBe('g');
  });

  it('апдейт с location — ветка sent и user.lat/user.lon', async () => {
    const upd = { message: { chat: { id: 2 }, from: { id: 2 }, message_id: 6, location: { latitude: 55.75, longitude: 37.62 } } };
    const res = await run(scn, upd, { currentBlock: 'g', vars: {} });
    expect(res.vars['user.lat']).toBe(55.75);
    expect(res.vars['user.lon']).toBe(37.62);
    expect(texts(res.outs)).toContain('координаты есть');
  });

  it('текст без гео — ветка declined (не зависаем)', async () => {
    const res = await run(scn, msgUpdate('не скажу'), { currentBlock: 'g', vars: {} });
    expect(texts(res.outs)).toContain('отказ');
  });
});

// ---------------- webhook_in ----------------

describe('runEngine: webhook_in', () => {
  it('прозрачный проход по next (wh.* кладёт роут до прохода)', async () => {
    const scn = sc({
      s: { id: 's', type: 'start', params: {}, next: 'w' },
      w: { id: 'w', type: 'webhook_in', params: { webhookFields: ['stage'] }, next: 'n' },
      n: { id: 'n', type: 'message', params: { text: 'статус: {{wh.stage}}' } },
    });
    const res = await run(scn, {}, { currentBlock: null, vars: { 'wh.stage': 'won' } });
    expect(texts(res.outs)).toContain('статус: won');
  });
});
