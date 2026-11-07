// TASK 13: приёмка прогона сценария (simulateScenario) через публичный API
// POST /api/bots/:id/simulate. simulateScenario не экспортируется — гоняем его
// через default export воркера с фейковыми DB/KV и явным админ-доступом:
// ADMIN_KEY задан в env, запросы несут заголовок x-admin-key.
//
// Один большой сценарий покрывает ВСЕ новые блоки: poll, forward, chat_action,
// wait, channel_check, segment_broadcast, user_stats, payment_link,
// payment_check, foreach, random_text, assert, counter + message с parseMode.
// Отдельные тесты: переключатели member:/notmember:/paid:/pending:, потолок
// foreach на 500 элементах, префиксы вложений document:/video:/voice:/audio:/any:.
import { describe, expect, it } from 'vitest';
import worker from '../worker/src/index';

const ENC_KEY = btoa('0123456789abcdef0123456789abcdef'); // ровно 32 байта

type Stmt = { sql: string; args: unknown[]; kind: 'first' | 'run' | 'all' };

function makeEnv(botId: string) {
  const stmts: Stmt[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              stmts.push({ sql, args, kind: 'first' });
              if (sql.includes('FROM bots WHERE id = ?')) {
                return { id: botId, name: 'SimBot', owner_id: 'owner-1', active: 1, created_at: Date.now(), token_enc: 'x' };
              }
              return null;
            },
            async run() {
              stmts.push({ sql, args, kind: 'run' });
              return { meta: { changes: 1 } };
            },
            async all() {
              stmts.push({ sql, args, kind: 'all' });
              return { results: [] };
            },
          };
        },
      };
    },
  };
  const kv = {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  };
  // Админ-доступ даёт явный ADMIN_KEY + заголовок x-admin-key (fail-open убран).
  const env = { DB: db, KV: kv, ENCRYPTION_KEY: ENC_KEY, ADMIN_KEY: 'test-admin-key', ENVIRONMENT: 'production' } as any;
  return { env, stmts };
}

async function simulate(env: any, botId: string, scenario: unknown, inputs: string[]) {
  const req = new Request(`https://bots.example/api/bots/${botId}/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin-key' },
    body: JSON.stringify({ flow_json: JSON.stringify(scenario), inputs }),
  });
  const res = await (worker as any).fetch(req, env, {});
  expect(res.status).toBe(200);
  return res.json() as Promise<{
    log: { who: 'bot' | 'user'; text: string }[];
    pending: { kind: string; prompt?: string; buttons?: { label: string; value: string }[] } | null;
    vars: Record<string, unknown>;
  }>;
}

const texts = (r: { log: { text: string }[] }) => r.log.map((l) => l.text);

// Один сценарий со всеми новыми блоками. Порядок обхода:
// start → input(имя) → message(parseMode HTML) → setvar → poll → forward →
// chat_action → wait → channel_check#1 → buttons → channel_check#2 (после
// notmember:) → segment_broadcast → user_stats → payment_link →
// payment_check#1 (paid) → buttons → payment_check#2 (после pending:) →
// input(список) → foreach(+input на итерации) → random_text → assert(pass) →
// assert(fail) → counter → message(финиш).
function megaScenario() {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'in_who' },
      in_who: { id: 'in_who', type: 'input', params: { prompt: 'Имя?', var: 'who' }, next: 'm_fmt' },
      m_fmt: { id: 'm_fmt', type: 'message', params: { text: '<b>{{who}}</b> & привет', parseMode: 'HTML' }, next: 'set_fwd' },
      set_fwd: { id: 'set_fwd', type: 'setvar', params: { assignVar: 'fwdFrom', expr: '5' }, next: 'poll_blk' },
      poll_blk: {
        id: 'poll_blk',
        type: 'poll',
        params: { question: 'Любишь тесты?', pollOptions: [{ text: 'Да' }, { text: 'Нет' }] },
        branches: { answered: 'fwd_blk' },
      },
      fwd_blk: {
        id: 'fwd_blk',
        type: 'forward',
        params: { toChatId: '-100123', forwardMode: 'forward', fromVar: 'fwdFrom' },
        branches: { ok: 'ca_blk', failed: 'ca_blk' },
      },
      ca_blk: { id: 'ca_blk', type: 'chat_action', params: { chatAction: 'typing' }, next: 'wait_blk' },
      wait_blk: {
        id: 'wait_blk',
        type: 'wait',
        params: { seconds: 15, prompt: 'Напиши что-нибудь' },
        branches: { reply: 'cc1', timeout: 'cc1' },
      },
      cc1: {
        id: 'cc1',
        type: 'channel_check',
        params: { channelId: '@chan', cacheMinutes: 0 },
        branches: { member: 'm_member', not_member: 'm_notmember', error: 'm_notmember' },
      },
      m_member: { id: 'm_member', type: 'message', params: { text: 'ты в канале' }, next: 'btn1' },
      m_notmember: { id: 'm_notmember', type: 'message', params: { text: 'подписки нет (1)' } },
      btn1: {
        id: 'btn1',
        type: 'buttons',
        params: { prompt: 'Дальше?', buttons: [{ label: 'Идём', value: 'go' }] },
        branches: { go: 'cc2' },
      },
      cc2: {
        id: 'cc2',
        type: 'channel_check',
        params: { channelId: '@chan', cacheMinutes: 0 },
        branches: { member: 'm_member2', not_member: 'sb_blk', error: 'sb_blk' },
      },
      m_member2: { id: 'm_member2', type: 'message', params: { text: 'всё ещё в канале' } },
      sb_blk: {
        id: 'sb_blk',
        type: 'segment_broadcast',
        params: { segmentTag: 'vip', segmentText: 'Всем VIP' },
        branches: { queued: 'us_blk', empty: 'us_blk' },
      },
      us_blk: {
        id: 'us_blk',
        type: 'user_stats',
        params: { template: 'Профиль: {{user.name}}, оплатил: {{user.paid_total}}' },
        next: 'pl_blk',
      },
      pl_blk: {
        id: 'pl_blk',
        type: 'payment_link',
        params: { connectionId: 'conn-sim', amount: 150000, currency: 'RUB', description: 'Тест' },
        branches: { created: 'pc1', failed: 'pc1' },
      },
      pc1: {
        id: 'pc1',
        type: 'payment_check',
        params: { connectionId: 'conn-sim', orderIdVar: 'pay.order' },
        branches: { paid: 'm_paid', pending: 'm_paid', failed: 'm_paid' },
      },
      m_paid: { id: 'm_paid', type: 'message', params: { text: 'оплачено!' }, next: 'btn2' },
      btn2: {
        id: 'btn2',
        type: 'buttons',
        params: { prompt: 'Проверить ещё?', buttons: [{ label: 'Ещё', value: 'again' }] },
        branches: { again: 'pc2' },
      },
      pc2: {
        id: 'pc2',
        type: 'payment_check',
        params: { connectionId: 'conn-sim', orderIdVar: 'pay.order' },
        branches: { paid: 'm_paid2', pending: 'm_pending', failed: 'm_pending' },
      },
      m_paid2: { id: 'm_paid2', type: 'message', params: { text: 'снова оплачено' } },
      m_pending: { id: 'm_pending', type: 'message', params: { text: 'ждём оплаты' }, next: 'in_list' },
      in_list: { id: 'in_list', type: 'input', params: { prompt: 'Список через запятую', var: 'items' }, next: 'fc_blk' },
      fc_blk: {
        id: 'fc_blk',
        type: 'foreach',
        params: { listVar: 'items', itemVar: 'item', indexVar: 'idx', maxIterations: 10 },
        branches: { each: 'fc_step', done: 'm_loopdone' },
      },
      fc_step: { id: 'fc_step', type: 'input', params: { prompt: 'Элемент {{item}} — продолжим?', var: 'ack' }, next: 'fc_blk' },
      m_loopdone: { id: 'm_loopdone', type: 'message', params: { text: 'цикл завершён' }, next: 'rt_blk' },
      rt_blk: {
        id: 'rt_blk',
        type: 'random_text',
        params: { variants: [{ text: 'орёл' }, { text: 'решка' }], outVar: 'coin' },
        next: 'as_pass',
      },
      as_pass: {
        id: 'as_pass',
        type: 'assert',
        params: { conditions: [{ var: 'coin', op: 'not_empty' }], failMessage: 'assert-pass упал' },
        branches: { pass: 'as_fail', fail: 'as_fail' },
      },
      as_fail: {
        id: 'as_fail',
        type: 'assert',
        params: { conditions: [{ var: 'coin', op: '==', value: '__never__' }], failMessage: 'assert не пройден' },
        branches: { pass: 'cnt_blk', fail: 'cnt_blk' },
      },
      cnt_blk: {
        id: 'cnt_blk',
        type: 'counter',
        params: { counterName: 'hits', counterScope: 'user', counterOp: 'inc', amount: 1, outVar: 'hitsVal' },
        next: 'm_end',
      },
      m_end: { id: 'm_end', type: 'message', params: { text: 'Финиш: {{hitsVal}}' } },
    },
  };
}

describe('simulate: один сценарий со всеми новыми блоками', () => {
  it('логирует каждый новый блок по правильной последовательности вводов', async () => {
    const { env } = makeEnv('sim-bot-1');
    const inputs = [
      '/start', // → ждём имя (pending input)
      '<i>Иван</i>', // → message(parseMode HTML), setvar, poll (pending poll)
      'poll:0', // → forward, chat_action, wait (pending wait)
      'готово', // → channel_check (member по умолчанию), buttons (pending choice)
      'notmember:', // служебный переключатель заглушки
      'callback:go', // → channel_check#2 (не подписан), broadcast, stats, payment_link, payment_check(paid), buttons
      'pending:', // служебный переключатель статуса оплаты
      'callback:again', // → payment_check#2 (pending), input списка
      'a,b,c', // → foreach итерация 1
      'дальше', // → итерация 2
      'дальше', // → итерация 3
      'дальше', // → done → random_text → assert pass → assert fail → counter → финиш
    ];
    const r = await simulate(env, 'sim-bot-1', megaScenario(), inputs);
    const lines = texts(r);

    // parseMode HTML: переменная интерполируется и экранируется
    expect(lines).toContain('&lt;b&gt;&lt;i&gt;Иван&lt;/i&gt;&lt;/b&gt; &amp; привет');

    // poll
    expect(lines).toContain('[опрос] Любишь тесты? (2 вариантов)');
    expect(lines).toContain('📊 ответ на опрос: 0');
    expect(r.vars['poll.answer']).toBe('Да');

    // forward / chat_action
    expect(lines).toContain('[переслано в -100123]');
    expect(lines).toContain('[печатает…]');

    // wait
    expect(lines).toContain('Напиши что-нибудь');
    expect(lines).toContain('[ждём ответ 15с]');

    // channel_check: есть → нет после переключателя notmember:
    expect(lines).toContain('[подписка на канал: есть]');
    expect(lines).toContain('[прогон: подписка на канал — нет]');
    expect(lines).toContain('[подписка на канал: нет]');
    expect(lines).toContain('ты в канале');

    // segment_broadcast: сегмент с тегом → сим-аудитория режется до 10
    expect(lines).toContain('[рассылка по сегменту: 10 получателей]');
    expect(r.vars['__broadcast_count']).toBe(10);

    // user_stats: профиль из заглушки
    expect(lines).toContain('Профиль: Тест Тестов, оплатил: 150000');

    // payment_link / payment_check: paid по умолчанию, pending после переключателя
    expect(lines).toContain('[счёт-ссылка: 1500.00 RUB]');
    expect(r.vars['pay.order']).toBe('sim-1');
    expect(r.vars['pay.link']).toBe('https://pay.example/sim-1');
    expect(lines).toContain('[оплата: paid]');
    expect(lines).toContain('оплачено!');
    expect(lines).toContain('[прогон: статус оплаты — pending]');
    expect(lines).toContain('[оплата: pending]');
    expect(lines).toContain('ждём оплаты');

    // foreach: по итерации на ввод, прогресс [цикл: i/N]
    expect(lines).toContain('Элемент a — продолжим?');
    expect(lines).toContain('[цикл: 1/3]');
    expect(lines).toContain('[цикл: 2/3]');
    expect(lines).toContain('[цикл: 3/3]');
    expect(lines).toContain('цикл завершён');

    // random_text: один из вариантов отправлен и лежит в переменной
    expect(['орёл', 'решка']).toContain(r.vars['coin']);
    expect(lines).toContain(String(r.vars['coin']));

    // assert: pass молча идёт дальше, fail шлёт failMessage
    expect(lines).not.toContain('assert-pass упал');
    expect(lines).toContain('assert не пройден');

    // counter
    expect(lines).toContain('[счётчик hits: 1]');
    expect(r.vars['hitsVal']).toBe(1);
    expect(lines).toContain('Финиш: 1');

    // сценарий дошёл до конца — ожидания нет
    expect(r.pending).toBeNull();
  });

  it('остановка на poll даёт pending kind=poll с кнопками poll:N', async () => {
    const { env } = makeEnv('sim-bot-1');
    const r = await simulate(env, 'sim-bot-1', megaScenario(), ['/start', 'Иван']);
    expect(r.pending?.kind).toBe('poll');
    expect(r.pending?.buttons).toEqual([
      { label: 'Да', value: 'poll:0' },
      { label: 'Нет', value: 'poll:1' },
    ]);
  });

  it('остановка на wait даёт pending kind=wait с авторским промптом', async () => {
    const { env } = makeEnv('sim-bot-1');
    const r = await simulate(env, 'sim-bot-1', megaScenario(), ['/start', 'Иван', 'poll:0']);
    expect(r.pending?.kind).toBe('wait');
    expect(r.pending?.prompt).toBe('Напиши что-нибудь');
  });

  it('остановка на input даёт pending kind=input', async () => {
    const { env } = makeEnv('sim-bot-1');
    const r = await simulate(env, 'sim-bot-1', megaScenario(), ['/start']);
    expect(r.pending?.kind).toBe('input');
    expect(r.pending?.prompt).toBe('Имя?');
  });
});

describe('simulate: переключатели заглушек', () => {
  const flipScenario = {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'cc' },
      cc: {
        id: 'cc',
        type: 'channel_check',
        params: { channelId: '@chan', cacheMinutes: 0 },
        branches: { member: 'yes', not_member: 'no', error: 'no' },
      },
      yes: { id: 'yes', type: 'message', params: { text: 'в канале' } },
      no: { id: 'no', type: 'message', params: { text: 'не в канале' } },
    },
  };

  it('member: / notmember: переключают ветку channel_check', async () => {
    const { env } = makeEnv('sim-bot-2');
    const def = await simulate(env, 'sim-bot-2', flipScenario, ['/start']);
    expect(texts(def)).toContain('в канале'); // заглушка по умолчанию: member=true

    const notMember = await simulate(env, 'sim-bot-2', flipScenario, ['notmember:', '/start']);
    expect(texts(notMember)).toContain('[подписка на канал: нет]');
    expect(texts(notMember)).toContain('не в канале');

    const backMember = await simulate(env, 'sim-bot-2', flipScenario, ['notmember:', 'member:', '/start']);
    expect(texts(backMember)).toContain('в канале');
  });

  const payScenario = {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'pl' },
      pl: {
        id: 'pl',
        type: 'payment_link',
        params: { connectionId: 'c1', amount: 100, currency: 'RUB' },
        branches: { created: 'pc', failed: 'fin' },
      },
      pc: {
        id: 'pc',
        type: 'payment_check',
        params: { connectionId: 'c1', orderIdVar: 'pay.order' },
        branches: { paid: 'paid_txt', pending: 'pend_txt', failed: 'fail_txt' },
      },
      paid_txt: { id: 'paid_txt', type: 'message', params: { text: 'paid_ok' }, next: 'fin' },
      pend_txt: { id: 'pend_txt', type: 'message', params: { text: 'pending_ok' }, next: 'fin' },
      fail_txt: { id: 'fail_txt', type: 'message', params: { text: 'failed_ok' }, next: 'fin' },
      fin: { id: 'fin', type: 'end' },
    },
  };

  it('paid: / pending: / failed: переключают ветку payment_check', async () => {
    const { env } = makeEnv('sim-bot-3');
    const paid = await simulate(env, 'sim-bot-3', payScenario, ['paid:', '/start']);
    expect(texts(paid)).toContain('[оплата: paid]');
    expect(texts(paid)).toContain('paid_ok');

    const pending = await simulate(env, 'sim-bot-3', payScenario, ['pending:', '/start']);
    expect(texts(pending)).toContain('[оплата: pending]');
    expect(texts(pending)).toContain('pending_ok');

    const failed = await simulate(env, 'sim-bot-3', payScenario, ['failed:', '/start']);
    expect(texts(failed)).toContain('[оплата: failed]');
    expect(texts(failed)).toContain('failed_ok');
  });
});

describe('simulate: foreach на 500 элементов', () => {
  const loopScenario = {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'in_list' },
      in_list: { id: 'in_list', type: 'input', params: { prompt: 'Список', var: 'items' }, next: 'fc' },
      // maxIterations не задан → дефолт 100 (HARD_LOOP_CAP движка — 500)
      fc: { id: 'fc', type: 'foreach', params: { listVar: 'items', itemVar: 'item', indexVar: 'i' }, branches: { each: 'msg', done: 'fin' } },
      msg: { id: 'msg', type: 'message', params: { text: 'итерация {{i}}' }, next: 'fc' },
      fin: { id: 'fin', type: 'message', params: { text: 'конец списка' } },
    },
  };

  it('проходит все итерации maxIterations за один проход и доходит до ветки done (§1/§2)', async () => {
    const { env } = makeEnv('sim-bot-4');
    const items = Array.from({ length: 500 }, (_, i) => `x${i}`).join(',');
    const t0 = Date.now();
    const r = await simulate(env, 'sim-bot-4', loopScenario, ['/start', items]);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(5000); // прогон возвращается, а не висит
    const lines = texts(r);
    const iterations = lines.filter((l) => l.startsWith('итерация '));
    // maxIterations не задан → дефолт 100. Бюджет шагов теперь 1000
    // (MAX_ENGINE_STEPS), а тело цикла — 2 блока (msg → fc), т.е. итерация
    // стоит ~3 шага. 100 итераций ~ 300 шагов проходят в ОДИН проход, и цикл
    // завершается по своей границе maxIterations, а не срезается guard'ом.
    expect(iterations.length).toBe(100);
    expect(lines).toContain('[цикл: 100/500]');
    expect(lines).not.toContain('[цикл: 500/500]'); // maxIterations 100 < 500 элементов
    // Дошли до ветки done — раньше её не было из-за guard'а на 200 шагов.
    expect(lines).toContain('конец списка');
    // Цикл завершён → состояние __loop.<id> удалено (done-ветка его стирает).
    expect(r.vars['__loop.fc']).toBeUndefined();
  });
});

describe('simulate: префиксы вложений', () => {
  const attachScenario = {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'in_doc' },
      in_doc: { id: 'in_doc', type: 'input', params: { prompt: 'Пришлите документ', kind: 'document', var: 'doc' }, next: 'in_vid' },
      in_vid: { id: 'in_vid', type: 'input', params: { prompt: 'Пришлите видео', kind: 'video', var: 'vid' }, next: 'in_voi' },
      in_voi: { id: 'in_voi', type: 'input', params: { prompt: 'Голосовое', kind: 'voice', var: 'voi' }, next: 'in_aud' },
      in_aud: { id: 'in_aud', type: 'input', params: { prompt: 'Аудио', kind: 'audio', var: 'aud' }, next: 'in_any' },
      in_any: { id: 'in_any', type: 'input', params: { prompt: 'Что угодно', kind: 'any', var: 'att' }, next: 'fin' },
      fin: { id: 'fin', type: 'message', params: { text: 'всё принято' } },
    },
  };

  it('document:/video:/voice:/audio:/any: кладут sim file_id в переменные ввода', async () => {
    const { env } = makeEnv('sim-bot-5');
    const r = await simulate(env, 'sim-bot-5', attachScenario, [
      '/start',
      'document:whatever',
      'video:whatever',
      'voice:whatever',
      'audio:whatever',
      'any:whatever',
    ]);
    const lines = texts(r);
    expect(lines).toContain('📎 document отправлен');
    expect(lines).toContain('📎 video отправлен');
    expect(lines).toContain('📎 voice отправлен');
    expect(lines).toContain('📎 audio отправлен');
    expect(lines).toContain('📎 any отправлен');
    expect(lines).toContain('всё принято');

    expect(r.vars['doc']).toBe('sim-file');
    expect(r.vars['doc_file_name']).toBe('файл.pdf');
    expect(r.vars['doc_mime_type']).toBe('application/pdf');
    expect(r.vars['vid']).toBe('sim-video');
    expect(r.vars['voi']).toBe('sim-voice');
    expect(r.vars['aud']).toBe('sim-audio');
    expect(r.vars['att']).toBe('sim-sticker'); // any: → sim-стикер, значение — его file_id
    expect(r.pending).toBeNull();
  });
});

describe('simulate: кнопки, меню и счёт — вводы, которые понимает превью', () => {
  // Инлайн-кнопка приходит callback_query (data=value), reply-кнопка и меню —
  // текстом подписи. Раньше превью получало сырой value и отправляло его
  // текстом: для inline-раскладки движок не находил ветку и прогон залипал.
  const buttonsScenario = (layout?: 'reply') => ({
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'btn' },
      btn: {
        id: 'btn',
        type: 'buttons',
        params: {
          prompt: 'Выбери:',
          ...(layout ? { layout } : {}),
          buttons: [
            { id: 'b1', label: 'Идём', value: 'go' },
            { id: 'b2', label: 'Стоп', value: 'stop' },
          ],
        },
        branches: { go: 'm_go', stop: 'm_stop' },
      },
      m_go: { id: 'm_go', type: 'message', params: { text: 'пошли' }, next: 'link_blk' },
      m_stop: { id: 'm_stop', type: 'message', params: { text: 'остановились' } },
      link_blk: {
        id: 'link_blk',
        type: 'buttons',
        params: { prompt: 'Ссылка:', buttons: [{ id: 'u1', label: 'Сайт', value: 'site', url: 'https://example.com' }] },
        branches: {},
      },
    },
  });

  it('inline-кнопки отдаются превью как callback:<value> и ведут по ветке', async () => {
    const { env } = makeEnv('sim-btn-1');
    const r = await simulate(env, 'sim-btn-1', buttonsScenario(), ['/start']);
    expect(r.pending?.kind).toBe('choice');
    expect(r.pending?.buttons).toEqual([
      { label: 'Идём', value: 'callback:go' },
      { label: 'Стоп', value: 'callback:stop' },
    ]);

    // Тот же ввод, который шлёт превью по клику, проводит поток до следующего блока.
    const after = await simulate(env, 'sim-btn-1', buttonsScenario(), ['/start', 'callback:go']);
    expect(texts(after)).toContain('пошли');
    // Дальше блок с одной кнопкой-ссылкой: апдейта от неё не приходит,
    // поэтому кнопок в прогоне нет — только заглушка pending.
    expect(after.pending?.buttons ?? []).toHaveLength(0);
  });

  it('reply-раскладка отдаёт подписи текстом, как их присылает Telegram', async () => {
    const { env } = makeEnv('sim-btn-2');
    const r = await simulate(env, 'sim-btn-2', buttonsScenario('reply'), ['/start']);
    expect(r.pending?.buttons).toEqual([
      { label: 'Идём', value: 'Идём' },
      { label: 'Стоп', value: 'Стоп' },
    ]);
    const after = await simulate(env, 'sim-btn-2', buttonsScenario('reply'), ['/start', 'Стоп']);
    expect(texts(after)).toContain('остановились');
  });

  it('кнопка-ссылка не попадает в кнопки прогона: апдейта от неё не приходит', async () => {
    const { env } = makeEnv('sim-btn-3');
    const r = await simulate(env, 'sim-btn-3', buttonsScenario(), ['/start', 'callback:go']);
    // Блок с одной ссылкой всё равно ждёт: сценарий не «завершён», а именно ждёт.
    expect(r.pending?.kind).toBe('choice');
    expect(r.pending?.buttons ?? []).toHaveLength(0);
  });

  it('в reply-раскладке кнопка со ссылкой остаётся: там приходит текст подписи', async () => {
    const { env } = makeEnv('sim-btn-4');
    const scenario = {
      version: 1,
      start: 's',
      blocks: {
        s: { id: 's', type: 'start', params: {}, next: 'btn' },
        btn: {
          id: 'btn',
          type: 'buttons',
          params: {
            prompt: 'Выбери:',
            layout: 'reply',
            buttons: [{ id: 'u1', label: 'Сайт', value: 'site', url: 'https://example.com' }],
          },
          branches: { site: 'm_site' },
        },
        m_site: { id: 'm_site', type: 'message', params: { text: 'по ссылке' } },
      },
    };
    const r = await simulate(env, 'sim-btn-4', scenario, ['/start']);
    expect(r.pending?.buttons).toEqual([{ label: 'Сайт', value: 'Сайт' }]);
    const after = await simulate(env, 'sim-btn-4', scenario, ['/start', 'Сайт']);
    expect(texts(after)).toContain('по ссылке');
  });

  const menuScenario = {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'menu' },
      menu: {
        id: 'menu',
        type: 'menu',
        params: { menuPrompt: 'Меню:', buttons: [{ id: 'm1', label: 'Каталог', value: 'cat' }] },
        branches: { cat: 'm_ok' },
        next: 'msg',
      },
      msg: { id: 'msg', type: 'message', params: { text: 'ждём выбор' }, next: 'btn' },
      btn: { id: 'btn', type: 'buttons', params: { prompt: 'ок?', buttons: [{ id: 'b1', label: 'ок', value: 'ok' }] }, branches: { ok: 'm_ok' } },
      m_ok: { id: 'm_ok', type: 'message', params: { text: 'выбрано ок' } },
    },
  };

  it('блок «Меню»: __menu выживает в прогоне, нажатие текстом ведёт по ветке меню', async () => {
    const { env } = makeEnv('sim-menu-1');
    const started = await simulate(env, 'sim-menu-1', menuScenario, ['/start']);
    // Меню — постоянная клавиатура: движок идёт дальше по next, __menu остаётся.
    expect(String(started.vars['__menu'] ?? '')).toContain('Каталог');
    // Нажатие приходит текстом подписи — тем же вводом, что шлёт превью.
    const picked = await simulate(env, 'sim-menu-1', menuScenario, ['/start', 'Каталог']);
    expect(texts(picked)).toContain('выбрано ок');
  });

  const invoiceScenario = {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: {}, next: 'inv' },
      inv: {
        id: 'inv',
        type: 'invoice',
        params: {
          invoice: { title: 'Товар', description: 'Тест', amount: '500', currency: 'RUB', label: 'Товар', payload: 'p1', providerToken: 'sim-token' },
        },
        branches: { paid: 'm_paid', cancelled: 'm_cancel' },
      },
      m_paid: { id: 'm_paid', type: 'message', params: { text: 'оплата принята' } },
      m_cancel: { id: 'm_cancel', type: 'message', params: { text: 'счёт отменён' } },
    },
  };

  it('счёт: pay:ok приходит successful_payment и ведёт по ветке paid', async () => {
    const { env } = makeEnv('sim-inv-1');
    const waiting = await simulate(env, 'sim-inv-1', invoiceScenario, ['/start']);
    expect(waiting.pending?.kind).toBe('choice');
    expect(waiting.pending?.buttons).toEqual([{ label: 'оплачено', value: 'pay:ok' }]);

    const paid = await simulate(env, 'sim-inv-1', invoiceScenario, ['/start', 'pay:ok']);
    expect(texts(paid)).toContain('💳 оплата прошла');
    expect(texts(paid)).toContain('оплата принята');
    expect(paid.vars['payment']).toBeTruthy();
  });
});

describe('simulate: админ-доступ только по x-admin-key', () => {
  it('анонимный POST simulate без заголовка x-admin-key → 401 (dev fail-open убран)', async () => {
    const { env } = makeEnv('sim-bot-1');
    const req = new Request('https://bots.example/api/bots/sim-bot-1/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        flow_json: JSON.stringify({
          version: 1,
          start: 's',
          blocks: {
            s: { id: 's', type: 'start', params: {}, next: 'm' },
            m: { id: 'm', type: 'message', params: { text: 'привет' } },
          },
        }),
        inputs: ['/start'],
      }),
    });
    const res = await (worker as any).fetch(req, env, {});
    expect(res.status).toBe(401);
  });
});
