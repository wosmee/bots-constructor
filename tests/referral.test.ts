// Реферальная система: runtime блоков в движке + валидатор конфигов.
// Движок чистый — хранилище подменяется in-memory ReferralOps (тот же,
// что использует прогон в редакторе), D1 и сеть не нужны.
import { describe, it, expect } from 'vitest';
import { runEngine, type SessionState } from '../worker/src/engine';
import { makeMemReferralOps } from '../worker/src/blocks/referral/db';
import {
  findAntifraudSettings,
  parsePrizeSplit,
  periodRange,
  parseRefStartParam,
  sanitizeRefPayload,
  tournamentIdFor,
  tournamentRunning,
  bonusTriggerFires,
  normalizeShares,
  hierarchySharesValid,
  formatLeaderboard,
} from '../worker/src/blocks/referral/runtime';
import { validateScenario, countIssues } from '../shared/validate';
import { scenarioHasReferral } from '../shared/graph';
import type { Scenario } from '../shared/types';

const DAY = 24 * 3600 * 1000;

function scenarioOf(blocks: Scenario['blocks'], start = 's'): Scenario {
  return { version: 1, start, blocks };
}

const startMsg = (text: string, userId = 2) => ({
  message: { chat: { id: userId }, from: { id: userId }, text },
});

async function run(sc: Scenario, update: any, ops: ReturnType<typeof makeMemReferralOps>, session: SessionState = { currentBlock: null, vars: {} }) {
  return runEngine({ scenario: sc, update, session, botUsername: 'testbot', referral: ops });
}

const nop = () => ({ push: () => undefined }) as unknown as { who: 'bot' | 'user'; text: string }[];

describe('движок: referral (ссылка) с payload', () => {
  it('кладёт ссылку с меткой источника', async () => {
    const ops = makeMemReferralOps(nop());
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'r' },
      r: { id: 'r', type: 'referral', params: { refVar: 'ref.link', refPayload: 'vk-ads' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(sc, startMsg('/start'), ops);
    expect(res.vars['ref.link']).toBe('https://t.me/testbot?start=ref_2_vk-ads');
  });

  it('вычищает из payload символы, которые Telegram не примет', () => {
    expect(sanitizeRefPayload('привет мир!')).toBe('');
    expect(sanitizeRefPayload('my_payload')).toBe('my-payload');
    expect(sanitizeRefPayload('a'.repeat(100))).toHaveLength(32);
  });
});

describe('движок: referral_track', () => {
  const sc = scenarioOf({
    s: { id: 's', type: 'start', params: {}, next: 'tr' },
    tr: {
      id: 'tr',
      type: 'referral_track',
      params: {},
      branches: { ok: 'ok', already_tracked: 'again', self_referral_blocked: 'self' },
    },
    ok: { id: 'ok', type: 'message', params: { text: 'засчитан' } },
    again: { id: 'again', type: 'message', params: { text: 'уже засчитан' } },
    self: { id: 'self', type: 'message', params: { text: 'сам себя' } },
  });

  it('новый реферал идёт в ветку ok и выставляет ref.inviter', async () => {
    const ops = makeMemReferralOps(nop());
    const res = await run(sc, startMsg('/start ref_777'), ops);
    expect(res.outs.some((o) => o.payload.text === 'засчитан')).toBe(true);
    expect(res.vars['ref.inviter']).toBe('777');
  });

  it('повторный вход по чужой связи — ветка already_tracked', async () => {
    const ops = makeMemReferralOps(nop());
    await run(sc, startMsg('/start ref_777'), ops);
    const second = await run(sc, startMsg('/start ref_888'), ops);
    expect(second.outs.some((o) => o.payload.text === 'уже засчитан')).toBe(true);
  });

  it('самоприглашение блокируется', async () => {
    const ops = makeMemReferralOps(nop());
    const res = await run(sc, startMsg('/start ref_2'), ops);
    expect(res.outs.some((o) => o.payload.text === 'сам себя')).toBe(true);
  });

  it('без start-параметра блок просто пропускается по next', async () => {
    const ops = makeMemReferralOps(nop());
    const sc2 = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'tr' },
      tr: { id: 'tr', type: 'referral_track', params: {}, branches: { ok: 'ok' }, next: 'm' },
      ok: { id: 'ok', type: 'message', params: { text: 'засчитан' } },
      m: { id: 'm', type: 'message', params: { text: 'обычное начало' } },
    });
    const res = await run(sc2, startMsg('/start'), ops);
    expect(res.outs.some((o) => o.payload.text === 'обычное начало')).toBe(true);
  });
});

describe('движок: referral_check', () => {
  const sc = scenarioOf({
    s: { id: 's', type: 'start', params: {}, next: 'c' },
    c: { id: 'c', type: 'referral_check', params: {}, branches: { yes: 'y', no: 'n' } },
    y: { id: 'y', type: 'message', params: { text: 'по ссылке' } },
    n: { id: 'n', type: 'message', params: { text: 'органика' } },
  });

  it('без пригласившего — ветка «нет»', async () => {
    const ops = makeMemReferralOps(nop());
    const res = await run(sc, startMsg('/start'), ops);
    expect(res.outs.some((o) => o.payload.text === 'органика')).toBe(true);
  });

  it('с сохранённой связью — ветка «да» (даже без ref.inviter в vars)', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('777', '2', 'link');
    const res = await run(sc, startMsg('/start'), ops);
    expect(res.outs.some((o) => o.payload.text === 'по ссылке')).toBe(true);
  });
});

describe('движок: referral_bonus', () => {
  const bonusSc = (params: Record<string, unknown>, antifraud?: Record<string, unknown>) =>
    scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: { id: 'b', type: 'referral_bonus', params, branches: { granted: 'g', skipped: 'sk', failed: 'f' } },
      g: { id: 'g', type: 'message', params: { text: 'награда' } },
      sk: { id: 'sk', type: 'message', params: { text: 'мимо' } },
      f: { id: 'f', type: 'message', params: { text: 'сбой' } },
      ...(antifraud
        ? { af: { id: 'af', type: 'antifraud' as const, params: antifraud } }
        : {}),
    });

  it('N-й реферал: награда отправляется пригласившему', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('777', '2', 'link');
    const sc = bonusSc({ refTrigger: 'nth_referral', refTriggerN: 1, refBonusKind: 'send_message', refBonusText: 'Спасибо, {{ref.count}}!' });
    const res = await run(sc, startMsg('/start'), ops);
    // У пригласившего 777 ровно 1 реферал → триггер сработал → ветка granted,
    // а сообщение ушло в чат 777, а не текущему пользователю.
    expect(res.outs.some((o) => o.payload.text === 'награда')).toBe(true);
    expect(res.outs.some((o) => o.method === 'sendMessage' && String(o.payload.chat_id) === '777')).toBe(true);
  });

  it('триггер не сработал — ветка skipped', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('777', '2', 'link');
    const sc = bonusSc({ refTrigger: 'nth_referral', refTriggerN: 5, refBonusKind: 'send_message', refBonusText: 'x' });
    const res = await run(sc, startMsg('/start'), ops);
    expect(res.outs.some((o) => o.payload.text === 'мимо')).toBe(true);
  });

  it('one_per_user: второй бонус за того же реферала не выдаётся', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('777', '2', 'link');
    const sc = bonusSc(
      { refTrigger: 'nth_referral', refTriggerN: 1, refBonusKind: 'send_message', refBonusText: 'x' },
      { refOnePerUser: true }
    );
    await run(sc, startMsg('/start'), ops);
    const second = await run(sc, startMsg('/start'), ops);
    expect(second.outs.some((o) => o.payload.text === 'мимо')).toBe(true);
  });

  it('increment_variable прибавляет к переменной пригласившего без сообщения', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('777', '2', 'link');
    const sc = bonusSc({ refTrigger: 'nth_referral', refTriggerN: 1, refBonusKind: 'increment_variable', refBonusVar: 'score', refBonusAmount: 10 });
    const res = await run(sc, startMsg('/start'), ops);
    // Ветка granted пройдена, но пригласившему ушло только начисление, без текста.
    expect(res.outs.some((o) => o.payload.text === 'награда')).toBe(true);
    expect(res.outs.filter((o) => o.method === 'sendMessage' && String(o.payload.chat_id) === '777')).toHaveLength(0);
    expect(await ops.earningsOf('777')).toBe(10);
  });

  it('без хранилища блок не рвёт сценарий — идёт по next', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: { id: 'b', type: 'referral_bonus', params: { refTrigger: 'nth_referral', refTriggerN: 1 }, branches: { granted: 'g' }, next: 'm' },
      g: { id: 'g', type: 'message', params: { text: 'награда' } },
      m: { id: 'm', type: 'message', params: { text: 'дальше' } },
    });
    const res = await runEngine({ scenario: sc, update: startMsg('/start'), session: { currentBlock: null, vars: {} }, botUsername: 'testbot' });
    expect(res.outs.some((o) => o.payload.text === 'дальше')).toBe(true);
  });
});

describe('движок: referral_hierarchy', () => {
  const hierSc = (params: Record<string, unknown>) =>
    scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'h' },
      h: { id: 'h', type: 'referral_hierarchy', params, branches: { granted: 'g', skipped: 'sk', failed: 'f' } },
      g: { id: 'g', type: 'message', params: { text: 'выплачено' } },
      sk: { id: 'sk', type: 'message', params: { text: 'нечего делить' } },
      f: { id: 'f', type: 'message', params: { text: 'конфиг сломан' } },
    });

  it('платёж делится по цепочке: 10% прямому, 5% — его пригласившему', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('1', '2', 'link'); // пользователя 2 пригласил 1
    await ops.track('2', '3', 'link'); // пользователя 3 пригласил 2
    await ops.recordPayment('3', 100000, 'RUB', Date.now());
    const sc = hierSc({ refTrigger: 'first_payment', refDepth: 2, refShares: [0.1, 0.05], refBonusText: 'Начислено {{ref.share}}' });
    const res = await run(sc, startMsg('/start', 3), ops);
    expect(res.outs.some((o) => o.payload.text === 'выплачено')).toBe(true);
    // Уровень 1 (id=2) получает 10000, уровень 2 (id=1) — 5000.
    expect(await ops.earningsOf('2')).toBe(10000);
    expect(await ops.earningsOf('1')).toBe(5000);
    // Каждому уровню ушло сообщение с его суммой.
    expect(res.outs.some((o) => String(o.payload.chat_id) === '2' && String(o.payload.text) === 'Начислено 10000')).toBe(true);
    expect(res.outs.some((o) => String(o.payload.chat_id) === '1' && String(o.payload.text) === 'Начислено 5000')).toBe(true);
  });

  it('нет оплаты — нечего делить, ветка skipped', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('2', '3', 'link');
    const sc = hierSc({ refTrigger: 'first_payment', refDepth: 2, refShares: [0.1, 0.05] });
    const res = await run(sc, startMsg('/start', 3), ops);
    expect(res.outs.some((o) => o.payload.text === 'нечего делить')).toBe(true);
  });

  it('сумма долей > 1 — ветка failed (конфигурация накручивает выплаты)', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('2', '3', 'link');
    await ops.recordPayment('3', 100000, 'RUB', Date.now());
    const sc = hierSc({ refTrigger: 'first_payment', refDepth: 2, refShares: [0.9, 0.9] });
    const res = await run(sc, startMsg('/start', 3), ops);
    expect(res.outs.some((o) => o.payload.text === 'конфиг сломан')).toBe(true);
  });
});

describe('движок: referral_stats / leaderboard', () => {
  it('статистика подставляет счёт и заработок', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('7', '2', 'link');
    await ops.grantBonus('7', '2', 'increment_variable', 500, 1, Date.now());
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'st' },
      st: { id: 'st', type: 'referral_stats', params: { refText: 'Пригласил: {{ref.count}}. Заработал: {{ref.earnings}}.', refLimit: 5 }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(sc, startMsg('/start', 7), ops);
    expect(res.outs.some((o) => o.payload.text === 'Пригласил: 1. Заработал: 500.')).toBe(true);
    expect(res.vars['ref.referred']).toBe('2');
  });

  it('лидерборд кладёт готовый список в ref.leaderboard', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('7', '2', 'link');
    await ops.track('7', '3', 'link');
    await ops.track('8', '4', 'link');
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'lb' },
      lb: { id: 'lb', type: 'referral_leaderboard', params: { refText: 'Топ:\n{{ref.leaderboard}}', refSort: 'count', refPeriod: 'all_time', refLimit: 10 }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(sc, startMsg('/start'), ops);
    const lb = String(res.vars['ref.leaderboard']);
    expect(lb.startsWith('1. 7 — 2')).toBe(true);
    expect(lb).toContain('2. 8 — 1');
    expect(res.outs.some((o) => String(o.payload.text).includes('1. 7 — 2'))).toBe(true);
  });
});

describe('движок: referral_tournament', () => {
  const tourSc = (params: Record<string, unknown>) =>
    scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 't' },
      t: { id: 't', type: 'referral_tournament', params, branches: { joined: 'j', already_in: 'a', tournament_not_running: 'n' } },
      j: { id: 'j', type: 'message', params: { text: 'в игре' } },
      a: { id: 'a', type: 'message', params: { text: 'уже в игре' } },
      n: { id: 'n', type: 'message', params: { text: 'не идёт' } },
    });

  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('в окне турнира первый вход — joined, повторный — already_in', async () => {
    const ops = makeMemReferralOps(nop());
    const sc = tourSc({
      refTournamentName: 'Осенний кубок',
      refStartsAt: iso(new Date(now.getTime() - DAY)),
      refEndsAt: iso(new Date(now.getTime() + DAY)),
      refMetric: 'count',
    });
    const first = await run(sc, startMsg('/start'), ops);
    expect(first.outs.some((o) => o.payload.text === 'в игре')).toBe(true);
    const second = await run(sc, startMsg('/start'), ops);
    expect(second.outs.some((o) => o.payload.text === 'уже в игре')).toBe(true);
  });

  it('вне окна — tournament_not_running', async () => {
    const ops = makeMemReferralOps(nop());
    const sc = tourSc({
      refTournamentName: 'Прошлый',
      refStartsAt: iso(new Date(now.getTime() - 10 * DAY)),
      refEndsAt: iso(new Date(now.getTime() - 5 * DAY)),
      refMetric: 'count',
    });
    const res = await run(sc, startMsg('/start'), ops);
    expect(res.outs.some((o) => o.payload.text === 'не идёт')).toBe(true);
  });
});

describe('движок: referral_verification', () => {
  const verSc = (params: Record<string, unknown>) =>
    scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'v' },
      v: { id: 'v', type: 'referral_verification', params, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'verified={{ref.verified}}' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });

  it('gate paid_once: после оплаты реферал подтверждён и отмечен в базе', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.track('7', '2', 'link');
    await ops.recordPayment('2', 1000, 'RUB', Date.now());
    const res = await run(verSc({ refGate: 'paid_once' }), startMsg('/start', 2), ops);
    expect(res.outs.some((o) => o.payload.text === 'verified=1')).toBe(true);
    const referred = await ops.listReferred('7', 5);
    expect(referred[0].verified).toBe(true);
  });

  it('gate paid_min_amount: оплата ниже порога не подтверждает', async () => {
    const ops = makeMemReferralOps(nop());
    await ops.recordPayment('2', 5000, 'RUB', Date.now());
    const res = await run(verSc({ refGate: 'paid_min_amount', refMinAmount: 10000 }), startMsg('/start', 2), ops);
    expect(res.outs.some((o) => o.payload.text === 'verified=0')).toBe(true);
  });

  it('gate custom_goal: читает булеву переменную сценария', async () => {
    // /start стирает все переменные, кроме ref.* — цель выставляется блоком
    // setvar внутри самого сценария, как это и бывает в реальных ботах.
    const ops = makeMemReferralOps(nop());
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'sv' },
      sv: { id: 'sv', type: 'setvar', params: { assignVar: 'goal_done', expr: '1' }, next: 'v' },
      v: { id: 'v', type: 'referral_verification', params: { refGate: 'custom_goal', refGoalVar: 'goal_done' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'verified={{ref.verified}}' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(sc, startMsg('/start', 2), ops);
    expect(res.outs.some((o) => o.payload.text === 'verified=1')).toBe(true);
  });

  it('gate subscribed: без подписки не подтверждает', async () => {
    const ops = makeMemReferralOps(nop());
    const res = await run(verSc({ refGate: 'subscribed' }), startMsg('/start', 2), ops);
    expect(res.outs.some((o) => o.payload.text === 'verified=0')).toBe(true);
  });
});

describe('движок: antifraud', () => {
  it('прозрачен для потока: просто идёт по next', async () => {
    const ops = makeMemReferralOps(nop());
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'af' },
      af: { id: 'af', type: 'antifraud', params: { refOnePerUser: true, refBlockSelf: true, refCooldownSec: 60, refMinAgeDays: 1 }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'поток цел' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(sc, startMsg('/start'), ops);
    expect(res.outs.some((o) => o.payload.text === 'поток цел')).toBe(true);
  });

  it('настройки читаются из блока сценария', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'af' },
      af: { id: 'af', type: 'antifraud', params: { refOnePerUser: false, refCooldownSec: 120, refMinAgeDays: 3 }, next: '' },
    });
    const af = findAntifraudSettings(sc);
    expect(af.onePerUser).toBe(false);
    expect(af.cooldownSec).toBe(120);
    expect(af.minAgeDays).toBe(3);
    // Без блока — дефолты.
    expect(findAntifraudSettings(scenarioOf({ s: { id: 's', type: 'start', params: {} } }))).toEqual({
      onePerUser: true,
      blockSelfReferral: true,
      cooldownSec: 0,
      minAgeDays: 0,
    });
  });
});

describe('чистые хелперы реферального рантайма', () => {
  it('parseRefStartParam разбирает id и payload', () => {
    expect(parseRefStartParam('ref_123')).toEqual({ referrerId: '123', source: 'link' });
    expect(parseRefStartParam('ref_123_vk-ads')).toEqual({ referrerId: '123', source: 'vk-ads' });
    expect(parseRefStartParam('other')).toEqual({ referrerId: null, source: 'link' });
    expect(parseRefStartParam(null)).toEqual({ referrerId: null, source: 'link' });
  });

  it('tournamentIdFor стабилен и безопасен для sql-ключа', () => {
    expect(tournamentIdFor('Осенний Кубок 2026')).toBe(tournamentIdFor(' осенний  кубок 2026 '));
    expect(tournamentIdFor('')).toBe('tournament');
  });

  it('tournamentRunning держит окно включительно', () => {
    expect(tournamentRunning(100, 200, 150)).toBe(true);
    expect(tournamentRunning(100, 200, 100)).toBe(true);
    expect(tournamentRunning(100, 200, 201)).toBe(false);
    expect(tournamentRunning(NaN, 200, 150)).toBe(false);
  });

  it('parsePrizeSplit и normalizeShares отбрасывают мусор', () => {
    expect(parsePrizeSplit('50/30/20')).toEqual([50, 30, 20]);
    expect(parsePrizeSplit('50//30')).toEqual([50, 30]);
    expect(normalizeShares([0.1, -1, NaN], 3)).toEqual([0.1, 0, 0]);
    expect(hierarchySharesValid([0.5, 0.5])).toBe(true);
    expect(hierarchySharesValid([0.9, 0.9])).toBe(false);
    expect(hierarchySharesValid([])).toBe(false);
  });

  it('periodRange считает окна недели/месяца и custom', () => {
    const now = Date.now();
    expect(periodRange('week', now).from).toBe(now - 7 * DAY);
    expect(periodRange('month', now).to).toBe(now);
    expect(periodRange('all_time', now)).toEqual({ from: null, to: null });
    expect(periodRange('custom', now, '2026-01-01', '2026-02-01')).toEqual({
      from: Date.parse('2026-01-01'),
      to: Date.parse('2026-02-01'),
    });
    expect(periodRange('custom', now, 'мусор', '')).toEqual({ from: null, to: null });
  });

  it('bonusTriggerFires: ровно N, первая оплата, подписка, своё событие', () => {
    const facts = { referralCount: 5, hasPayment: false, isSubscribed: false, eventName: 'level_up' };
    expect(bonusTriggerFires({ refTrigger: 'nth_referral', refTriggerN: 5 }, facts)).toBe(true);
    expect(bonusTriggerFires({ refTrigger: 'nth_referral', refTriggerN: 4 }, facts)).toBe(false);
    expect(bonusTriggerFires({ refTrigger: 'first_payment' }, facts)).toBe(false);
    expect(bonusTriggerFires({ refTrigger: 'first_payment' }, { ...facts, hasPayment: true })).toBe(true);
    expect(bonusTriggerFires({ refTrigger: 'subscription_started' }, { ...facts, isSubscribed: true })).toBe(true);
    expect(bonusTriggerFires({ refTrigger: 'custom_event', refEventName: 'level_up' }, facts)).toBe(true);
    expect(bonusTriggerFires({ refTrigger: 'custom_event', refEventName: 'other' }, facts)).toBe(false);
    expect(bonusTriggerFires({ refTrigger: 'custom_event' }, facts)).toBe(false);
  });

  it('formatLeaderboard нумерует с 1', () => {
    expect(formatLeaderboard([{ userId: '7', score: 3 }])).toBe('1. 7 — 3');
  });

  it('scenarioHasReferral видит все блоки семейства', () => {
    expect(scenarioHasReferral(scenarioOf({ s: { id: 's', type: 'start', params: {} } }))).toBe(false);
    expect(
      scenarioHasReferral(
        scenarioOf({
          s: { id: 's', type: 'start', params: {}, next: 'b' },
          b: { id: 'b', type: 'referral_bonus', params: {}, branches: {} },
        })
      )
    ).toBe(true);
    expect(
      scenarioHasReferral(
        scenarioOf({
          s: { id: 's', type: 'start', params: {}, next: 'a' },
          a: { id: 'a', type: 'antifraud', params: {} },
        })
      )
    ).toBe(true);
  });
});

describe('journey: полный реферальный цикл', () => {
  // Приглашённый кликает deep link → referral_track → делает оплату →
  // referral_verification проходит → многоуровневый бонус выплачивается
  // обоим уровням → referral_stats показывает обновлённые числа.
  it('deep link → track → payment → verification → двухуровневый бонус → stats', async () => {
    const ops = makeMemReferralOps(nop());
    const now = Date.now();

    // Цепочка: пользователя 2 пригласил 1; пользователя 3 пригласил 2.
    await ops.track('1', '2', 'link');

    // Шаг 1: пользователь 3 приходит по deep link ref_2.
    const trackSc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'tr' },
      tr: {
        id: 'tr',
        type: 'referral_track',
        params: {},
        branches: { ok: 'welcome', already_tracked: 'welcome', self_referral_blocked: 'welcome' },
      },
      welcome: { id: 'welcome', type: 'message', params: { text: 'Добро пожаловать!' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const tracked = await run(trackSc, startMsg('/start ref_2_campaign', 3), ops, { currentBlock: null, vars: {} });
    expect(tracked.outs.some((o) => o.payload.text === 'Добро пожаловать!')).toBe(true);
    expect(await ops.referrerOf('3')).toBe('2');

    // Шаг 2: пользователь 3 оплачивает счёт (в бою — successful_payment из
    // Telegram; воркер пишет его в referral_payments до запуска движка).
    await ops.recordPayment('3', 100000, 'RUB', now);

    // Шаг 3: verification по оплате проходит и отмечает реферала.
    const verifySc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'v' },
      v: { id: 'v', type: 'referral_verification', params: { refGate: 'paid_min_amount', refMinAmount: 50000 }, next: 'h' },
      h: {
        id: 'h',
        type: 'referral_hierarchy',
        params: { refTrigger: 'first_payment', refDepth: 2, refShares: [0.1, 0.05], refBonusText: 'Вам начислено {{ref.share}}' },
        branches: { granted: 'done', skipped: 'done', failed: 'done' },
      },
      done: { id: 'done', type: 'message', params: { text: 'Готово' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const verified = await run(verifySc, startMsg('/start', 3), ops);
    expect(verified.vars['ref.verified']).toBe(1);
    expect(verified.outs.some((o) => o.payload.text === 'Готово')).toBe(true);
    // Уровень 1 (id=2): 10% от 100000 = 10000; уровень 2 (id=1): 5% = 5000.
    expect(await ops.earningsOf('2')).toBe(10000);
    expect(await ops.earningsOf('1')).toBe(5000);
    const referred = await ops.listReferred('2', 5);
    expect(referred[0].verified).toBe(true);

    // Шаг 4: пригласивший (id=2) запрашивает свою статистику.
    const statsSc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'st' },
      st: {
        id: 'st',
        type: 'referral_stats',
        params: { refText: 'Приглашено: {{ref.count}}, заработано: {{ref.earnings}}', refLimit: 5 },
        next: 'e',
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    const stats = await run(statsSc, startMsg('/start', 2), ops);
    expect(stats.outs.some((o) => o.payload.text === 'Приглашено: 1, заработано: 10000')).toBe(true);
    expect(stats.vars['ref.referred']).toBe('3');
  });

  it('регрессия: обычный реферальный блок (ссылка) продолжает работать', async () => {
    const ops = makeMemReferralOps(nop());
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'r' },
      r: { id: 'r', type: 'referral', params: { refVar: 'ref.link' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'Твоя ссылка: {{ref.link}}' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const res = await run(sc, startMsg('/start'), ops);
    expect(res.vars['ref.link']).toBe('https://t.me/testbot?start=ref_2');
    expect(res.outs.some((o) => o.payload.text === 'Твоя ссылка: https://t.me/testbot?start=ref_2')).toBe(true);
  });
});

describe('валидатор: реферальные блоки', () => {
  const only = (sc: Scenario) => validateScenario(sc).map((i) => i.code);

  it('referral_track без веток — три ошибки', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'tr' },
      tr: { id: 'tr', type: 'referral_track', params: {} },
    });
    expect(only(sc)).toEqual(expect.arrayContaining(['reft-ok', 'reft-already', 'reft-self']));
  });

  it('полностью настроенный сценарий рефералки проходит без ошибок', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'tr' },
      tr: { id: 'tr', type: 'referral_track', params: {}, branches: { ok: 'b', already_tracked: 'm', self_referral_blocked: 'm' } },
      b: {
        id: 'b',
        type: 'referral_bonus',
        params: { refTrigger: 'nth_referral', refTriggerN: 5, refBonusKind: 'send_message', refBonusText: 'Спасибо!' },
        branches: { granted: 'm', skipped: 'm', failed: 'm' },
      },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
      af: { id: 'af', type: 'antifraud', params: { refOnePerUser: true, refBlockSelf: true, refCooldownSec: 0, refMinAgeDays: 0 } },
    });
    expect(countIssues(validateScenario(sc)).errors).toBe(0);
  });

  it('bonus: nth_referral без N и custom_event без имени — ошибки', () => {
    const branches = { granted: 'm', skipped: 'm', failed: 'm' };
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'b1' },
      b1: { id: 'b1', type: 'referral_bonus', params: { refTrigger: 'nth_referral' }, branches },
      b2: { id: 'b2', type: 'referral_bonus', params: { refTrigger: 'custom_event' }, branches },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(only(sc)).toEqual(expect.arrayContaining(['refb-n', 'refb-event']));
  });

  it('bonus: пустой текст награды и неотрицательные проверки', () => {
    const branches = { granted: 'm', skipped: 'm', failed: 'm' };
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'b1' },
      b1: { id: 'b1', type: 'referral_bonus', params: { refTrigger: 'first_payment', refBonusKind: 'send_message', refBonusText: ' ' }, branches },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(only(sc)).toContain('refb-text');
  });

  it('hierarchy: доли > 1 и глубина вне 1–5 — ошибки', () => {
    const branches = { granted: 'm', skipped: 'm', failed: 'm' };
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'h1' },
      h1: { id: 'h1', type: 'referral_hierarchy', params: { refTrigger: 'first_payment', refDepth: 2, refShares: [0.9, 0.9] }, branches },
      h2: { id: 'h2', type: 'referral_hierarchy', params: { refTrigger: 'first_payment', refDepth: 9, refShares: [0.1] }, branches },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(only(sc)).toEqual(expect.arrayContaining(['refh-sum', 'refh-depth']));
  });

  it('tournament: без дат и с перепутанным порядком — ошибки', () => {
    const branches = { joined: 'm', already_in: 'm', tournament_not_running: 'm' };
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 't1' },
      t1: { id: 't1', type: 'referral_tournament', params: { refTournamentName: 'Кубок' }, branches },
      t2: { id: 't2', type: 'referral_tournament', params: { refTournamentName: 'X', refStartsAt: '2026-05-01', refEndsAt: '2026-04-01' }, branches },
      t3: { id: 't3', type: 'referral_tournament', params: { refTournamentName: '', refStartsAt: '2026-04-01', refEndsAt: '2026-05-01' }, branches },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(only(sc)).toEqual(expect.arrayContaining(['reft-dates', 'reft-order', 'reft-name']));
  });

  it('verification: paid_min_amount без суммы, custom_goal без переменной', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'v1' },
      v1: { id: 'v1', type: 'referral_verification', params: { refGate: 'paid_min_amount' }, next: 'v2' },
      v2: { id: 'v2', type: 'referral_verification', params: { refGate: 'custom_goal' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(only(sc)).toEqual(expect.arrayContaining(['refv-amount', 'refv-goal']));
  });

  it('antifraud: отрицательные лимиты — ошибки', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'af' },
      af: { id: 'af', type: 'antifraud', params: { refCooldownSec: -5, refMinAgeDays: -1 }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(only(sc)).toEqual(expect.arrayContaining(['refa-cooldown', 'refa-age']));
  });

  it('referral: payload с запрещёнными символами — ошибка, длинный — предупреждение', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'r1' },
      r1: { id: 'r1', type: 'referral', params: { refPayload: 'привет!' }, next: 'r2' },
      r2: { id: 'r2', type: 'referral', params: { refPayload: 'a'.repeat(60) }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(only(sc)).toEqual(expect.arrayContaining(['ref-payload-chars', 'ref-payload-long']));
  });

  it('leaderboard: custom-период без границ — ошибка', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'lb' },
      lb: { id: 'lb', type: 'referral_leaderboard', params: { refPeriod: 'custom' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'ок' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(only(sc)).toContain('refl-period');
  });
});
