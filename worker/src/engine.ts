import {
  Scenario,
  Block,
  BlockParams,
  ConditionOp,
  ConditionDef,
  InputKind,
  ParseMode,
  interpolate,
  REF_LINK_VAR,
  REF_INVITER_VAR,
  REF_COUNT_VAR,
  REF_EVENT_VAR,
  REF_VERIFIED_VAR,
  REF_EARNINGS_VAR,
  REF_LEADERBOARD_VAR,
  REF_REFERRED_VAR,
  CB_MSG_VAR,
  CB_CHAT_VAR,
  BOT_MSG_VAR,
  CHAT_FALLBACK_VAR,
  loopVar,
  waitVar,
  LOOP_PREFIX,
  WAIT_PREFIX,
  HTTP_PAGE_VAR,
  isInternalVar,
  POLL_ANSWER_VAR,
  POLL_OPTIONS_VAR,
  PAY_LINK_VAR,
  PAY_ORDER_VAR,
  USER_LANG_VAR,
  USER_LAT_VAR,
  USER_LON_VAR,
  AI_LABEL_VAR,
  dataCountVar,
  dataJsonVar,
  normalizeTag,
  hasDangerousRepetition,
} from '../../shared/types';
import { renderMarkup } from '../../shared/markup';
import { evalExprWithFunctions } from '../../shared/expr';
import {
  MAX_ENGINE_STEPS,
  MIN_ENGINE_STEPS,
  LOOP_VISIT_GUARD,
  HARD_LOOP_CAP,
  DEFAULT_SCHEDULE_TIMEZONE,
  TG_POLL_QUESTION_MAX,
  TG_POLL_OPTION_MAX,
  TG_MESSAGE_TEXT_MAX,
  TG_CAPTION_MAX,
  TG_INVOICE_TITLE_MAX,
  TG_INVOICE_DESC_MAX,
  TG_INVOICE_PAYLOAD_MAX,
  TG_INVOICE_CURRENCY_MAX,
} from '../../shared/limits';
import type { ScheduleKind, ScheduleAudience } from '../../shared/cron';
import {
  type ReferralOps,
  findAntifraudSettings,
  periodRange,
  parseRefStartParam,
  sanitizeRefPayload,
  tournamentIdFor,
  tournamentRunning,
  formatLeaderboard,
  bonusTriggerFires,
  normalizeShares,
  hierarchySharesValid,
} from './blocks/referral/runtime';
// Набор 2026-10: чистые хелперы новых блоков (правку/удаление/викторину/язык/
// классификатор/гео держим вне интерпретатора — движок только вызывает).
import { resolveMsgRef } from './blocks/msgops/runtime';
import { evaluateQuizAnswer, findCorrectIndex } from './blocks/quiz/runtime';
import { normalizeLangCode, pickLangBranch } from './blocks/lang/runtime';
import { buildClassifyPrompt } from './blocks/aiclassify/runtime';
import { readLocationFromUpdate } from './blocks/location/runtime';

export type { ReferralOps } from './blocks/referral/runtime';

export interface TelegramOut {
  method: string; // 'sendMessage' | 'action' | 'http' | 'ai' | ...
  payload: Record<string, unknown>;
}

// Операции над таблицами бота (коллекциями). Движок остаётся чистым: он не знает
// про D1 и получает эти вызовы снаружи. Если ops не передали (например, прогон
// без базы), блок «Данные» просто пропускается по next.
export interface DataOps {
  add(collectionId: string, fields: Record<string, unknown>, userId: number | null): Promise<string | null>;
  find(collectionId: string, where: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]>;
  update(collectionId: string, where: Record<string, unknown>, patch: Record<string, unknown>): Promise<number>;
  remove(collectionId: string, where: Record<string, unknown>): Promise<number>;
}

// Операции с тегами пользователя (F2). Как и DataOps, движок получает их
// снаружи: сам он про D1 не знает и остаётся тестируемым без базы.
export interface TagOps {
  add(tag: string, userId: number): Promise<void>;
  remove(tag: string, userId: number): Promise<void>;
  clear(userId: number): Promise<void>;
  list(userId: number): Promise<string[]>;
  has(tag: string, userId: number): Promise<boolean>;
}

// Проверка членства в канале/чате (блок channel_check). Реализуется воркером
// через getChatMember; движок остаётся чистым и только получает ответ.
export interface ChannelOps {
  isMember(chatId: string, userId: number): Promise<boolean>;
}

// Счётчики (блок counter). Атомарный инкремент — на стороне D1, движок видит
// только итоговое значение.
export interface CounterOps {
  inc(name: string, scope: 'user' | 'bot', userId: number, amount: number): Promise<number>;
  dec(name: string, scope: 'user' | 'bot', userId: number, amount: number): Promise<number>;
  reset(name: string, scope: 'user' | 'bot', userId: number): Promise<number>;
  get(name: string, scope: 'user' | 'bot', userId: number): Promise<number>;
}

// Профиль пользователя (блок user_stats и условия source: 'user'). Поля
// соответствуют контракту user.* — движок раскладывает их по переменным сам.
export interface UserProfile {
  name: string;
  username: string;
  id: number;
  tags: string[];
  subscription: boolean;
  paidTotal: number;
  refCount: number;
  firstSeen: number | null;
}

export interface UserOps {
  profile(userId: number): Promise<UserProfile>;
}

// Сегментный получатель для рассылки, отдаваемый BroadcastOps.
export interface BroadcastSegment {
  tag?: string;
  conditions?: ConditionDef[];
}

// Рассылка (блок segment_broadcast). ВАЖНО: никогда не отправляет сообщения
// внутри вебхука. enqueue() кладёт пачки в существующую очередь scheduled_sends
// и возвращает число получателей (0 -> ветка «пусто»).
export interface BroadcastOps {
  enqueue(
    segment: BroadcastSegment,
    payload: {
      text: string;
      mediaUrl?: string;
      parseMode?: ParseMode;
      chunkSize?: number;
      delayMs?: number;
      dailyCap?: number;
    }
  ): Promise<number>;
}

// Расписания (блок schedule). Блок — регистрационный: движок не вычисляет
// время сам, он передаёт определение воркеру (ops.schedules.register), а тот
// кладёт строку в bot_schedules; срабатывания считает крон (shared/cron.ts).
export interface ScheduleDef {
  blockId: string;
  scheduleKind: ScheduleKind;
  atTime?: string;
  weekdays?: number[];
  everyMinutes?: number;
  cronExpr?: string;
  audience: ScheduleAudience;
  audienceTag: string;
  timezone: string;
  // Для audience 'single': пользователь, дошедший до блока регистрации.
  userId: number | null;
}

export interface ScheduleOps {
  register(def: ScheduleDef): Promise<{ status: 'ok' | 'limit' | 'invalid'; count: number }>;
}

// Заказ платежа для блока payment_link / payment_check.
export interface PaymentOrderInfo {
  id: string;
  externalId: string;
  amount: number;
  currency: string;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'cancelled';
  link: string;
  // Провайдер подключения: 'telegram' означает, что внешней ссылки нет —
  // счёт выставляется через sendInvoice (provider_token подставит воркер).
  provider?: string;
}

// Платёжные операции. Движок сам не ходит ни в D1, ни к провайдеру: он получает
// connectionId и прикладные параметры, а воркер строит ссылку/ищет заказ.
export interface PaymentOps {
  create(
    connectionId: string,
    params: {
      amount: number;
      currency: string;
      description: string;
      userId: number;
      orderId?: string;
      // Блок-источник и его successNext: публичный вебхук /pay/:botId/:path
      // возобновляет сценарий с этой точки, когда оплата подтверждена.
      blockId?: string;
      successNext?: string | null;
    }
  ): Promise<PaymentOrderInfo | null>;
  get(connectionId: string, orderId: string): Promise<PaymentOrderInfo | null>;
}

export interface EngineResult {
  outs: TelegramOut[];
  currentBlock: string | null;
  vars: Record<string, unknown>;
  // Исчерпан бюджет шагов (MAX_ENGINE_STEPS или opts.maxSteps). Поток НЕ
  // брошен: currentBlock указывает точку продолжения, а воркер уносит остаток
  // в scheduled_sends (method 'resume') — поток продолжается следующим тиком
  // крона. Раньше флаг никто не читал, и сессия молча парковалась навсегда.
  guardCutoff?: boolean;
  // Настоящий runaway-цикл: один блок посещён больше LOOP_VISIT_GUARD раз за
  // проход. Поток оборван с логом engine.loop.break.<blockId>, продолжение
  // НЕ планируется (иначе цикл кормился бы вечно).
  loopBreak?: boolean;
  // Блок, на котором сработал loop-guard (для лога воркера).
  loopBreakBlock?: string;
}

export interface SessionState {
  currentBlock: string | null;
  vars: Record<string, unknown>;
}

// Pure scenario engine: given a Telegram update + current session, walk the blocks
// and emit Telegram API calls (or action markers for the caller to execute).
// Асинхронный: блок «Данные» читает и пишет таблицы бота, а результат нужен
// сразу — чтобы идти по ветке «найдено / не найдено» без второго захода.
// С await-efficient: внутри await только когда блок реально ходит в базу.
export async function runEngine(opts: {
  scenario: Scenario;
  update: any;
  session: SessionState;
  startBlockId?: string;
  // @username бота (без @) — нужен блоку «Реферальная ссылка».
  botUsername?: string | null;
  // Операции над таблицами бота (коллекциями). Без них блок «Данные» — заглушка.
  data?: DataOps;
  // Операции с тегами. Без них блок «Тег» просто пропускается по next.
  tags?: TagOps;
  // Операции реферальной системы. Без них её блоки не рвут сценарий:
  // track/check/bonus идут по next (или ветке «пропущен»), как «Данные» без базы.
  referral?: ReferralOps;
  // Проверка членства в канале. Без неё channel_check идёт по ветке «ошибка».
  channels?: ChannelOps;
  // Счётчики бота (counter).
  counters?: CounterOps;
  // Профиль пользователя (user_stats, условия source: 'user').
  users?: UserOps;
  // Рассылка по сегменту (segment_broadcast).
  broadcast?: BroadcastOps;
  // Платежи: создание ссылки и поиск заказа (payment_link / payment_check).
  payments?: PaymentOps;
  // Расписания (schedule). Без них блок регистрации проходит насквозь по next.
  schedules?: ScheduleOps;
  // Бюджет шагов одного прохода. По умолчанию MAX_ENGINE_STEPS; аргумент
  // урезается не ниже MIN_ENGINE_STEPS (тесты могут ужесточить, продакшен — нет).
  maxSteps?: number;
}): Promise<EngineResult> {
  const { scenario, update, session } = opts;
  const blocks = scenario.blocks;
  const vars: Record<string, unknown> = { ...session.vars };
  const outs: TelegramOut[] = [];

  const msg = update?.message;
  const cbq = update?.callback_query;
  const pollAnswer = update?.poll_answer;
  let chatId: number | undefined;
  let text: string | undefined;
  let cbData: string | undefined;

  if (msg) {
    chatId = msg.chat?.id;
    text = typeof msg.text === 'string' ? msg.text : undefined;
  }
  if (cbq) {
    chatId = cbq.message?.chat?.id ?? cbq.from?.id;
    cbData = typeof cbq.data === 'string' ? cbq.data : undefined;
    // Запоминаем сообщение под кнопкой и чат: нужны для правки сообщения
    // (updateMode: 'edit') и для уведомлений. Внутренние имена ('__') — в
    // панели переменных и в чипсах {{var}} их не видно.
    const cbChat = cbq.message?.chat?.id;
    const cbMessageId = cbq.message?.message_id;
    if (cbChat != null && cbMessageId != null) {
      vars[CB_MSG_VAR] = { chatId: cbChat, messageId: cbMessageId };
      vars[CB_CHAT_VAR] = cbChat;
    }
  }
  if (pollAnswer) chatId = pollAnswer?.user?.id;
  if (text != null) vars.last_input = text;
  // Resume-проходы (delay, wait_timeout, бюджет шагов §1, расписания §4)
  // исполняются БЕЗ апдейта: chat_id брать неоткуда, и сообщения уходили с
  // undefined chat_id — Telegram их молча отклонял. Память последнего чата
  // живёт в служебной переменной __chat (внутренние '__' не видны в панели
  // переменных и чипсах). Живой апдейт перезаписывает её своим чатом.
  if (chatId == null) {
    const saved = Number(vars[CHAT_FALLBACK_VAR]);
    if (Number.isFinite(saved) && saved !== 0) chatId = saved;
  } else {
    vars[CHAT_FALLBACK_VAR] = chatId;
  }
  const tgUserId: number = msg?.from?.id ?? cbq?.from?.id ?? pollAnswer?.user?.id ?? 0;

  // id входящего сообщения нужен блоку deleteUserMessage. В прогонах и в
  // апдейтах без message его просто нет — тогда удалять нечего.
  const incomingMessageId: number | undefined = msg?.message_id;

  // Resolve the entry block. A forced startBlockId is used when resuming after a delay/http/ai.
  let entry: string | null = opts.startBlockId ?? null;
  const waiting = session.currentBlock ? blocks[session.currentBlock] : null;

  if (!opts.startBlockId) {
    // Ответ на опрос приходит отдельным типом апдейта (poll_answer), без
    // message/callback_query. Ждать его умеет только блок poll, поэтому
    // обрабатываем ДО разбора message-веток.
    if (waiting?.type === 'poll' && pollAnswer) {
      const chosen = Array.isArray(pollAnswer.option_ids) ? pollAnswer.option_ids : [];
      const pollOpts = readPollOptions(waiting);
      vars[POLL_ANSWER_VAR] = chosen.map((i: number) => pollOpts[i]?.text ?? '').filter(Boolean).join(', ');
      vars[POLL_OPTIONS_VAR] = chosen.join(',');
      entry = waiting.branches?.answered ?? waiting.next ?? null;
    }
    // Опрос ждёт именно poll_answer. Любой ДРУГОЙ апдейт (сообщение/кнопка)
    // означает, что пользователь не стал отвечать — уходим в ветку «пропущен»,
    // иначе сценарий навсегда зависнет на блоке опроса.
    if (entry == null && waiting?.type === 'poll' && !pollAnswer && (msg || cbq)) {
      entry = waiting.branches?.skipped ?? waiting.next ?? null;
    }
    // Викторина (набор 2026-10): тот же poll_answer, но ветка зависит от
    // правильности ответа, а не от факта ответа.
    if (waiting?.type === 'quiz' && pollAnswer) {
      const chosen = Array.isArray(pollAnswer.option_ids) ? pollAnswer.option_ids : [];
      const pollOpts = readPollOptions(waiting);
      vars[POLL_ANSWER_VAR] = chosen.map((i: number) => pollOpts[i]?.text ?? '').filter(Boolean).join(', ');
      const verdict = evaluateQuizAnswer(pollOpts, String(waiting.params.correctOptionId || ''), chosen);
      if (verdict === 'failed' && waiting.params.quizFailText) {
        pushMessage(outs, chatId, render(String(waiting.params.quizFailText), vars, waiting.params.parseMode), vars, undefined, 'sendMessage', undefined, waiting);
      }
      entry = waiting.branches?.[verdict] ?? waiting.next ?? null;
    }
    if (entry == null && waiting?.type === 'quiz' && !pollAnswer && (msg || cbq)) {
      // Как poll: любой другой апдейт = пользователь бросил викторину.
      entry = waiting.branches?.failed ?? waiting.next ?? null;
    }
    // Геопозиция (набор 2026-10): ждём апдейт с location. Координаты кладём в
    // публичные переменные user.lat/user.lon — их видно в чипсах и условиях.
    // Любой апдейт БЕЗ гео (текст/кнопка) считаем отказом: пользователь волен
    // не делиться, и сценарий не должен висеть навсегда.
    if (entry == null && waiting?.type === 'location' && msg) {
      const loc = readLocationFromUpdate(update);
      if (loc) {
        vars[USER_LAT_VAR] = loc.lat;
        vars[USER_LON_VAR] = loc.lon;
        entry = waiting.branches?.sent ?? waiting.next ?? null;
      } else {
        entry = waiting.branches?.declined ?? waiting.next ?? null;
      }
    }
    // Ожидание (wait): любой апдейт от пользователя считается ответом, если он
    // пришёл от ТОГО же пользователя. Таймаут приходит отдельной задачей из
    // крона (method 'wait_timeout') — здесь только ветка «ответил».
    if (entry == null && waiting?.type === 'wait' && (msg || cbq)) {
      // Ответ пришёл раньше таймаута: снимаем аренду ожидания, чтобы задача
      // крона не сработала повторно (она сверяет nonce и current_block).
      delete vars[waitVar(waiting.id)];
      entry = waiting.branches?.reply ?? waiting.next ?? null;
    }
    // Нажатие кнопки: сначала «снимаем часики» и показываем авторский
    // toast/alert, потом уходим по ветке кнопки. cbToast/cbAlert живут на
    // БЛОКЕ КНОПОК, чью кнопку нажали, — это фаза разбора входа.
    if (cbq && cbData != null && waiting?.type === 'buttons' && waiting.branches) {
      pushCallbackUx(outs, waiting);
      entry = waiting.branches[cbData] ?? null;
    } else if (msg && entry == null) {
      // 1) /command entry points (any 'command' block in the scenario)
      if (text != null && text.startsWith('/')) {
        const cmd = text.split(' ')[0].split('@')[0].toLowerCase();
        const hit = Object.values(blocks).find(
          (b) => b.type === 'command' && !b.params.disabled && (b.params.command || '').toLowerCase() === cmd
        );
        if (hit && !(cmd === '/start' && blocks[scenario.start])) entry = hit.id;
      }
      // 2) contact / location answer
      if (entry == null && waiting?.type === 'contact' && (msg.contact || msg.location)) {
        const value = msg.contact
          ? msg.contact.phone_number
          : msg.location
          ? `${msg.location.latitude},${msg.location.longitude}`
          : '';
        vars[waiting.params.var || 'contact'] = value;
        entry = waiting.next ?? null;
      }
      // 2b) photo answer (input с kind=photo)
      if (
        entry == null &&
        waiting?.type === 'input' &&
        waiting.params.kind === 'photo' &&
        msg.photo &&
        Array.isArray(msg.photo) &&
        msg.photo.length
      ) {
        // Telegram отдаёт массив размеров фото; последний — самое крупное.
        const best = msg.photo[msg.photo.length - 1];
        if (best?.file_id) {
          vars[waiting.params.var || 'photo'] = best.file_id;
          entry = waiting.next ?? null;
        }
      }
      // 2b2) остальные виды вложений (input с kind=document/video/voice/audio/
      // location/any). Значение — file_id, для location — «lat,lon», для 'any' —
      // вид вложения и лучший доступный payload (см. readAttachment).
      if (entry == null && waiting?.type === 'input' && waiting.params.kind && waiting.params.kind !== 'photo') {
        const att = readAttachment(msg, waiting.params.kind);
        if (att) {
          vars[waiting.params.var || 'input'] = att.value;
          // Дополнительные поля (имя файла, mime) кладём отдельными переменными:
          // {{var_file_name}} и {{var_mime_type}} — их можно использовать в тексте.
          const target = waiting.params.var || 'input';
          if (att.fileName != null) vars[`${target}_file_name`] = att.fileName;
          if (att.mimeType != null) vars[`${target}_mime_type`] = att.mimeType;
          entry = waiting.next ?? null;
        }
      }
      // 2c) successful_payment после sendInvoice
      if (
        entry == null &&
        waiting?.type === 'invoice' &&
        msg.successful_payment
      ) {
        const p = msg.successful_payment;
        // В переменные попадают основные поля платежа, чтобы дальше их мог
        // использовать обычный condition/switch. Автор сам решает, что делать.
        vars.payment = {
          currency: p.currency,
          total_amount: p.total_amount,
          invoice_payload: p.invoice_payload,
          telegram_payment_charge_id: p.telegram_payment_charge_id,
          provider_payment_charge_id: p.provider_payment_charge_id,
        };
        entry = waiting.branches?.paid ?? waiting.next ?? null;
      }
      // 3) free text
      if (entry == null && text != null) {
        // menu: a plain-text reply that matches an active persistent menu button
        if (vars['__menu']) {
          try {
            const menu = JSON.parse(String(vars['__menu']));
            const hit = (menu.buttons || []).find((b: { label: string }) => b.label === text);
            if (hit && menu.branches?.[hit.value]) entry = menu.branches[hit.value];
          } catch {
            /* ignore malformed menu */
          }
        }
        if (entry == null) {
          if (text.startsWith('/start') || !session.currentBlock) {
            entry = scenario.start;
            // fresh start resets vars, но реферальные (ref.*) переживают сброс:
            // они выставляются воркером до запуска сценария и нужны ветке награды.
            // Служебные '__' переживают сброс выборочно (F-022, аудит 2026-10-18):
            // инфраструктурная память (__chat, __menu, __bot_msg, кэш __channel.*)
            // нужна отложенным задачам (delay, wait-таймаут, budget-resume),
            // запланированным в ЭТОМ ЖЕ /start-прогоне — без __chat их отправка
            // уходит без chat_id и Telegram молча её отклоняет. А вот состояние
            // потока управления в свежий прогон протекать не должно: stale
            // __loop.<id> продолжил бы старую итерацию вместо нового цикла,
            // __wait.<id> обязан снять аренду покинутого ожидания, __http_page
            // возобновил бы старый постраничный обход при совпадении URL.
            for (const k of Object.keys(vars)) {
              if (k.startsWith('ref.')) continue;
              if (isInternalVar(k) && !k.startsWith(LOOP_PREFIX) && !k.startsWith(WAIT_PREFIX) && k !== HTTP_PAGE_VAR) continue;
              delete vars[k];
            }
            vars.last_input = text;
          } else if (waiting?.type === 'buttons' && waiting.params.layout === 'reply') {
            const b = (waiting.params.buttons || []).find((x) => x.label === text);
            entry = b ? waiting.branches?.[b.value] ?? null : null;
          } else if (waiting?.type === 'input') {
            // Вложения ждут вложения, текст игнорируем: он придёт отдельным
            // апдейтом, и принимать его как «ответ» значило бы записать в
            // переменную пустоту вместо файла (см. TEXT_INPUT_KINDS).
            if (textInputKind(waiting.params.kind)) {
              const raw = text;
              let val: unknown = raw;
              if (waiting.params.kind === 'number') val = Number(raw);
              const re = waiting.params.regex;
              // kind-проверка: number — числовое значение, email — базовый формат
              // адреса (не RFC: в чат-боте важнее поймать бытовую опечатку).
              const badKind =
                (waiting.params.kind === 'number' && Number.isNaN(Number(raw))) ||
                (waiting.params.kind === 'email' && !EMAIL_RE.test(raw.trim()));
              let bad = badKind;
              let kindErrorText: string | null = null;
              if (badKind) {
                kindErrorText =
                  waiting.params.kind === 'number' ? 'Нужно число. Попробуйте ещё раз.' : 'Похоже, это не e-mail. Попробуйте ещё раз.';
              }
              if (!bad && re) {
                // Защита от ReDoS — та же, что у оператора 'regex': потолок
                // длины ввода и отказ на катастрофическом паттерне.
                if (hasNestedQuantifier(re)) {
                  console.warn('[engine] catastrophic input regex rejected', { blockId: waiting.id });
                  bad = true;
                }
                try {
                  if (!bad) bad = !new RegExp(re).test(raw.slice(0, MAX_REGEX_INPUT));
                } catch {
                  // Не принимаем ввод при сломанной регулярке: это ошибка автора,
                  // но пропуск проверки превращает правило в silently-allow.
                  console.warn('[engine] invalid input regex', { blockId: waiting.id });
                  bad = true;
                }
              }
              if (bad) {
                // stay on the same block and ask again
                outs.push({
                  method: 'sendMessage',
                  payload: {
                    chat_id: chatId,
                    text: waiting.params.errorText || kindErrorText || 'Не похоже на правильный формат. Попробуйте ещё раз.',
                  },
                });
                return { outs, currentBlock: waiting.id, vars };
              }
              vars[waiting.params.var || 'input'] = val;
              entry = waiting.next ?? null;
            }
          } else if (waiting?.type === 'keyword') {
            entry = waiting.id; // re-enter the block: it will consume vars.last_input
          }
        }
      }
      // 4) non-text input (photo, sticker…) while a block waits — just ignore
    }
  }

  if (entry == null) {
    return { outs, currentBlock: session.currentBlock, vars };
  }

  let currentBlock: string | null = session.currentBlock;
  let blockId: string | null = entry;
  let guard = 0;
  // Бюджет шагов прохода: по умолчанию MAX_ENGINE_STEPS (1000). Аргументом
  // можно урезать (тесты), но не ниже MIN_ENGINE_STEPS — иначе «тестовый»
  // прогон начнёт ловить бюджет там, где продакшен его не ловит.
  const maxSteps = Math.max(MIN_ENGINE_STEPS, Math.floor(Number(opts.maxSteps) || MAX_ENGINE_STEPS));
  // Отдельная защита от настоящего runaway-цикла: считаем посещения каждого
  // блока за проход. Линейная цепочка из 900 блоков бюджет исчерпает, но
  // visit-guard не заденет; цикл A→B→A наоборот — упрётся в visit-guard
  // задолго до бюджета. Это разные ситуации: бюджет → продолжение фоново,
  // цикл → обрыв с логом engine.loop.break.
  const visitCounts = new Map<string, number>();
  let loopBreakBlock: string | null = null;
  while (blockId) {
    if (++guard > maxSteps) {
      // Раньше сессия молча парковалась навсегда: флаг guardCutoff никто не
      // читал. Теперь воркер уносит остаток потока в scheduled_sends
      // (engine.budget.resume.<blockId>) и крон продолжает со следующего тика.
      console.warn(`[engine] step budget ${maxSteps} exhausted at block=${blockId}, deferring continuation`);
      break;
    }
    const block: Block | undefined = blocks[blockId];
    if (!block) break;
    // Visit-guard считает входы в блок, НО не в foreach: цикл по списку
    // реентерабелен по конструкции (одна итерация = повторный вход) и конечен
    // сам по себе — maxIterations ≤ HARD_LOOP_CAP плюс состояние __loop.<id>.
    // Настоящий runaway (A→B→A из обычных блоков) loop-состояния не имеет и
    // ловится здесь же. Без исключения легальный цикл на 100 итераций
    // обрывался бы как «runaway» ровно на сотом входе.
    if (block.type !== 'foreach') {
      const visits = (visitCounts.get(blockId) ?? 0) + 1;
      visitCounts.set(blockId, visits);
      if (visits > LOOP_VISIT_GUARD) {
        loopBreakBlock = blockId;
        console.warn(`[engine] runaway loop: block=${blockId} visited ${visits} times, breaking`);
        break;
      }
    }

    // Disabled blocks are transparent: the flow just passes through them.
    // Идём по `next`, а если его нет — по первой живой ветке: замороженный
    // блок не должен рвать сценарий, даже если это развилка.
    if (block.params?.disabled) {
      const firstBranch: string | undefined = Object.values(block.branches ?? {}).find((t) => !!t);
      blockId = block.next || firstBranch || null;
      continue;
    }

    switch (block.type) {
      case 'start':
        blockId = block.next ?? null;
        break;

      case 'command':
        if (block.params.prompt) {
          pushMessage(outs, chatId, render(block.params.prompt, vars, block.params.parseMode), vars, undefined, 'sendMessage', undefined, block);
        }
        blockId = block.next ?? null;
        break;

      case 'message': {
        // deleteUserMessage: убираем сообщение, на которое отвечаем. Ошибку
        // Telegram (сообщение старше 48 часов / уже удалено) глушим: сценарий
        // не должен останавливаться из-за необязательной уборки.
        pushDeletes(outs, block, chatId, incomingMessageId, vars);
        const edit = cbEditTarget(block, vars, chatId);
        if (edit) emitEdit(outs, edit, render(block.params.text || '', vars, block.params.parseMode), vars, block);
        else pushMessage(outs, chatId, render(block.params.text || '', vars, block.params.parseMode), vars, undefined, 'sendMessage', undefined, block);
        blockId = block.next ?? null;
        break;
      }

      case 'buttons': {
        // Подписи кнопок Telegram всегда показывает как plain text: parseMode
        // на них не действует, поэтому клавиатура от переменных не зависит.
        const kb = buildKeyboard(block);
        const edit = cbEditTarget(block, vars, chatId);
        if (edit) {
          emitEdit(outs, edit, render(block.params.prompt || '', vars, block.params.parseMode), vars, block, kb);
        } else {
          pushMessage(outs, chatId, render(block.params.prompt || '', vars, block.params.parseMode), vars, kb, 'sendMessage', undefined, block);
        }
        currentBlock = block.id; // wait for callback / reply
        return { outs, currentBlock, vars };
      }

      case 'input':
        // Подсказка по умолчанию зависит от того, чего блок ждёт: текст или
        // конкретное вложение. Иначе «Введите значение» на блоке, ждущем
        // документ, сбивает пользователя с толку.
        const inputDefaultPrompt = inputPromptFor(block.params.kind ?? 'text');
        pushDeletes(outs, block, chatId, incomingMessageId, vars);
        outs.push({
          method: 'sendMessage',
          payload: {
            chat_id: chatId,
            text: render(block.params.prompt || inputDefaultPrompt, vars, block.params.parseMode),
            ...attachMarkup(block, vars),
          },
        });
        currentBlock = block.id; // wait for user text
        return { outs, currentBlock, vars };

      case 'contact': {
        const wantLocation = block.params.request === 'location';
        const kb = {
          keyboard: [[{ text: wantLocation ? '📍 Отправить геолокацию' : '📱 Отправить контакт', request_contact: !wantLocation, request_location: wantLocation }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        };
        pushDeletes(outs, block, chatId, incomingMessageId, vars);
        pushMessage(
          outs,
          chatId,
          render(block.params.prompt || (wantLocation ? 'Отправьте геолокацию' : 'Отправьте номер телефона'), vars, block.params.parseMode),
          vars,
          kb,
          'sendMessage',
          undefined,
          block
        );
        currentBlock = block.id;
        return { outs, currentBlock, vars };
      }

      case 'condition': {
        const ok = await evalConditionSet(block.params, opts, vars, tgUserId);
        blockId = (ok ? block.branches?.then : block.branches?.else) ?? block.next ?? null;
        break;
      }

      case 'switch': {
        const left = String(vars[block.params.switchVar || ''] ?? '');
        const idx = (block.params.cases || []).findIndex((c) => String(c.value) === left);
        blockId = (idx >= 0 ? block.branches?.[`c${idx}`] : block.branches?.default) ?? block.next ?? null;
        break;
      }

      case 'keyword': {
        const incoming = String(vars.last_input ?? '');
        if (!incoming) {
          currentBlock = block.id; // nothing to analyse yet — wait for text
          return { outs, currentBlock, vars };
        }
        const words = (block.params.keywords || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const low = incoming.toLowerCase();
        const hit =
          block.params.matchMode === 'equals' ? words.includes(low) : words.some((w) => low.includes(w));
        blockId = (hit ? block.branches?.hit : block.branches?.miss) ?? block.next ?? null;
        break;
      }

      case 'setvar': {
        const expr = interpolate(block.params.expr || '', vars);
        // Функции выражений (len/upper/default/now/...) работают там же, где
        // арифметика: без вызовов функций поведение прежнее (evalExpression).
        const value = evalExprWithFunctions(expr).value;
        if (block.params.assignVar) vars[block.params.assignVar] = value;
        blockId = block.next ?? null;
        break;
      }

      case 'http': {
        const pg = block.params.paginate;
        outs.push({
          method: 'http',
          payload: {
            url: interpolate(block.params.url || '', vars),
            method: block.params.method || 'GET',
            headersJson: block.params.headersJson || '',
            bodyJson: interpolate(block.params.bodyJson || '', vars),
            jsonPath: block.params.jsonPath || '',
            outVar: block.params.outVar || '',
            // Повторы/пагинация: значения по умолчанию сохраняют сегодняшнее
            // поведение (один запрос, без повторов) — старые сценарии не меняются.
            retries: Math.max(0, Math.min(5, Math.floor(Number(block.params.retries) || 0))),
            backoffMs: Math.max(0, Math.floor(Number(block.params.backoffMs) || 0)),
            collectVar: block.params.collectVar || '',
            paginate: pg
              ? {
                  kind: pg.kind === 'offset' || pg.kind === 'cursor' ? pg.kind : 'page',
                  param: pg.param || (pg.kind === 'cursor' ? 'cursor' : 'page'),
                  start: Number.isFinite(Number(pg.start)) ? Number(pg.start) : 1,
                  step: Math.max(1, Math.floor(Number(pg.step) || 1)),
                  maxPages: Math.max(1, Math.min(50, Math.floor(Number(pg.maxPages) || 10))),
                  cursorPath: pg.cursorPath || '',
                  nextCursorPath: pg.nextCursorPath || '',
                  delayMs: Math.max(0, Math.floor(Number(pg.delayMs) || 0)),
                }
              : null,
            next: block.next ?? null,
            vars,
          },
        });
        currentBlock = block.id;
        return { outs, currentBlock, vars };
      }

      case 'ai': {
        outs.push({
          method: 'ai',
          payload: {
            prompt: interpolate(block.params.aiPrompt || '', vars),
            system: interpolate(block.params.aiSystem || '', vars),
            model: block.params.aiModel || '',
            outVar: block.params.aiVar || '',
            reply: !!block.params.aiReply,
            chatId: chatId ?? null,
            // Память диалога (§5): движок остаётся чистым — историю читает,
            // дополняет и персистит воркер (dispatchOuts). Здесь только
            // передаём имена параметров; отсутствие полей = прежнее
            // поведение (один промпт, без истории).
            historyVar: block.params.historyVar || '',
            historyTurns: block.params.historyTurns,
            persistHistoryTo: block.params.persistHistoryTo || '',
            next: block.next ?? null,
            vars,
          },
        });
        currentBlock = block.id;
        return { outs, currentBlock, vars };
      }

      case 'random': {
        const opts = (block.params.options || []).filter((o) => block.branches?.[o.key]);
        if (!opts.length) {
          blockId = block.next ?? null;
          break;
        }
        const total = opts.reduce((s, o) => s + Math.max(1, Number(o.weight) || 1), 0);
        let r = Math.random() * total;
        let picked = opts[0];
        for (const o of opts) {
          r -= Math.max(1, Number(o.weight) || 1);
          if (r <= 0) { picked = o; break; }
        }
        blockId = block.branches?.[picked.key] ?? block.next ?? null;
        break;
      }

      case 'action': {
        const kind = block.params.actionKind;
        if (kind === 'delay') {
          // Emit a delay out and stop. The worker schedules a resume at block.next.
          outs.push({ method: 'delay', payload: { seconds: Number(block.params.seconds) || 0, next: block.next ?? null, vars } });
          currentBlock = block.id;
          return { outs, currentBlock, vars };
        }
        // Caller executes these (webhook POST / notify admin / broadcast).
        // {{var}} в notifyText/broadcastText обещан контрактом полей
        // (shared/types.ts), а обработчик в index.ts шлёт текст как есть —
        // интерполируем здесь.
        const actionPayload: Record<string, unknown> = { kind, ...block.params, vars };
        if (block.params.notifyText)
          actionPayload.notifyText = render(block.params.notifyText, vars, block.params.parseMode);
        if (block.params.broadcastText)
          actionPayload.broadcastText = render(block.params.broadcastText, vars, block.params.parseMode);
        outs.push({ method: 'action', payload: actionPayload });
        blockId = block.next ?? null;
        break;
      }

      case 'media': {
        const method =
          block.params.mediaType === 'video' ? 'sendVideo' : block.params.mediaType === 'document' ? 'sendDocument' : 'sendPhoto';
        const cap = render(block.params.caption || '', vars, block.params.parseMode);
        const mediaType = block.params.mediaType || 'photo';
        const attachKey: string = mediaType === 'video' ? 'video' : mediaType === 'document' ? 'document' : 'photo';
        const attach: Record<string, string> = {
          [attachKey]: block.params.fileId || block.params.mediaUrl || '',
        };
        pushMessage(outs, chatId, cap, vars, undefined, method, attach, block);
        blockId = block.next ?? null;
        break;
      }

      case 'media_group': {
        // Альбом: массив InputMedia-объектов (type/媒体/caption). Telegram принимает
        // от 2 до 10 медиа в одном альбоме, проверка в validate.ts.
        const items = (block.params.mediaItems || [])
          .filter((it) => it && (it.url || it.fileId))
          .map((it) => {
            const media: Record<string, string> = {};
            // Telegram требует ключ "type" в каждом элементе альбома (photo или video),
            // плюс сам файл под ключом media (URL или file_id).
            media.type = it.type;
            media.media = it.fileId || it.url || '';
            if (it.caption) media.caption = render(it.caption, vars, block.params.parseMode);
            return media;
          });
        if (items.length >= 2) {
          outs.push({
            method: 'sendMediaGroup',
            payload: { chat_id: chatId, media: items, ...attachMarkup(block, vars) },
          });
        } else if (items.length === 1) {
          // Альбом из 1 элемента — отправим одиночным sendPhoto/sendVideo,
          // чтобы Telegram не отверг запрос.
          const it = items[0];
          const method = it.type === 'video' ? 'sendVideo' : 'sendPhoto';
          const attach: Record<string, string> = { [it.type]: it.media };
          pushMessage(outs, chatId, it.caption || '', vars, undefined, method, attach, block);
        }
        blockId = block.next ?? null;
        break;
      }

      case 'invoice': {
        const inv = block.params.invoice || ({} as any);
        const amountStr = String(inv.amount ?? '').trim();
        // amount поддерживает интерполяцию и простое выражение (то же, что в setvar.expr).
        const amountNum = Number(amountStr ? evalExprWithFunctions(interpolate(amountStr, vars)).value : NaN);
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
          // Невалидный счёт: сообщим автору (если есть admin chat) и пойдём в «отменено».
          outs.push({
            method: 'sendMessage',
            payload: {
              chat_id: chatId,
              text: 'Не получилось выставить счёт: сумма должна быть числом > 0.',
            },
          });
          blockId = block.branches?.cancelled ?? block.next ?? null;
          break;
        }
        const providerToken = (inv.providerToken || '').trim();
        // connectionId — новый необязательный путь: если автор выбрал платёжное
        // подключение, provider_token можно не заполнять (воркер возьмёт токен
        // из зашифрованного секрета подключения).
        const invoiceConnection = (block.params.connectionId || '').trim();
        if (!providerToken && !invoiceConnection) {
          outs.push({
            method: 'sendMessage',
            payload: {
              chat_id: chatId,
              text: 'Не получилось выставить счёт: не задан provider_token. Укажите его в настройках блока или выберите платёжное подключение.',
            },
          });
          blockId = block.branches?.cancelled ?? block.next ?? null;
          break;
        }
        const prices = [
          {
            label: (inv.label || inv.title || 'Оплата').slice(0, TG_INVOICE_TITLE_MAX),
            amount: Math.round(amountNum),
          },
        ];
        outs.push({
          method: 'sendInvoice',
          payload: {
            chat_id: chatId,
            // S4-03: лимиты — из shared/limits.ts (единый источник с валидатором).
            title: interpolate(inv.title || '', vars).slice(0, TG_INVOICE_TITLE_MAX),
            description: interpolate(inv.description || '', vars).slice(0, TG_INVOICE_DESC_MAX),
            payload: interpolate(inv.payload || '', vars).slice(0, TG_INVOICE_PAYLOAD_MAX),
            // provider_token подставляется здесь только если он есть в блоке;
            // иначе его добавит воркер из секрета подключения перед вызовом.
            ...(providerToken ? { provider_token: providerToken } : {}),
            ...(invoiceConnection ? { connectionId: invoiceConnection } : {}),
            currency: (inv.currency || 'RUB').slice(0, TG_INVOICE_CURRENCY_MAX),
            prices,
            ...(inv.photoUrl ? { photo_url: interpolate(inv.photoUrl, vars) } : {}),
          },
        });
        currentBlock = block.id; // ждём pre_checkout_query и/или successful_payment
        return { outs, currentBlock, vars };
      }

      case 'subscription':
        // DB mutation handled by caller (needs DB); engine just emits a signal.
        outs.push({ method: 'subscription', payload: { subAction: block.params.subAction, ...block.params, vars } });
        blockId = block.next ?? null;
        break;

      case 'menu': {
        // Persistent reply keyboard: attach to all outgoing messages while active.
        const menuButtons = block.params.buttons || [];
        vars['__menu'] = menuButtons.length
          ? JSON.stringify({ buttons: menuButtons, branches: block.branches || {} })
          : '';
        pushDeletes(outs, block, chatId, incomingMessageId, vars);
        const menuText = render(block.params.menuPrompt || 'Меню:', vars, block.params.parseMode);
        const menuKb = { keyboard: menuButtons.map((b) => [{ text: b.label }]), resize_keyboard: true };
        // Меню — это reply-keyboard: она прикрепляется к сообщению и не умеет
        // правиться на месте, поэтому updateMode для menu не применяется.
        pushMessage(outs, chatId, menuText, vars, menuKb, 'sendMessage', undefined, block);
        blockId = block.next ?? null;
        break;
      }

      case 'note':
        blockId = block.next ?? null;
        break;

      // Реферальная ссылка: бэк ничего не «выдаёт» и не начисляет — он только
      // кладёт персональную ссылку в переменную (по умолчанию {{ref.link}}).
      // Что давать за приглашение, автор бота решает сам блоками condition/action/setvar.
      case 'referral': {
        const target = block.params.refVar || REF_LINK_VAR;
        const handle = String(opts.botUsername ?? '').replace(/^@/, '').trim();
        // Необязательный payload: метка источника (кампания, канал, QR).
        // Telegram ограничивает start-параметр набором [A-Za-z0-9_-], поэтому
        // шаблон интерполируем и чистим — битая ссылка хуже пустой.
        const payload = sanitizeRefPayload(interpolate(block.params.refPayload || '', vars));
        const suffix = payload ? `_${payload}` : '';
        vars[target] = handle ? `https://t.me/${handle}?start=ref_${tgUserId}${suffix}` : '';
        blockId = block.next ?? null;
        break;
      }

      // Учёт приглашения: фиксирует, кто привёл этого пользователя. Источник
      // пригласившего — start-параметр текущего апдейта (/start ref_<id>) либо
      // уже выставленная воркером {{ref.inviter}}.
      case 'referral_track': {
        const startParam = typeof text === 'string' ? text.trim().split(/\s+/)[1] ?? null : null;
        const parsed = parseRefStartParam(startParam);
        const referrer = parsed.referrerId ?? (vars[REF_INVITER_VAR] != null ? String(vars[REF_INVITER_VAR]) : null);
        if (!referrer || !opts.referral || !tgUserId) {
          // Пришли не по ссылке (или нет хранилища) — засчитывать нечего.
          blockId = block.next ?? null;
          break;
        }
        if (referrer === String(tgUserId)) {
          blockId = block.branches?.self_referral_blocked ?? block.next ?? null;
          break;
        }
        try {
          const fresh = await opts.referral.track(referrer, String(tgUserId), parsed.source);
          vars[REF_INVITER_VAR] = referrer;
          blockId = (fresh ? block.branches?.ok : block.branches?.already_tracked) ?? block.next ?? null;
        } catch {
          blockId = block.branches?.failed ?? block.next ?? null;
        }
        break;
      }

      // Пришёл ли человек по реферальной ссылке: «да» / «нет».
      case 'referral_check': {
        let has = vars[REF_INVITER_VAR] != null && vars[REF_INVITER_VAR] !== '';
        if (!has && opts.referral && tgUserId) {
          try {
            has = !!(await opts.referral.referrerOf(String(tgUserId)));
          } catch {
            has = false;
          }
        }
        blockId = (has ? block.branches?.yes : block.branches?.no) ?? block.next ?? null;
        break;
      }

      // Бонус пригласившему: срабатывает по триггеру (N-й реферал, первая
      // оплата, подписка, своё событие), антифрод-лимиты — из блока antifraud.
      case 'referral_bonus': {
        const outcome = await runReferralBonus(opts, block, scenario, vars, tgUserId, chatId, outs);
        blockId = (outcome ? block.branches?.[outcome] : undefined) ?? block.next ?? null;
        break;
      }

      // Многоуровневый бонус: доли дохода поднимаются по цепочке пригласивших.
      case 'referral_hierarchy': {
        const outcome = await runReferralHierarchy(opts, block, scenario, vars, tgUserId, outs);
        blockId = (outcome ? block.branches?.[outcome] : undefined) ?? block.next ?? null;
        break;
      }

      // Статистика приглашений текущего пользователя.
      case 'referral_stats': {
        if (opts.referral && tgUserId) {
          try {
            const uid = String(tgUserId);
            const [count, referred, earnings] = await Promise.all([
              opts.referral.countReferrals(uid),
              opts.referral.listReferred(uid, Math.min(50, Math.max(1, Number(block.params.refLimit) || 5))),
              opts.referral.earningsOf(uid),
            ]);
            vars[REF_COUNT_VAR] = count;
            vars[REF_REFERRED_VAR] = referred.map((r) => r.userId).join(', ');
            vars[REF_EARNINGS_VAR] = earnings;
          } catch {
            /* без базы — сообщение уйдёт с пустыми числами */
          }
        }
        pushMessage(outs, chatId, interpolate(block.params.refText || DEFAULT_REF_STATS_TEXT, vars), vars);
        blockId = block.next ?? null;
        break;
      }

      // Топ пригласивших: сортировка и период настраиваются в блоке.
      case 'referral_leaderboard': {
        if (opts.referral) {
          try {
            const metric = block.params.refSort === 'revenue' ? 'revenue' : 'count';
            const range = periodRange(
              block.params.refPeriod || 'all_time',
              Date.now(),
              block.params.refPeriodFrom,
              block.params.refPeriodTo
            );
            const rows = await opts.referral.leaderboard(
              metric,
              range.from,
              range.to,
              Math.min(100, Math.max(1, Number(block.params.refLimit) || 10))
            );
            vars[REF_LEADERBOARD_VAR] = formatLeaderboard(rows);
          } catch {
            vars[REF_LEADERBOARD_VAR] = '';
          }
        } else {
          vars[REF_LEADERBOARD_VAR] = '';
        }
        pushMessage(outs, chatId, interpolate(block.params.refText || DEFAULT_REF_LEADERBOARD_TEXT, vars), vars);
        blockId = block.next ?? null;
        break;
      }

      // Турнир: участие в соревновании с окном по времени.
      case 'referral_tournament': {
        const now = Date.now();
        const startsAt = Date.parse(block.params.refStartsAt || '');
        const endsAt = Date.parse(block.params.refEndsAt || '');
        if (!tournamentRunning(startsAt, endsAt, now)) {
          blockId = block.branches?.tournament_not_running ?? block.next ?? null;
          break;
        }
        if (!opts.referral || !tgUserId) {
          blockId = block.next ?? null;
          break;
        }
        try {
          const meta = {
            id: tournamentIdFor(block.params.refTournamentName || ''),
            name: String(block.params.refTournamentName || ''),
            startsAt,
            endsAt,
            metric: block.params.refMetric === 'revenue' ? ('revenue' as const) : ('count' as const),
            configJson: JSON.stringify({
              prize_pool: block.params.refPrizePool || '',
              prize_split: block.params.refPrizeSplit || '',
            }),
          };
          const joined = await opts.referral.joinTournament(meta, String(tgUserId), now);
          blockId = (joined ? block.branches?.joined : block.branches?.already_in) ?? block.next ?? null;
        } catch {
          blockId = block.next ?? null;
        }
        break;
      }

      // Проверка «живого» реферала: по подписке, факту/сумме оплаты или
      // своей цели (boolean-переменная). Результат — {{ref.verified}} (1/0)
      // и отметка в базе: накрутка не проходит ворота и не даёт бонусов.
      case 'referral_verification': {
        const gate = block.params.refGate || 'subscribed';
        let ok = false;
        try {
          if (gate === 'subscribed') {
            ok = opts.referral ? await opts.referral.isSubscribed(String(tgUserId)) : false;
          } else if (gate === 'paid_once') {
            ok = opts.referral ? (await opts.referral.paidTotal(String(tgUserId))) > 0 : false;
          } else if (gate === 'paid_min_amount') {
            const min = Number(block.params.refMinAmount) || 0;
            ok = opts.referral ? (await opts.referral.paidTotal(String(tgUserId))) >= min && min > 0 : false;
          } else if (gate === 'custom_goal') {
            const goal = vars[block.params.refGoalVar || ''];
            ok = goal === true || goal === 1 || String(goal ?? '').toLowerCase() === 'true' || String(goal ?? '') === '1';
          }
          if (ok && opts.referral && tgUserId) await opts.referral.markVerified(String(tgUserId));
        } catch {
          ok = false;
        }
        vars[REF_VERIFIED_VAR] = ok ? 1 : 0;
        blockId = block.next ?? null;
        break;
      }

      // Антифрод — декларация глобальных лимитов: сам по себе ничего не делает,
      // блоки бонусов читают его настройки в момент выдачи (findAntifraudSettings).
      case 'antifraud':
        blockId = block.next ?? null;
        break;

      // Блок «Данные»: таблица бота (коллекция) — записать, найти, обновить, удалить.
      // Условия поиска и значения полей поддерживают {{var}}, поэтому интерполируем
      // их на текущих переменных клиента.
      case 'data': {
        const op = block.params.dataOp || 'add';
        const coll = block.params.collectionId || '';
        const outVar = block.params.outVar || 'found';
        const build = (m?: Record<string, string>): Record<string, unknown> => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(m ?? {})) {
            if (!k) continue;
            out[k] = interpolate(String(v ?? ''), vars);
          }
          return out;
        };
        if (!coll || !opts.data) {
          // Коллекция не выбрана или база недоступна — не рвём сценарий.
          blockId = block.next ?? null;
          break;
        }
        try {
          if (op === 'add') {
            const id = await opts.data.add(coll, build(block.params.dataFields), tgUserId || null);
            if (block.params.outVar) vars[outVar] = id ?? '';
            blockId = block.next ?? null;
          } else if (op === 'find') {
            const rows = await opts.data.find(coll, build(block.params.dataWhere), Number(block.params.dataLimit) || 10);
            vars[outVar] = rows;
            vars[dataCountVar(outVar)] = rows.length;
            vars[dataJsonVar(outVar)] = JSON.stringify(rows);
            // Поля первой записи — как переменные: {{order.name}}, {{order.phone}}.
            if (rows.length) for (const [k, v] of Object.entries(rows[0])) vars[`${outVar}.${k}`] = v;
            blockId = (rows.length ? block.branches?.found : block.branches?.not_found) ?? block.next ?? null;
          } else if (op === 'update') {
            const n = await opts.data.update(coll, build(block.params.dataWhere), build(block.params.dataFields));
            vars[dataCountVar(outVar)] = n;
            blockId = (n ? block.branches?.found : block.branches?.not_found) ?? block.next ?? null;
          } else {
            const n = await opts.data.remove(coll, build(block.params.dataWhere));
            vars[dataCountVar(outVar)] = n;
            blockId = (n ? block.branches?.found : block.branches?.not_found) ?? block.next ?? null;
          }
        } catch {
          // База не ответила — идём по «не найдено», чтобы бот не молчал.
          blockId = block.branches?.not_found ?? block.next ?? null;
        }
        break;
      }

      case 'goto':
        blockId = block.params.target ?? null;
        break;

      // Блок «Тег»: пометить человека, снять метку, очистить все или показать
      // список. Устроен как блок «Данные»: без операций (например, в прогоне
      // без базы) он не рвёт сценарий, а идёт дальше по next.
      case 'tag': {
        const op = block.params.tagOp || 'add';
        const name = normalizeTag(interpolate(block.params.tagName || '', vars));
        const outVar = block.params.tagVar || 'tags';
        if (!opts.tags || !tgUserId) {
          blockId = block.next ?? null;
          break;
        }
        try {
          if (op === 'add') {
            if (name) await opts.tags.add(name, tgUserId);
          } else if (op === 'remove') {
            if (name) await opts.tags.remove(name, tgUserId);
          } else if (op === 'clear') {
            await opts.tags.clear(tgUserId);
          } else {
            // Список — как data.find: значение плюс отдельная переменная с
            // количеством, чтобы по нему можно было ветвиться.
            const list = await opts.tags.list(tgUserId);
            vars[outVar] = list.join(', ');
            vars[`${outVar}_count`] = list.length;
          }
        } catch {
          // База не ответила — сценарий всё равно должен продолжиться.
        }
        blockId = block.next ?? null;
        break;
      }

      // Блок «Цепочка»: несколько сообщений подряд, каждое — отдельный вызов
      // Telegram. Отличие от «Альбома»: альбом — одно сгруппированное
      // сообщение из медиа, цепочка — N независимых сообщений в заданном
      // порядке (текст, фото с подписью, документ, снова текст).
      case 'chain': {
        pushDeletes(outs, block, chatId, incomingMessageId, vars);
        for (const item of block.params.chainItems || []) {
          if (!item || !item.kind) continue;
          if (item.kind === 'text') {
            const text = render(item.text || '', vars, block.params.parseMode);
            if (text.trim()) {
              outs.push({ method: 'sendMessage', payload: { chat_id: chatId, text, ...attachMarkup(block, vars) } });
            }
            continue;
          }
          const file = item.fileId || item.url || '';
          // Элемент без файла отправлять нечем — пропускаем молча, как это
          // делает блок «Альбом» с пустыми элементами.
          if (!file) continue;
          const method =
            item.kind === 'video'
              ? 'sendVideo'
              : item.kind === 'audio'
              ? 'sendAudio'
              : item.kind === 'document'
              ? 'sendDocument'
              : 'sendPhoto';
          // Ключ вложения: Telegram ждёт photo/video/audio/document.
          const attach: Record<string, string> = { [item.kind]: file };
          pushMessage(outs, chatId, render(item.caption || '', vars, block.params.parseMode), vars, undefined, method, attach, block);
        }
        blockId = block.next ?? null;
        break;
      }

      case 'end':
        currentBlock = null;
        return { outs, currentBlock, vars };

      // ------------------------- подсценарии: защита границы -------------------------
      // Блоки subflow/subflow_return — АВТОРСКИЕ: публикация раскрывает их в
      // плоский сценарий (shared/subflow.ts), и до движка они доходить не
      // должны НИКОГДА. Если такой блок всё же здесь (баг или устаревший
      // закэшированный артефакт) — безопасный тупик: одна строка в лог,
      // currentBlock = null, без исключений. Движок НЕ получает семантику
      // подсценариев: это нарушило бы контракт «движок — чистая функция над
      // плоским сценарием» (см. шапку shared/subflow.ts).
      case 'subflow':
      case 'subflow_return':
        console.warn(`[engine] authoring-time block reached the interpreter: ${block.type} (${block.id}) — treated as dead end`);
        currentBlock = null;
        return { outs, currentBlock, vars };

      // ------------------------- набор 2026-09 -------------------------

      // Опрос. sendPoll не блокирует: Telegram присылает poll_answer отдельным
      // апдейтом, поэтому блок встаёт на ожидание (currentBlock = сам).
      case 'poll': {
        const pollOpts = readPollOptions(block);
        if (!pollOpts.length) {
          blockId = block.branches?.skipped ?? block.next ?? null;
          break;
        }
        const mp = block.params.multiple;
        const correct = (block.params.correctOptionId || '').trim();
        // correctOptionId — это id варианта (PollOptionDef.id), а sendPoll ждёт
        // индекс. Ищем индекс, а не отдаём id: Telegram отклонил бы запрос.
        const correctIndex = correct ? pollOpts.findIndex((o) => (o.id || '') === correct) : -1;
        const pollQuestion = render(block.params.question || 'Вопрос', vars, block.params.parseMode);
        const pollRendered = pollOpts.map((o) => ({ text: render(o.text, vars, block.params.parseMode) }));
        warnPollLengths(pollQuestion, pollRendered, block.id);
        outs.push({
          method: 'sendPoll',
          payload: {
            chat_id: chatId,
            question: pollQuestion,
            options: JSON.stringify(pollRendered),
            is_anonymous: block.params.anonymous !== false,
            allows_multiple_answers: !!mp,
            ...(correctIndex >= 0
              ? {
                  type: 'quiz',
                  correct_option_id: correctIndex,
                  ...(block.params.explanation
                    ? { explanation: render(block.params.explanation, vars, block.params.parseMode) }
                    : {}),
                }
              : {}),
          },
        });
        currentBlock = block.id; // ждём poll_answer
        return { outs, currentBlock, vars };
      }

      // Пересылка: forward текущего сообщения, copy или sendMessage с текстом.
      case 'forward': {
        const toChat = resolveToChat(block, vars, tgUserId);
        const mode = block.params.forwardMode || 'forward';
        const fromMessageId = Number(block.params.fromVar ? vars[block.params.fromVar] : incomingMessageId);
        if (!toChat) {
          blockId = block.branches?.failed ?? block.next ?? null;
          break;
        }
        if (mode === 'text') {
          const text = render(block.params.forwardText || '', vars, block.params.parseMode);
          if (!text.trim()) {
            blockId = block.branches?.failed ?? block.next ?? null;
            break;
          }
          outs.push({ method: 'sendMessage', payload: { chat_id: toChat, text, ...attachMarkup(block, vars) } });
          blockId = block.branches?.ok ?? block.next ?? null;
          break;
        }
        if (!fromMessageId || !chatId) {
          blockId = block.branches?.failed ?? block.next ?? null;
          break;
        }
        outs.push({
          method: mode === 'copy' ? 'copyMessage' : 'forwardMessage',
          payload: { chat_id: toChat, from_chat_id: chatId, message_id: fromMessageId },
        });
        blockId = block.branches?.ok ?? block.next ?? null;
        break;
      }

      // Индикатор активности. Неблокирующий: отправляется и идём дальше.
      case 'chat_action': {
        outs.push({
          method: 'sendChatAction',
          payload: { chat_id: chatId, action: block.params.chatAction || 'typing' },
        });
        blockId = block.next ?? null;
        break;
      }

      // Ожидание с таймаутом. currentBlock остаётся на себе; воркер кладёт
      // задачу 'wait_timeout' в scheduled_sends и вернёт сценарий сюда же, если
      // пользователь не ответил. nonce защищает от «двойного срабатывания»:
      // старый таймер увидит другой nonce и молча выпадет.
      case 'wait': {
        const nonce = String(Math.random()).slice(2) + Date.now().toString(36);
        vars[waitVar(block.id)] = nonce;
        pushDeletes(outs, block, chatId, incomingMessageId, vars);
        if (block.params.prompt) {
          pushMessage(outs, chatId, render(block.params.prompt, vars, block.params.parseMode), vars, undefined, 'sendMessage', undefined, block);
        }
        outs.push({
          method: 'wait',
          payload: {
            blockId: block.id,
            timeoutTarget: block.branches?.timeout ?? block.next ?? null,
            nonce,
            vars,
            seconds: Math.max(1, Number(block.params.seconds) || 60),
            maxWaitMinutes: Math.max(0, Number(block.params.maxWaitMinutes) || 0),
            reminderText: block.params.reminderText
              ? render(block.params.reminderText, vars, block.params.parseMode)
              : '',
            chatId: chatId ?? null,
          },
        });
        currentBlock = block.id;
        return { outs, currentBlock, vars };
      }

      // Проверка членства в канале. Результат кэшируется в переменных на
      // cacheMinutes: getChatMember упирается в лимиты Telegram.
      case 'channel_check': {
        const channel = interpolate(block.params.channelId || '', vars).trim();
        if (!channel) {
          blockId = block.branches?.error ?? block.next ?? null;
          break;
        }
        const cacheVar = `__channel.${block.id}`;
        const cached = readChannelCache(vars[cacheVar], block.params.cacheMinutes);
        if (cached !== null) {
          blockId = (cached ? block.branches?.member : block.branches?.not_member) ?? block.next ?? null;
          break;
        }
        if (!opts.channels || !tgUserId) {
          blockId = block.branches?.error ?? block.next ?? null;
          break;
        }
        try {
          const member = await opts.channels.isMember(channel, tgUserId);
          vars[cacheVar] = { member, ts: Date.now() };
          blockId = (member ? block.branches?.member : block.branches?.not_member) ?? block.next ?? null;
        } catch {
          blockId = block.branches?.error ?? block.next ?? null;
        }
        break;
      }

      // Рассылка по сегменту. Никогда не отправляется внутри вебхука: только
      // постановка в очередь (воркер режет на пачки и кладёт в scheduled_sends).
      case 'segment_broadcast': {
        const text = render(block.params.segmentText || '', vars, block.params.parseMode);
        const segment = {
          tag: normalizeTag(interpolate(block.params.segmentTag || '', vars)),
          conditions: (block.params.segmentWhere || []).map((c) => ({
            ...c,
            value: interpolate(c.value ?? '', vars),
          })),
        };
        if (!opts.broadcast || (!text.trim() && !block.params.segmentMediaUrl)) {
          blockId = block.branches?.empty ?? block.next ?? null;
          break;
        }
        try {
          const count = await opts.broadcast.enqueue(segment, {
            text,
            mediaUrl: block.params.segmentMediaUrl || undefined,
            parseMode: block.params.parseMode,
            chunkSize: Number(block.params.chunkSize) || undefined,
            delayMs: Number(block.params.delayMs) || undefined,
            dailyCap: Number(block.params.dailyCap) || undefined,
          });
          vars['__broadcast_count'] = count;
          blockId = (count > 0 ? block.branches?.queued : block.branches?.empty) ?? block.next ?? null;
        } catch {
          blockId = block.branches?.empty ?? block.next ?? null;
        }
        break;
      }

      // Профиль пользователя: раскладывает user.* по переменным и (необязательно)
      // отправляет шаблон. Ветвей нет — идём по next.
      case 'user_stats': {
        const prefix = block.params.outPrefix || 'user';
        if (opts.users && tgUserId) {
          try {
            const profile = await opts.users.profile(tgUserId);
            vars[`${prefix}.name`] = profile.name;
            vars[`${prefix}.username`] = profile.username;
            vars[`${prefix}.id`] = profile.id;
            vars[`${prefix}.tags`] = profile.tags.join(', ');
            vars[`${prefix}.subscription`] = profile.subscription ? 1 : 0;
            vars[`${prefix}.paid_total`] = profile.paidTotal;
            vars[`${prefix}.ref_count`] = profile.refCount;
            vars[`${prefix}.first_seen`] = profile.firstSeen ?? '';
          } catch {
            /* без профиля сообщение уйдёт с пустыми числами */
          }
        }
        const tpl = block.params.template;
        if (tpl && tpl.trim()) pushMessage(outs, chatId, render(tpl, vars, block.params.parseMode), vars, undefined, 'sendMessage', undefined, block);
        blockId = block.next ?? null;
        break;
      }

      // Платёжная ссылка: создаёт заказ и кладёт ссылку в linkVar (по умолчанию
      // pay.link). Ветки «создано» / «не удалось».
      case 'payment_link': {
        const connectionId = (block.params.connectionId || '').trim();
        const amountRaw = interpolate(String(block.params.amount ?? ''), vars).trim();
        const amount = Number(amountRaw ? evalExprWithFunctions(amountRaw).value : NaN);
        if (!connectionId || !Number.isFinite(amount) || amount <= 0 || !opts.payments || !tgUserId) {
          blockId = block.branches?.failed ?? block.next ?? null;
          break;
        }
        try {
          const order = await opts.payments.create(connectionId, {
            amount: Math.round(amount),
            currency: (block.params.currency || 'RUB').toUpperCase().slice(0, 8),
            description: interpolate(block.params.description || '', vars),
            userId: tgUserId,
            orderId: block.params.orderIdVar ? String(vars[block.params.orderIdVar] ?? '') : undefined,
            blockId: block.id,
            successNext: block.params.successNext ?? null,
          });
          if (!order) {
            blockId = block.branches?.failed ?? block.next ?? null;
            break;
          }
          const linkVarName = block.params.linkVar || PAY_LINK_VAR;
          if (linkVarName) vars[linkVarName] = order.link;
          const orderVarName = block.params.orderIdVar || PAY_ORDER_VAR;
          if (orderVarName) vars[orderVarName] = order.externalId;
          vars[PAY_ORDER_VAR] = order.externalId;
          // Telegram Payments: внешней ссылки нет — выставляем счёт прямо здесь.
          // provider_token подставит воркер из секрета подключения (connectionId
          // в payload), движок секретов не видит и не хранит.
          if (order.provider === 'telegram' && !order.link) {
            outs.push({
              method: 'sendInvoice',
              payload: {
                chat_id: chatId,
                title: (block.params.description || 'Оплата').slice(0, 32),
                description: (block.params.description || 'Оплата').slice(0, 255),
                payload: order.externalId.slice(0, 128),
                connectionId,
                currency: (block.params.currency || 'RUB').toUpperCase().slice(0, 8),
                prices: [{ label: 'Оплата', amount: order.amount }],
              },
            });
          }
          // Внешняя ссылка (ЮKassa/Robokassa/Stripe/custom): платёжная
          // страница не инлайнится в чат — отправляем кнопкой-ссылкой.
          // На VK кнопка становится open_link (адаптер), на Telegram —
          // url-кнопкой; идентично работает в превью и на обеих платформах.
          // Авторская разметка блока (attachMarkup) не содержит клавиатуры —
          // кнопки у payment_link нет, поэтому просто добавляем свою.
          if (order.link) {
            outs.push({
              method: 'sendMessage',
              payload: {
                chat_id: chatId,
                text: `${interpolate(block.params.description || 'Оплата', vars).slice(0, 350)}\nСумма: ${order.amount} ${order.currency}`,
                reply_markup: {
                  inline_keyboard: [[{ text: 'Оплатить', url: order.link }]],
                },
                ...attachMarkup(block, vars),
              },
            });
          }
          blockId = block.branches?.created ?? block.next ?? null;
        } catch {
          blockId = block.branches?.failed ?? block.next ?? null;
        }
        break;
      }

      // Проверка оплаты: paid / pending / failed по заказу из orderIdVar.
      case 'payment_check': {
        const connectionId = (block.params.connectionId || '').trim();
        const orderId = String(vars[block.params.orderIdVar || PAY_ORDER_VAR] ?? '').trim();
        if (!connectionId || !orderId || !opts.payments) {
          blockId = block.branches?.failed ?? block.next ?? null;
          break;
        }
        try {
          const order = await opts.payments.get(connectionId, orderId);
          if (!order) {
            blockId = block.branches?.failed ?? block.next ?? null;
            break;
          }
          vars['payment'] = { status: order.status, amount: order.amount, currency: order.currency, order: order.externalId };
          if (order.status === 'paid') blockId = block.branches?.paid ?? block.next ?? null;
          else if (order.status === 'created' || order.status === 'pending') blockId = block.branches?.pending ?? block.next ?? null;
          else blockId = block.branches?.failed ?? block.next ?? null;
        } catch {
          blockId = block.branches?.failed ?? block.next ?? null;
        }
        break;
      }

      // Цикл по списку. Реентерабельный, НЕ рекурсивный: состояние (индекс и
      // список) живёт в переменных, поэтому цикл переживает паузы и ответы
      // пользователя между итерациями.
      case 'foreach': {
        const state = readLoopState(vars[loopVar(block.id)]);
        const listVarName = block.params.listVar || '';
        const source = state ? state.items : parseLoopList(vars[listVarName]);
        const maxIter = Math.max(1, Math.min(HARD_LOOP_CAP, Math.floor(Number(block.params.maxIterations) || 100)));
        const index = state ? state.index : 0;
        if (index >= source.length || index >= maxIter) {
          delete vars[loopVar(block.id)];
          blockId = block.branches?.done ?? block.next ?? null;
          break;
        }
        const itemVarName = block.params.itemVar || 'item';
        const indexVarName = block.params.indexVar || 'i';
        vars[itemVarName] = source[index];
        vars[indexVarName] = index;
        vars[loopVar(block.id)] = { items: source, index: index + 1 };
        // Итерация цикла — доказуемый прогресс (index строго растёт, потолок
        // maxIterations ограничен HARD_LOOP_CAP). Сбрасываем visit-счётчики:
        // блоки тела легально посещаются сотни раз, это не runaway. Настоящий
        // A→B→A цикл до foreach не доходит и считается заново — guard его ловит.
        visitCounts.clear();
        // trace — не команда Telegram: воркер его игнорирует, а прогон
        // (simulateScenario) рисует строку «[цикл: i/N]». Без него синхронный
        // цикл не оставил бы в логе прогона ни следа.
        outs.push({ method: 'trace', payload: { kind: 'loop', index: index + 1, total: source.length } });
        blockId = block.branches?.each ?? block.next ?? null;
        break;
      }

      // Случайный текст: взвешенный выбор, необязательно отправляем и/или
      // кладём в переменную. Ветвей нет.
      case 'random_text': {
        const variants = (block.params.variants || []).filter((v) => v && String(v.text ?? '').trim() !== '');
        if (variants.length) {
          const total = variants.reduce((s, v) => s + Math.max(1, Number(v.weight) || 1), 0);
          let r = Math.random() * total;
          let picked = variants[0];
          for (const v of variants) {
            r -= Math.max(1, Number(v.weight) || 1);
            if (r <= 0) {
              picked = v;
              break;
            }
          }
          const text = render(picked.text, vars, block.params.parseMode);
          if (block.params.outVar) vars[block.params.outVar] = text;
          if (block.params.send !== false) {
            pushMessage(outs, chatId, text, vars, undefined, 'sendMessage', undefined, block);
          }
        }
        blockId = block.next ?? null;
        break;
      }

      // Утверждение: те же условия, что у condition, но с явной веткой «не прошло»
      // и понятным сообщением. Нужно для отладки сценариев.
      case 'assert': {
        const ok = await evalConditionSet(block.params, opts, vars, tgUserId);
        if (!ok) {
          const fail = render(block.params.failMessage || DEFAULT_ASSERT_FAIL, vars, block.params.parseMode);
          if (fail.trim()) {
            pushMessage(outs, chatId, fail, vars, undefined, 'sendMessage', undefined, block);
          }
          blockId = block.branches?.fail ?? block.next ?? null;
        } else {
          blockId = block.branches?.pass ?? block.next ?? null;
        }
        break;
      }

      // Счётчик: атомарный инкремент на стороне D1, значение — в переменной.
      case 'counter': {
        const name = (block.params.counterName || '').trim();
        const scope = block.params.counterScope === 'bot' ? 'bot' : 'user';
        const op = block.params.counterOp || 'inc';
        const amount = Math.max(1, Math.floor(Number(block.params.amount) || 1));
        if (!name || !opts.counters) {
          // Нет счётчиков (прогон без базы) — не рвём сценарий.
          blockId = block.branches?.ok ?? block.next ?? null;
          break;
        }
        try {
          let value: number;
          if (op === 'dec') value = await opts.counters.dec(name, scope, tgUserId, amount);
          else if (op === 'reset') value = await opts.counters.reset(name, scope, tgUserId);
          else if (op === 'get') value = await opts.counters.get(name, scope, tgUserId);
          else value = await opts.counters.inc(name, scope, tgUserId, amount);
          const outVarName = block.params.outVar || 'counter';
          vars[outVarName] = value;
          const max = Number(block.params.counterMax);
          const limited = Number.isFinite(max) && max > 0 && value >= max;
          blockId = (limited ? block.branches?.limit_reached : block.branches?.ok) ?? block.next ?? null;
        } catch {
          blockId = block.branches?.ok ?? block.next ?? null;
        }
        break;
      }

      // Расписание (§4): регистрационный блок. Движок НЕ вычисляет время —
      // он передаёт определение воркеру через ops.schedules.register (тот
      // пишет bot_schedules; срабатывания считает крон по shared/cron.ts).
      // Без ops (прогон/simulate) блок прозрачно проходит по next.
      // Ветвей нет: идём по next, как message.
      case 'schedule': {
        const kindRaw = String(block.params.scheduleKind || 'daily');
        const audRaw = String(block.params.scheduleAudience || 'all');
        const def: ScheduleDef = {
          blockId: block.id,
          scheduleKind: (['daily', 'weekly', 'interval', 'cron'].includes(kindRaw) ? kindRaw : 'daily') as ScheduleKind,
          atTime: String(block.params.atTime || '').trim(),
          weekdays: Array.isArray(block.params.weekdays)
            ? block.params.weekdays.map((d) => Math.floor(Number(d))).filter((d) => d >= 1 && d <= 7)
            : [],
          everyMinutes: Math.floor(Number(block.params.everyMinutes) || 0),
          cronExpr: String(block.params.cronExpr || '').trim(),
          audience: (['all', 'tag', 'single'].includes(audRaw) ? audRaw : 'all') as ScheduleAudience,
          audienceTag: normalizeTag(interpolate(block.params.audienceTag || '', vars)),
          timezone: String(block.params.timezone || DEFAULT_SCHEDULE_TIMEZONE).trim() || DEFAULT_SCHEDULE_TIMEZONE,
          userId: tgUserId || null,
        };
        let status = 'skipped';
        if (opts.schedules) {
          try {
            const r = await opts.schedules.register(def);
            status = r.status;
          } catch {
            status = 'invalid';
          }
        }
        // След для прогона (simulate рисует строку); воркер логирует сам в register.
        outs.push({ method: 'trace', payload: { kind: 'schedule', status, blockId: block.id } });
        blockId = block.next ?? null;
        break;
      }

      // Mini App: сообщение с инлайн-кнопкой, открывающей Telegram Web App.
      // Telegram принимает web_app-кнопку ТОЛЬКО в inline_keyboard — поэтому
      // клавиатура собирается явно и передаётся в pushMessage как
      // extraReplyMarkup (постоянное reply-меню __menu её не перебивает).
      // Ветвей нет: идём по next, как message.
      case 'web_app': {
        const waUrl = interpolate(block.params.url || '', vars);
        const waKb = {
          inline_keyboard: [
            [{ text: interpolate(block.params.button || '', vars), web_app: { url: waUrl } }],
          ],
        };
        pushDeletes(outs, block, chatId, incomingMessageId, vars);
        pushMessage(
          outs,
          chatId,
          render(block.params.text || '', vars, block.params.parseMode),
          vars,
          waKb,
          'sendMessage',
          undefined,
          block
        );
        blockId = block.next ?? null;
        break;
      }

      // ------------------------- набор 2026-10 -------------------------

      // Правка отправленного сообщения. Цель — переменная с {chatId,messageId}
      // ({{__bot_msg}}) или числовой id текущего чата. Ветки по ошибке Telegram
      // выбирает воркер (dispatchOuts): слишком старое / не найдено / ок.
      case 'edit_message': {
        const ref = resolveMsgRef(vars, block.params.msgRefVar, chatId);
        if (!ref) {
          blockId = block.branches?.not_found ?? block.next ?? null;
          break;
        }
        const editText = render(block.params.editText || '', vars, block.params.parseMode);
        warnTelegramLength('edit text', editText.length, TG_MESSAGE_TEXT_MAX, block.id);
        outs.push({
          method: 'edit_message',
          payload: {
            chatId: ref.chatId,
            messageId: ref.messageId,
            text: editText,
            buttons: block.params.editButtons ?? null,
            branches: {
              ok: block.branches?.ok ?? block.next ?? null,
              too_old: block.branches?.too_old ?? null,
              not_found: block.branches?.not_found ?? null,
            },
            blockId: block.id,
            vars,
          },
        });
        currentBlock = block.id;
        return { outs, currentBlock, vars };
      }

      // Удаление сообщения. Ошибки глотаются воркером: удаление — косметика,
      // сценарий идёт по next независимо от результата.
      case 'delete_message': {
        const ref = resolveMsgRef(vars, block.params.msgRefVar, chatId);
        if (ref) {
          outs.push({ method: 'deleteMessage', payload: { chat_id: ref.chatId, message_id: ref.messageId } });
        }
        blockId = block.next ?? null;
        break;
      }

      // Викторина: sendPoll в quiz-режиме (correct_option обязателен), ждём
      // poll_answer; ветку passed/failed выбирает evaluateQuizAnswer.
      case 'quiz': {
        const pollOpts = readPollOptions(block);
        const correctIndex = findCorrectIndex(pollOpts, String(block.params.correctOptionId || ''));
        if (!pollOpts.length || correctIndex < 0) {
          // Без правильного ответа quiz-опрос Telegram отклонил бы: уходим в
          // failed, а не отправляем заведомо битый запрос.
          blockId = block.branches?.failed ?? block.next ?? null;
          break;
        }
        const quizQuestion = render(block.params.question || 'Вопрос', vars, block.params.parseMode);
        const quizRendered = pollOpts.map((o) => ({ text: render(o.text, vars, block.params.parseMode) }));
        warnPollLengths(quizQuestion, quizRendered, block.id);
        outs.push({
          method: 'sendPoll',
          payload: {
            chat_id: chatId,
            question: quizQuestion,
            options: JSON.stringify(quizRendered),
            is_anonymous: block.params.anonymous !== false,
            allows_multiple_answers: false,
            type: 'quiz',
            correct_option_id: correctIndex,
            ...(block.params.explanation
              ? { explanation: render(block.params.explanation, vars, block.params.parseMode) }
              : {}),
          },
        });
        currentBlock = block.id;
        return { outs, currentBlock, vars };
      }

      // Язык пользователя: ветка по language_code апдейта, код кладём в
      // user.lang — условия и тексты видят его как обычную переменную.
      case 'language': {
        const langCode = normalizeLangCode(msg?.from?.language_code ?? cbq?.from?.language_code);
        vars[USER_LANG_VAR] = langCode;
        const key = pickLangBranch(block.params.langCodes, langCode);
        blockId = block.branches?.[key] ?? block.next ?? null;
        break;
      }

      // Дедлайн: ФОНОВАЯ задача (не пауза потока!). Диалог пользователя
      // продолжается по next, а крон в срок проверяет переменную-флаг отмены:
      // установлена — возобновляет сессию с ветки done без сообщения, нет —
      // шлёт deadlineText и возобновляет с expired. Пауза здесь заморозила бы
      // диалог на весь срок (бронь слота: пользователь должен получить ссылку
      // на оплату сразу, а не через 30 минут).
      case 'timer_deadline': {
        const atRaw =
          String(block.params.deadlineAt || '').trim() ||
          String(interpolate(block.params.deadlineVar || '', vars) ?? '').trim();
        const atMs = Date.parse(atRaw);
        if (!atRaw || !Number.isFinite(atMs)) {
          // Битый срок: дедлайн, который никогда не сработает, хуже честного
          // прохода по «успел» — автор увидит проблему в валидаторе.
          blockId = block.branches?.done ?? block.next ?? null;
          break;
        }
        outs.push({
          method: 'deadline',
          payload: {
            blockId: block.id,
            atMs,
            cancelVar: String(block.params.cancelVar || '').trim(),
            text: block.params.deadlineText ? render(block.params.deadlineText, vars, block.params.parseMode) : '',
            branches: {
              done: block.branches?.done ?? block.next ?? null,
              expired: block.branches?.expired ?? block.next ?? null,
            },
            chatId: chatId ?? null,
          },
        });
        blockId = block.next ?? null;
        break;
      }

      // ИИ-классификатор: модель выбирает метку, воркер парсит ответ и
      // возобновляет поток по ветке метки (fallback при неразобранном).
      case 'ai_classify': {
        const labels = (block.params.classifyLabels || []).map((l) => String(l ?? '').trim()).filter(Boolean);
        if (!labels.length) {
          blockId = block.next ?? null;
          break;
        }
        const input = block.params.classifyInput
          ? render(block.params.classifyInput, vars, block.params.parseMode)
          : text || '';
        outs.push({
          method: 'ai_classify',
          payload: {
            prompt: buildClassifyPrompt(labels, render(block.params.classifyPrompt || '', vars, block.params.parseMode), input),
            labels,
            fallback: String(block.params.classifyFallbackLabel || 'other').trim() || 'other',
            outVar: String(block.params.classifyOutVar || '').trim() || AI_LABEL_VAR,
            branches: Object.fromEntries(
              [...labels, String(block.params.classifyFallbackLabel || 'other').trim() || 'other'].map((k) => [k, block.branches?.[k] ?? block.next ?? null])
            ),
            blockId: block.id,
            chatId: chatId ?? null,
            vars,
          },
        });
        currentBlock = block.id;
        return { outs, currentBlock, vars };
      }

      // Входящий вебхук: триггер-регистратор (как schedule). В движок попадает
      // только когда воркер возобновляет поток по событию: wh.* переменные
      // кладёт роут /hook/:botId/:token ДО прохода, здесь блок прозрачен.
      case 'webhook_in':
        blockId = block.next ?? null;
        break;

      // Геопозиция: reply-клавиатура с request_location, ждём апдейт с
      // location (ветка sent) или любой другой ответ (declined).
      case 'location': {
        const kb = {
          keyboard: [[{ text: interpolate(block.params.locationButtonLabel || '', vars) || 'Отправить геопозицию', request_location: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        };
        pushMessage(outs, chatId, render(block.params.locationPrompt || '', vars, block.params.parseMode), vars, kb, 'sendMessage', undefined, block);
        currentBlock = block.id;
        return { outs, currentBlock, vars };
      }
    }
  }

  // Исчерпан бюджет шагов: возвращаем точку продолжения (blockId — блок, на
  // котором остановились). Воркер прочитает guardCutoff и запланирует resume.
  const budgetCutoff = guard > maxSteps && !loopBreakBlock;

  // Цикл, прерванный бюджетом: оставляем след в логе прогона (trace) — автор
  // видит частичный прогресс «i/N» вместо молчаливого обрыва. Состояние цикла
  // (__loop.<id>) остаётся в vars, resume продолжит с той же итерации.
  if (budgetCutoff) {
    for (const key of Object.keys(vars)) {
      if (!key.startsWith(LOOP_PREFIX)) continue;
      const st = readLoopState(vars[key]);
      if (!st) continue;
      outs.push({
        method: 'trace',
        payload: { kind: 'loop-deferred', event: `engine.loop.deferred.${key.slice(LOOP_PREFIX.length)}.${st.index}/${st.items.length}` },
      });
    }
    // Маркер продолжения: dispatchOuts кладёт { resumeBlockId, vars } в
    // scheduled_sends (method 'resume'), и крон доводит поток со следующего
    // тика. Раньше guardCutoff никто не читал — сессия парковалась навсегда.
    outs.push({
      method: 'trace',
      payload: {
        kind: 'engine-budget-resume',
        event: `engine.budget.resume.${blockId}`,
        resumeBlockId: blockId,
        vars,
      },
    });
  }
  if (loopBreakBlock) {
    // Настоящий runaway-цикл: поток оборван, продолжение НЕ планируется.
    outs.push({
      method: 'trace',
      payload: { kind: 'engine-loop-break', event: `engine.loop.break.${loopBreakBlock}` },
    });
  }

  return {
    outs,
    currentBlock: blockId ?? null,
    vars,
    ...(budgetCutoff ? { guardCutoff: true } : {}),
    ...(loopBreakBlock ? { loopBreak: true, loopBreakBlock } : {}),
  };
}

// ---------------------------------------------------------------- реферальные бонусы

// Дефолтные тексты блоков-сообщений, если автор оставил шаблон пустым.
// Интерполируются на vars бота, поэтому {{ref.count}} и т.п. работают.
const DEFAULT_REF_STATS_TEXT =
  'Вы пригласили: {{ref.count}}. Заработано: {{ref.earnings}}.';
const DEFAULT_REF_LEADERBOARD_TEXT = 'Топ пригласивших:\n{{ref.leaderboard}}';

// Факты для триггеров бонуса: счётчик приглашённых — по ПРИГЛАСИВШЕМУ (его
// прогресс к N-му рефералу), оплата/подписка — по ТЕКУЩЕМУ пользователю,
// имя события — из {{ref.event}}.
async function referralFacts(
  ops: ReferralOps,
  vars: Record<string, unknown>,
  referrerId: string,
  currentUserId: string
): Promise<{ referralCount: number; hasPayment: boolean; isSubscribed: boolean; eventName: string }> {
  let referralCount = 0;
  let hasPayment = false;
  let isSubscribed = false;
  {
    try {
      referralCount = await ops.countReferrals(referrerId);
      hasPayment = (await ops.paidTotal(currentUserId)) > 0;
      isSubscribed = await ops.isSubscribed(currentUserId);
    } catch {
      /* база не ответила — факты останутся нулевыми, триггер не сработает */
    }
  }
  // ref.count из воркера приоритетнее: он посчитан на входе по свежим данным.
  const fromVars = Number(vars[REF_COUNT_VAR]);
  if (Number.isFinite(fromVars) && fromVars > referralCount) referralCount = fromVars;
  return { referralCount, hasPayment, isSubscribed, eventName: String(vars[REF_EVENT_VAR] ?? '') };
}

// Выдача награды по конфигу блока: сообщение, инкремент переменной или дни
// подписки. Возвращает outcome-ветку ('granted' | 'skipped' | 'failed').
async function deliverBonus(
  ops: ReferralOps,
  block: Block,
  referrerId: string,
  refereeId: string,
  chatId: number | undefined,
  outs: TelegramOut[],
  vars: Record<string, unknown>
): Promise<'granted' | 'failed'> {
  const kind = block.params.refBonusKind || 'send_message';
  try {
    if (kind === 'send_message') {
      // Сообщение уходит пригласившему, а не текущему пользователю.
      outs.push({
        method: 'sendMessage',
        payload: {
          chat_id: Number(referrerId) || chatId,
          text: interpolate(block.params.refBonusText || 'Спасибо за приглашение!', vars),
        },
      });
      await ops.grantBonus(referrerId, refereeId, kind, 0, 1, Date.now());
    } else if (kind === 'increment_variable') {
      const name = String(block.params.refBonusVar || '').trim();
      const amount = Number(block.params.refBonusAmount) || 0;
      if (!name || amount <= 0) return 'failed';
      await ops.incrementVariable(referrerId, name, amount);
      await ops.grantBonus(referrerId, refereeId, kind, amount, 1, Date.now());
    } else {
      const days = Math.max(0, Math.floor(Number(block.params.refBonusDays) || 0));
      if (days <= 0) return 'failed';
      await ops.grantSubscriptionDays(referrerId, days);
      await ops.grantBonus(referrerId, refereeId, 'grant_subscription_days', days, 1, Date.now());
    }
    return 'granted';
  } catch {
    return 'failed';
  }
}

// referral_bonus: триггер → антифрод → выдача. Возвращает ключ ветки либо null,
// когда идти нужно по next (нет хранилища / нет пригласившего).
async function runReferralBonus(
  opts: { referral?: ReferralOps },
  block: Block,
  scenario: Scenario,
  vars: Record<string, unknown>,
  tgUserId: number,
  chatId: number | undefined,
  outs: TelegramOut[]
): Promise<'granted' | 'skipped' | 'failed' | null> {
  if (!opts.referral || !tgUserId) return null;
  const uid = String(tgUserId);
  try {
    const referrer = await opts.referral.referrerOf(uid);
    if (!referrer || referrer === uid) return 'skipped';
    const facts = await referralFacts(opts.referral, vars, referrer, uid);
    if (!bonusTriggerFires(block.params, facts)) return 'skipped';
    const af = findAntifraudSettings(scenario);
    const blocked = await opts.referral.bonusAllowed(referrer, uid, af, Date.now());
    if (blocked) return 'skipped';
    return await deliverBonus(opts.referral, block, referrer, uid, chatId, outs, vars);
  } catch {
    return 'failed';
  }
}

// referral_hierarchy: доли события распределяются по цепочке пригласивших.
// Событие — оплата текущего пользователя (revenue share): сумма берётся из
// его платежей, доли начисляются уровням 1..depth их пригласившим.
async function runReferralHierarchy(
  opts: { referral?: ReferralOps },
  block: Block,
  scenario: Scenario,
  vars: Record<string, unknown>,
  tgUserId: number,
  outs: TelegramOut[]
): Promise<'granted' | 'skipped' | 'failed' | null> {
  if (!opts.referral || !tgUserId) return null;
  const uid = String(tgUserId);
  try {
    const shares = normalizeShares(block.params.refShares, block.params.refDepth ?? 1);
    if (!hierarchySharesValid(shares)) return 'failed';
    const chain = await opts.referral.referrerChain(uid, shares.length);
    if (!chain.length) return 'skipped';
    // Триггеры — те же, что у referral_bonus: событие относится к текущему
    // пользователю (его оплата/подписка), счётчик N — к первому уровню цепочки.
    const facts = await referralFacts(opts.referral, vars, chain[0], uid);
    if (!bonusTriggerFires(block.params, facts)) return 'skipped';
    // База распределения — сумма платежей пользователя (событие first_payment).
    const paid = await opts.referral.paidTotal(uid);
    if (paid <= 0) return 'skipped';
    const af = findAntifraudSettings(scenario);
    const now = Date.now();
    let grantedAny = false;
    for (let i = 0; i < Math.min(chain.length, shares.length); i++) {
      const referrer = chain[i];
      if (!referrer || referrer === uid || shares[i] <= 0) continue;
      const blocked = await opts.referral.bonusAllowed(referrer, uid, af, now);
      if (blocked) continue;
      const amount = Math.round(paid * shares[i]);
      if (amount <= 0) continue;
      try {
        outs.push({
          method: 'sendMessage',
          payload: {
            chat_id: Number(referrer),
            text: interpolate(
              block.params.refBonusText || 'Начислено {{ref.share}} за покупку приглашённого.',
              { ...vars, 'ref.share': amount, 'ref.level': i + 1 }
            ),
          },
        });
        await opts.referral.grantBonus(referrer, uid, 'revenue_share', amount, i + 1, now);
        grantedAny = true;
      } catch {
        /* один уровень не выплатился — остальные пробуем */
      }
    }
    return grantedAny ? 'granted' : 'skipped';
  } catch {
    return 'failed';
  }
}

// F-025/F-026: рантайм-лог «понятная причина». Статические превышения ловит
// валидатор (error до публикации), но после интерполяции {{…}} длина может
// выйти за лимит уже в бою — тогда Telegram отвечает 400, сообщение теряется,
// а в логе раньше был только голый send.error. Здесь движок пишет причину с
// блоком-источником ДО отправки: send.error в логах воркера теперь соседствует
// с этой строкой и автор видит, что именно не так. Поведение не меняется:
// обрезка/разбивка — продуктовое решение, отправка уходит как есть.
function warnTelegramLength(what: string, len: number, limit: number, blockId?: string): void {
  if (len <= limit) return;
  console.warn(`[engine] telegram length limit exceeded: ${what} ${len} > ${limit}`, {
    blockId: blockId ?? '',
    reason: 'Telegram ответит 400, сообщение не отправится',
  });
}

// Рендер-функция опроса общая у poll и quiz: проверяем вопрос и варианты после
// интерполяции (статические случаи валидатор отсекает до публикации).
function warnPollLengths(
  question: string,
  options: { text: string }[],
  blockId: string
): void {
  warnTelegramLength('poll question', question.length, TG_POLL_QUESTION_MAX, blockId);
  options.forEach((o, i) => warnTelegramLength(`poll option ${i + 1}`, o.text.length, TG_POLL_OPTION_MAX, blockId));
}

// Helper: push a Telegram send* out, attaching an optional persistent __menu keyboard.
function pushMessage(
  outs: TelegramOut[],
  chatId: number | undefined,
  text: string,
  vars: Record<string, unknown>,
  extraReplyMarkup?: Record<string, unknown>,
  method: string = 'sendMessage',
  media?: Record<string, string>,
  // Блок-источник: нужен только ради parseMode/disablePreview. Без него
  // поведение прежнее — ни parse_mode, ни link_preview_options не добавляются.
  source?: Block
) {
  const reply_markup = extraReplyMarkup ?? (vars['__menu'] ? buildMenuKeyboard(vars) : undefined);
  const markup = source ? attachMarkup(source, vars) : {};
  if (method === 'sendMessage') {
    warnTelegramLength('message text', text.length, TG_MESSAGE_TEXT_MAX, source?.id);
    outs.push({
      method,
      payload: { chat_id: chatId, text, ...markup, ...(reply_markup ? { reply_markup } : {}) },
    });
  } else {
    warnTelegramLength('media caption', text.length, TG_CAPTION_MAX, source?.id);
    outs.push({
      method,
      payload: { chat_id: chatId, caption: text, ...media, ...markup, ...(reply_markup ? { reply_markup } : {}) },
    });
  }
}

function buildKeyboard(block: Block): Record<string, unknown> {
  const buttons = block.params.buttons || [];
  if (block.params.layout === 'reply') {
    return { keyboard: buttons.map((b) => [{ text: b.label }]), resize_keyboard: true, one_time_keyboard: true };
  }
  return {
    inline_keyboard: buttons.map((b) =>
      b.url ? [{ text: b.label, url: b.url }] : [{ text: b.label, callback_data: b.value }]
    ),
  };
}

// Cache parsed persistent-menu keyboards by their JSON string so we don't
// JSON.parse() the same menu on every outgoing message while it stays active.
// Размер ограничен (LRU): ключ — текст меню, который задаёт автор бота, поэтому
// неограниченная Map в изоляте росла бы всё время жизни воркера.
const MENU_CACHE_MAX = 50;
const menuKeyboardCache = new Map<string, Record<string, unknown> | undefined>();
function buildMenuKeyboard(vars: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = vars['__menu'];
  if (raw == null) return undefined;
  const key = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (menuKeyboardCache.has(key)) {
    const hit = menuKeyboardCache.get(key);
    // Map хранит порядок вставки: переставляем ключ в конец = «недавно использован».
    menuKeyboardCache.delete(key);
    menuKeyboardCache.set(key, hit);
    return hit;
  }
  let kb: Record<string, unknown> | undefined;
  try {
    const menu = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    kb = menu?.buttons?.length
      ? { keyboard: menu.buttons.map((b: { label: string }) => [{ text: b.label }]), resize_keyboard: true }
      : undefined;
  } catch {
    kb = undefined;
  }
  menuKeyboardCache.set(key, kb);
  while (menuKeyboardCache.size > MENU_CACHE_MAX) {
    const oldest = menuKeyboardCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    menuKeyboardCache.delete(oldest);
  }
  return kb;
}

function evalCond(left: string, op: ConditionOp, right: string): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case 'contains':
      return left.includes(right);
    case '>':
      return Number(left) > Number(right);
    case '<':
      return Number(left) < Number(right);
  }
  return false;
}

// Легаси-путь: старое поведение сохраняется ровно (для '>'/'<' сравнение только
// числовое — нечисловые строки дают false, как раньше). Операторы, которых в
// старых сценариях быть не могло, делегируются новой реализации: если автор
// осознанно выбрал 'in'/'regex' на легаси-полях, они должны работать.
function evalLegacyCond(left: string, op: ConditionOp, right: string): boolean {
  if (op === '>' || op === '<') return evalCond(left, op, right);
  return evalConditionOp(left, op, right);
}

// ------------------------------------------------------------------ новые блоки
//
// Всё, что ниже, обслуживает набор 2026-09. Правило совместимости: если новых
// полей в params нет, код ведёт себя как раньше — старые сценарии не меняются.

// -------------------------------- разметка и операции с сообщениями

// Текст с интерполяцией и экранированием под parseMode. Без parseMode — это
// ровно старый interpolate(): ни одного лишнего преобразования.
function render(template: string, vars: Record<string, unknown>, mode: ParseMode | undefined): string {
  return renderMarkup(template ?? '', vars, mode);
}

// Поля payload, зависящие от parseMode/disablePreview. Пустой объект, когда
// автор ничего не выбрал: тогда payload остаётся прежним (важно и для
// работающих ботов, и для теста байтовой совместимости).
function attachMarkup(block: Block, vars: Record<string, unknown>): Record<string, unknown> {
  const p = block.params;
  const out: Record<string, unknown> = {};
  // parse_mode не шлём при 'none' — Telegram не понимает такое значение.
  if (p.parseMode && p.parseMode !== 'none') out.parse_mode = p.parseMode;
  if (p.disablePreview) out.link_preview_options = { is_disabled: true };
  void vars;
  return out;
}

// Операции удаления сообщений (deleteUserMessage / deleteBotMessage).
// id сообщения пользователя берём из текущего апдейта; id последнего сообщения
// бота кладёт воркер в {{__bot_msg}} после отправки (форма { chatId, messageId }).
// Ошибки удаления воркер логирует и глотает: Telegram запрещает удалять
// сообщения старше 48 часов, и это не должно рвать сценарий.
function pushDeletes(
  outs: TelegramOut[],
  block: Block,
  chatId: number | undefined,
  incomingMessageId: number | undefined,
  vars: Record<string, unknown>
): void {
  if (block.params.deleteUserMessage && incomingMessageId != null && chatId != null) {
    outs.push({ method: 'deleteMessage', payload: { chat_id: chatId, message_id: incomingMessageId } });
  }
  if (block.params.deleteBotMessage) {
    const raw = vars[BOT_MSG_VAR];
    if (raw && typeof raw === 'object') {
      const bm = raw as { chatId?: number; messageId?: number };
      const chat = Number(bm.chatId ?? chatId);
      const messageId = Number(bm.messageId);
      if (Number.isFinite(chat) && Number.isFinite(messageId) && messageId > 0) {
        outs.push({ method: 'deleteMessage', payload: { chat_id: chat, message_id: messageId } });
        // id израсходован: повторное удаление того же сообщения на следующем
        // блоке — гарантированная ошибка Telegram и лишний лог.
        delete vars[BOT_MSG_VAR];
      }
    }
  }
}

// Куда править сообщение при updateMode: 'edit'. Берём chat_id/message_id
// нажатой кнопки из {{__cb_msg}} — но только если апдейт вообще был callback'ом
// (иначе править нечего, и мы отправляем новое сообщение).
function cbEditTarget(
  block: Block,
  vars: Record<string, unknown>,
  chatId: number | undefined
): { chatId: number; messageId: number } | null {
  if (block.params.updateMode !== 'edit') return null;
  const raw = vars[CB_MSG_VAR];
  if (!raw || typeof raw !== 'object') return null;
  const cb = raw as { chatId?: number; messageId?: number };
  const chat = Number(cb.chatId ?? chatId);
  const messageId = Number(cb.messageId);
  if (!Number.isFinite(chat) || !Number.isFinite(messageId) || messageId <= 0) return null;
  return { chatId: chat, messageId };
}

// Правка сообщения на месте. Если текста нет, а клавиатура изменилась —
// достаточно editMessageReplyMarkup.
function emitEdit(
  outs: TelegramOut[],
  target: { chatId: number; messageId: number },
  text: string,
  vars: Record<string, unknown>,
  block: Block,
  keyboard?: Record<string, unknown>
): void {
  const payload: Record<string, unknown> = {
    chat_id: target.chatId,
    message_id: target.messageId,
    ...attachMarkup(block, vars),
  };
  if (text.trim()) {
    payload.text = text;
    if (keyboard) payload.reply_markup = keyboard;
    outs.push({ method: 'editMessageText', payload });
  } else if (keyboard) {
    payload.reply_markup = keyboard;
    outs.push({ method: 'editMessageReplyMarkup', payload });
  }
}

// answerCallbackQuery по параметрам блока: toast (без alert) или alert.
// Правило: один апдейт — один ответ на callback, поэтому alert приоритетнее
// toast; если не задано ни то, ни другое — воркер снимает «часики» своим
// безусловным фолбэком. callback_query_id подставляет воркер.
function pushCallbackUx(outs: TelegramOut[], block: Block): void {
  const alert = (block.params.cbAlert || '').trim();
  const toast = (block.params.cbToast || '').trim();
  if (!alert && !toast) return;
  outs.push({
    method: 'answerCallbackQuery',
    payload: { text: alert || toast, show_alert: !!alert },
  });
}

// -------------------------------- вложения во «Ввод»

// Виды ввода, которые закрываются вложением, а не текстом. Текстовое сообщение
// на таком блоке не должно записываться как «ответ»: иначе в переменную попадёт
// случайная фраза вместо файла.
const ATTACHMENT_INPUT_KINDS = ['photo', 'document', 'video', 'voice', 'audio', 'location', 'any', 'contact'];

function textInputKind(kind: InputKind | undefined): boolean {
  return !kind || !ATTACHMENT_INPUT_KINDS.includes(kind);
}

function inputPromptFor(kind: InputKind): string {
  switch (kind) {
    case 'photo':
      return 'Пришлите фото';
    case 'document':
      return 'Пришлите документ';
    case 'video':
      return 'Пришлите видео';
    case 'voice':
      return 'Запишите голосовое сообщение';
    case 'audio':
      return 'Пришлите аудио';
    case 'location':
      return 'Отправьте геолокацию';
    case 'any':
      return 'Отправьте что-нибудь';
    default:
      return 'Введите значение';
  }
}

// Что записать в переменную для пришедшего вложения.
// document/video/voice/audio -> file_id (+ имя файла и mime, если есть),
// location -> «lat,lon», any -> вид вложения либо лучший доступный payload.
function readAttachment(
  msg: any,
  kind: InputKind | undefined
): { value: unknown; fileName?: string; mimeType?: string } | null {
  if (!msg) return null;
  const doc = msg.document;
  const video = msg.video;
  const voice = msg.voice;
  const audio = msg.audio;
  const location = msg.location;

  switch (kind) {
    case 'document':
      if (!doc?.file_id) return null;
      return { value: doc.file_id, fileName: doc.file_name ?? undefined, mimeType: doc.mime_type ?? undefined };
    case 'video':
      if (!video?.file_id) return null;
      return { value: video.file_id, fileName: video.file_name ?? undefined, mimeType: video.mime_type ?? undefined };
    case 'voice':
      if (!voice?.file_id) return null;
      return { value: voice.file_id, mimeType: voice.mime_type ?? undefined };
    case 'audio':
      if (!audio?.file_id) return null;
      return { value: audio.file_id, fileName: audio.file_name ?? undefined, mimeType: audio.mime_type ?? undefined };
    case 'location':
      if (!location) return null;
      return { value: `${location.latitude},${location.longitude}` };
    case 'any': {
      if (msg.photo?.length) return { value: msg.photo[msg.photo.length - 1].file_id };
      if (doc?.file_id) return { value: doc.file_id, fileName: doc.file_name, mimeType: doc.mime_type };
      if (video?.file_id) return { value: video.file_id, fileName: video.file_name };
      if (voice?.file_id) return { value: voice.file_id };
      if (audio?.file_id) return { value: audio.file_id };
      if (msg.sticker?.file_id) return { value: msg.sticker.file_id };
      if (location) return { value: `${location.latitude},${location.longitude}` };
      if (typeof msg.text === 'string') return { value: msg.text };
      if (typeof msg.caption === 'string') return { value: msg.caption };
      return null;
    }
    default:
      return null;
  }
}

// -------------------------------- составные условия (TASK 5)

// Потолок длины строки для оператора 'regex': синхронный RegExp.test на данных
// пользователя с катастрофическим паттерном автора ((a+)+$) блокирует изолят
// на минуты, а в Workers синхронный код не прервать таймаутом.
const MAX_REGEX_INPUT = 1000;

// Базовый формат e-mail для kind:'email' блока «Ввод». Сознательно не
// RFC-валидатор: в чат-боте цель — поймать бытовую опечатку («без собачки»,
// «без точки в домене», пробел внутри), а не отсечь экзотические, но легальные
// адреса. Дополнительная regex-проверка автора (params.regex) поверх этого —
// по-прежнему работает.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Эвристика катастрофического бэктрекинга — общая с валидатором
// (shared/types.ts: hasDangerousRepetition, F-023): ловит вложенные
// квантификаторы (a+)+ / (\w*)* / ([a-z]+){2,} И перекрытие альтернатив
// (a|a)+ / (a|ab)+. Валидатор отсекает такие паттерны до публикации
// (error cond-regex-danger / input-regex-danger), а движок страхует рантайм:
// синхронный RegExp.test в Workers не прерывается, 22 символа входа на (a|a)+$
// блокировали изолят на 15 секунд.
const hasNestedQuantifier = hasDangerousRepetition;

// Проверить один оператор. Числовое сравнение — когда ОБЕ стороны разбираются
// как конечные числа, иначе лексикографическое (строковое).
export function evalConditionOp(leftRaw: string, op: ConditionOp, rightRaw: string): boolean {
  const left = String(leftRaw ?? '');
  const right = String(rightRaw ?? '');
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case 'contains':
      return left.includes(right);
    case '>':
    case '<':
    case '>=':
    case '<=': {
      // Числа — только если обе стороны действительно числа. «10» > «9» иначе
      // сравнилось бы как строки и дало ложный результат.
      const ln = Number(left);
      const rn = Number(right);
      const numeric = left.trim() !== '' && right.trim() !== '' && Number.isFinite(ln) && Number.isFinite(rn);
      if (numeric) {
        if (op === '>') return ln > rn;
        if (op === '<') return ln < rn;
        if (op === '>=') return ln >= rn;
        return ln <= rn;
      }
      if (op === '>') return left > right;
      if (op === '<') return left < right;
      if (op === '>=') return left >= right;
      return left <= right;
    }
    case 'in':
    case 'not_in': {
      // Правая часть — список через запятую. Регистр и пробелы не важны:
      // «Москва, спб» и «москва» должны совпасть.
      const list = right.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s !== '');
      const hit = list.includes(left.trim().toLowerCase());
      return op === 'in' ? hit : !hit;
    }
    case 'starts_with':
      return right !== '' && left.startsWith(right);
    case 'ends_with':
      return right !== '' && left.endsWith(right);
    case 'empty':
      // Пусто — это '' или undefined. '0' НЕ пусто: ноль — осмысленное значение
      // счётчика, и считать его пустым значило бы ломать сценарии про баланс.
      return left === '';
    case 'not_empty':
      return left !== '';
    case 'regex': {
      // Защита от ReDoS: ограничиваем длину входа и запрещаем катастрофические паттерны
      const inputStr = String(left).slice(0, MAX_REGEX_INPUT);
      if (hasNestedQuantifier(right)) {
        // Катастрофический бэктрекинг — ложь, как битый регексп: синхронный
        // test() в Workers не прерывается и заблокировал бы изолят.
        console.warn('[engine] catastrophic regex rejected', { pattern: right.slice(0, 64) });
        return false;
      }
      try {
        return new RegExp(right).test(inputStr);
      } catch {
        // Битый регексп — ложь, а не исключение: сценарий не должен падать.
        return false;
      }
    }
  }
  return false;
}

// Значение левой части для source: 'user' — из профиля или из уже выложенных
// в переменные user.*; для 'tag' — из тегов; иначе из переменных сценария.
async function conditionLeft(
  def: ConditionDef,
  opts: { tags?: TagOps; users?: UserOps },
  vars: Record<string, unknown>,
  tgUserId: number
): Promise<{ ok: boolean; left: string }> {
  const name = interpolate(def.var || '', vars).trim();
  if (!name) return { ok: false, left: '' };
  if (def.source === 'tag') {
    const tag = normalizeTag(name);
    if (!tag || !opts.tags || !tgUserId) return { ok: false, left: '' };
    try {
      const has = await opts.tags.has(tag, tgUserId);
      // Тег — факт «есть/нет»: для ==/!=/empty/not_empty это 1/''. Операторы
      // вроде «больше» для тега бессмысленны и дадут ложь (валидатор предупредит).
      return { ok: true, left: has ? '1' : '' };
    } catch {
      return { ok: false, left: '' };
    }
  }
  if (def.source === 'user') {
    // Сначала — уже выложенные переменные ({{user.name}} после user_stats),
    // потом — живой профиль. Так условие работает и без UserOps.
    const direct = vars[name] ?? vars[`user.${name}`];
    if (direct !== undefined) return { ok: true, left: String(direct ?? '') };
    if (!opts.users || !tgUserId) return { ok: false, left: '' };
    try {
      const profile = await opts.users.profile(tgUserId);
      const values: Record<string, unknown> = {
        name: profile.name,
        username: profile.username,
        id: profile.id,
        tags: profile.tags.join(', '),
        subscription: profile.subscription ? '1' : '',
        paid_total: profile.paidTotal,
        ref_count: profile.refCount,
        first_seen: profile.firstSeen ?? '',
      };
      const key = name.startsWith('user.') ? name.slice(5) : name;
      return { ok: true, left: String(values[key] ?? '') };
    } catch {
      return { ok: false, left: '' };
    }
  }
  return { ok: true, left: String(vars[name] ?? '') };
}

  // Проверить набор условий. Легаси-режим (нет conditions или массив пуст):
// работает пара condVar/op/condValue ровно как раньше — включая condSource:'tag'.
// Новый режим: conditions[] + logic ('and' по умолчанию).
export async function evalConditionSet(
  params: BlockParams,
  opts: { tags?: TagOps; users?: UserOps },
  vars: Record<string, unknown>,
  tgUserId: number
): Promise<boolean> {
  const list = (params.conditions || []).filter((c) => c && (c.var || '').trim() !== '');

  // --- легаси-путь: одиночное условие по переменной или тегу ---
  if (!list.length) {
    if (params.condSource === 'tag') {
      const tag = normalizeTag(interpolate(params.condVar || '', vars));
      const op = params.op || '==';
      let has = false;
      if (tag && opts.tags && tgUserId) {
        try {
          has = await opts.tags.has(tag, tgUserId);
        } catch {
          has = false;
        }
      }
      return op === '!=' ? !has : has;
    }
    const name = params.condVar || '';
    if (!name) return false;
    return evalLegacyCond(String(vars[name] ?? ''), params.op || '==', interpolate(params.condValue ?? '', vars));
  }

  // --- новый путь: список условий, объединённых and/or ---
  const and = (params.logic || 'and') !== 'or';
  let result = and;
  for (const def of list) {
    const { ok, left } = await conditionLeft(def, opts, vars, tgUserId);
    const right = interpolate(def.value ?? '', vars);
    const hit = ok && evalConditionOp(left, def.op, right);
    if (and) {
      result = result && hit;
      // «И» уже ложно — считать остальное незачем: это заметно на цепочке
      // условий по тегам, каждое из которых ходит в базу.
      if (!result) break;
    } else {
      result = result || hit;
      if (result) break;
    }
  }
  return result;
}

// -------------------------------- вспомогательные функции новых блоков

// Потолок итераций цикла (HARD_LOOP_CAP) теперь живёт в shared/limits.ts и
// равен MAX_ENGINE_STEPS: недопройденный цикл продолжается через resume
// (состояние __loop.<id> переживает запись сессии), поэтому заявленная
// вместимость и фактическая больше не расходятся.

// Список для цикла: массив из data.find, JSON-строка или строка через запятую.
function parseLoopList(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.values(raw as Record<string, unknown>);
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Битый JSON не должен ронять сценарий: считаем список одним элементом.
      return [s];
    }
  }
  return s.split(',').map((x) => x.trim()).filter((x) => x !== '');
}

// Состояние цикла из переменных. Хранится как объект {items, index} и потому
// переживает запись сессии между апдейтами (vars_json).
function readLoopState(raw: unknown): { items: unknown[]; index: number } | null {
  if (!raw) return null;
  let obj: any = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.items)) return null;
  const index = Math.max(0, Math.floor(Number(obj.index) || 0));
  return { items: obj.items, index };
}

// Опции опроса: основной список — pollOptions, но исторически у блока могли
// быть поля question/options. Читаем только pollOptions: `options` занято
// блоком «Случайный выбор» (OptionDef с key/weight), и подмена типов тут
// превратила бы чужие данные в варианты опроса.
export function readPollOptions(block: Block): { id?: string; text: string }[] {
  return (block.params.pollOptions || [])
    .filter((o) => o && String(o.text ?? '').trim() !== '')
    .map((o) => ({ id: o.id, text: o.text }));
}

// Кэш проверки канала: {member, ts}. Возвращает null, если кэш пуст или истёк.
function readChannelCache(raw: unknown, minutes: number | undefined): boolean | null {
  if (!raw) return null;
  let obj: any = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const ttl = Math.max(0, Math.floor(Number(minutes ?? 10) || 0)) * 60_000;
  const ts = Number(obj.ts ?? 0);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (ttl <= 0 || Date.now() - ts > ttl) return null;
  return !!obj.member;
}

// Куда пересылать/копировать: публичный @channel, числовой id или {{var}}.
// Telegram принимает и @name, и -100..., поэтому оставляем строку как есть,
// но приводим числовой id к числу: строку с минусом Telegram тоже примет, а
// вот «@name» числом сделать нельзя.
export function resolveToChat(block: Block, vars: Record<string, unknown>, tgUserId: number): string | number | null {
  const raw = interpolate(block.params.toChatId || '', vars).trim();
  if (raw) {
    if (/^-?\d+$/.test(raw)) return Number(raw);
    return raw;
  }
  // Без явного адреса пересылаем самому пользователю — так блок остаётся
  // осмысленным по умолчанию.
  return tgUserId || null;
}

// Сообщение по умолчанию для не пройденного утверждения. Текст русский, как и
// остальные дефолты движка (см. «Нужно число. Попробуйте ещё раз.»).
const DEFAULT_ASSERT_FAIL = 'Проверка не пройдена.';
