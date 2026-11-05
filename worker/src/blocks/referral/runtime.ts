// Referral system runtime: storage-facing operations + pure decision helpers.
//
// The engine stays pure: everything that touches D1 is declared here as
// ReferralOps and injected by the worker (makeReferralOps) or simulated in
// preview (makeMemReferralOps) — the same pattern as DataOps / TagOps.
//
// Attribution lives in `referrals` (migration 0004, extended by 0017):
// inviter_user_id = referrer, invited_user_id = referee, unique per referee.
import {
  Block,
  BlockParams,
  ReferralPeriod,
  Scenario,
} from '../../../../shared/types';

// ---------------------------------------------------------------- storage ops

export interface ReferredUser {
  userId: string;
  createdAt: number;
  verified: boolean;
}

export interface LeaderboardRow {
  userId: string;
  score: number;
}

// Турнир, объявленный блоком referral_tournament: id детерминирован из имени,
// поэтому повторные запуски блока не плодят турниры.
export interface TournamentMeta {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
  metric: 'count' | 'revenue';
  configJson: string;
}

// Resolved antifraud limits (block params merged over defaults).
export interface AntifraudSettings {
  onePerUser: boolean;
  blockSelfReferral: boolean;
  cooldownSec: number;
  minAgeDays: number;
}

export const DEFAULT_ANTIFRAUD: AntifraudSettings = {
  onePerUser: true,
  blockSelfReferral: true,
  cooldownSec: 0,
  minAgeDays: 0,
};

export interface ReferralOps {
  /** Persist attribution. Returns false when the referee was already tracked. */
  track(referrerId: string, refereeId: string, source: string): Promise<boolean>;
  /** Known referrer of a user, or null. */
  referrerOf(userId: string): Promise<string | null>;
  /** Ancestor chain: [direct referrer, their referrer, ...], max `depth`. */
  referrerChain(userId: string, depth: number): Promise<string[]>;
  /** How many users this referrer invited (optionally verified only). */
  countReferrals(referrerId: string, verifiedOnly?: boolean): Promise<number>;
  /** Latest referred users for the stats message. */
  listReferred(referrerId: string, limit: number): Promise<ReferredUser[]>;
  /** Sum of granted bonus amounts + attributed revenue, minor units. */
  earningsOf(referrerId: string): Promise<number>;
  /**
   * Antifraud gate for one grant. Returns null when allowed, otherwise the
   * reason code ('already_granted' | 'cooldown' | 'too_young').
   */
  bonusAllowed(referrerId: string, refereeId: string, af: AntifraudSettings, now: number): Promise<string | null>;
  /** Record a granted bonus (idempotency source for one_per_user). */
  grantBonus(referrerId: string, refereeId: string, kind: string, amount: number, level: number, now: number): Promise<void>;
  /** Add `amount` to `varName` in the referrer's saved session vars. */
  incrementVariable(referrerId: string, varName: string, amount: number): Promise<void>;
  /**
   * Add the referrer to the bot's subscriber list for `days` days.
   * TODO(question): the subscribers table is boolean (no expiry column), so
   * auto-unsubscribe after N days is not enforced — confirm whether an expiry
   * column + cron is acceptable before promising timed grants to bot authors.
   */
  grantSubscriptionDays(referrerId: string, days: number): Promise<void>;
  /** Verification gates. */
  isSubscribed(userId: string): Promise<boolean>;
  paidTotal(userId: string): Promise<number>;
  markVerified(refereeId: string): Promise<void>;
  /** Record a successful payment (also updates tournament revenue scores). */
  recordPayment(userId: string, amount: number, currency: string, now: number): Promise<void>;
  /** Top referrers for the given metric/period. */
  leaderboard(metric: 'count' | 'revenue', from: number | null, to: number | null, limit: number): Promise<LeaderboardRow[]>;
  /** Tournament membership: ensure the tournament row, join (idempotent). True on first join. */
  joinTournament(meta: TournamentMeta, userId: string, now: number): Promise<boolean>;
  /** Current metric score of one participant inside the window. */
  tournamentScore(tournamentId: string, userId: string, metric: 'count' | 'revenue', from: number, to: number): Promise<number>;
  /** Participants with scores, best first. */
  tournamentStandings(tournamentId: string, metric: 'count' | 'revenue', from: number, to: number, limit: number): Promise<LeaderboardRow[]>;
}

// ------------------------------------------------------------- pure helpers

// Ан티фрод-настройки бота: первый (и по смыслу единственный) блок antifraud
// в сценарии. Блоки бонусов читают их в момент выдачи, поэтому antifraud
// не обязан стоять в потоке ДО бонуса — он декларация лимитов, а не шаг.
export function findAntifraudSettings(sc: Scenario): AntifraudSettings {
  const block = Object.values(sc?.blocks ?? {}).find((b) => b.type === 'antifraud' && !b.params?.disabled);
  if (!block) return { ...DEFAULT_ANTIFRAUD };
  const p = block.params;
  return {
    onePerUser: p.refOnePerUser !== false,
    blockSelfReferral: p.refBlockSelf !== false,
    cooldownSec: Math.max(0, Number(p.refCooldownSec) || 0),
    minAgeDays: Math.max(0, Number(p.refMinAgeDays) || 0),
  };
}

// Окно периода для лидерборда: [from, to] в миллисекундах, null = без границы.
export function periodRange(period: ReferralPeriod, now: number, from?: string, to?: string): { from: number | null; to: number | null } {
  if (period === 'week') return { from: now - 7 * 24 * 3600 * 1000, to: now };
  if (period === 'month') return { from: now - 30 * 24 * 3600 * 1000, to: now };
  if (period === 'custom') {
    const f = Date.parse(from || '');
    const t = Date.parse(to || '');
    return { from: Number.isNaN(f) ? null : f, to: Number.isNaN(t) ? null : t };
  }
  return { from: null, to: null };
}

// Турнир идёт прямо сейчас: now внутри [starts_at, ends_at].
export function tournamentRunning(startsAt: number, endsAt: number, now: number): boolean {
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && now <= endsAt;
}

// «50/30/20» → [50, 30, 20]. Пустые и нечисловые части отбрасываются
// (Number('') === 0 — без фильтра «50//30» дало бы лишний ноль).
export function parsePrizeSplit(raw: string): number[] {
  return String(raw || '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
}

// Сумма долей иерархии ≤ 1 — иначе выплата больше события (накрутка из конфига).
export function hierarchySharesValid(shares: number[]): boolean {
  if (!shares.length) return false;
  if (shares.some((s) => !(Number(s) >= 0))) return false;
  return shares.reduce((a, b) => a + b, 0) <= 1.0001;
}

// Нормализация долей: отсекаем отрицательные и NaN, округляем до 4 знаков.
export function normalizeShares(shares: number[] | undefined, depth: number): number[] {
  const d = Math.max(1, Math.min(5, Math.floor(Number(depth) || 1)));
  const out: number[] = [];
  for (let i = 0; i < d; i++) {
    const raw = Number(shares?.[i] ?? 0);
    out.push(Number.isFinite(raw) && raw > 0 ? Math.round(raw * 10000) / 10000 : 0);
  }
  return out;
}

// Срабатывает ли триггер бонуса. `facts` — то, что движок уже знает о текущем
// пользователе (реферале) на момент выполнения блока.
export function bonusTriggerFires(
  p: BlockParams,
  facts: { referralCount: number; hasPayment: boolean; isSubscribed: boolean; eventName: string }
): boolean {
  const trigger = p.refTrigger || 'nth_referral';
  switch (trigger) {
    case 'nth_referral': {
      const n = Math.max(1, Math.floor(Number(p.refTriggerN) || 1));
      // Ровно N: если автор поставил блок в сценарий, который может выполниться
      // позже, счётчик уже больше — бонус не выдаётся повторно.
      return facts.referralCount === n;
    }
    case 'first_payment':
      return facts.hasPayment;
    case 'subscription_started':
      return facts.isSubscribed;
    case 'custom_event': {
      const want = String(p.refEventName || '').trim();
      return !!want && facts.eventName === want;
    }
    default:
      return false;
  }
}

// Формат строки лидерборда для сообщения бота: «1. 123456 — 7».
// Telegram не даёт имён участников без отдельного API-запроса на каждого,
// поэтому показываем id: автор бота знает своих пользователей.
export function formatLeaderboard(rows: LeaderboardRow[]): string {
  return rows.map((r, i) => `${i + 1}. ${r.userId} — ${r.score}`).join('\n');
}

// Идентификатор турнира, определённый блоком. Стабильный slug из имени нужен,
// чтобы повторные запуски блока не плодили турниры; bot_id хранится отдельной
// колонкой, поэтому в сам id он не входит.
export function tournamentIdFor(name: string): string {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .slice(0, 48);
  return slug || 'tournament';
}

// Payload для ?start=ref_<id>_<payload>: Telegram принимает только
// [A-Za-z0-9_-] и ограничивает весь параметр 64 символами, из которых
// ref_<id> съедает до ~26. Подчёркивание в payload нельзя: разбор берёт id
// до первого «_», поэтому заменяем его на дефис и всё лишнее вычищаем.
export function sanitizeRefPayload(raw: string): string {
  return String(raw || '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/_/g, '-')
    .slice(0, 32);
}

// Источник перехода: payload из ?start=ref_<id>_<payload>, либо 'link'.
export function referralSourceOf(startParam: string | null | undefined): string {
  if (!startParam) return 'link';
  const rest = startParam.startsWith('ref_') ? startParam.slice(4) : '';
  const cut = rest.indexOf('_');
  const payload = cut >= 0 ? rest.slice(cut + 1) : '';
  return payload ? payload.slice(0, 64) : 'link';
}

// Разбор ref_<id>[_<payload>]: кто пригласил и откуда пришёл пользователь.
export function parseRefStartParam(startParam: string | null | undefined): { referrerId: string | null; source: string } {
  if (!startParam || !startParam.startsWith('ref_')) return { referrerId: null, source: 'link' };
  const rest = startParam.slice(4);
  const cut = rest.indexOf('_');
  const referrerId = (cut >= 0 ? rest.slice(0, cut) : rest).slice(0, 32);
  return { referrerId: referrerId || null, source: referralSourceOf(startParam) };
}

// Список типов реферальных блоков — используется движком и тестами.
export const isReferralRuntimeBlock = (b: Block): boolean =>
  typeof b?.type === 'string' && b.type.startsWith('referral_');
