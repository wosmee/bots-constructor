// Shared domain types for the No-code Bot Constructor.
// Single source of truth consumed by both the Worker (engine) and the web (constructor UI).
import type { ScheduleKind, ScheduleAudience } from './cron';
export type { ScheduleKind, ScheduleAudience };

export type BlockType =
  | 'start'
  | 'message'
  | 'buttons'
  | 'input'
  | 'condition'
  | 'action'
  | 'goto'
  | 'end'
  | 'media'
  | 'subscription'
  | 'menu'
  // v2 block set
  | 'command'
  | 'keyword'
  | 'setvar'
  | 'http'
  | 'ai'
  | 'random'
  | 'switch'
  | 'contact'
  | 'note'
  // рефералка: генерирует персональную ссылку приглашения
  | 'referral'
  // альбом медиа (sendMediaGroup): несколько фото/видео одним сообщением
  | 'media_group'
  // оплата: выставляет счёт через Telegram Payments
  | 'invoice'
  // данные: запись/поиск/обновление/удаление в таблицах самого бота
  | 'data'
  // теги пользователя: пометки вроде «VIP», «купил», «новенький» (F2)
  | 'tag'
  // цепочка сообщений: текст, фото, документ — отдельными сообщениями по порядку (F3)
  | 'chain'
  // реферальная система: учёт, условия, бонусы, статистика, турниры, антифрод.
  // `referral` (ссылка) исторически первый — его тип НЕ переименован, чтобы
  // сохранённые сценарии и флаг has_referral продолжали работать.
  | 'referral_track'
  | 'referral_check'
  | 'referral_bonus'
  | 'referral_stats'
  | 'referral_leaderboard'
  | 'referral_hierarchy'
  | 'referral_tournament'
  | 'referral_verification'
  | 'antifraud'
  // --- набор 2026-09: платформенные блоки (см. docs/CODEBASE.md) ---
  // Опрос (sendPoll) с ветками «ответил» / «пропустил».
  | 'poll'
  // Пересылка сообщения (forward/copy/text) в указанный чат.
  | 'forward'
  // Chat action («печатает…»): не блокирует сценарий, идёт по next.
  | 'chat_action'
  // Ожидание с таймаутом: ветки «ответил» / «таймаут» (таймер в scheduled_sends).
  | 'wait'
  // Проверка членства в канале/чате: member / not_member / error.
  | 'channel_check'
  // Рассылка по сегменту через существующую очередь (scheduled_sends).
  | 'segment_broadcast'
  // Профиль пользователя и статистика (user.*) в текст сообщения.
  | 'user_stats'
  // Платёжная ссылка: счёт Telegram Payments либо внешний checkout.
  | 'payment_link'
  // Проверка статуса заказа, созданного payment_link.
  | 'payment_check'
  // Цикл по списку: итерация — ветка `each`, конец — `done`.
  | 'foreach'
  // Случайный текст из вариантов с весами.
  | 'random_text'
  // Утверждение: условия прошли / не прошли.
  | 'assert'
  // Счётчик на пользователя или на бота (атомарный инкремент).
  | 'counter'
  // Mini App: сообщение с инлайн-кнопкой, открывающей Telegram Web App
  // (полная ссылка https://t.me/<bot>/<slug>). Ветвей нет — идём по next.
  | 'web_app'
  // Расписание: регистрационный блок — вносит сценарий в bot_schedules
  // (миграция 0027), крон воркера запускает поток по времени. Ветвей нет.
  | 'schedule'
  // --- подсценарии (библиотека фрагментов) ---
  // Блок-вызов подсценария: exists ТОЛЬКО в авторском сценарии. До движка не
  // доходит никогда — публикация раскрывает вызовы в плоский сценарий
  // (shared/subflow.ts). Ветки: done / failed.
  | 'subflow'
  // Терминальный маркер внутри фрагмента: возвращает управление вызывающему
  // и (опционально) мапит выходы в переменные вызывающего.
  | 'subflow_return'
  // --- набор 2026-10: управление сообщениями, время, входные события, ИИ ---
  // Правка уже отправленного сообщения по message_id из переменной.
  // Ветки: ok / too_old / not_found.
  | 'edit_message'
  // Удаление сообщения по message_id из переменной. Веток нет (next),
  // ошибки глотаются с логом: удаление — косметика, не логика сценария.
  | 'delete_message'
  // Тест с проверкой ответа: sendPoll в quiz-режиме, ветки passed / failed
  // по сравнению option_ids ответа с correctOptionId. Переиспользует параметры
  // poll (pollOptions, correctOptionId, explanation, anonymous).
  | 'quiz'
  // Ветвление по языку пользователя: language_code из апдейта. Ветки — коды
  // языков (ru, en, …) плюс fallback; переменная user.lang для условий.
  | 'language'
  // Дедлайн с авто-веткой: крон по наступлении срока гонит ветку expired,
  // действие раньше срока (cancelVar установлен или событие cancel) — done.
  // Механизм — bot_schedules (как schedule), но привязан к пользователю.
  | 'timer_deadline'
  // ИИ-классификатор: список меток -> модель выбирает одну -> ветки по меткам
  // плюс fallback, когда ответ не разобран.
  | 'ai_classify'
  // Входящий вебхук как триггер сценария: регистрационный блок (как schedule),
  // создаёт токен-эндпоинт /hook/<bot>/<token>; тело кладётся в wh.* переменные.
  | 'webhook_in'
  // Запрос геопозиции: клавиатура с кнопкой request_location, ждём апдейт с
  // location. Ветки sent / refused; переменные user.lat / user.lon.
  | 'location';

// Префикс id блоков, развёрнутых из подсценария: `sf:<alias>:<originalId>`.
// Alias (или индекс вызова) входит в префикс, поэтому два вызова одного
// фрагмента физически не могут столкнуться id.
export const SUBFLOW_ID_PREFIX = 'sf:';

// Все блоки реферальной системы. `referral` (ссылка) входит в семейство:
// по этому списку сценарий помечается флагом has_referral, а воркер знает,
// что на каждое сообщение нужно готовить ref.* переменные.
export const REFERRAL_BLOCK_TYPES: BlockType[] = [
  'referral',
  'referral_track',
  'referral_check',
  'referral_bonus',
  'referral_stats',
  'referral_leaderboard',
  'referral_hierarchy',
  'referral_tournament',
  'referral_verification',
  'antifraud',
];

// Операторы сравнения. Исторические пять (==, !=, >, <, contains) расширены
// набором 2026-09: строковые in/not_in/starts_with/ends_with/empty/not_empty/
// regex и числовые >= / <=. Старые сценарии используют только первые пять —
// их семантика не менялась.
export type ConditionOp =
  | '=='
  | '!='
  | '>'
  | '<'
  | 'contains'
  | 'in'
  | 'not_in'
  | 'starts_with'
  | 'ends_with'
  | 'empty'
  | 'not_empty'
  | 'regex'
  | '>='
  | '<=';

// Одно условие в составном списке (condition/assert). Отдельный интерфейс, а
// не поля в BlockParams: движок и валидатор получают массив целиком.
export type ConditionSource = 'var' | 'tag' | 'user';

// Что блок «Ввод» ждёт от пользователя. Исторические text/number/email/photo
// дополнены вложениями, геолокацией и режимом «любой апдейт».
export type InputKind =
  | 'text'
  | 'number'
  | 'email'
  | 'photo'
  | 'document'
  | 'video'
  | 'voice'
  | 'audio'
  | 'location'
  | 'any';

export interface ConditionDef {
  // По чему сравниваем: переменная сценария, тег человека или поле user.*
  // (имя, username, id, tags, subscription, paid_total, ref_count, first_seen).
  source: ConditionSource;
  // Имя переменной/тега/поля профиля. Для source 'user' допустимо короткое имя
  // ('name') и полное ('user.name') — движок нормализует сам.
  var: string;
  op: ConditionOp;
  // Правая часть сравнения; поддерживает {{var}}.
  value: string;
}

export interface ButtonDef {
  // Стабильный id элемента списка: нужен React, чтобы при удалении строки
  // состояние соседних инпутов не переезжало. Движок его игнорирует.
  id?: string;
  label: string;
  value: string; // callback_data / branch key
  url?: string; // if set -> Telegram url-button (no branch)
}

export interface CaseDef {
  id?: string; // см. ButtonDef.id
  value: string; // compared against the switch variable
}

export interface OptionDef {
  id?: string; // см. ButtonDef.id
  key: string; // branch key
  weight: number; // relative weight for the random pick
}

// Элемент медиа-альбома (sendMediaGroup): Telegram принимает от 2 до 10 элементов
// в одном альбоме, у каждого — свой type (photo/video), URL либо file_id и
// опциональная подпись (caption). Подпись поддерживает {{var}}.
export interface MediaItemDef {
  id?: string; // см. ButtonDef.id
  type: 'photo' | 'video';
  url?: string;
  fileId?: string;
  caption?: string;
}

// Элемент цепочки сообщений (F3), в отличие от альбома — каждое сообщение
// уходит отдельным вызовом Telegram. Поэтому здесь шире набор типов:
// текст и аудио альбом не поддерживает, а цепочка — да.
export interface ChainItemDef {
  id?: string; // см. ButtonDef.id
  kind: 'text' | 'photo' | 'video' | 'audio' | 'document';
  text?: string; // для kind === 'text'
  url?: string; // публичная ссылка на файл
  fileId?: string; // file_id Telegram (приоритет выше url)
  caption?: string; // подпись к медиа, поддерживает {{var}}
}

// Реквизиты платежа (Telegram Payments / sendInvoice).
// provider_token обязателен — без него Telegram не примет счёт. Источник — BotFather
// → Payments → провайдер (ЮKassa, Stripe, ...). Поле может содержать {{var}}.
export interface InvoiceParams {
  title: string; // заголовок счёта
  description: string; // описание позиции
  // Цена в МИНИМАЛЬНЫХ единицах валюты (для RUB — копейки). Поддерживает {{expr}}.
  amount: number | string;
  currency?: string; // по умолчанию RUB
  // Подпись одной позиции (label), показывается пользователю в счёте.
  label?: string;
  payload?: string; // вернётся в successful_payment.telegram_payment_charge_id → payload
  providerToken?: string; // provider_token (BotFather). Если пусто — invoice не отправится.
  photoUrl?: string; // URL картинки товара (необязательно)
}

export interface BlockParams {
  // --- common ---
  disabled?: boolean; // block is skipped at runtime (stays on canvas)
  // start
  command?: string; // default '/start'
  // message
  text?: string; // supports {{var}}
  // buttons
  prompt?: string; // caption above the keyboard
  layout?: 'inline' | 'reply';
  buttons?: ButtonDef[]; // each button -> branch key = value
  // input
  var?: string; // variable name to store
  // Вид ожидаемого ввода. Кроме текстовых (text/number/email) блок умеет ждать
  // вложение (photo/document/video/voice/audio), геолокацию и «любой» апдейт.
  kind?: InputKind;
  regex?: string; // optional validation (JS regex source)
  errorText?: string; // shown when validation fails
  // condition
  condVar?: string;
  op?: ConditionOp;
  condValue?: string;
  // action
  actionKind?: 'webhook' | 'notify' | 'delay' | 'broadcast';
  url?: string; // webhook
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  notifyText?: string; // notify admin
  seconds?: number; // delay
  broadcastText?: string; // broadcast message (supports {{var}})
  // goto
  target?: string; // target block id
  // media
  mediaType?: 'photo' | 'video' | 'document';
  mediaUrl?: string; // public URL
  fileId?: string; // Telegram file_id (takes priority over url)
  caption?: string; // supports {{var}}
  // subscription
  subAction?: 'subscribe' | 'unsubscribe';
  // menu (persistent reply keyboard)
  menuPrompt?: string;
  // command (entry point by /command)
  description?: string; // shown in the block list / docs
  // keyword (text router)
  keywords?: string; // comma separated
  matchMode?: 'contains' | 'equals';
  // setvar (assign / arithmetic)
  assignVar?: string;
  expr?: string; // "1", "{{count}} + 1", "{{price}} * 0.9"
  // http request
  headersJson?: string;
  bodyJson?: string;
  jsonPath?: string; // dot path, e.g. "data.price"
  outVar?: string;
  // ai
  aiPrompt?: string;
  aiSystem?: string;
  aiModel?: string; // overrides the platform default
  aiVar?: string; // where to store the answer
  aiReply?: boolean; // send the answer to the user
  // random (A/B split)
  options?: OptionDef[];
  // switch (multi-branch router)
  switchVar?: string;
  cases?: CaseDef[];
  // contact / location request
  request?: 'contact' | 'location';
  // note (canvas comment)
  note?: string;
  // referral: куда положить персональную ссылку (по умолчанию ref.link)
  refVar?: string;
  // media_group: список элементов альбома (2-10 штук, лимит Telegram)
  mediaItems?: MediaItemDef[];
  // invoice: реквизиты счёта для sendInvoice
  invoice?: InvoiceParams;
  // data: работа с таблицами бота (коллекциями)
  collectionId?: string; // id коллекции
  dataOp?: DataOp; // что делаем
  // поле таблицы -> значение (поддерживает {{var}}). Для add/update — что писать,
  // для find/remove — по чему искать (dataWhere).
  dataFields?: Record<string, string>;
  dataWhere?: Record<string, string>;
  dataLimit?: number; // сколько записей вернуть (find), по умолчанию 10
  // tag: операции с тегами пользователя (F2)
  tagOp?: TagOp;
  // Имя тега; поддерживает {{var}}. Хранится нормализованным.
  tagName?: string;
  // Куда положить список тегов (tagOp === 'list').
  tagVar?: string;
  // condition: по чему сравниваем — по переменной сценария или по тегу.
  condSource?: 'var' | 'tag';
  // chain: элементы цепочки сообщений (F3)
  chainItems?: ChainItemDef[];
  // referral (ссылка): необязательный шаблон payload'а в ?start=ref_<id>_<payload>.
  // Telegram разрешает в start только [A-Za-z0-9_-], максимум 64 символа.
  refPayload?: string;
  // referral_bonus / referral_hierarchy: когда срабатывает бонус.
  refTrigger?: ReferralTrigger;
  // Для custom_event — имя события, которое ловит бонус (переменная {{ref.event}}).
  refEventName?: string;
  // Для nth_referral — какой по счёту приглашённый запускает бонус.
  refTriggerN?: number;
  // Что выдаём пригласившему.
  refBonusKind?: ReferralBonusKind;
  // Текст сообщения-награды (send_message), поддерживает {{var}}.
  refBonusText?: string;
  // Имя переменной и величина для increment_variable.
  refBonusVar?: string;
  refBonusAmount?: number;
  // Сколько дней подписки даёт grant_subscription_days.
  refBonusDays?: number;
  // referral_hierarchy: глубина цепочки (1–5) и доли каждого уровня.
  refDepth?: number;
  // Доли уровней, сумма ≤ 1. Уровень 1 — прямой пригласивший.
  refShares?: number[];
  // referral_stats / referral_leaderboard: шаблон сообщения и лимиты.
  refText?: string;
  refLimit?: number;
  // referral_leaderboard: сортировка и период.
  refSort?: ReferralSort;
  refPeriod?: ReferralPeriod;
  // Для period=custom — границы в ISO-датах (YYYY-MM-DD).
  refPeriodFrom?: string;
  refPeriodTo?: string;
  // referral_tournament: имя, окна, метрика, призовой фонд.
  refTournamentName?: string;
  refStartsAt?: string;
  refEndsAt?: string;
  refMetric?: 'count' | 'revenue';
  refPrizePool?: string;
  // Распределение призов по местам: «50/30/20» — доли в %.
  refPrizeSplit?: string;
  // referral_verification: чем подтверждаем реферала.
  refGate?: ReferralGate;
  // Для paid_min_amount — порог суммы (в минимальных единицах валюты).
  refMinAmount?: number;
  // Для custom_goal — имя boolean-переменной сценария.
  refGoalVar?: string;
  // antifraud: глобальные ограничения выдачи бонусов.
  refOnePerUser?: boolean;
  refBlockSelf?: boolean;
  refCooldownSec?: number;
  refMinAgeDays?: number;

  // ===================== набор 2026-09 (все поля необязательные) =====================

  // --- разметка: parseMode/disablePreview применяются к текстам и подписям ---
  // Отсутствие parseMode = сегодняшнее поведение (plain text, без parse_mode).
  parseMode?: ParseMode;
  // Отключить превью ссылок у этого сообщения (link_preview_options.is_disabled).
  disablePreview?: boolean;

  // --- UX инлайн-кнопок: всплывающее уведомление и правка сообщения на месте ---
  // cbToast -> answerCallbackQuery { text, show_alert: false }
  cbToast?: string;
  // cbAlert -> answerCallbackQuery { text, show_alert: true }
  cbAlert?: string;
  // updateMode 'edit' -> editMessageText вместо нового сообщения.
  updateMode?: 'send' | 'edit';

  // --- операции с сообщениями ---
  // Удалить сообщение пользователя (то, что пришло в этом апдейте).
  deleteUserMessage?: boolean;
  // Удалить последнее сообщение бота (id запоминается в {{__bot_msg}}).
  deleteBotMessage?: boolean;

  // --- составные условия (condition/assert) ---
  // При пустом/отсутствующем массиве работает легаси condVar/op/condValue.
  conditions?: ConditionDef[];
  logic?: 'and' | 'or';

  // --- http: повторы и постраничный обход ---
  retries?: number;
  backoffMs?: number;
  // Куда сложить накопленный результат постраничного обхода (по умолчанию outVar).
  collectVar?: string;
  paginate?: HttpPagination;

  // --- wait: пауза с таймаутом ---
  reminderText?: string;
  // Потолок ожидания для ветки «таймаут»; по умолчанию — seconds.
  maxWaitMinutes?: number;

  // --- poll / quiz: опрос и тест ---
  question?: string;
  pollOptions?: PollOptionDef[];
  anonymous?: boolean;
  multiple?: boolean;
  // id правильного варианта (для викторины). Валидатор сверяет с опциями.
  correctOptionId?: string;
  explanation?: string;
  // quiz: текст в ветку failed (пояснение при неверном ответе), {{vars}}.
  quizFailText?: string;

  // --- edit_message / delete_message ---
  // Имя переменной с целью вида { chatId, messageId } (то, что кладёт
  // {{__bot_msg}}) либо числовым message_id текущего чата. Пусто = __bot_msg.
  msgRefVar?: string;
  // edit_message: новый текст ({{vars}}) и новая клавиатура (опционально).
  editText?: string;
  editButtons?: ButtonDef[];

  // --- language ---
  // Коды языков-веток: ['ru', 'en']; не перечисленные уходят в fallback.
  langCodes?: string[];

  // --- timer_deadline ---
  // Срок: абсолютная дата-время ISO либо переменная с таковой.
  deadlineAt?: string;
  deadlineVar?: string;
  // Переменная-флаг отмены: установлена и не '0'/'false' — дедлайн гасится
  // кроном в ветку done без сообщения.
  cancelVar?: string;
  // Текст в ветку expired ({{vars}}); пусто — без сообщения.
  deadlineText?: string;

  // --- ai_classify ---
  classifyPrompt?: string; // системный контекст классификации ({{vars}})
  classifyInput?: string; // что классифицируем ({{vars}}), пусто = текст апдейта
  classifyLabels?: string[]; // метки; каждая = ключ ветки
  classifyFallbackLabel?: string; // метка при неразобранном ответе (default 'other')
  classifyOutVar?: string; // куда положить выбранную метку (default ai.label)

  // --- webhook_in ---
  // Поля тела вебхука (JSON) раскладываются в wh.<field>; пусто = всё тело в wh.body.
  webhookFields?: string[];

  // --- location ---
  locationPrompt?: string; // текст над клавиатурой ({{vars}})
  locationButtonLabel?: string; // подпись кнопки запроса гео

  // --- forward: пересылка ---
  forwardMode?: 'forward' | 'copy' | 'text';
  toChatId?: string;
  forwardText?: string;
  fromVar?: string;

  // --- chat_action ---
  chatAction?: ChatActionKind;

  // --- channel_check ---
  channelId?: string;
  requireMembership?: boolean;
  cacheMinutes?: number;

  // --- segment_broadcast ---
  segmentTag?: string;
  segmentWhere?: ConditionDef[];
  segmentText?: string;
  segmentMediaUrl?: string;
  chunkSize?: number;
  delayMs?: number;
  dailyCap?: number;

  // --- user_stats ---
  outPrefix?: string;
  template?: string;

  // --- payment_link / payment_check ---
  connectionId?: string;
  amount?: number | string;
  currency?: string;
  orderIdVar?: string;
  linkVar?: string;
  successNext?: string;
  autoOrderId?: boolean;

  // --- foreach ---
  listVar?: string;
  itemVar?: string;
  indexVar?: string;
  maxIterations?: number;

  // --- random_text ---
  variants?: RandomVariantDef[];
  send?: boolean;

  // --- assert ---
  failMessage?: string;

  // --- counter ---
  counterName?: string;
  counterScope?: 'user' | 'bot';
  counterOp?: 'inc' | 'dec' | 'reset' | 'get';
  counterMax?: number;

  // --- web_app: сообщение с кнопкой Mini App ---
  // Подпись инлайн-кнопки, открывающей Telegram Web App. Текст сообщения —
  // общее поле text, ссылка — общее поле url (полный https://t.me/<bot>/<slug>;
  // конструктор подставляет его при публикации).
  button?: string;

  // ===================== набор 2026-09-30: снятие жёстких потолков =====================
  // Все поля необязательные; отсутствие = прежнее поведение (обратная совместимость).

  // --- ai: память диалога (§5) ---
  // Имя переменной сценария, где хранится история: массив {role, content}.
  historyVar?: string;
  // Сколько последних ходов учитывать (по умолчанию AI_HISTORY_TURNS_DEFAULT,
  // потолок AI_HISTORY_TURNS_MAX — см. shared/limits.ts).
  historyTurns?: number;
  // id коллекции, куда дублировать историю: она переживает сброс сессии.
  // Пишется через существующие data-операции, движок в D1 не ходит.
  persistHistoryTo?: string;

  // --- schedule: абсолютное расписание (§4) ---
  scheduleKind?: ScheduleKind;
  // Время срабатывания HH:MM (daily/weekly) в часовом поясе timezone.
  atTime?: string;
  // Дни недели 1–7 (1 = понедельник, 7 = воскресенье) для weekly.
  weekdays?: number[];
  // Интервал в минутах (>= 1) для interval.
  everyMinutes?: number;
  // 5-полевое cron-выражение для scheduleKind === 'cron'.
  cronExpr?: string;
  // Кому запускать: всем подписчикам / тегу / одному пользователю (текущему).
  scheduleAudience?: ScheduleAudience;
  // Тег аудитории при scheduleAudience === 'tag'.
  audienceTag?: string;
  // Часовой пояс расписания (по умолчанию DEFAULT_SCHEDULE_TIMEZONE).
  timezone?: string;

  // ===================== подсценарии (библиотека фрагментов) =====================

  // --- subflow: блок-вызов фрагмента из библиотеки ---
  // id фрагмента в библиотеке владельца бота (таблица subflows).
  subflowId?: string;
  // Закреплённая ревизия; undefined = «последняя на момент публикации».
  subflowRevision?: number;
  // Короткое имя вызова: часть пространства имён развёрнутых блоков
  // (`sf:<alias>:<id>`) и префикс переменных (`sf:<alias>.<var>`).
  alias?: string;
  // Привязка входов: имя входа фрагмента -> выражение вызывающего ({{var}}).
  inputs?: Record<string, string>;
  // Привязка выходов: имя выхода фрагмента -> имя переменной вызывающего.
  // Значение по умолчанию — то же имя, что у выхода.
  outputs?: Record<string, string>;
  // 'isolated' (по умолчанию): внутренние переменные фрагмента переименовываются
  // в sf:<alias>.<var> и не протекают наружу, кроме объявленных выходов.
  // 'shared': имена используются как есть — фрагмент МОЖЕТ перезаписать
  // переменные вызывающего (осознанное решение, UI предупреждает).
  scope?: 'isolated' | 'shared';

  // --- subflow_return: терминал внутри фрагмента ---
  // (переиспользует outputs: имя выхода -> выражение в переменных фрагмента;
  // выходы, которых здесь нет, копируются по совпадению имён.)
}

// Режим разметки сообщения. 'none' — явный plain text; undefined ведёт себя
// так же, как 'none' (совместимость: у старых сценариев поля нет вовсе).
export type ParseMode = 'none' | 'HTML' | 'MarkdownV2';

// Описание постраничного обхода в блоке http. Все виды страниц двигаются одним
// и тем же параметром запроса; курсорные дополнительно читают путь в ответе.
export interface HttpPagination {
  kind: 'page' | 'offset' | 'cursor';
  param: string;
  start?: number;
  step?: number;
  maxPages?: number;
  // path в JSON-ответе, где лежит следующий курсор.
  cursorPath?: string;
  nextCursorPath?: string;
  delayMs?: number;
}

// Вариант опроса. id нужен, чтобы связать correctOptionId с конкретным
// вариантом и стабильно ключевать список в React.
export interface PollOptionDef {
  id?: string;
  text: string;
}

// Вариант случайного текста: вес — относительная вероятность (по умолчанию 1).
export interface RandomVariantDef {
  id?: string;
  text: string;
  weight?: number;
}

export type ChatActionKind =
  | 'typing'
  | 'upload_photo'
  | 'upload_document'
  | 'find_location'
  | 'record_voice';

// Триггеры бонуса: когда именно пригласивший получает награду.
// - nth_referral — когда приглашённых стало ровно N;
// - first_payment — первая успешная оплата приглашённого;
// - subscription_started — приглашённый (или пригласивший) оформил подписку;
// - custom_event — автор сам выставляет {{ref.event}} (например, из HTTP-ответа).
export type ReferralTrigger = 'nth_referral' | 'first_payment' | 'subscription_started' | 'custom_event';

export type ReferralBonusKind = 'send_message' | 'increment_variable' | 'grant_subscription_days';

export type ReferralSort = 'count' | 'revenue' | 'activity_period';

export type ReferralPeriod = 'all_time' | 'month' | 'week' | 'custom';

// Чем подтверждаем «живого» реферала, чтобы накрутка не получала бонусов.
export type ReferralGate = 'subscribed' | 'paid_once' | 'paid_min_amount' | 'custom_goal';

// Переменные сценария, через которые блоки реферальной системы обмениваются
// фактами: {{ref.event}} — имя события для custom_event, {{ref.verified}} —
// прошёл ли пользователь проверку (0/1).
export const REF_EVENT_VAR = 'ref.event';
export const REF_VERIFIED_VAR = 'ref.verified';
export const REF_EARNINGS_VAR = 'ref.earnings';
export const REF_LEADERBOARD_VAR = 'ref.leaderboard';
export const REF_REFERRED_VAR = 'ref.referred';

// Операции блока «Данные» над таблицей бота.
export type DataOp = 'add' | 'find' | 'update' | 'remove';

// Операции блока «Тег»: поставить / снять / очистить все / показать список.
// Один блок с селектором операции — как в «Данных» и «Подписке».
export type TagOp = 'add' | 'remove' | 'clear' | 'list';

// Единая нормализация тега: ею пользуются и движок, и валидатор, и интерфейс.
// Иначе « VIP » и «vip» считались бы разными тегами, а по тегу сравнивается
// условие — расхождение молча ломало бы ветку сценария.
export const TAG_MAX_LENGTH = 32;

export function normalizeTag(raw: string | null | undefined): string {
  const trimmed = String(raw ?? '').trim().toLowerCase();
  // Внутренние пробелы схлопываем: «из рассылки   X» и «из рассылки X» — одно.
  return trimmed.replace(/\s+/g, ' ').slice(0, TAG_MAX_LENGTH);
}

// Системные имена переменных, которые выставляет блок «Данные» при поиске.
// {{order.name}} — поле первой найденной записи, {{order_count}} — сколько найдено,
// {{order_json}} — весь результат текстом.
export function dataCountVar(outVar: string): string {
  return `${outVar || 'found'}_count`;
}
export function dataJsonVar(outVar: string): string {
  return `${outVar || 'found'}_json`;
}

// Имена переменных, которые движок выставляет для реферальной ветки.
// Создатель бота сам собирает награду из обычных блоков — бэк только даёт данные.
export const REF_LINK_VAR = 'ref.link';
export const REF_INVITER_VAR = 'ref.inviter';
export const REF_COUNT_VAR = 'ref.count';

// ---------------------------------------------------------------- системные переменные
// Имена, которые движок выставляет сам. Часть из них внутренние (начинаются с
// '__'): такие переменные НИКОГДА не показываются в панели переменных, не
// предлагаются в чипсах {{var}} и не создаются из интерфейса — они существуют
// только для обмена данными между блоком и воркером.
export const BOT_MSG_VAR = '__bot_msg';
export const CB_MSG_VAR = '__cb_msg';
export const CB_CHAT_VAR = '__cb_chat';
export const HTTP_PAGE_VAR = '__http_page';
// Чат последнего апдейта пользователя: resume-проходы (delay, wait_timeout,
// бюджет шагов, расписания) исполняются без апдейта, а сообщения нужно
// доставлять в тот же чат. Раньше chat_id в таких проходах был undefined и
// Telegram молча отклонял отправку.
export const CHAT_FALLBACK_VAR = '__chat';

// Префиксы переменных цикла и ожидания: полное имя — префикс + id блока.
export const LOOP_PREFIX = '__loop.';
export const WAIT_PREFIX = '__wait.';
export const loopVar = (blockId: string): string => `${LOOP_PREFIX}${blockId}`;
export const waitVar = (blockId: string): string => `${WAIT_PREFIX}${blockId}`;

// Переменные опроса и платежей — обычные (публичные) переменные сценария: автор
// может подставить их в текст блока.
export const POLL_ANSWER_VAR = 'poll.answer';
export const POLL_OPTIONS_VAR = 'poll.options';
export const PAY_LINK_VAR = 'pay.link';
export const PAY_ORDER_VAR = 'pay.order';

// Публичные переменные профиля пользователя (блок user_stats и source: 'user'
// в составных условиях). Значения — из сессии/подписок/платежей бота.
export const USER_NAME_VAR = 'user.name';
export const USER_USERNAME_VAR = 'user.username';
export const USER_ID_VAR = 'user.id';
export const USER_TAGS_VAR = 'user.tags';
export const USER_SUBSCRIPTION_VAR = 'user.subscription';
export const USER_PAID_TOTAL_VAR = 'user.paid_total';
export const USER_REF_COUNT_VAR = 'user.ref_count';
export const USER_FIRST_SEEN_VAR = 'user.first_seen';

// Язык пользователя (language_code апдейта): подставляется блоком language
// и доступен условиям/текстам как обычная переменная профиля.
export const USER_LANG_VAR = 'user.lang';
// Геопозиция из апдейта с location (блок location): широта/долгота строками.
export const USER_LAT_VAR = 'user.lat';
export const USER_LON_VAR = 'user.lon';

export const USER_VARS: string[] = [
  USER_NAME_VAR,
  USER_USERNAME_VAR,
  USER_ID_VAR,
  USER_TAGS_VAR,
  USER_SUBSCRIPTION_VAR,
  USER_PAID_TOTAL_VAR,
  USER_REF_COUNT_VAR,
  USER_FIRST_SEEN_VAR,
  USER_LANG_VAR,
  USER_LAT_VAR,
  USER_LON_VAR,
];

// Префикс переменных входящего вебхука: wh.<field> (или wh.body целиком).
export const WH_PREFIX = 'wh.';
// Метка ИИ-классификатора по умолчанию, если автор не задал свою.
export const AI_LABEL_VAR = 'ai.label';

// Системные переменные, которые МОЖНО показывать автору (публичные).
export const PUBLIC_SYSTEM_VARS: string[] = [
  'last_input',
  REF_LINK_VAR,
  REF_INVITER_VAR,
  REF_COUNT_VAR,
  REF_VERIFIED_VAR,
  REF_EARNINGS_VAR,
  REF_LEADERBOARD_VAR,
  REF_REFERRED_VAR,
  REF_EVENT_VAR,
  POLL_ANSWER_VAR,
  POLL_OPTIONS_VAR,
  PAY_LINK_VAR,
  PAY_ORDER_VAR,
  ...USER_VARS,
];

// Внутренняя ли переменная. Правило: '__' в начале имени, плюс уже
// существовавшая '__menu'. Такие имена не рендерятся в панели переменных и не
// предлагаются в чипсах.
export function isInternalVar(name: string): boolean {
  return name.startsWith('__');
}

export interface Block {
  id: string;
  type: BlockType;
  params: BlockParams;
  next?: string; // default fall-through
  branches?: Record<string, string>; // condition (then/else), buttons (value -> block id), switch, random, keyword
  position?: { x: number; y: number }; // canvas coordinates (persisted for manual layout)
}

export interface Scenario {
  version: number;
  start: string; // id of the start block
  blocks: Record<string, Block>;
}

export type SupportKind = 'bug' | 'question' | 'idea' | 'billing' | 'abuse' | 'other';
export type SupportStatus = 'new' | 'in_progress' | 'closed';
export interface SupportTicket {
  id: string;
  author_user_id: string;
  author_login: string;
  bot_id: string | null;
  kind: SupportKind;
  subject: string;
  status: SupportStatus;
  assignee_user_id: string | null;
  created_at: number;
  updated_at: number;
  last_message_at: number;
}
export interface SupportMessage {
  id: string;
  ticket_id: string;
  author_role: 'user' | 'staff';
  author_user_id: string;
  author_login: string;
  body: string;
  created_at: number;
}

export function emptyScenario(startId = 'start'): Scenario {
  return {
    version: 1,
    start: startId,
    blocks: {
      [startId]: { id: startId, type: 'start', params: { command: '/start' }, next: '' },
    },
  };
}

// Interpolate {{var}} placeholders using the session variable map.
export function interpolate(template: string, vars: Record<string, unknown>): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

// Интерполяция без данных: {{var}} -> 'x'. Нужна валидатору, который проверяет
// шаблон до запуска и не знает значений: важно отличить «поле заполнено» от
// «поле пустое», а не подставить реальное значение.
export function staticInterpolate(template: string | null | undefined): string {
  return String(template ?? '').replace(/\{\{\{?\s*[\w.]+\s*\}?\}\}/g, 'x');
}

// Block types whose outgoing connections live in `branches` instead of `next`.
export const BRANCH_TYPES: BlockType[] = [
  'buttons',
  'condition',
  'menu',
  'keyword',
  'random',
  'switch',
  'invoice',
  'data',
  'referral_track',
  'referral_check',
  'referral_bonus',
  'referral_hierarchy',
  'referral_tournament',
  // набор 2026-09: у каждого из этих блоков исходящие связи — только ветки.
  // Ключи: wait reply|timeout, poll answered|skipped, forward ok|failed,
  // channel_check member|not_member|error, segment_broadcast queued|empty,
  // payment_link created|failed, payment_check paid|pending|failed,
  // foreach each|done, assert pass|fail, counter ok|limit_reached.
  'wait',
  'poll',
  'forward',
  'channel_check',
  'segment_broadcast',
  'payment_link',
  'payment_check',
  'foreach',
  'assert',
  'counter',
  // набор 2026-10: ключи веток — edit_message ok|too_old|not_found,
  // quiz passed|failed, language <код>|fallback, timer_deadline done|expired,
  // ai_classify <метка>|fallback, location sent|declined.
  // webhook_in — регистрационный, без веток.
  'edit_message',
  'quiz',
  'language',
  'timer_deadline',
  'ai_classify',
  'location',
  // Подсценарий: блок-вызов фрагмента. Ветки — done / failed. В движок не
  // попадает: публикация раскрывает вызовы (shared/subflow.ts).
  'subflow',
];

export function usesBranches(type: BlockType): boolean {
  return BRANCH_TYPES.includes(type);
}

// Tiny safe arithmetic evaluator: only digits, + - * / ( ) and spaces are allowed,
// anything else falls back to the raw (interpolated) string. Never uses eval().
export function evalExpression(raw: string): string | number {
  const src = (raw ?? '').trim();
  if (!src) return '';
  if (!/^[\d\s+\-*/().]+$/.test(src)) return src;
  try {
    const n = calc(src);
    return Number.isFinite(n) ? n : src;
  } catch {
    return src;
  }
}

// Recursive-descent parser for + - * / and parentheses over non-negative numbers.
function calc(src: string): number {
  let i = 0;
  const skip = () => { while (i < src.length && src[i] === ' ') i++; };
  const parsePrimary = (): number => {
    skip();
    if (src[i] === '(') {
      i++;
      const v = parseSum();
      skip();
      if (src[i] === ')') i++;
      return v;
    }
    if (src[i] === '-') { i++; return -parsePrimary(); }
    if (src[i] === '+') { i++; return parsePrimary(); }
    const start = i;
    while (i < src.length && /[\d.]/.test(src[i])) i++;
    const num = Number(src.slice(start, i));
    if (Number.isNaN(num)) throw new Error('bad number');
    return num;
  };
  const parseProduct = (): number => {
    let v = parsePrimary();
    for (;;) {
      skip();
      const op = src[i];
      if (op === '*' || op === '/') { i++; const r = parsePrimary(); v = op === '*' ? v * r : v / r; }
      else return v;
    }
  };
  const parseSum = (): number => {
    let v = parseProduct();
    for (;;) {
      skip();
      const op = src[i];
      if (op === '+' || op === '-') { i++; const r = parseProduct(); v = op === '+' ? v + r : v - r; }
      else return v;
    }
  };
  const res = parseSum();
  return res;
}

// ------------------------------------------------------------------ ReDoS (F-023)

// Эвристика катастрофического бэктрекинга в регулярном выражении. Ловит две
// формы:
//   1. вложенные квантификаторы: (a+)+, (\w*)*, ([a-z]+){2,} — движок на каждой
//      итерации внешней группы заново перебирает разбиения внутренней;
//   2. перекрытие альтернатив под квантификатором: (a|a)+, (a|ab)+, (ab|a|b)+ —
//      одну и ту же строку можно собрать экспоненциально многими способами,
//      поэтому на НЕсовпадающем входе RegExp.test деградирует в 2^n шагов.
// Синхронный RegExp.test в Workers не прерывается: 22 символа входа на (a|a)+$
// блокировали изолят на 15 секунд (аудит 18.10.2026, F-023). Проход линейный
// (балансный разбор скобок) — сама проверка не должна стать новым ReDoS.
// Консервативна в обе стороны: форму без квантификатора за группой — (a|ab)c —
// пропускает; пустую альтернативу (a|)+ считает опасной.
export function hasDangerousRepetition(pattern: string): boolean {
  const src = String(pattern ?? '');

  // Балансный разбор: вернуть содержимое группы, открытой в openIdx (индекс
  // '('), и индекс её закрывающей ')'. Учёт экранирований, символьных классов
  // и вложенных групп. -1 — группа не закрыта (битый паттерн — не наша форма).
  function groupSpan(openIdx: number): { body: string; close: number } | null {
    let depth = 0;
    for (let i = openIdx; i < src.length; i++) {
      const ch = src[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '[') {
        i++;
        if (src[i] === '^') i++;
        if (src[i] === ']') i++;
        while (i < src.length && src[i] !== ']') { if (src[i] === '\\') i++; i++; }
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return { body: src.slice(openIdx + 1, i), close: i };
      }
    }
    return null;
  }

  // Разбить тело группы на альтернативы по '|' верхнего уровня
  // (вложенные группы и классы не считаем разделителями).
  function splitAlternatives(body: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '\\') { cur += ch + (body[i + 1] ?? ''); i++; continue; }
      if (ch === '[') {
        // Открывающая ']' сразу после '[' (или '^') — литерал, не конец класса.
        const close = body.indexOf(']', i + (body[i + 1] === '^' || body[i + 1] === ']' ? 2 : 1));
        const end = close < 0 ? body.length - 1 : close;
        cur += body.slice(i, end + 1);
        i = end;
        continue;
      }
      if (ch === '(') { depth++; cur += ch; continue; }
      if (ch === ')') { depth--; cur += ch; continue; }
      if (ch === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts;
  }

  // «Опасно ли повторять эту группу?» Пустая альтернатива ((a|)+ = a*) — да.
  // Две альтернативы с общим первым символом (после открывающих скобок —
  // (?:a|ab)+ тоже ловим) — да: они перекрываются на входе.
  function alternativesOverlap(body: string): boolean {
    const alts = splitAlternatives(body);
    if (alts.length < 2) return false;
    const firsts: string[] = [];
    for (const a of alts) {
      let s = a;
      // (?:… и (?=… — первая «ветка» начинается после префикса группы.
      const inner = /^\(\?[<:=!]/.exec(s);
      if (inner) s = s.slice(inner[0].length);
      if (!s) return true;
      let f: string;
      if (s[0] === '\\') f = s.slice(0, 2);
      else if (s[0] === '[') {
        const close = s.indexOf(']');
        f = close < 0 ? s : s.slice(0, close + 1);
      } else if (s[0] === '(') f = s[0];
      else f = s[0];
      if (firsts.includes(f)) return true;
      firsts.push(f);
    }
    return false;
  }

  // Квантификатор сразу за индексом close: '+', '*', '{n,}'-формы с повтором.
  // '{3}' (точный счёт) безопасен — не считаем. Пробелы между ')' и
  // квантификатором в регулярках не допускаются (меняют смысл), не учитываем.
  function quantifierAt(close: number): boolean {
    const ch = src[close + 1];
    if (ch === '+' || ch === '*') return true;
    if (ch === '{') {
      const m = /^\{(\d*)(,)(\d*)\}/.exec(src.slice(close + 1));
      if (!m) return false;
      // {,n} / {n,} / {n,m}: повтор есть, когда нет верхней границы или она > 1.
      if (!m[3]) return true;
      return Number(m[3]) > 1;
    }
    return false;
  }

  // Стек флагов: был ли +/* внутри текущей открытой группы (форма 1).
  const quant: boolean[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') {
      i++;
      if (src[i] === '^') i++;
      if (src[i] === ']') i++;
      while (i < src.length && src[i] !== ']') { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (ch === '(') { quant.push(false); continue; }
    if (ch === ')') {
      const inner = quant.pop() ?? false;
      if (quantifierAt(i)) {
        // Форма 1: внутренний +/* под внешним квантификатором.
        if (inner) return true;
        // Форма 2: перекрывающиеся альтернативы под квантификатором.
        // Тело берём по балансу от ближайшей непросмотренной '(' — groupSpan.
        const openIdx = src.lastIndexOf('(', i);
        const span = openIdx >= 0 ? groupSpan(openIdx) : null;
        if (span && span.close === i && alternativesOverlap(span.body)) return true;
      }
      // Вложенные группы ((a+))+: внутренний квантификатор всплывает наружу.
      if (inner && quant.length) quant[quant.length - 1] = true;
      continue;
    }
    if ((ch === '+' || ch === '*') && quant.length) quant[quant.length - 1] = true;
  }
  return false;
}

// Read a dot-path out of a JSON-ish object: "data.price" -> obj.data.price
export function pickPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: any = obj;
  for (const part of path.split('.')) {
    if (part === '') continue;
    if (cur == null) return undefined;
    // support array indexes like items.0.name
    cur = cur[part];
  }
  return cur;
}
