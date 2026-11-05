// ReferralOps backed by D1 (migrations 0004 + 0017).
//
// Attribution: `referrals` — inviter_user_id (referrer) / invited_user_id
// (referee), unique per (bot, referee). Bonuses: `referral_bonuses`.
// Payments: `referral_payments`. Tournaments: `referral_tournaments` +
// `referral_tournament_entries`.
import {
  type AntifraudSettings,
  type LeaderboardRow,
  type ReferralOps,
  type ReferredUser,
  type TournamentMeta,
} from './runtime';

// user_id везде TEXT: в referrals исторически строки, а в sessions/payments —
// числа Telegram. Приводим к строке на границе, сравнения в SQL — по строкам.
export function makeReferralOps(db: D1Database, botId: string): ReferralOps {
  return {
    async track(referrerId, refereeId, source) {
      const res = await db
        .prepare(
          'INSERT OR IGNORE INTO referrals (id, bot_id, inviter_user_id, invited_user_id, created_at, depth, source, verified) VALUES (?,?,?,?,?,1,?,0)'
        )
        .bind(crypto.randomUUID(), botId, referrerId, refereeId, Date.now(), source || 'link')
        .run();
      return ((res.meta.changes as number) ?? 0) > 0;
    },

    async referrerOf(userId) {
      const r = await db
        .prepare('SELECT inviter_user_id FROM referrals WHERE bot_id = ? AND invited_user_id = ?')
        .bind(botId, userId)
        .first<{ inviter_user_id: string }>();
      return r?.inviter_user_id ?? null;
    },

    async referrerChain(userId, depth) {
      const out: string[] = [];
      const seen = new Set<string>([userId]);
      let cur = userId;
      const max = Math.max(1, Math.min(5, Math.floor(depth)));
      for (let i = 0; i < max; i++) {
        // Уровень за уровень: запросов максимум 5 (лимит глубины), цикл
        // гарантированно конечен — `seen` не пускает по кольцу.
        const r = await db
          .prepare('SELECT inviter_user_id FROM referrals WHERE bot_id = ? AND invited_user_id = ?')
          .bind(botId, cur)
          .first<{ inviter_user_id: string }>();
        const up = r?.inviter_user_id;
        if (!up || seen.has(up)) break;
        seen.add(up);
        out.push(up);
        cur = up;
      }
      return out;
    },

    async countReferrals(referrerId, verifiedOnly = false) {
      const sql = verifiedOnly
        ? 'SELECT COUNT(*) AS c FROM referrals WHERE bot_id = ? AND inviter_user_id = ? AND verified = 1'
        : 'SELECT COUNT(*) AS c FROM referrals WHERE bot_id = ? AND inviter_user_id = ?';
      const r = await db.prepare(sql).bind(botId, referrerId).first<{ c: number }>();
      return Number(r?.c ?? 0);
    },

    async listReferred(referrerId, limit) {
      const n = Math.max(1, Math.min(50, Math.floor(limit)));
      const rows =
        (
          await db
            .prepare(
              'SELECT invited_user_id, created_at, verified FROM referrals WHERE bot_id = ? AND inviter_user_id = ? ORDER BY created_at DESC LIMIT ?'
            )
            .bind(botId, referrerId, n)
            .all<{ invited_user_id: string; created_at: number; verified: number }>()
        ).results ?? [];
      return rows.map<ReferredUser>((r) => ({
        userId: r.invited_user_id,
        createdAt: Number(r.created_at),
        verified: !!r.verified,
      }));
    },

    async earningsOf(referrerId) {
      const r = await db
        .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM referral_bonuses WHERE bot_id = ? AND referrer_id = ?')
        .bind(botId, referrerId)
        .first<{ s: number }>();
      return Number(r?.s ?? 0);
    },

    async bonusAllowed(referrerId, refereeId, af: AntifraudSettings, now) {
      if (af.onePerUser) {
        const dup = await db
          .prepare('SELECT COUNT(*) AS c FROM referral_bonuses WHERE bot_id = ? AND referrer_id = ? AND referee_id = ?')
          .bind(botId, referrerId, refereeId)
          .first<{ c: number }>();
        if (Number(dup?.c ?? 0) > 0) return 'already_granted';
      }
      if (af.cooldownSec > 0) {
        const last = await db
          .prepare('SELECT MAX(created_at) AS ts FROM referral_bonuses WHERE bot_id = ? AND referrer_id = ?')
          .bind(botId, referrerId)
          .first<{ ts: number | null }>();
        if (last?.ts != null && now - Number(last.ts) < af.cooldownSec * 1000) return 'cooldown';
      }
      if (af.minAgeDays > 0) {
        // Возраст аккаунта приглашённого — с момента, когда бот увидел его
        // впервые (sessions.first_seen, миграция 0009). Возраст самого
        // Telegram-аккаунта изнутри бота недоступен.
        const seen = await db
          .prepare('SELECT first_seen FROM sessions WHERE bot_id = ? AND user_id = ?')
          .bind(botId, Number(refereeId) || 0)
          .first<{ first_seen: number | null }>();
        const firstSeen = Number(seen?.first_seen ?? 0);
        if (firstSeen > 0 && now - firstSeen < af.minAgeDays * 86400 * 1000) return 'too_young';
      }
      return null;
    },

    async grantBonus(referrerId, refereeId, kind, amount, level, now) {
      await db
        .prepare(
          'INSERT INTO referral_bonuses (bot_id, referrer_id, referee_id, kind, amount, level, created_at) VALUES (?,?,?,?,?,?,?)'
        )
        .bind(botId, referrerId, refereeId, kind, Math.round(amount) || 0, Math.max(1, level || 1), now)
        .run();
    },

    async incrementVariable(referrerId, varName, amount) {
      // Переменные пригласившего живут в его сессии этого же бота. Сессии нет —
      // создавать нечем (нет current_block): бонус учтётся в referral_bonuses,
      // а переменная появится, когда человек вернётся в бота.
      const row = await db
        .prepare('SELECT vars_json FROM sessions WHERE bot_id = ? AND user_id = ?')
        .bind(botId, Number(referrerId) || 0)
        .first<{ vars_json: string }>();
      if (!row) return;
      let vars: Record<string, unknown>;
      try {
        vars = JSON.parse(row.vars_json || '{}');
      } catch {
        vars = {};
      }
      const cur = Number(vars[varName]) || 0;
      vars[varName] = cur + (Number(amount) || 0);
      await db
        .prepare('UPDATE sessions SET vars_json = ? WHERE bot_id = ? AND user_id = ?')
        .bind(JSON.stringify(vars), botId, Number(referrerId) || 0)
        .run();
    },

    async grantSubscriptionDays(referrerId, _days) {
      // TODO(question): таблица subscribers булева (bot_id, user_id) — срок
      // подписки в днях хранить негде, поэтому «дни» пока дают бессрочную
      // подписку. Нужно ли добавлять expires_at + кроны отписки — вопрос к
      // владельцу продукта; автозадачу без подтверждения не создаём.
      await db
        .prepare('INSERT OR IGNORE INTO subscribers (bot_id, user_id, created_at) VALUES (?,?,?)')
        .bind(botId, Number(referrerId) || 0, Date.now())
        .run();
    },

    async isSubscribed(userId) {
      const r = await db
        .prepare('SELECT 1 AS hit FROM subscribers WHERE bot_id = ? AND user_id = ?')
        .bind(botId, Number(userId) || 0)
        .first<{ hit: number }>();
      return !!r?.hit;
    },

    async paidTotal(userId) {
      const r = await db
        .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM referral_payments WHERE bot_id = ? AND user_id = ?')
        .bind(botId, userId)
        .first<{ s: number }>();
      return Number(r?.s ?? 0);
    },

    async markVerified(refereeId) {
      await db
        .prepare('UPDATE referrals SET verified = 1 WHERE bot_id = ? AND invited_user_id = ?')
        .bind(botId, refereeId)
        .run();
    },

    async recordPayment(userId, amount, currency, now) {
      // Денормализуем referrer_id: revenue-метрики лидерборда читают эту
      // таблицу без join'ов через referrals.
      const r = await db
        .prepare('SELECT inviter_user_id FROM referrals WHERE bot_id = ? AND invited_user_id = ?')
        .bind(botId, userId)
        .first<{ inviter_user_id: string }>();
      await db
        .prepare(
          'INSERT INTO referral_payments (bot_id, user_id, referrer_id, amount, currency, created_at) VALUES (?,?,?,?,?,?)'
        )
        .bind(botId, userId, r?.inviter_user_id ?? null, Math.round(amount) || 0, currency || 'RUB', now)
        .run();
    },

    async leaderboard(metric, from, to, limit) {
      const n = Math.max(1, Math.min(100, Math.floor(limit)));
      const conds = metric === 'revenue' ? ['bot_id = ?'] : ['bot_id = ?'];
      const args: (string | number)[] = [botId];
      if (metric === 'revenue') {
        if (from != null) {
          conds.push('created_at >= ?');
          args.push(from);
        }
        if (to != null) {
          conds.push('created_at <= ?');
          args.push(to);
        }
        conds.push('referrer_id IS NOT NULL');
        const rows =
          (
            await db
              .prepare(
                `SELECT referrer_id AS uid, COALESCE(SUM(amount),0) AS s FROM referral_payments WHERE ${conds.join(' AND ')} GROUP BY referrer_id ORDER BY s DESC LIMIT ?`
              )
              .bind(...args, n)
              .all<{ uid: string; s: number }>()
          ).results ?? [];
        return rows.map<LeaderboardRow>((r) => ({ userId: r.uid, score: Number(r.s) }));
      }
      // count: приглашённые в окне периода; activity_period — тот же счёт,
      // окно уже сужено периодом (отдельной «активности» в схеме нет).
      if (from != null) {
        conds.push('created_at >= ?');
        args.push(from);
      }
      if (to != null) {
        conds.push('created_at <= ?');
        args.push(to);
      }
      const rows =
        (
          await db
            .prepare(
              `SELECT inviter_user_id AS uid, COUNT(*) AS s FROM referrals WHERE ${conds.join(' AND ')} GROUP BY inviter_user_id ORDER BY s DESC LIMIT ?`
            )
            .bind(...args, n)
            .all<{ uid: string; s: number }>()
        ).results ?? [];
      return rows.map<LeaderboardRow>((r) => ({ userId: r.uid, score: Number(r.s) }));
    },

    async joinTournament(meta: TournamentMeta, userId, now) {
      await db
        .prepare(
          'INSERT OR IGNORE INTO referral_tournaments (id, bot_id, name, starts_at, ends_at, metric, config_json) VALUES (?,?,?,?,?,?,?)'
        )
        .bind(meta.id, botId, meta.name, meta.startsAt, meta.endsAt, meta.metric, meta.configJson)
        .run();
      const res = await db
        .prepare(
          'INSERT OR IGNORE INTO referral_tournament_entries (tournament_id, bot_id, user_id, score, joined_at) VALUES (?,?,?,?,?)'
        )
        .bind(meta.id, botId, userId, 0, now)
        .run();
      return ((res.meta.changes as number) ?? 0) > 0;
    },

    tournamentScore: (_tournamentId, userId, metric, from, to) => scoreOne(userId, metric, from, to),

    async tournamentStandings(tournamentId, metric, from, to, limit) {
      const n = Math.max(1, Math.min(100, Math.floor(limit)));
      const rows =
        (
          await db
            .prepare('SELECT user_id FROM referral_tournament_entries WHERE tournament_id = ? AND bot_id = ?')
            .bind(tournamentId, botId)
            .all<{ user_id: string }>()
        ).results ?? [];
      const out: LeaderboardRow[] = [];
      // Участников ограниченно (вступление через блок), поэтому считаем счёт
      // каждому: один индексный запрос на участника, без тяжёлых join'ов.
      for (const e of rows.slice(0, 200)) {
        out.push({ userId: e.user_id, score: await scoreOne(e.user_id, metric, from, to) });
      }
      out.sort((a, b) => b.score - a.score);
      return out.slice(0, n);
    },
  };

  // Счёт одного участника турнира в окне — нужен и tournamentScore, и standings.
  async function scoreOne(userId: string, metric: 'count' | 'revenue', from: number, to: number): Promise<number> {
    if (metric === 'revenue') {
      const r = await db
        .prepare(
          `SELECT COALESCE(SUM(p.amount),0) AS s
           FROM referral_payments p
           JOIN referrals r ON r.bot_id = p.bot_id AND r.invited_user_id = p.user_id
           WHERE p.bot_id = ? AND r.inviter_user_id = ? AND p.created_at >= ? AND p.created_at <= ?`
        )
        .bind(botId, userId, from, to)
        .first<{ s: number }>();
      return Number(r?.s ?? 0);
    }
    const r = await db
      .prepare('SELECT COUNT(*) AS c FROM referrals WHERE bot_id = ? AND inviter_user_id = ? AND created_at >= ? AND created_at <= ?')
      .bind(botId, userId, from, to)
      .first<{ c: number }>();
    return Number(r?.c ?? 0);
  }
}

// Прогон в редакторе: та же семантика, но в памяти — реферальная система
// работает в симуляции, не трогая базу бота (как makeMemDataOps/makeMemTagOps).
export interface SimLine {
  who: 'bot' | 'user';
  text: string;
}

export function makeMemReferralOps(log: SimLine[]): ReferralOps {
  const refs = new Map<string, { referrer: string; createdAt: number; verified: boolean; source: string }>();
  const bonuses: { referrer: string; referee: string; kind: string; amount: number; level: number; createdAt: number }[] = [];
  const payments = new Map<string, number>();
  const subs = new Set<string>();
  const sessionVars = new Map<string, Record<string, unknown>>();
  const tournaments = new Map<string, TournamentMeta>();
  const entries = new Map<string, Set<string>>();

  return {
    async track(referrerId, refereeId, source) {
      if (refs.has(refereeId)) return false;
      refs.set(refereeId, { referrer: referrerId, createdAt: Date.now(), verified: false, source });
      log.push({ who: 'bot', text: `[реферал засчитан: ${referrerId} ← ${refereeId}]` });
      return true;
    },
    async referrerOf(userId) {
      return refs.get(userId)?.referrer ?? null;
    },
    async referrerChain(userId, depth) {
      const out: string[] = [];
      const seen = new Set<string>([userId]);
      let cur = userId;
      for (let i = 0; i < Math.max(1, Math.min(5, depth)); i++) {
        const up = refs.get(cur)?.referrer;
        if (!up || seen.has(up)) break;
        seen.add(up);
        out.push(up);
        cur = up;
      }
      return out;
    },
    async countReferrals(referrerId) {
      let c = 0;
      for (const r of refs.values()) if (r.referrer === referrerId) c++;
      return c;
    },
    async listReferred(referrerId, limit) {
      const out: ReferredUser[] = [];
      for (const [userId, r] of refs) {
        if (r.referrer !== referrerId) continue;
        out.push({ userId, createdAt: r.createdAt, verified: r.verified });
        if (out.length >= limit) break;
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },
    async earningsOf(referrerId) {
      return bonuses.filter((b) => b.referrer === referrerId).reduce((s, b) => s + b.amount, 0);
    },
    async bonusAllowed(referrerId, refereeId, af, now) {
      if (af.onePerUser && bonuses.some((b) => b.referrer === referrerId && b.referee === refereeId)) return 'already_granted';
      if (af.cooldownSec > 0) {
        const last = bonuses.filter((b) => b.referrer === referrerId).reduce((m, b) => Math.max(m, b.createdAt), 0);
        if (last && now - last < af.cooldownSec * 1000) return 'cooldown';
      }
      return null;
    },
    async grantBonus(referrerId, refereeId, kind, amount, level, now) {
      bonuses.push({ referrer: referrerId, referee: refereeId, kind, amount, level, createdAt: now });
      log.push({ who: 'bot', text: `[бонус ${kind}: ${referrerId} +${amount}]` });
    },
    async incrementVariable(referrerId, varName, amount) {
      const vars = sessionVars.get(referrerId) ?? {};
      vars[varName] = (Number(vars[varName]) || 0) + amount;
      sessionVars.set(referrerId, vars);
    },
    async grantSubscriptionDays(referrerId, days) {
      subs.add(referrerId);
      log.push({ who: 'bot', text: `[подписка +${days} дн.: ${referrerId}]` });
    },
    async isSubscribed(userId) {
      return subs.has(userId);
    },
    async paidTotal(userId) {
      return payments.get(userId) ?? 0;
    },
    async markVerified(refereeId) {
      const r = refs.get(refereeId);
      if (r) r.verified = true;
    },
    async recordPayment(userId, amount) {
      payments.set(userId, (payments.get(userId) ?? 0) + amount);
    },
    async leaderboard(metric, _from, _to, limit) {
      const scores = new Map<string, number>();
      if (metric === 'revenue') {
        for (const [userId, sum] of payments) {
          const r = refs.get(userId)?.referrer;
          if (r) scores.set(r, (scores.get(r) ?? 0) + sum);
        }
      } else {
        for (const r of refs.values()) scores.set(r.referrer, (scores.get(r.referrer) ?? 0) + 1);
      }
      return [...scores.entries()]
        .map(([userId, score]) => ({ userId, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
    async joinTournament(meta, userId) {
      tournaments.set(meta.id, meta);
      let set = entries.get(meta.id);
      if (!set) {
        set = new Set();
        entries.set(meta.id, set);
      }
      if (set.has(userId)) return false;
      set.add(userId);
      return true;
    },
    async tournamentScore(_tournamentId, userId, metric, _from, _to) {
      return memScore(userId, metric);
    },
    async tournamentStandings(tournamentId, metric, _from, _to, limit) {
      const rows: LeaderboardRow[] = [];
      for (const uid of entries.get(tournamentId) ?? []) {
        rows.push({ userId: uid, score: memScore(uid, metric) });
      }
      return rows.sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };

  function memScore(userId: string, metric: 'count' | 'revenue'): number {
    if (metric === 'revenue') {
      let s = 0;
      for (const [u, r] of refs) if (r.referrer === userId) s += payments.get(u) ?? 0;
      return s;
    }
    let c = 0;
    for (const r of refs.values()) if (r.referrer === userId) c++;
    return c;
  }
}
