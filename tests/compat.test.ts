// РЕГРЕССИОННЫЙ ПАК ОБРАТНОЙ СОВМЕСТИМОСТИ (TASK 14).
//
// Этот файл защищает продакшен: четыре реалистичных сценария ДО изменений
// набора 2026-09 (рефералка, счёт, коллекции+теги, http/ai/delay). Фикстуры
// сняты с поведения кода на момент введения набора и должны обновляться ТОЛЬКО
// осознанно — если поведение старых сценариев реально решено изменить. Любое
// «починил тест, чтобы прошёл» здесь = сломанный бот у живого автора.
//
// Контракты, которые файл держит:
//   1. outs старых блоков байт-в-байт прежние (методы, payload, порядок);
//   2. payload сообщений БЕЗ parseMode не содержит parse_mode /
//      link_preview_options (никаких новых ключей);
//   3. легаси-условия (> и <) — только числовые, как раньше;
//   4. validateScenario на старых сценариях не выдаёт НОВЫХ кодов;
//   5. scenarioCommands не изменился.
import { describe, it, expect } from 'vitest';
import { runEngine, type SessionState } from '../worker/src/engine';
import { makeMemReferralOps } from '../worker/src/blocks/referral/db';
import { validateScenario, scenarioCommands } from '../shared/validate';
import type { Scenario } from '../shared/types';

const nop = () => ({ push: () => undefined }) as unknown as { who: 'bot' | 'user'; text: string }[];

function run(scenario: Scenario, update: any, session: SessionState = { currentBlock: null, vars: {} }, extra: Record<string, unknown> = {}) {
  return runEngine({ scenario, update, session, botUsername: 'oldbot', ...extra } as any);
}

// Коды валидатора, которые существовали ДО набора 2026-09. Новый код на
// старом сценарии = регрессия валидатора.
const LEGACY_CODES = new Set([
  'empty', 'start-exit', 'link-next', 'link-branch', 'dead-end', 'tight-loop',
  'start-cmd', 'msg-empty', 'btn-none', 'btn-label', 'btn-value', 'btn-branch',
  'input-var', 'input-prompt', 'input-regex', 'cond-var', 'cond-op', 'cond-then', 'cond-else',
  'switch-var', 'switch-cases', 'switch-case', 'switch-branch', 'kw-empty', 'kw-hit', 'kw-miss',
  'setvar-var', 'setvar-expr', 'http-url', 'http-scheme', 'ai-prompt', 'ai-out',
  'act-webhook', 'act-notify', 'act-broadcast', 'act-delay',
  'media-empty', 'mg-empty', 'mg-min', 'mg-max', 'mg-type', 'chain-empty', 'chain-text', 'chain-media',
  'inv-title', 'inv-desc', 'inv-amount', 'inv-token', 'inv-paid', 'inv-cancelled',
  'sub-action', 'cmd-name', 'goto-target', 'goto-self', 'rnd-none', 'rnd-key', 'rnd-branch',
  'contact-var', 'tag-name', 'tag-outvar', 'cond-tag-op',
  'data-collection', 'data-fields', 'data-where', 'data-outvar', 'data-found', 'data-notfound',
  'ref-payload-chars', 'ref-payload-long',
  'refb-event', 'refb-n', 'refb-text', 'refb-var', 'refb-amount', 'refb-days',
  'refb-granted', 'refb-skipped', 'refb-failed',
  'refc-yes', 'refc-no', 'refh-depth', 'refh-shares', 'refh-sum', 'refh-negative',
  'refl-limit', 'refl-period', 'refl-period-order',
  'reft-name', 'reft-dates', 'reft-order', 'reft-split', 'reft-split-sum',
  'reft-joined', 'reft-already', 'reft-self', 'reft-notrunning', 'reft-ok',
  'refv-goal', 'refv-amount', 'refs-limit', 'refa-cooldown', 'refa-age',
  'missing-target',
]);

function assertOnlyLegacyCodes(scenario: Scenario) {
  const issues = validateScenario(scenario);
  const fresh = issues.map((i) => i.code).filter((c) => !LEGACY_CODES.has(c));
  expect(fresh).toEqual([]);
}

// ---------------- 1. Реферальная journeys-сценарий ----------------

const referralScenario: Scenario = {
  version: 1,
  start: 'start',
  blocks: {
    start: { id: 'start', type: 'start', params: { command: '/start' }, next: 'track' },
    track: {
      id: 'track', type: 'referral_track', params: {},
      branches: { ok: 'check', already_tracked: 'stats', self_referral_blocked: 'stats' },
    },
    check: { id: 'check', type: 'referral_check', params: {}, branches: { yes: 'bonus', no: 'stats' } },
    bonus: {
      id: 'bonus', type: 'referral_bonus',
      // Имена параметров — настоящие (refTrigger/refTriggerN): фикстура обязана
      // exercising реальный контракт блока, а не несуществующие поля.
      params: { refTrigger: 'nth_referral', refTriggerN: 1, refBonusKind: 'send_message', refBonusText: 'Спасибо, {{ref.inviter}}!' },
      branches: { granted: 'stats', skipped: 'stats', failed: 'stats' },
    },
    stats: { id: 'stats', type: 'referral_stats', params: {}, next: 'end' },
    end: { id: 'end', type: 'end', params: {} },
  },
} as Scenario;

describe('compat: реферальный сценарий', () => {
  it('/start ref_777 — track → check → bonus → stats: эталонные outs и vars', async () => {
    const ops = makeMemReferralOps(nop());
    const res = await run(referralScenario, { message: { chat: { id: 2 }, from: { id: 2 }, text: '/start ref_777' } }, { currentBlock: null, vars: {} }, { referral: ops });
    // ЭТАЛОН: бонус уходит пригласившему (777), статистика — текущему
    // пользователю (2), у которого пока 0 приглашённых. Состав, порядок и
    // payload — байт-в-байт.
    expect(res.outs).toEqual([
      { method: 'sendMessage', payload: { chat_id: 777, text: 'Спасибо, 777!' } },
      { method: 'sendMessage', payload: { chat_id: 2, text: 'Вы пригласили: 0. Заработано: 0.' } },
    ]);
    for (const s of res.outs) {
      // Никаких parse_mode / link_preview_options на старом сценарии.
      expect(s.payload.parse_mode).toBeUndefined();
      expect(s.payload.link_preview_options).toBeUndefined();
    }
    expect(res.currentBlock).toBeNull();
    expect(res.vars).toMatchObject({
      'ref.inviter': '777',
      'ref.count': 0,
      'ref.referred': '',
      'ref.earnings': 0,
      last_input: '/start ref_777',
    });
  });

  it('валидатор: только легаси-коды; scenarioCommands прежний', () => {
    assertOnlyLegacyCodes(referralScenario);
    expect(scenarioCommands(referralScenario)).toEqual([{ command: 'start', description: 'Запустить бота' }]);
  });
});

// ---------------- 2. Счёт (invoice) ----------------

const invoiceScenario: Scenario = {
  version: 1,
  start: 'start',
  blocks: {
    start: { id: 'start', type: 'start', params: { command: '/start' }, next: 'btns' },
    btns: {
      id: 'btns', type: 'buttons',
      params: { prompt: 'Купить курс?', buttons: [{ label: 'Оплатить', value: 'pay' }] },
      branches: { pay: 'inv' },
    },
    inv: {
      id: 'inv', type: 'invoice',
      params: { invoice: { title: 'Курс', description: 'Доступ на месяц', amount: '1500', providerToken: 'TEST:TOKEN', currency: 'RUB', payload: 'course1' } },
      branches: { paid: 'thanks', cancelled: 'bye' },
    },
    thanks: { id: 'thanks', type: 'message', params: { text: 'Спасибо за оплату!' }, next: 'end' },
    bye: { id: 'bye', type: 'message', params: { text: 'Оплата отменена' }, next: 'end' },
    end: { id: 'end', type: 'end', params: {} },
  },
} as Scenario;

describe('compat: invoice', () => {
  const cbqUpdate = {
    callback_query: { id: 'c1', from: { id: 2 }, data: 'pay', message: { chat: { id: 2 }, message_id: 55 } },
  };

  it('шаг 1: /start показывает inline-кнопки и ждёт нажатия', async () => {
    const res = await run(invoiceScenario, { message: { chat: { id: 2 }, from: { id: 2 }, text: '/start' } });
    // ЭТАЛОН: старый buttons без cbToast — никакого answerCallbackQuery нет и в помине.
    expect(res.outs).toEqual([
      {
        method: 'sendMessage',
        payload: {
          chat_id: 2,
          text: 'Купить курс?',
          reply_markup: { inline_keyboard: [[{ text: 'Оплатить', callback_data: 'pay' }]] },
        },
      },
    ]);
    expect(res.currentBlock).toBe('btns');
  });

  it('шаг 2: нажатие выставляет счёт — payload прежний, ждёт на блоке', async () => {
    const first = await run(invoiceScenario, { message: { chat: { id: 2 }, from: { id: 2 }, text: '/start' } });
    const res = await run(invoiceScenario, cbqUpdate, { currentBlock: 'btns', vars: first.vars });
    // ФИКСТУРА: точный payload до изменений (label = inv.label || inv.title,
    // provider_token из блока, никаких новых ключей).
    expect(res.outs).toEqual([
      {
        method: 'sendInvoice',
        payload: {
          chat_id: 2,
          title: 'Курс',
          description: 'Доступ на месяц',
          payload: 'course1',
          provider_token: 'TEST:TOKEN',
          currency: 'RUB',
          prices: [{ label: 'Курс', amount: 1500 }],
        },
      },
    ]);
    expect(res.currentBlock).toBe('inv');
  });

  it('successful_payment → ветка paid, vars.payment прежней формы', async () => {
    const res = await run(
      invoiceScenario,
      { message: { chat: { id: 2 }, from: { id: 2 }, successful_payment: { currency: 'RUB', total_amount: 1500, invoice_payload: 'course1', telegram_payment_charge_id: 'tg1', provider_payment_charge_id: 'pr1' } } },
      { currentBlock: 'inv', vars: {} }
    );
    expect(res.outs.filter((o) => o.method === 'sendMessage').map((o) => o.payload.text)).toEqual(['Спасибо за оплату!']);
    // ФИКСТУРА: объект payment — те же пять полей, без status/amount/order.
    expect(res.vars['payment']).toEqual({
      currency: 'RUB',
      total_amount: 1500,
      invoice_payload: 'course1',
      telegram_payment_charge_id: 'tg1',
      provider_payment_charge_id: 'pr1',
    });
  });

  it('валидатор: только легаси-коды', () => assertOnlyLegacyCodes(invoiceScenario));
});

// ---------------- 3. Коллекции + теги ----------------

const dataScenario: Scenario = {
  version: 1,
  start: 'start',
  blocks: {
    start: { id: 'start', type: 'start', params: { command: '/start' }, next: 'ask' },
    ask: { id: 'ask', type: 'input', params: { prompt: 'Имя?', var: 'name' }, next: 'save' },
    // Настоящие имена полей: outVar (не dataOutVar), tagName (не tag) —
    // иначе блок молча ничего не делает, и фикстура проверяет пустоту.
    save: {
      id: 'save', type: 'data',
      params: { collectionId: 'c1', dataOp: 'add', dataFields: { name: '{{name}}', city: 'Москва' }, outVar: 'rowId' },
      next: 'tag',
    },
    tag: { id: 'tag', type: 'tag', params: { tagOp: 'add', tagName: 'заявка' }, next: 'find' },
    find: {
      id: 'find', type: 'data',
      params: { collectionId: 'c1', dataOp: 'find', outVar: 'order', dataWhere: { city: 'Москва' }, dataLimit: 10 },
      branches: { found: 'cond', not_found: 'no' },
    },
    cond: { id: 'cond', type: 'condition', params: { condVar: 'order_count', op: '>', condValue: '0' }, branches: { then: 'yes', else: 'no' } },
    yes: { id: 'yes', type: 'message', params: { text: 'нашли {{order.name}}, всего {{order_count}}' }, next: 'end' },
    no: { id: 'no', type: 'message', params: { text: 'нет' }, next: 'end' },
    end: { id: 'end', type: 'end', params: {} },
  },
} as Scenario;

describe('compat: данные + теги + легаси-условие', () => {
  function memData() {
    const store: Record<string, unknown>[] = [];
    const match = (row: Record<string, unknown>, where: Record<string, unknown>) =>
      Object.entries(where ?? {}).every(([k, v]) => String(row[k] ?? '') === String(v ?? ''));
    return {
      store,
      async add(_c: string, fields: Record<string, unknown>) {
        store.push({ ...fields });
        return `row-${store.length}`;
      },
      async find(_c: string, where: Record<string, unknown>, limit: number) {
        return store.filter((row) => match(row, where)).slice(0, Math.max(1, Number(limit) || 10));
      },
      async update(_c: string, where: Record<string, unknown>, patch: Record<string, unknown>) {
        let n = 0;
        for (const row of store) if (match(row, where)) Object.assign(row, patch), n++;
        return n;
      },
      async remove(_c: string, where: Record<string, unknown>) {
        const keep = store.filter((row) => !match(row, where));
        const n = store.length - keep.length;
        store.length = 0;
        store.push(...keep);
        return n;
      },
    };
  }
  const memTags = {
    added: [] as string[],
    async add(tag: string) { this.added.push(tag); }, async remove() {}, async clear() {},
    async list() { return ['заявка']; }, async has() { return true; },
  };

  it('ввод имени → запись → тег → find → условие по количеству: эталонные outs и vars', async () => {
    const data = memData();
    const tags = memTags;
    const res = await run(dataScenario, { message: { chat: { id: 2 }, from: { id: 2 }, text: 'тестовое имя' } }, { currentBlock: 'ask', vars: {} }, { data, tags });
    // ЭТАЛОН: одно сообщение из ветки then, без parse_mode.
    expect(res.outs).toEqual([{ method: 'sendMessage', payload: { chat_id: 2, text: 'нашли тестовое имя, всего 1' } }]);
    for (const o of res.outs) expect(o.payload.parse_mode).toBeUndefined();
    expect(res.currentBlock).toBeNull();
    expect(res.vars).toMatchObject({
      name: 'тестовое имя',
      rowId: 'row-1',
      order_count: 1,
      'order.name': 'тестовое имя',
      'order.city': 'Москва',
    });
    expect(data.store).toEqual([{ name: 'тестовое имя', city: 'Москва' }]);
    expect(tags.added).toEqual(['заявка']);
  });

  it('легаси > остаётся числовым: нечисловая строка → false (ветка else)', async () => {
    const numScn: Scenario = {
      version: 1, start: 'c',
      blocks: {
        c: { id: 'c', type: 'condition', params: { condVar: 'n', op: '>', condValue: '5' }, branches: { then: 'y', else: 'n2' } },
        y: { id: 'y', type: 'message', params: { text: 'больше' } },
        n2: { id: 'n2', type: 'message', params: { text: 'не больше' } },
      },
    } as Scenario;
    // 'abc' > '5' лексикографически было бы true — старое поведение: false.
    const res = await run(numScn, {}, { currentBlock: null, vars: { n: 'abc' } }, {});
    const forced = await runEngine({ scenario: numScn, update: {}, session: { currentBlock: null, vars: { n: 'abc' } }, startBlockId: 'c', botUsername: 'oldbot' } as any);
    expect(forced.outs.map((o: any) => o.payload.text)).toEqual(['не больше']);
    void res;
  });

  it('валидатор: только легаси-коды', () => assertOnlyLegacyCodes(dataScenario));
});

// ---------------- 4. http / ai / delay ----------------

const asyncScenario: Scenario = {
  version: 1,
  start: 'start',
  blocks: {
    start: { id: 'start', type: 'start', params: { command: '/start' }, next: 'h' },
    h: { id: 'h', type: 'http', params: { url: 'https://api.example/v1', method: 'GET', jsonPath: 'data.name', outVar: 'name' }, next: 'ai' },
    ai: { id: 'ai', type: 'ai', params: { aiPrompt: 'Привет, {{name}}', aiVar: 'answer', aiReply: true }, next: 'd' },
    d: { id: 'd', type: 'action', params: { actionKind: 'delay', seconds: 60 }, next: 'm' },
    m: { id: 'm', type: 'message', params: { text: 'финал {{name}}' }, next: 'end' },
    end: { id: 'end', type: 'end', params: {} },
  },
} as Scenario;

describe('compat: http/ai/delay', () => {
  it('http-out прежний: новые поля есть, но дефолты нейтральны', async () => {
    const res = await run(asyncScenario, { message: { chat: { id: 2 }, from: { id: 2 }, text: '/start' } });
    const h = res.outs.find((o) => o.method === 'http');
    expect(h).toBeTruthy();
    // ФИКСТУРА: дефолты новых полей не меняют поведение — retries 0 (без
    // повторов, как раньше), paginate null (без пагинации).
    expect(h!.payload).toMatchObject({
      url: 'https://api.example/v1',
      method: 'GET',
      headersJson: '',
      bodyJson: '',
      jsonPath: 'data.name',
      outVar: 'name',
      retries: 0,
      backoffMs: 0,
      collectVar: '',
      paginate: null,
      next: 'ai',
    });
    expect(res.currentBlock).toBe('h'); // ждёт, как раньше
  });

  it('ai-out прежний', async () => {
    const res = await runEngine({ scenario: asyncScenario, update: {}, session: { currentBlock: null, vars: { name: 'X' } }, startBlockId: 'ai', botUsername: 'oldbot' } as any);
    const a = res.outs.find((o) => o.method === 'ai');
    expect(a!.payload).toMatchObject({ prompt: 'Привет, X', system: '', model: '', outVar: 'answer', reply: true, chatId: null, next: 'd' });
  });

  it('delay-out прежний', async () => {
    const res = await runEngine({ scenario: asyncScenario, update: {}, session: { currentBlock: null, vars: {} }, startBlockId: 'd', botUsername: 'oldbot' } as any);
    const d = res.outs.find((o) => o.method === 'delay');
    expect(d!.payload).toMatchObject({ seconds: 60, next: 'm' });
  });

  it('валидатор: только легаси-коды; scenarioCommands прежний', () => {
    assertOnlyLegacyCodes(asyncScenario);
    // ФИКСТУРА: scenarioCommands берёт params.command у блоков start/command,
    // имя — без '/' и без @bot, дефолтное описание старта — 'Запустить бота'.
    // Полный вывод сверен с реализацией до набора 2026-09 — не изменился.
    expect(scenarioCommands(asyncScenario)).toEqual([{ command: 'start', description: 'Запустить бота' }]);
  });
});

// ---------------- 5. Байтовая совместимость message без parseMode ----------------

describe('compat: message без parseMode байт-в-байт прежний', () => {
  it('payload = ровно chat_id + text (+ reply_markup от меню, если было)', async () => {
    const scn: Scenario = {
      version: 1, start: 'm',
      blocks: { m: { id: 'm', type: 'message', params: { text: 'привет {{name}}!' }, next: 'e' }, e: { id: 'e', type: 'end', params: {} } },
    } as Scenario;
    // Вход через startBlockId: /start без currentBlock сбросил бы vars.
    const res = await runEngine({
      scenario: scn,
      update: { message: { chat: { id: 2 }, from: { id: 2 }, text: 'x' } },
      session: { currentBlock: null, vars: { name: 'мир' } },
      startBlockId: 'm',
      botUsername: 'oldbot',
    } as any);
    const m = res.outs.find((o) => o.method === 'sendMessage')!;
    // ФИКСТУРА: точный набор ключей — ни одного нового.
    expect(Object.keys(m.payload).sort()).toEqual(['chat_id', 'text']);
    expect(m.payload).toEqual({ chat_id: 2, text: 'привет мир!' });
  });

  it('интерполяция {{var}} без экранирования, когда parseMode не задан', async () => {
    const scn: Scenario = {
      version: 1, start: 'm',
      blocks: { m: { id: 'm', type: 'message', params: { text: '{{x}}' }, next: 'e' }, e: { id: 'e', type: 'end', params: {} } },
    } as Scenario;
    const res = await runEngine({
      scenario: scn,
      update: { message: { chat: { id: 2 }, from: { id: 2 }, text: 'x' } },
      session: { currentBlock: null, vars: { x: '<b>&_.*' } },
      startBlockId: 'm',
      botUsername: 'oldbot',
    } as any);
    expect(res.outs.find((o) => o.method === 'sendMessage')!.payload.text).toBe('<b>&_.*');
  });
});
