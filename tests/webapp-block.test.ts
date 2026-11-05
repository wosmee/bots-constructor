// Блок web_app (Mini App): валидатор и движок.
// Валидатор: корректная ссылка https://t.me/<bot>/<slug> проходит; не-t.me,
// http://, короткий путь и пустая кнопка — ошибки. Движок: sendMessage уходит
// с web_app-кнопкой в inline_keyboard, сценарий продолжает идти по next.
import { describe, it, expect } from 'vitest';
import { validateScenario, countIssues } from '../shared/validate';
import { runEngine, type SessionState } from '../worker/src/engine';
import type { Scenario, Block } from '../shared/types';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

function block(id: string, type: Block['type'], params: Block['params'], next?: string): Block {
  return { id, type, params, next } as Block;
}

function withStart(blocks: Scenario['blocks']): Scenario {
  return { version: 1, start: 's', blocks: { s: { id: 's', type: 'start', params: { command: '/start' }, next: Object.keys(blocks)[0] ?? '' }, ...blocks } };
}

// Минимальный корректный web_app-блок: сообщение, кнопка, полная t.me-ссылка.
const okParams = {
  text: 'Открой каталог',
  button: 'Открыть',
  url: 'https://t.me/mybot/shop',
};

// ---------------- validate ----------------

describe('validate: web_app', () => {
  it('корректный блок — без ошибок', () => {
    const issues = validateScenario(withStart({ w: block('w', 'web_app', okParams, 'e'), e: block('e', 'end', {}) }));
    expect(countIssues(issues).errors).toBe(0);
  });

  it('url не с t.me — webapp-url', () => {
    const b = block('w', 'web_app', { ...okParams, url: 'https://example.com/shop' }, 'e');
    expect(codes(validateScenario(withStart({ w: b, e: block('e', 'end', {}) })))).toContain('webapp-url');
  });

  it('url по http:// — webapp-url (https обязателен)', () => {
    const b = block('w', 'web_app', { ...okParams, url: 'http://t.me/mybot/shop' }, 'e');
    expect(codes(validateScenario(withStart({ w: b, e: block('e', 'end', {}) })))).toContain('webapp-url');
  });

  it('пустая ссылка — webapp-url', () => {
    const b = block('w', 'web_app', { ...okParams, url: '' }, 'e');
    expect(codes(validateScenario(withStart({ w: b, e: block('e', 'end', {}) })))).toContain('webapp-url');
  });

  it('короткий путь (только username, без slug) — webapp-url-path', () => {
    const b = block('w', 'web_app', { ...okParams, url: 'https://t.me/mybot' }, 'e');
    expect(codes(validateScenario(withStart({ w: b, e: block('e', 'end', {}) })))).toContain('webapp-url-path');
  });

  it('пустая кнопка — webapp-button', () => {
    const b = block('w', 'web_app', { ...okParams, button: '  ' }, 'e');
    expect(codes(validateScenario(withStart({ w: b, e: block('e', 'end', {}) })))).toContain('webapp-button');
  });

  it('пустой текст сообщения — webapp-text', () => {
    const b = block('w', 'web_app', { ...okParams, text: '' }, 'e');
    expect(codes(validateScenario(withStart({ w: b, e: block('e', 'end', {}) })))).toContain('webapp-text');
  });

  it('{{var}} в ссылке проходит проверку формата (staticInterpolate)', () => {
    const b = block('w', 'web_app', { ...okParams, url: 'https://t.me/{{bot}}/{{slug}}' }, 'e');
    const issues = validateScenario(withStart({ w: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).not.toContain('webapp-url');
    expect(codes(issues)).not.toContain('webapp-url-path');
  });
});

// ---------------- engine ----------------

function sc(blocks: Scenario['blocks'], start = 's'): Scenario {
  return { version: 1, start, blocks } as Scenario;
}

const msgUpdate = (text: string, userId = 2, messageId = 5) => ({
  message: { chat: { id: userId }, from: { id: userId }, message_id: messageId, text },
});

function run(scenario: Scenario, update: any, session: SessionState = { currentBlock: null, vars: {} }) {
  const startBlockId = session.currentBlock ? undefined : scenario.start;
  return runEngine({ scenario, update, session, startBlockId, botUsername: 'testbot' });
}

describe('runEngine: web_app', () => {
  const scn = sc({
    s: { id: 's', type: 'start', params: {}, next: 'w' },
    w: { id: 'w', type: 'web_app', params: okParams, next: 'm' },
    m: { id: 'm', type: 'message', params: { text: 'после кнопки' }, next: 'e' },
    e: { id: 'e', type: 'end', params: {} },
  });

  it('шлёт sendMessage с web_app.url в inline_keyboard и идёт по next', async () => {
    const res = await run(scn, msgUpdate('/start'));
    const sent = res.outs.find((o) => o.method === 'sendMessage' && o.payload.text === 'Открой каталог');
    expect(sent).toBeTruthy();
    const kb = sent!.payload.reply_markup as any;
    expect(kb.inline_keyboard).toEqual([[{ text: 'Открыть', web_app: { url: 'https://t.me/mybot/shop' } }]]);
    // Клавиатура — именно inline: web_app-кнопка в reply-клавиатуре невалидна.
    expect(kb.keyboard).toBeUndefined();
    // Идём дальше по next: следующее сообщение отправлено, сессия на «end».
    expect(res.outs.some((o) => o.method === 'sendMessage' && o.payload.text === 'после кнопки')).toBe(true);
    expect(res.currentBlock).toBeNull();
  });

  it('{{var}} в тексте, кнопке и ссылке интерполируются', async () => {
    const vars = { bot: 'mybot', slug: 'shop', name: 'Аня' };
    const interp = sc({
      s: { id: 's', type: 'start', params: {}, next: 'w' },
      w: {
        id: 'w',
        type: 'web_app',
        params: { text: 'Привет, {{name}}', button: 'Открыть {{slug}}', url: 'https://t.me/{{bot}}/{{slug}}' },
        next: 'e',
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(interp, msgUpdate('привет'), { currentBlock: null, vars });
    const sent = res.outs.find((o) => o.method === 'sendMessage');
    expect(sent!.payload.text).toBe('Привет, Аня');
    const kb = sent!.payload.reply_markup as any;
    expect(kb.inline_keyboard[0][0]).toEqual({ text: 'Открыть shop', web_app: { url: 'https://t.me/mybot/shop' } });
  });

  it('disabled-блок прозрачно пропускается по next (без отправки)', async () => {
    const frozen = sc({
      s: { id: 's', type: 'start', params: {}, next: 'w' },
      w: { id: 'w', type: 'web_app', params: { ...okParams, disabled: true }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'после кнопки' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(frozen, msgUpdate('/start'));
    expect(res.outs.some((o) => (o.payload as any).reply_markup?.inline_keyboard)).toBe(false);
    expect(res.outs.some((o) => o.method === 'sendMessage' && o.payload.text === 'после кнопки')).toBe(true);
  });

  it('активное reply-меню (__menu) НЕ подмешивается: web_app — только inline', async () => {
    const res = await run(scn, msgUpdate('текст'), {
      currentBlock: null,
      vars: { __menu: JSON.stringify({ buttons: [{ label: 'Меню' }], branches: {} }) },
    });
    const sent = res.outs.find((o) => o.method === 'sendMessage' && o.payload.text === 'Открой каталог');
    const kb = sent!.payload.reply_markup as any;
    expect(kb.inline_keyboard).toBeTruthy();
    expect(kb.keyboard).toBeUndefined();
  });
});
