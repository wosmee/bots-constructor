# CODEBASE.md — память кодовой базы (бот-конструктор)

Живой справочник по архитектуре репозитория. Писан по фактическому состоянию кода, не по памяти. Читай перед правкой движка, воркера или фронта.

## Что это

No-code визуальный конструктор Telegram-ботов. Пользователь собирает сценарий из
блоков на холсте (react-flow), платформа сохраняет версию в D1, при публикации
воркер дёргает `setWebhook` в Telegram, и дальше входящие апдейты гоняются через
интерпретатор блоков (`engine.ts`). Оплата в БД шифруется AES-256-GCM.

⚠️ Все `account_id` / `database_id` / токены Cloudflare — свои для аккаунта деплоя.

## Стек

- **Worker** (`worker/`): Hono + `@cloudflare/workers-types`. Роутер вебхуков
  (`/:botId`) + админ-API (`/api/*`), интерпретатор блоков, D1, KV.
- **Front** (`web/`): React + Vite + `@xyflow/react` (react-flow). Статический
  сайт на Pages.
- **Shared** (`shared/`): `types.ts` и `validate.ts` — единый источник правды,
  импортируются и воркером, и фронтом. `subflow.ts` — раскрытие подсценариев
  (см. раздел «Подсценарии»).

## Структура

```
корень репозитория
├─ shared/
│  ├─ types.ts       # BlockType (60), BlockParams, Scenario, interpolate, evalExpression, BRANCH_TYPES, системные переменные
│  ├─ validate.ts     # validateScenario() — ОДИН код для фронта (мгновенно) и воркера (жёсткий стоп)
│  ├─ graph.ts        # обход графа, хэши содержимого, WAIT_TYPES, scenarioHasReferral — общий для validate/conflicts
│  ├─ markup.ts       # renderMarkup/escapeMarkup: {{var}} экранируется под parseMode, {{{var}}} — сырое (opt-in)
│  ├─ expr.ts         # evalExprWithFunctions: белый список функций (len/upper/now/...), свой парсер, без eval
│  ├─ limits.ts       # вместимость платформы — ЕДИНСТВЕННЫЙ источник чисел (движок/db/воркер/валидатор/доки)
│  ├─ cron.ts         # scheduleToCron/isScheduleDue — чистая математика времени расписаний
│  ├─ subflow.ts      # expandSubflows(): КОМПИЛЯЦИЯ подсценариев в плоский сценарий (чистая, синхронная) + selectionIo/checkSubflowCalls
│  ├─ miniapp.ts      # схема мини-аппа (MiniApp/MiniElement/MiniAccessRule), validateMiniAppShape, MINI_LIMITS
│  ├─ miniapp-templates.ts # шаблоны мини-аппов (applyMiniTemplate)
│  └─ mini-sanitize.ts# санитайзер CSS/атрибутов мини-аппов
├─ tests/             # vitest, 103 файла: движок, валидатор, разметка, выражения, платежи,
│                     # мини-аппы, расписания, крон, VK, аудит-фиксы (npm test из корня)
├─ worker/
│  ├─ wrangler.toml   # name, account_id, compatibility_date 2025-10-01, D1 bots_constructor,
│  │                  # KV WEBHOOK_SECRETS, cron "* * * * *", observability,
│  │                  # routes (custom_domain, опционально) + workers_dev=true,
│  │                  # vars: PAY_WEBHOOK_BASE, ADMIN_TG_ID, HTTP_ALLOWED_HOSTS
│  ├─ .dev.vars       # только ENVIRONMENT=dev; настоящие секреты — вне репозитория
│  ├─ migrations/     # 0001..0031 (…, 0025 mini_apps, 0026 mini_app_usage, 0027 bot_schedules,
│  │                  # 0028 bot_webhooks, 0029 аудит волна 2, 0030 платформа VK: колонки bots
│  │                  # platform/vk_group_id/vk_confirmation/vk_screen_name)
│  └─ src/
│     ├─ index.ts      # все роуты + вход вебхука (app.post('/:botId')) + cron-обработчик scheduled_sends
│     │                # + /p/:token (платежи; легаси /pay/… → 410) + /wh/:token (webhook_in)
│     │                # + /m/* (мини-аппы) + /vk/:botId (Callback API VK)
│     ├─ engine.ts     # runEngine(): чистая функция update+session -> TelegramOut[] (ops-интерфейсы снаружи)
│     ├─ db.ts         # все D1-запросы, KV-кэш сценария, батчи хот-пафа, claimScheduledSend, upsertSessionCas
│     ├─ auth.ts       # PBKDF2 (100k), сессии в KV, bearerToken()
│     ├─ crypto.ts     # AES-256-GCM обёртки для токенов ботов
│     ├─ media.ts      # загрузки медиа (Filebase S3); @aws-sdk/client-s3 — ДИНАМИЧЕСКИЙ import (S5-10)
│     ├─ aiHistory.ts  # чистая логика памяти диалога блока ai (сборка messages, бюджет промпта)
│     ├─ support.ts    # тикеты поддержки
│     ├─ vk.ts         # адаптер платформы VK: vkCall/VkApiError, vkKeyboard (строки ≤4),
│     │                # vkDownloadMedia (SSRF-гарды, redirect:manual), upload-цепочки,
│     │                # translateOutgoing (TG-методы → VK API), события → TG-форма
│     ├─ blocks/       # 9 модулей: aiclassify, deadline, lang, location, msgops,
│     │                # payments/providers.ts (ссылки + проверка подписей вебхуков), quiz, referral, webhookin
│     └─ miniapp/      # рантайм мини-аппов: spa.ts (SPA_HTML + eval видимости), runtime.ts
│                      # (parseAndValidateInitData, buildContext, filterVisible*), payments.ts
│                      # (Stars: miniPaymentPayload/parseMiniPayPayload/sendMiniInvoice), ai.ts, limits.ts
└─ web/
   ├─ .env.production  # VITE_API_BASE — адрес твоего воркера (см. .env.production.example)
   ├─ vite.config.ts   # proxy /api -> :8787; manualChunks (react-vendor/xyflow-vendor)
   └─ src/             # ~80 файлов: холст, инспектор, мини-редактор, страницы
      ├─ api.ts        # тонкий клиент платформы (Bearer + x-admin-key, sessionStorage)
      ├─ blocks.ts     # BLOCK_META (ленивый i18n через defineProperty), PALETTE_GROUPS (13 групп), WHAT_IF, цвета
      ├─ i18n.ts       # RU/EN словарь (~1500 ключей) + 8 пар фрагментов i18n.frag.*
      │                # (guide/insp/canvas/pay/subflow/mini/admin/blocks2610), translate(lang, key)
      ├─ settings.ts   # стор настроек (useSyncExternalStore, data-theme)
      ├─ App.tsx / Constructor.tsx / Inspector.tsx / preview.tsx / Guide.tsx
      ├─ MiniAppEditor.tsx / MiniInspector.tsx / miniMeta.ts / miniRender.tsx / miniInspLogic.ts
      ├─ DataPage.tsx / PaymentsPage.tsx / SubflowsPage.tsx / SupportPage.tsx / AdminPage.tsx
      ├─ conflicts.ts / explain.ts / graph.ts / canvasContext.ts / journey.ts / logLabels.ts
      ├─ TemplatesPage.tsx / TemplatesModal.tsx / SettingsModal.tsx / Publish.tsx
      ├─ VersionsModal.tsx / LogsModal.tsx / OnboardingTour.tsx / SkillLevelModal.tsx
      ├─ VarsPanel.tsx / SearchPanel.tsx
      └─ styles.css    # графит + медный акцент, моно только для ID/переменных
```

## Доменная модель (`shared/types.ts`)

- `Scenario = { version, start: blockId, blocks: Record<id, Block> }`.
- `Block = { id, type, params: BlockParams, next?, branches?, position? }`.
  - `next` — переход по умолчанию (fall-through).
  - `branches` — ветвления: `buttons`(value→id), `condition`(then/else),
    `keyword`(hit/miss), `switch`(c0..cN/default), `random`(key→id),
    `menu`(value→id), `invoice`(paid/cancelled), плюс ветки наборов 2026-09
    и 2026-10 (см. разделы «Набор 2026-09» и «Изменения 28.09–02.10»).
  - `params.disabled` — заморозка: блок остаётся на холсте, движок его пропускает
    (фолбэк на первую живую ветку). Валидатор даёт warn, не error.
- `BRANCH_TYPES` = 30 типов: buttons, condition, menu, keyword, random, switch,
  invoice, data, referral_track, referral_check, referral_bonus,
  referral_hierarchy, referral_tournament, wait, poll, forward, channel_check,
  segment_broadcast, payment_link, payment_check, foreach, assert, counter,
  edit_message, quiz, language, timer_deadline, ai_classify, location, subflow.
  (`webhook_in` — регистрационный, без веток.)
- `interpolate(tpl, vars)` — `{{var}}`. `evalExpression` — безопасный калькулятор
  (`+ - * / ()`, НЕ eval) для setvar/invoice-amount. Выражения с функциями —
  `shared/expr.ts` (`evalExprWithFunctions`, белый список 15 функций, свой парсер,
  без eval/new Function).
- 55 типов блока (аудит 30.10 пересчитал): start, message, buttons, input, condition, action, goto, end,
  media, subscription, menu, command, keyword, setvar, http, ai, random, switch,
  contact, note, referral, media_group, invoice, data, tag, chain, реферальная
  семья из 9 (referral_track, referral_check, referral_bonus, referral_stats,
  referral_leaderboard, referral_hierarchy, referral_tournament,
  referral_verification, antifraud), набор 2026-09 из 13 (poll, forward,
  chat_action, wait, channel_check, segment_broadcast, user_stats, payment_link,
  payment_check, foreach, random_text, assert, counter), web_app, schedule,
  subflow, subflow_return и набор 2026-10 из 8 (edit_message, delete_message,
  quiz, language, timer_deadline, ai_classify, webhook_in, location).

## Платформа VK

Вторая платформа рядом с Telegram (миграции 0030–0031, `worker/src/vk.ts` +
`shared/platform.ts`). Создание бота: радио VK, токен сообщества проверяется
живым `groups.getById` (id группы → `vk_group_id`, screen_name, случайная
`vk_confirmation`).
**Callback API v2 (30.10, живая приёмка):** VK УДАЛИЛ метод
`groups.setCallbackServer` (error 3 «Unknown method passed») — публикация
VK-бота через него падала 502. Новый цикл (api 5.199):
`groups.addCallbackServer` (url + secret, title ≤14 символов → `server_id`,
хранится в `bots.vk_callback_server_id`, миграция 0031) +
`groups.setCallbackSettings` (требует `server_id`). Переиздание —
`editCallbackServer`; unpublish/delete — `deleteCallbackServer`.
Вебхук `POST /vk/:botId`: confirmation-ответ
(до проверки secret) → secret constant-time → дедуп `vkupd:` (TTL 1 день,
учитывает вложенную форму `object.message` api 5.131) → гард `bot.active`
(unpublished бот события не исполняет) → сверка `group_id` → перевод события
в Telegram-форму (`vkMessageToTelegramUpdate`, attachments → photo/location)
→ тот же `runEngine` + `dispatchOuts` с `platform='vk'`.
Исходящие — `platformCall('vk', …)`: `translateOutgoing` (sendMessage →
messages.send, edit → messages.edit, delete, forward-JSON, setActivity),
клавиатуры `vkKeyboard` (≤4 кнопки в строке, payload ≤255 байт, url-кнопки
open_link), медиа `vkSendMediaUpload` (vkDownloadMedia с SSRF-блэклистом и
redirect:manual → photos/docs upload-цепочка → attachment), фолбэк текстом+ссылкой.
`answerCallbackQuery` → `messages.sendMessageEventAnswer` (toast).
Unpublish/delete: `setCallbackServer url=''` + `setCallbackSettings` 0 +
KV.delete `vk:<id>`. Ограничения: видео ключом сообщества не загружается
(валидационная ошибка `platform-media-unsupported`), polls/invoice/web_app
и пр. — TG-only (матрица `blockSupportedOn`, палитра VK-бота их прячет,
валидатор выдаёт `platform-unsupported`). Платежи VK — внешний контур
`/p/:token` без изменений.

## Публикация (pipeline)

`/validate` → `/publish`: раскрыть подсценарии (expandSubflows с библиотекой
владельца) → сохранить версию в `scenarios` (авторский вид) → проверить
валидатором (ошибки раскрытия — против блоков вызова) → записать
`scenario_builds` (раскрытый артефакт, ДО Telegram) → `setWebhook` +
`getWebhookInfo` → `setMyCommands` (из `scenarioCommands`) → `active=1`.
Ошибка на любом шаге останавливает ДО обращения к Telegram. Фронт
`Publish.tsx` показывает замечания с кликом по блоку + пошаговый отчёт. Валидатор —
`validateScenario()` из `shared/validate.ts` (один код фронт+воркер). Превью
(`/simulate`) тоже гоняет РАСКРЫТЫЙ сценарий — иначе превью врёт.

## Обработка вебхука (hot-path)

1. `app.post('/:botId')` (вход вебхука, раздел «Telegram webhook entry» в
   index.ts) — проверяет `secret_token` (KV `WEBHOOK_SECRETS`, constant-time
   `keysEqual`), дешифрует токен бота (`crypto.ts`; битый `token_enc` — 200 +
   лог `bot.token_broken`, не 500), грузит сценарий. Тело апдейта больше
   `MAX_WEBHOOK_BODY_BYTES` (1 МБ) не парсится — всегда 200 ack + лог
   `webhook.oversized` (инвариант вебхука: никогда не отдавать ошибку, иначе
   Telegram ретраит мусор). Апдейты идемпотентны по `upd:<bot>:<update_id>`
   (KV, TTL 1 день — тот же механизм, что `whseen:` у `/wh/:token`).
2. Сценарий читается из **KV-кэша** `sc:` (ttl 1ч, инвалидируется при save/publish/
   rollback), а не из D1 на каждый апдейт. Флаг `has_referral` считается один раз
   при сохранении (`scenarioHasReferral` по типам блоков, подстрока — только
   fallback при битом JSON), а не парсится на хот-пафе.
3. `runEngine({scenario, update, session, botUsername})` (engine.ts) — чистая
   функция; возвращает `TelegramOut[]` + `currentBlock` + `vars`. Движок сам
   определяет точку входа: `/command` блоки, ответ на contact/location, фото-input,
   `successful_payment` (→ ветка `paid`), меню (plain-text), иначе `/start` /
   ожидающий блок. Две независимые защиты (числа — `shared/limits.ts`):
   - **бюджет шагов** `MAX_ENGINE_STEPS=1000` на проход (аргумент `maxSteps`,
     пол `MIN_ENGINE_STEPS=200`). Исчерпание — НЕ парковка: движок возвращает
     `guardCutoff` + trace `engine-budget-resume`, воркер кладёт
     `{resumeBlockId, vars}` в `scheduled_sends` (method `resume`) и крон
     доводит поток (лог `engine.budget.resume.<blockId>`; эстафета ограничена
     `MAX_BUDGET_RESUMES=20`, затем `engine.budget.gaveup`).
   - **visit-guard** `LOOP_VISIT_GUARD=100`: если ОДИН блок посещён за проход
     больше 100 раз (настоящий A→B→A runaway) — обрыв с `loopBreak` + лог
     `engine.loop.break.<blockId>`, продолжение НЕ планируется. foreach
     исключён из visit-счёта (реентерабельность по конструкции), итерация
     цикла сбрасывает счётчики — прогресс доказуем через `__loop.<id>`.
   - Resume-проходы идут без апдейта: чат доставки берётся из `__chat`
     (последний живой чат пользователя; для расписаний — его user_id).
4. `outs` с `method`:
   - `sendMessage/sendPhoto/sendVideo/sendAudio/sendDocument/sendMediaGroup/sendInvoice`
     — Telegram API. `dispatchOuts` запоминает `message_id` ответа в
     `vars['__bot_msg']` — из него работает `deleteBotMessage`.
   - `sendPoll/sendChatAction/forwardMessage/copyMessage/deleteMessage/
     editMessageText/editMessageReplyMarkup` — набор 2026-09; ошибки логируются
     и глотаются («message is not modified» → событие `edit.not_modified`, не ошибка).
   - `answerCallbackQuery` — движок выпускает его БЕЗ `callback_query_id`
     (он id не знает); воркер подставляет id текущего апдейта. Правило: РОВНО
     ОДИН ответ на callback за апдейт — безусловный фолбэк в persist-шаге
     пропускается, если движок уже ответил (cbToast/cbAlert).
   - `http` / `ai` — асинхронно: воркер уходит, потом **резюмирует** тот же
     вебхук через `dispatchOuts→resumeFrom` с `startBlockId` (сценарий прокидывается
     один раз за webhook, double `getBot` убран). `http` поддерживает `retries`
     (экспоненциальный backoff) и `paginate` (page/offset/cursor, сбор в
     `collectVar`, бюджет ~50 с, недообход → частичный результат + `__http_page`).
     Глубина рекурсии ограничена `MAX_ASYNC_CHAIN=25` (было 5, молча): на
     превышении хвост откладывается в `scheduled_sends` (лог
     `async.chain.deferred.<depth>`) и доезжает кроном — 12 http-блоков подряд
     завершаются в одном запросе, 30 — через одно отложение.
   - `trace` — служебные маркеры движка (не Telegram): `loop` (прогон рисует
     «цикл i/N»), `loop-deferred`, `engine-budget-resume` (воркер планирует
     продолжение), `engine-loop-break`, `schedule`. В вебхуке не уходят в
     Telegram — только в логи/прогон; секретов и payload'ов не содержат.
   - `wait` — воркер кладёт задачу `wait_timeout` (и опционально `wait_reminder`)
     в `scheduled_sends`; крон срабатывает ТОЛЬКО если сессия всё ещё на том же
     блоке и nonce `__wait.<blockId>` совпал, иначе задача молча удаляется.
   - `action` (webhook/notify/broadcast) / `subscription` / `delay` — исполняет воркер.
     `delay` кладёт запись в `scheduled_sends`, крон раз в минуту (`* * * * *`)
     добирает просроченные и досылает.
5. `session` + `log` пишутся в D1 **одним `db.batch`** через `ctx.waitUntil` —
   не блокируют ответ Telegram. Персист сессии — CAS (`upsertSessionCas`,
   F-002): строка читается вместе с `updated_at`, запись сверяет её и при
   расхождении накладывает только СВОЙ diff переменных — параллельные апдейты
   одного чата не затирают друг друга last-write-wins.
6. Telegram 429 (`retry_after`) — не потеря: `tgCall` бросает `TgRateLimitError`
   с `retry_after` (кап 300 с); в кроне задача переносится
   (`rescheduleScheduledSend`) с логом `scheduled.rate_limited.<n>s`, в вебхуке
   хвост отправки откладывается.
7. Движок остаётся чистым: всё внешнее приходит ops-интерфейсами
   (`data/tags/referral/channels/counters/users/broadcast/payments`), которые
   собирает `makeEngineOps()` и прокидывает через `runEngine → dispatchOuts →
   resumeFrom → processDue`. Без ops соответствующий блок не рвёт сценарий:
   идёт по `next`/ветке ошибки.

## База данных (D1 `bots_constructor`)

Таблицы (миграции 0001–0029): `accounts`(role), `bots`(+bot_username, has_referral),
`scenarios`(история версий), `sessions`, `logs`(крон стирает старше 30 дней),
`subscribers`, `scheduled_sends`(+attempts, +claimed_at 0029; methods: resume/broadcast/
wait_timeout/wait_reminder/schedule_run), `referrals`(+бонусные таблицы 0017),
`user_settings`(+advanced_blocks, 0020), `templates`, `collections`/`collection_items`,
`user_tags`, `scenario_drafts`, `payment_connections` + `payment_orders` (0018),
`counters` + `broadcast_counters` (0019: counters — PK(bot_id, scope, scope_id, name),
scope 'bot' → scope_id=''; broadcast_counters — дневной лимит segment_broadcast
по боту), `subflows` + `subflow_versions` + `scenario_builds` (0021, см. раздел
«Подсценарии»), `mini_apps` + `mini_app_versions` (0025) + `mini_app_usage`
(0026, с 0029 PK(bot_id, user_id, date) — AI-лимит на пользователя, media_bytes —
агрегат на бота в служебной строке user_id=0) + `mini_payments` (0029: журнал
Stars-платежей мини-аппов, payload UNIQUE = идемпотентность, charge_id UNIQUE),
`bot_schedules` (0027: абсолютные расписания, UNIQUE(bot_id, block_id),
`last_run_at` — атомарный якорь анти-дубля, `enabled=0` глушит мёртвые строки),
`bot_webhooks` (0028: входящие вебхуки блока webhook_in, token глобально UNIQUE).
С 0030: `bots.platform` ('telegram'|'vk'), `vk_group_id`, `vk_confirmation`,
`vk_screen_name`. Составные индексы (0029): `bots(owner_id, created_at)`,
`support_tickets(status, created_at)`.
Схема и все запросы — в `db.ts` (только биндинги). Роль: `user`/`moderator`/`admin`.
`deleteBotCascade`/`deleteAccountCascade` вычищают и платёжные таблицы, и билды,
и библиотеку подсценариев аккаунта, и расписания, и мини-аппы с `mini_payments`.

**Поиск в коллекциях** (`collectionFind/Update/Remove`): SQL-префильтр
`search_text LIKE` по каждому непустому значению `where` сужает выборку до
`FIND_SCAN_LIMIT=5000` самых новых строк, затем JS-проверка `matches()`
гарантирует прежнюю семантику (search_text — конкатенация, возможны
кросс-полевые попадания). Переполнение окна — лог `data.scan.capped.<n>`
(потолок скана `FIND_HARD_CAP=5000`, обе константы — `shared/limits.ts`).
Лимит выдачи `collectionFind` — 50 (кламп аргумента limit внутри функции),
лимит массовых update/remove — 25.

## Расписания (§4, набор 2026-09-30)

Блок `schedule` (группа «Время»; до набора 2026-10 был в «Потоке») —
**регистрационный**: движок выпускает
`ops.schedules.register(def)` и идёт по `next`; время считает НЕ движок.
- Регистрация: параметры → cron_expr через `scheduleToCron` (`shared/cron.ts`):
  daily/weekly → `M H * * [dow]`, interval → `*/N * * * *` / `0 */H * * *`
  либо маркер `every:N` для произвольных интервалов, cron → как есть.
  Лимит `MAX_SCHEDULES_PER_BOT=20`, апсерт по UNIQUE(bot_id, block_id).
- Крон (`scheduled()` → `processSchedules` → `processDue`): раз в минуту
  выбирает `enabled=1`, считает `isScheduleDue` (зона автора, UTC-хранение,
  DST-коррекция, минутная гранулярность), захватывает минуту атомарно
  (`markScheduleRun … WHERE last_run_at < ?`) — двойной тик не дублирует.
- Запуск потока: `next` блока регистрации (сам блок не перезапускается).
  audience `single` → строка `resume` с `vars.__chat = uid`; `all`/`tag` →
  пачки `schedule_run` по `SCHEDULE_RUN_CHUNK=10` с разносом
  `SCHEDULE_RUN_STAGGER_MS=5000`, потолок
  `MAX_SCHEDULE_RECIPIENTS_PER_TICK=2000`. Получатели — ТЕКУЩИЕ на момент
  срабатывания: backfill прошлых запусков для новых подписчиков исключён
  (якорь last_run_at/created_at).
- Мёртвая строка (блок удалён/заморожен/сценарий сброшен) → `enabled=0` +
  лог `schedule.disabled.<blockId>`, без error-loop.
- Движок остаётся чистым: `processSchedules` живёт в воркере, вся математика
  времени — чистые функции `shared/cron.ts` (покрыты `cron-expr.test.ts`).

## Набор 2026-09: новые блоки и платежи

- **Разметка** (`shared/markup.ts`): `parseMode: 'none'|'HTML'|'MarkdownV2'` на
  текстовых блоках. `{{var}}` экранируется под режим, `{{{var}}}` — сырое (opt-in).
  Без `parseMode` payload байт-в-байт прежний (parse_mode не добавляется).
  Валидатор: warn `markup-tags` на несбалансированные HTML-теги.
- **UX кнопок**: `cbToast`/`cbAlert` → `answerCallbackQuery` (alert приоритетнее
  toast, ровно один ответ на апдейт); `updateMode:'edit'` → правка сообщения
  на месте по `__cb_msg`.
- **Удаления**: `deleteUserMessage` (id входящего), `deleteBotMessage` (по
  `__bot_msg`, который воркер кладёт после каждой отправки).
- **Виды ввода** (`input.kind`): + document/video/voice/audio/location/any —
  в переменную file_id («lat,lon» для location), доп. `{{var_file_name}}`,
  `{{var_mime_type}}`.
- **Составные условия** (`conditions[]` + `logic`): 9 новых операторов
  (>=, <=, in, not_in, starts_with, ends_with, empty, not_empty, regex).
  Легаси condVar/op/condValue сохраняет СТАРОЕ поведение (> и < только числовые).
  `empty` — только '' (строка '0' НЕ пустая). Битый regex = false + ошибка
  `cond-regex`. Пустой `conditions[]` = ошибка `cond-conditions`.
- **Функции выражений** (`shared/expr.ts`): len, upper, lower, trim, substr,
  replace, concat, default, now, today, format_date, random, round, floor, ceil.
  Неизвестная функция → строка как есть + `expr-unknown-fn`. Результат функции
  НЕ прогоняется через калькулятор повторно (дата «2026-09-23» не превращается в число).
- **foreach**: реентерабельный цикл, состояние в `vars['__loop.'+id]` — переживает
  паузы между апдейтами И срезы бюджета шагов (resume продолжает с той же
  итерации, trace `engine.loop.deferred.<id>.<i>/<n>`). `maxIterations`
  (default 100, hard cap `HARD_LOOP_CAP = MAX_ENGINE_STEPS = 1000`).
  Обратная связь body→foreach НЕ считается tight loop (`breaksInstantLoop` в graph.ts).
  Валидатор честно говорит о вместимости одного прохода (`fe-pass-capacity`:
  `foreachPassCapacity(foreachBodySize(sc, id))`), остаток доезжает фоново.
- **ai-память** (§5): `historyVar` (массив {role, content} в vars),
  `historyTurns` (default 6, cap 20), `persistHistoryTo` (коллекция — история
  переживает сброс сессии, пишется через data-операции). Сборка
  `[system?, ...history, user]` с бюджетом `AI_PROMPT_BUDGET_BYTES=8KB`:
  переполнение режет СТАРЕЙШИЕ ходы (лог `ai.history.truncated.<n>`), вызов
  не падает никогда. Пустой ответ модели не пишет assistant-ход.
  Чистая логика — `worker/src/aiHistory.ts`.
- **schedule**: абсолютное расписание (см. раздел «Расписания»).
- **wait**: ветки reply/timeout; таймаут через `scheduled_sends` (method
  `wait_timeout`) с nonce-защитой от двойного срабатывания; `reminderText` —
  напоминание в середине ожидания (method `wait_reminder`).
- **Новые блоки**: poll (answered/skipped, quiz через correctOptionId), forward
  (ok/failed; forward/copy/text), chat_action, channel_check (member/not_member/
  error, кэш в `__channel.<id>` на cacheMinutes), segment_broadcast (queued/empty;
  ТОЛЬКО очередь scheduled_sends, никогда не инлайн; dailyCap по broadcast_counters),
  user_stats (user.* переменные, без веток), payment_link (created/failed),
  payment_check (paid/pending/failed), random_text (взвешенный выбор), assert
  (pass/fail), counter (ok/limit_reached; inc/dec/reset/get, scope user/bot).
- **Системные переменные**: `__bot_msg`, `__cb_msg`, `__cb_chat`, `__loop.<id>`,
  `__wait.<id>`, `__channel.<id>`, `__http_page`, `poll.answer`, `poll.options`,
  `pay.link`, `pay.order`, `payment`, `user.*` (name, username, id, tags,
  subscription, paid_total, ref_count, first_seen), `ref.*` (как раньше).
  Внутренние `__*` скрыты из панели переменных (`isInternalVar`).
- **allowed_updates** при публикации теперь включают `poll_answer` и
  `pre_checkout_query` (иначе Telegram не шлёт эти апдейты).

## Платежи: как владелец подключает СВОЕГО провайдера

Принцип платформы: она НЕ использует свой платёжный аккаунт, НЕ проксирует деньги
и НЕ видит данные карт. Владелец регистрируется у провайдера сам и подключает его
в панели; платформа хранит конфиг (не-секретный открыто, секретный — AES-256-GCM
в `payment_connections.secrets_enc`), строит checkout-ссылки и проверяет подписи
вебхуков. Секреты принимаются ОДИН раз и наружу не возвращаются никогда (в API —
только маска `{has, keys}`).

Провайдеры: `telegram` (provider_token из BotFather, счёт через sendInvoice —
внешнего вебхука нет), `yookassa` (shopId + secretKey + ОБЯЗАТЕЛЬНЫЙ linkTemplate
(WS-02): дефолтная quickpay-форма не совместима с вебхуком /v3/payments,
подключение без шаблона ссылки отклоняется; тело вебхука не подписано, поэтому
событие ПЕРЕПРОВЕРЯЕТСЯ через api.yookassa.ru), `robokassa` (MerchantLogin
+ Password1/Password2; подпись md5(OutSum:InvId:Password2)), `stripe` (signing
secret; Stripe-Signature t/v1 HMAC), `custom` (любой провайдер с вебхуком:
linkTemplate обязателен, с {{order}}/{{amount}}/...; HMAC-SHA256 сырого тела в
X-Signature + ОБЯЗАТЕЛЬНЫЙ X-Timestamp (WS-06, replay-окно 5 минут) — без него
подпись отклоняется 400).

Публичный вебхук: `POST /p/:token` (короткий код 10 символов из алфавита без
0/O/1/l/I, колонка `payment_connections.webhook_token`, миграция 0022;
глобально уникален — bot id из URL исчез и берётся из строки подключения).
Публичный хост — `PAY_WEBHOOK_BASE` в `worker/wrangler.toml`
(`https://api.<твой-домен>`, см. `routes` в `worker/wrangler.toml`), при пустом значении фолбэк на origin
запроса. Старый длинный адрес `POST /pay/:botId/:webhookPath` ОТКЛЮЧЁН
навсегда: отвечает 410 Gone без единого обращения к D1/KV; колонка
`webhook_path` сохранена (в D1 удаление колонки = пересборка таблицы), но для
маршрутизации не используется. Ротация кода владельцем:
`POST /api/bots/:id/payments/connections/:cid/regenerate-webhook` — старый
адрес мгновенно перестаёт работать, событие `payments.connection.webhook.rotated`.
Легаси-строки без токена получают его лениво при чтении списка подключений
(UPDATE с guard'ом `WHERE id = ? AND webhook_token IS NULL`, идемпотентно).
Правила безопасности (на каждое есть тест):
1. Подпись проверяется ДО любых записей в БД; сравнение constant-time (`safeEqual`).
2. Идемпотентность: `UNIQUE(bot_id, external_id)` + атомарный
   `markPaymentOrderPaid` (WHERE status <> 'paid') — повтор события = 200 без записей.
3. Replay: события старше 5 минут (timestamp в подписи/теле) отклоняются 400.
4. Сумма из запроса NEVER не проверяется: сверяется с суммой сохранённого заказа,
   расхождение = 400 без изменения статуса.
5. На успех: отметка paid → факт оплаты через существующий `referralOps.recordPayment`
   (first_payment/revenue-триггеры работают как раньше) → `vars.pay.order` +
   `vars.payment` в сессию → возобновление сценария с `payment_link.successNext`
   (только если блок ещё существует в сценарии).
6. Ответы: 200 принято/уже обработано; 404 неизвестный путь/заказ; 400 неверная
   подпись/сумма/битое тело; 500 не возвращается НИКОГДА (провайдер бы долбил повторами).
RUNBOOK по подключению каждого провайдера — шапка миграции `0018_payments.sql`.

## Подсценарии (библиотека фрагментов, 26.09)

Переиспользуемый фрагмент сценария: «отправить меню» или «принять оплату»
собирается один раз и вызывается из многих ботов владельца. Смысл — перестать
копировать 12 блоков в 20 мест и не дать холсту стать нечитаемым на 80+ блоках.

**Главное проектное решение: подсценарий — АВТОРСКАЯ конструкция, которая
КОМПИЛИРУЕТСЯ (раскрывается) в плоский сценарий ДО движка.** Динамических
вызовов в рантайме нет и не будет (осознанно отклонено: чтения D1 на горячем
пути, нерепродуцируемая публикация, неоднозначный rollback; VM/стек вызовов в
engine.ts — огромная поверхность для того, что по сути макрос):

```
авторский сценарий (блоки subflow)
  -> expandSubflows(scenario, library)   [shared/subflow.ts — чистая, синхронная]
  -> validateScenario(expanded)          [тот же валидатор; проблемы мапятся на блок вызова]
  -> runEngine(expanded)                 [движок НЕ изменён]
```

Следствия: превью точно (что прогнал, то и в проде); публикация детерминирована
(правка библиотеки НЕ меняет живой бот, пока вызов не обновлён и бот не
опубликован заново); движок остаётся чистой функцией — все его тесты сохраняют
смысл. В engine.ts есть только guard: блок subflow/subflow_return, дошедший до
интерпретатора (баг или устаревший кэш), — одна строка лога + тупик
(currentBlock=null), никогда не исключение.

**Два артефакта, не путать:**
- `scenarios.flow_json` — АВТОРСКИЙ вид (с блоками subflow); его грузит редактор.
- `scenario_builds` (bot_id, version) — РАСКРЫТЫЙ артефакт; его исполняет вебхук.
  `loadPublishedScenario` предпочитает билд опубликованной версии; бот без билда
  (все существующие) грузится как раньше — поведение не меняется. KV-кэш 'sc:'
  без изменений (инвалидация на save/publish/rollback).
- Rollback на версию N берёт билд N; нет билда — перераскрывает на лету,
  сохраняет и пишет событие `rollback.rebuilt.vN` в логи.
- publish-version берёт СУЩЕСТВУЮЩИЙ билд, если он есть (повторная публикация
  версии обязана давать тот же артефакт, даже если библиотека изменилась).

**Модель вызова** (BlockParams): `subflowId`, `subflowRevision` (undefined =
последняя), `alias`, `inputs`/`outputs` (Record имя->выражение / имя->имя),
`scope: 'isolated'|'shared'`. Ветки: `done`/`failed`. Терминал фрагмента —
`subflow_return` (params.outputs — явные выражения выходов).

**Правила раскрытия** (shared/subflow.ts):
- id развёрнутых блоков: `sf:<alias>:<originalId>` (SUBFLOW_ID_PREFIX='sf:');
  alias входит в префикс — два вызова одного фрагмента не сталкиваются.
- isolated (дефолт): переменные фрагмента переименовываются в `sf.<alias>.<var>`,
  КРОМЕ объявленных выходов (пишутся в пространство вызывающего) и системных
  (last_input, __*, ref.*, pay.*, user.*, poll.* — никогда не переименовываются).
  shared: имена как есть — фрагмент МОЖЕТ перезаписать переменные бота (UI
  показывает callout-предупреждение).
- Входы: setvar-пролог `sf:<alias>:in_<name>` = выражение вызывающего ПЛЮС
  подстановка {{name}} в шаблонах — оба места обязаны получить значение.
- Лимиты: SUBFLOW_MAX_DEPTH=3, SUBFLOW_MAX_BLOCKS=500; превышение — ошибка
  валидации (subflow-depth/subflow-size), никогда не тихое усечение.
- Коды ошибок несут id БЛОКА ВЫЗОВА: subflow-id/-branches/-input/-missing/-cycle/
  -depth/-revision (ошибки), subflow-outdated (warn — закреплённая ревизия
  устарела, публикация разрешена), subflow-return-outside (терминал в боте).
  remapIssuesToCallSites() возвращает проблемы раскрытого артефакта на вызовы.
- params.disabled сохраняется: замороженный блок внутри фрагмента остаётся
  замороженным.

**Владелец и безопасность:** фрагмент принадлежит ОДНОМУ аккаунту; бот может
вызывать только фрагменты своего владельца. Enforced в воркере на каждом пути
чтения: библиотека грузится по owner_id (чужой id физически отсутствует →
subflow-missing), PUT scenario отклоняет чужие ссылки 400 ЯВНО (не вырезает
молча — тихое удаление теряет работу). **Шаблоны:** экспорт раскрывает сценарий
(в каталог ложатся обычные блоки) — импорт физически не может создать чужую
ссылку. Удаление фрагмента не трогает боты: вызовы становятся ошибками
валидации (тот же принцип, что «ссылка на удалённый блок»).

**Эндпоинты** (owner-scoped, админ-ключ как везде): `GET|POST /api/subflows`,
`GET|PUT|DELETE /api/subflows/:id`, `GET /api/subflows/:id/versions`,
`POST /api/subflows/:id/rollback` (восстановление = НОВАЯ ревизия, история не
перезаписывается), `POST /api/subflows/:id/preview` (прогон фрагмента настоящим
движком через обёртку вызова, in-memory ops), `POST /api/bots/:id/subflow-check`
(статусы вызовов ok/outdated/missing/cycle для бейджей холста). Лимиты записи:
имя ≤64, io-имена `/^[A-Za-z_][\w.]*$/` без дублей, фрагмент ≤256 КБ (вчетверо
меньше лимита flow_json 1 МБ: фрагмент раскрывается в КАЖДЫЙ вызов).

**UI:** блок вызова — «дверь» (двойной контур, #7c2d12) с бейджем ревизии и
статуса; subflow_return (#78350f) вставляется только во фрагменте. «Создать
подсценарий из выделения» (контекстное меню, ≥2 блоков): диалог показывает
дефолтные входы/выходы (selectionIo из shared/subflow.ts) ДО действия,
конверсия — ОДИН шаг undo; обратная операция — «Распаковать подсценарий»
(копия блоков текущей ревизии, связь с библиотекой теряется). Drill-in:
двойной клик по вызову открывает фрагмент на том же холсте (второго редактора
нет), крошки «бот / фрагмент rev N», «← бот» возвращает снимок холста.
Устаревшие вызовы: бейдж + баннер «обновить все» + «обновить до rev N» в
инспекторе; автообновления нет никогда. Страница «Библиотека» (SubflowsPage,
ленивый чанк, view='subflows' в App): поиск, ревизии с восстановлением,
дублирование, удаление с предупреждением, «Проверить фрагмент».

## Мини-аппы (Telegram WebApp, 28–29.09 + волны аудита)

Отдельная от сценариев подсистема: у бота может быть несколько мини-аппов
(UNIQUE(bot_id, slug)), каждый — JSON-схема (`shared/miniapp.ts`: страницы,
элементы, действия, `visible_when`, правила доступа all/tag/users). Редактор —
`web/src/MiniAppEditor.tsx` + `MiniInspector.tsx` (ленивый чанк); draft/published
раздельны, публикация пишет снапшот в `mini_app_versions` (revision = max+1,
откат — копирование из снапшота).

**Рантайм (`worker/src/miniapp/`):**
- `spa.ts` — `SPA_HTML`: единая HTML-оболочка с бут-скриптом mini-boot (рендер
  схемы на клиенте, действия — POST на /m/api). Логика условий `evalMiniOp` /
  `evalVisibleMini` дублирует серверную семантику для мгновенного отклика UI,
  но истина — серверная фильтрация.
- `runtime.ts` — `parseAndValidateInitData` (HMAC по алгоритму Telegram WebApp:
  секрет = HMAC("WebAppData", botToken) бота ИЗ ПУТИ — initData бота A на
  эндпоинте бота B невалиден по построению), `buildContext` (user/tag/подписка),
  `checkAccess` (all/tag/users), СЕРВЕРНАЯ фильтрация `filterVisibleApp`
  (visible_when) и `collectAllowedTables` (whitelist таблиц — клиент не может
  прочитать таблицу, которой нет в схеме).
- `payments.ts` — Stars-платежи (F-041): действие `{kind:'pay', product, stars}`
  → строка `mini_payments` → `sendMiniInvoice` (sendInvoice БЕЗ provider_token,
  валюта XTR, payload `mini:<id>` через `miniPaymentPayload`). pre_checkout в
  вебхуке бота сверяет сумму/валюту с pending-строкой и отвечает ok:false при
  расхождении; successful_payment обрабатывается ДО загрузки сценария и
  идемпотентно отмечает paid по charge_id (`markMiniPaymentPaid`; ретрай →
  лог `mini.payment.duplicate`). Легаси-payload `mini:<botId>:<userId>`
  парсером отбрасывается.
- `ai.ts` — генерация изображений для мини-аппов (`generateMiniImage`, Filebase),
  дневной лимит — на ПОЛЬЗОВАТЕЛЯ (PK(bot_id, user_id, date) в mini_app_usage,
  0029; было на бота — F-039).
- `limits.ts` — `checkPublishLimits` (страницы/элементы), `checkMediaQuota`
  (Filebase-байты на бота), `rateLimitMiniApi` (минутный лимит /m/api на пару
  бот+юзер, KV, fail-open). Числа — `MINI_LIMITS` в `shared/miniapp.ts`
  (pages 20, elsPerPage 80, mediaBytesPerBot 100 МБ, apiPerMin 120,
  aiPerUserDay 20).

**Роуты:** `GET /m/:botId/:slug` (SPA_HTML), `GET /m/img/:botId/:file` (медиа,
ключ строго regex), `POST /m/api/:botId/:slug/boot|query|action` (initData
обязателен). Управление (владелец): `GET|POST /api/bots/:id/miniapps`,
`GET|PUT|DELETE /api/miniapps/:id`, `POST /api/miniapps/:id/publish|rollback`,
`GET /api/miniapps/:id/versions`. Схема хранит `draft_json`/`published_json`,
`access_rule_json` — строкой (валидация формы — `validateMiniAppShape` воркером).
CSS/атрибуты пользователя санитизируются (`shared/mini-sanitize.ts`).


## Auth (`worker/src/auth.ts`, `web/src/api.ts`)

- Регистрация/логин: `login`+`password` → `PBKDF2-SHA256` (100 000 итераций — потолок
  WebCrypto в Workers), сессия в KV (`sess:<token>`, 30 дней), Bearer-токен в
  `sessionStorage`. У пользователя видны только свои боты.
- Админ платформы: `ADMIN_KEY` → `x-admin-key`. **Ключ только у владельца, в файлы не пишу.**
- `GET /api/me` и `GET /me` → `{user, role}`.
- CORS — белый список (`PROD_ORIGINS` + regex-паттерны preview-деплоев/localhost
  + `CORS_ORIGINS` из env), не `*`; суффиксная атака не проходит (regex с якорями).
- Минимальный пароль — 6 символов; ответы login различимы («Логин занят» /
  «Пароль не верный» / «Логин не найден») — принято владельцем, см. «Принятые риски» (WS-14).

## Фронт (React)

- `api.ts` — клиент; `req()` всегда берёт `body.error` если есть (тексты уже
  человеческие: «Логин занят» / «Пароль не верный» / «Логин не найден»; на
  auth-роутах рядом машинное поле `code` — его смотрит `authErrorMessage` в
  `journey.ts`). `checkAdminKey()` шлёт кандидата явным `x-admin-key` на
  `GET /api/admin/session` — ключ проверяется сервером до открытия дашборда.
  `reqKeepBody()` нужен для `/validate` и `/publish` (отдают 422 + список замечаний).
  `api.payments.*` — CRUD подключений провайдеров (секреты только маской
  `{has, keys}`), `paymentWebhookUrl()` собирает публичный адрес вебхука.
- `blocks.ts` — `BLOCK_META` строится через `Object.defineProperty` геттеры, чтобы
  i18n подхватывался в момент чтения (смена языка в настройках перерисовывает палитру
  без перезагрузки). НЕ делать spread/fromEntries по META — сломается ленивый i18n.
  Палитра — 13 групп (`PALETTE_GROUPS`; в наборе 2026-10 добавились «Время»
  (time: schedule, wait, timer_deadline) и «ИИ» (ai: ai, ai_classify,
  random_text));
  `PALETTE_GROUP_IDS` и тип `PaletteGroupId` — ДВА списка, их равенство держит
  `tests/registry.test.ts`. `LEGACY_GROUP_IDS` мапит старые id из localStorage
  (`messages`→`content`, значение живёт в браузере бесконечно). Группа `advanced`
  у skill_level 'low' скрыта до тумблера (серверная настройка `advanced_blocks`,
  входы — низ палитры и Настройки). `guideTextKey(type)` — ключ текста гайда:
  справочник блоков ГЕНЕРИРУЕТСЯ из META, новый блок попадает в гайд сам.
- `i18n.ts` — `translate(lang, key, vars)`, RU/EN (~1500 ключей); TKey выводится
  из суммы базового ru-словаря и 8 пар фрагментов
  `i18n.frag.{guide,insp,canvas,pay,subflow,mini,admin,blocks2610}.ts`
  (каждая задача ведёт свой файл; EN-фрагмент типизирован
  `Record<keyof …_RU, string>` — паритет компилируется; отсутствующий ключ ловит
  только tsc, не vitest). `settings.ts` — стор
  (`useSyncExternalStore`, `data-theme`), `DEFAULT_SETTINGS` (тема dark, lang ru,
  skill_level '', advanced_blocks false).
- `Constructor.tsx` — холст; `Inspector.tsx` — редактор блока (цвет+id, «точка входа»,
  «Далее →»); `preview.tsx` — прогон НА воркере (`/simulate`): системные строки
  движка (`[опрос]`, `[правка сообщения]`, `[цикл: i/n]`, …) оформляются как
  события, панель служебных вводов (member:/notmember:, paid:/pending:/failed:,
  document:/video:/voice:/audio:/any:) позволяет проверить ветки новых блоков
  без живого бота; локальной семантики блоков во фронте нет и не должно быть.
  `Publish.tsx` — публикация с отчётом; `TemplatesPage.tsx` — каталог;
  `PaymentsPage.tsx` — ленивая страница «Оплата» (view='payments' в App):
  подключения своего провайдера, секреты write-only, webhook URL с копированием,
  «проверить подключение»; `conflicts.ts`/`explain.ts` — детектор конфликтов и
  «объяснить блок». `MiniAppEditor.tsx`/`MiniInspector.tsx` — редактор
  мини-аппов (см. раздел «Мини-аппы»); `SubflowsPage.tsx`, `DataPage.tsx`,
  `SupportPage.tsx`, `AdminPage.tsx` — ленивые страницы (view=… в App).
- Онбординг: `OnboardingTour.tsx` (6 шагов), `SkillLevelModal.tsx` (high/medium/low) —
  адаптирует UI по уровню.
- Build: `vite.config.ts` режет `react-vendor` / `xyflow-vendor` в отдельные чанки
  (content-hash) — при деплое app-кода vendor не перекачивается. Ленивые чанки:
  Constructor, DataPage, PaymentsPage, Guide, TemplatesModal, SupportPage,
  TemplatesPage, SubflowsPage, AdminPage, MiniAppEditor, i18n.en. CSS тяжёлой
  библиотеки (xyflow) обязан импортироваться из ленивого модуля, иначе
  vendor-чанк снова привяжется к entry.
- Анти-дрейфовые гейты (`tests/registry.test.ts`, `tests/palette.test.ts`,
  `tests/ports.test.ts`): каждый BlockType обязан иметь META (label/hint/цвет),
  WHAT_IF, defaultBlock, summary, порты (ветвящиеся — ключи веток из контракта),
  текст гайда в RU и EN и лежать ровно в одной основной группе палитры.

## Эндпоинты воркера (коротко)

**110 route-записей** (109 + `POST /vk/:botId`; settings/templates/me имеют двойные пути
`/api/*` + легаси `/*`). Классы авторизации (карта — `docs/AUDIT-2026-10-18.md`
раздел 3): session+ownership 44, session 23, session(+role) 11, staff-or-session 7,
admin-key 1, PUBLIC 17, token/secret 2, deprecated-410 1, cron 1. Хелперы:
`resolveIdentity` (admin-ветка первой — ADMIN_KEY затеняет сессию, см. инцидент
§19 уроков), `loadOwnedBot/loadOwnedBotById` (чужой бот → 403, несуществующий → 404),
`requireStaff`, `canAccessAnyBot` (read-only: логи, statuses, admin/users — запись
чужих ботов сотрудникам недоступна).

- Auth: `POST /api/auth/register|login` (антибрут: `login:<ip>`/`acct:<login>`,
  429 после 10 неудач), `GET|DELETE /api/auth/me`, `POST /api/auth/logout|password|logout-all`.
- Bots: `GET /api/bots` (только боты СВОЕГО владельца: у аккаунта — свой id, у
  чистой ADMIN_KEY-сессии — `owner_id = 'admin'` (константа `ADMIN_OWNER_ID`) +
  флаг `adminKey`; глобального списка нет), `POST /api/bots` (владельца
  выбирает сессия, `body.owner_id` не уважается), `GET|DELETE /api/bots/:id`,
  `GET|PUT /api/bots/:id/scenario` (PUT — оптимистичная блокировка: `body.version`
  устарела → **409 `version-conflict`** с актуальной версией; без version в теле —
  прежнее поведение), `GET|PUT|DELETE /api/bots/:id/draft`, `GET /api/bots/:id/stats`,
  `POST /api/bots/:id/webhook`, `POST /api/bots/statuses` (batch, дашборд без N+1),
  `GET /api/bots/:id/versions`, `DELETE /api/bots/:id/versions[/:version]`,
  `POST /api/bots/:id/rollback`, `GET|DELETE /api/bots/:id/logs`,
  `POST /api/bots/:id/media`, `DELETE /api/bots/:id/media/:key`,
  `POST /api/bots/:id/simulate` (точный прогон движком; лимит **30/мин**,
  429 + Retry-After — `minuteLimited`).
- Publish: `POST /api/bots/:id/validate|publish|publish-version|unpublish`,
  `GET /api/bots/:id/status`. Публикация — лимит **10/мин** на бота (429 + Retry-After).
- Clients: `GET /api/bots/:id/clients[.csv]`, `PUT|DELETE /api/bots/:id/clients/:userId`.
- Collections: `GET|POST /api/bots/:id/collections`,
  `PUT|DELETE /api/bots/:id/collections/:cid`,
  `GET|POST /api/bots/:id/collections/:cid/items`, `GET …/items.csv`,
  `PUT|DELETE …/items/:itemId`.
- Settings: `GET|PUT /api/settings` (+ легаси `/settings`), `GET /api/me` (+ `/me`).
- Templates: `GET|POST /api/templates` (+ легаси `/templates`; GET открыт,
  POST — сессия+лимит), `GET /api/templates/:id`,
  `POST /api/templates/:id/use|like` (IP-лимит 60/час), `DELETE /api/templates/:id`.
- Referrals: `GET /api/bots/:id/referrals`.
- Payments (владелец бота): `GET|POST /api/bots/:id/payments/connections`,
  `PUT|DELETE /api/bots/:id/payments/connections/:cid`,
  `POST /api/bots/:id/payments/connections/:cid/regenerate-webhook|check`.
  Секреты — только маска.
- Miniapps (владелец): `GET|POST /api/bots/:id/miniapps`,
  `GET|PUT|DELETE /api/miniapps/:id`, `POST /api/miniapps/:id/publish|rollback`,
  `GET /api/miniapps/:id/versions`.
- Subflows (владелец): `GET|POST /api/subflows`, `GET|PUT|DELETE /api/subflows/:id`,
  `GET /api/subflows/:id/versions`, `POST /api/subflows/:id/rollback|preview`,
  `POST /api/bots/:id/subflow-check`.
- Публичные (без сессии):
  - `POST /:botId` — вебхук Telegram (защита — `x-telegram-bot-api-secret-token`,
    constant-time; тело ≤1 МБ, всегда 200 ack).
  - `POST /p/:token` — платёжный вебхук провайдера (подпись до БД; см. «Платежи»).
    Старый `POST /pay/:botId/:webhookPath` — 410 Gone без обращений к БД.
  - `POST /wh/:token` — входящий вебхук блока `webhook_in` (токен из
    `bot_webhooks`, fail-счётчик антибрута, дедупликация `whseen:<token>:<eventId>`
    в KV, TTL 1 день; тело раскладывается в `wh.*` переменные).
  - `/m/*` — мини-аппы: `GET /m/:botId/:slug` (SPA_HTML), `GET /m/img/:botId/:file`
    (ключ строго regex), `POST /m/api/:botId/:slug/boot|query|action` (initData
    HMAC, минутный rate limit, серверная фильтрация).
  - `GET /api/health`, каталог шаблонов (GET).
- Staff-страница «Пользователи» (admin/moderator/ADMIN_KEY, read-only):
  `GET /api/admin/users/:login` (профиль, боты с версиями, итоги),
  `GET /api/admin/users/:login/logs?limit&botId&userId` (агрегированные
  события всех ботов владельца, `listLogsByOwner`, limit ≤ 500). Каждый
  просмотр логируется (`admin.user.view.<login>` / `admin.user.logs.<login>`).
  Граница безопасности: доступ сотрудника (`canAccessAnyBot`) распространяется
  ТОЛЬКО на эти два роута плюс чтение `GET /api/bots/:id/logs` и
  `POST /api/bots/statuses`. `loadOwnedBot`/`loadOwnedBotById` НЕ расширены:
  запись сценария, публикация, откат и удаление чужого бота модератору
  недоступны (403, на это есть тест).
- Support: `GET /api/support/open-count`, `GET|POST /api/support/tickets`,
  `GET /api/support/tickets/:id`, `POST /api/support/tickets/:id/messages|assign|close|reopen`.
  Тикеты имеют сквозной номер `#N` (`support_tickets.number`,
  миграция 0023, выдаётся атомарно подзапросом MAX+1 внутри INSERT +
  уникальный индекс). Легаси-тикеты (number NULL) не перенумеровываются — UI
  показывает короткий id. Поиск: `q=123` и `q=#123` матчат номер, плюс явный
  фильтр `?number=123`.
- Cron (`scheduled()`): раз в минуту — `processDue` (очередь `scheduled_sends`
  с атомарным claim: `claimScheduledSend` ставит `claimed_at` через
  `UPDATE … WHERE claimed_at IS NULL`, зависшие >10 мин перехватываются —
  дублирующий тик cron не отправляет сообщение дважды) + `processSchedules`.

## Ловушки (проверено на практике)

- **PBKDF2 в Workers** — максимум 100 000 итераций, иначе 500.
- **urllib/curl без User-Agent** → CF WAF 403/1010.
- **`wrangler` для `web/`** брать из `worker/node_modules/.bin/`; деплоить с
  `CLOUDFLARE_ACCOUNT_ID`. Для локального крола на воркер — `no_proxy='*'` и на
  `localhost` (`127.0.0.1` отдаёт 000).
- **`wrangler deploy` для Worker НЕ принимает `--account-id`** (ошибка «Unknown
  arguments») — ставить `CLOUDFLARE_ACCOUNT_ID` в env, `account_id` из `wrangler.toml`.
- **OAuth-логин wrangler перебивает токен**: деплой логинится под
  OAuth-аккаунт и при несовпадении валит 401 «account_id does not match authenticated
  accounts». Обход — экспортировать токен руками (секреты — вне репозитория,
   в `worker/.dev.vars` только `ENVIRONMENT=dev`):
   `CLOUDFLARE_API_TOKEN=... wrangler deploy`.
- **ПКМ-меню блока**: НЕ вешать на `window` слушатель `contextmenu`→закрытие — событие
  всплывает до window и тем же кликом гасит меню. Закрывать по `click` + `Escape`;
  ПКМ по пустому холсту — через `onPaneContextMenu`.
- **Dev без `ADMIN_KEY` больше НЕ открывает админ-доступ** (fail-open убран 29.09.2026):
  `isAdminRequest` всегда требует заголовок `x-admin-key`, равный заданному ключу.
  Локальный воркер и тесты запускать с ключом (`wrangler dev --var ADMIN_KEY:<локальный ключ>`).
- **WebCrypto importKey с пустым ключом** бросает `DataError: Zero-length key` —
  любая HMAC/AES-операция с пустым секретом падает исключением, а не «неверной
  подписью». В `verifyWebhook` пустой signing secret проверяется ДО вызова
  `hmacHex` (иначе битое подключение давало бы 500 на каждый вебхук).
- **allowed_updates режет апдейты**: если в списке нет `poll_answer` /
  `pre_checkout_query`, Telegram их просто не присылает — блок «Опрос» зависнет
  на ожидании, а счёт отменится на пред-чекауте. Список в `setWebhook` (publish +
  publish-version) обязан содержать оба.
- **CSS import order**: react-flow первым, свои вторым.

## Доступ к *.pages.dev из РФ

`pages.dev` троттлит РКН по SNI — с некоторых сетей РФ любой `*.pages.dev`
отдаёт 000 (таймаут TLS), при этом `cloudflare.com`, `1.1.1.1` и
`*.workers.dev` ходят напрямую. Если фронт живёт на Pages — обзаведись
кастомным доменом для живых проверок:

- фронт — кастомный домен Pages-проекта (`bots-constructor-web`);
- API воркера — свой домен через `routes` + `custom_domain = true`
  в `worker/wrangler.toml` (wrangler сам создаёт DNS-запись при деплое).
  Значение используется как `PAY_WEBHOOK_BASE` (публичные платёжные вебхуки
  `/p/:token`). `VITE_API_BASE` в прод-сборке Pages может указывать на
  `*.workers.dev` (он ходит напрямую).

## Запуск / деплой

```bash
# Worker (отдельный CF-аккаунт)
cd worker && npm install
wrangler d1 create bots_constructor          # вписать account_id/database_id в wrangler.toml
wrangler secret put ENCRYPTION_KEY           # base64 от 32 случайных байт
npm run migrate:local                         # все миграции 0001..0031
npm run dev                                    # http://localhost:8787

# Front (второй терминал)
cd web && npm install && npm run dev          # http://localhost:5173, прокси /api -> :8787

# Тесты (движок — чистая функция, сеть не нужна)
npm test                                       # из корня корень репозитория

# Прод (на авторизованной машине)
set -a; . /e/secrets/bots.env; set +a         # CLOUDFLARE_API_TOKEN живёт ВНЕ проекта
cd worker
wrangler secret put ENCRYPTION_KEY
printf 'y\n' | wrangler d1 migrations apply bots_constructor --remote   # --yes не существует
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id wrangler deploy
# Front: cd web && npm run build, затем
# wrangler pages deploy dist --project-name=bots-constructor-web --branch=main
```

## Что проверено живьём

Прогон register→bot→scenario→simulate→versions→logs→statuses в проде проходил.
Перформанс-правки (KV-кэш сценария, batch сессий, `stats()` скалярными подзапросами,
manualChunks) задеплоены.

## Изменения 17.09 (аудит-фиксы, все задеплоены)

- **Безопасность:** `isAdminRequest` fail-closed (пустой `ADMIN_KEY` = доступ закрыт
  во всех окружениях); CORS — белый список (`PROD_ORIGINS` + паттерны
  preview/ localhost + `CORS_ORIGINS` из env), а не `*`; `safeFetch` для `http` и
  `action.webhook` (таймаут, лимит ответа, `HTTP_ALLOWED_HOSTS`); глобальный `onError`;
  антибрут считает только неудачи и держит отдельные бакеты на логин/регистрацию;
  лимит на создание шаблонов; смена пароля и «выйти на всех устройствах»;
  удаление бота (`DELETE /api/bots/:id` + `deleteWebhook`).
- **Данные:** версия сценария пишется только при изменении содержимого
  (`jsonContentHash`, `shared/graph.ts`) + лимит 1 МБ на `flow_json`; крон ретраит
  `scheduled_sends` (`attempts`, миграция 0007) вместо удаления задачи при первой ошибке;
  рассылки всегда идут через `scheduled_sends`; флаг рефералки — по типу блока
  (`scenarioHasReferral`), а не по подстроке в JSON.
- **Единство кода:** обход графа вынесен в `shared/graph.ts` (одни `WAIT_TYPES` с
  `invoice` для валидатора и инспектора конфликтов); ветвящиеся блоки — только
  `usesBranches`; `PreviewLocal` удалён, превью всегда гоняет `runEngine` на воркере.
- **Фронт:** EN-словарь в отдельном чанке (`web/src/i18n.en.ts`, динамический `import()`);
  стабильные `key` у списков инспектора (`id` у кнопок/кейсов/вариантов/медиа);
  черновик сравнивается хэшем содержимого; `hideAttribution` убран.
- **Инфраструктура:** git-репозиторий (ветка `main`), `ENVIRONMENT=production` и
  observability в `wrangler.toml`, `_headers` с CSP, favicon, `npm test` (vitest).

## Изменения 17.09, вторая половина вечера (добито)

- **Тесты:** `tests/validate.test.ts` — 9 тестов на `validateScenario` и `scenarioCommands`
  (пустой сценарий, битые ссылки, заморозка гасит ошибки содержимого, тупики,
  `tight-loop` и отдельно — что цикл через `invoice` не считается бесконечным).
  Всего `npm test` = 17 тестов (движок + валидатор).
- **Мёртвая схема:** миграция `0008_drop_dead_schema.sql` — `DROP TABLE users`,
  `DROP TABLE outbox`, `ALTER TABLE bots DROP COLUMN shard_id`. Порядок важен:
  сначала деплой кода без `shard_id` (колонка имеет `DEFAULT 0`), потом миграция.
- **Зависимости:** `wrangler` 3.114 → 4.133 **вместе с** `@cloudflare/workers-types`
  4 → 5 (у wrangler 4 это peerOptional `^5.…`, иначе `npm install` падает с ERESOLVE);
  `vite` 5.4 → 8.3 (сборка на rolldown, бандлы чуть меньше), `@vitejs/plugin-react` 4 → 6.
  После апгрейда: `tsc --noEmit` чист, `vite build` проходит, деплой воркера и Pages
  выполняется новым враглером, `npm audit --omit=dev` = 0 в worker, web и корне.
- **Деплой:** воркер `a700333e-7a1c-4407-85a4-8ff716e5b889`, Pages `7a119b91`.

## Изменения 23.09 (набор 2026-09: 13 новых блоков + платежи)

- **Модель:** 13 новых BlockType (poll, forward, chat_action, wait, channel_check,
  segment_broadcast, user_stats, payment_link, payment_check, foreach, random_text,
  assert, counter), все новые поля `BlockParams` необязательные — старый сценарий
  без них ведёт себя байт-в-байт как раньше (регрессионный пак `tests/compat.test.ts`).
- **Движок:** ops-интерфейсы ChannelOps/CounterOps/UserOps/BroadcastOps/PaymentOps
  (engine.ts остаётся чистым: без D1, без fetch); `makeEngineOps()` в index.ts
  прокидывает их через webhook → dispatchOuts → resumeFrom → processDue.
- **http:** retries с экспоненциальным backoff и пагинация page/offset/cursor
  (budget ~50 с, частичный результат + `__http_page`).
- **Платежи:** миграция 0018 (payment_connections + payment_orders), провайдеры
  telegram/yookassa/robokassa/stripe/custom (`blocks/payments/providers.ts`),
  owner-scoped CRUD `/api/bots/:id/payments/connections*`, публичный вебхук
  `/pay/:botId/:webhookPath` (подпись до БД, идемпотентность, replay-окно 5 мин,
  сверка суммы, никогда не 500).
- **Миграции:** 0018 (платежи), 0019 (counters + broadcast_counters),
  0020 (`user_settings.advanced_blocks`, default 0 = прежнее UI).
- **Прогон (simulate):** заглушки всех новых ops в памяти; служебные вводы
  `member:`/`notmember:`, `paid:`/`pending:`/`failed:`, `poll:N`, префиксы
  вложений `document:`/`video:`/`voice:`/`audio:`/`any:`; читаемые строки лога
  на каждый новый метод.
- **Тесты:** базово было 210 (не 206 — промпт устарел), стало 503 (26 файлов:
  payments 48, markup 26, expr 53, engine-blocks 71, compat 15, simulate,
  payment-webhook 14, validate-blocks 55, settings-advanced 5, worker-callback 3).
- **Деплой 24.09:** миграции 0018–0020 на remote D1 (согласие владельца
  получено), воркер версия `8adcd4c5-6c7c-4516-a9e6-6a6acdb59c28`;
  `/api/health` 200 production, `/pay/*` 404 на неизвестный путь (роут живой).
  Полный платёжный E2E прогнан локально на wrangler dev (подпись/идемпотентность/
  replay/сумма/resume successNext/wait-таймауты).
- **web/ (минимум, помечен `// TODO(prompt-2): full UI`):** блоки в blocks.ts
  (цвета закреплены), i18n RU/EN, порты, explain, settings.advanced_blocks —
  typecheck и build зелёные; полный UI — Промпт 2.

## Изменения 26.09 (подсценарии / библиотека фрагментов)

Полное описание модели — раздел «Подсценарии» выше. Коротко о фактах:

- **Миграция 0021** (аддитивная): `subflows`, `subflow_versions`, `scenario_builds`.
- **shared/subflow.ts:** expandSubflows (компиляция вызовов), checkSubflowCalls
  (статусы для бейджей), selectionIo (дефолтные входы/выходы извлечения),
  remapIssuesToCallSites (проблемы раскрытого артефакта → блоки вызова),
  scenarioHasSubflows. Новые BlockType: subflow, subflow_return.
- **Версии и rollback с билдами:** «версия» бота = пара (scenarios, scenario_builds).
  Публикация пишет обе; rollback на N берёт билд N (нет билда — перераскрывает
  и логирует `rollback.rebuilt.vN`); publish-version переиспользует существующий
  билд (детерминизм). История версий самого бота не изменилась.
- **Движок НЕ расширен:** в engine.ts добавлен только guard (авторский блок =
  лог + тупик). Тест purity-guard проверяет, что engine.ts не импортирует
  subflow.ts и не трогает D1.
- **Тесты:** 652 (было 603): subflow.test.ts 21 (раскрытие, детерминизм,
  иммутабельность, эквивалентность рантайма рукописному сценарию, selectionIo),
  subflow-worker.test.ts 8 (guard владельца, превью=раскрытый сценарий, билд
  при публикации, loader предпочитает билд, экспорт шаблона раскрытым,
  регрессия бота без подсценариев), validate-subflows 13, engine +3 (guard),
  guide-search +3, worker-safety +1 (loader).
- **UI:** холст (узел-«дверь», бейджи, drill-in, извлечение/распаковка, баннер
  устаревших вызовов), инспектор вызова и возврата, страница «Библиотека»,
  гайды/глоссарий/поиск — см. раздел «Подсценарии».

## Capacity limits — реальные числа платформы

Единый источник правды — **`shared/limits.ts`**. Движок, db, воркер, валидатор
и эта таблица обязаны брать числа оттуда; любое новое ограничение сначала
появляется в limits.ts. До 30.09.2026 числа жили дублями в коде и разъезжались
с подсказками валидатора (foreach «до 500» фактически делал ~40–60).

| Что | Константа | Значение | Поведение на пределе |
|---|---|---|---|
| Шагов движка за проход | `MAX_ENGINE_STEPS` | 1000 | остаток потока → `scheduled_sends` (`resume`), лог `engine.budget.resume.<blockId>` |
| Пол аргумента maxSteps | `MIN_ENGINE_STEPS` | 200 | значение ниже пола игнорируется |
| Продолжений бюджета подряд | `MAX_BUDGET_RESUMES` | 20 | стоп с логом `engine.budget.gaveup` |
| Посещений одного блока | `LOOP_VISIT_GUARD` | 100 | обрыв, лог `engine.loop.break.<blockId>` (foreach исключён) |
| Потолок итераций foreach | `HARD_LOOP_CAP` | = MAX_ENGINE_STEPS | недобор доезжает фоново (`__loop.<id>` переживает resume) |
| Вместимость прохода цикла | `foreachPassCapacity(bodySize)` | budget/(тело) шагов | подсказка `fe-pass-capacity` в валидаторе |
| Сканирование коллекций | `FIND_SCAN_LIMIT` / `FIND_HARD_CAP` | 5000 / 5000 | SQL-префильтр `search_text LIKE`; переполнение — лог `data.scan.capped.<n>` |
| Выдача `data.find` | кламп `limit` в `collectionFind` (db.ts) | 50 | большее значение усекается до 50 |
| Массовые update/remove | кламп в `collectionUpdate`/`collectionRemove` | 25 | — |
| Глубина http/ai-цепочки | `MAX_ASYNC_CHAIN` | 25 | хвост → `scheduled_sends`, лог `async.chain.deferred.<depth>` (было 5 и молча) |
| Ходов истории ИИ | `AI_HISTORY_TURNS_DEFAULT` / `_MAX` | 6 / 20 | opt-in через `historyVar` |
| Бюджет промпта ИИ | `AI_PROMPT_BUDGET_BYTES` | 8 КБ | режет СТАРЕЙШИЕ ходы, лог `ai.history.truncated.<n>`, вызов не падает |
| Расписаний на бота | `MAX_SCHEDULES_PER_BOT` | 20 | лог `schedule.limit.<blockId>`, регистрация отклонена |
| Минимальный интервал | `MIN_SCHEDULE_INTERVAL_MIN` | 1 мин | ошибка валидации `sch-interval` |
| Получателей расписания за тик | `MAX_SCHEDULE_RECIPIENTS_PER_TICK` | 2000 | хвост аудитории ждёт следующего срабатывания |
| Пачка schedule_run | `SCHEDULE_RUN_CHUNK` / stagger | 10 / 5000 мс | разнос по времени внутри очереди |
| callback_data кнопки | `TG_CALLBACK_DATA_BYTES` | 64 байта | **error** `btn-value-long` (блокирует публикацию) |
| Заголовок/описание счёта | `TG_INVOICE_TITLE_MAX` / `_DESC_MAX` | 32 / 255 | warn (рантайм усекает) |
| Текст cbToast/cbAlert | `TG_CB_TOAST_MAX` | 200 | warn `cbt-toast-long` (Telegram усекает) |
| Текст сообщения / правки | `TG_MESSAGE_TEXT_MAX` | 4096 | **error** `msg-text-long` / `editm-text-long` |
| Подпись медиа | `TG_CAPTION_MAX` | 1024 | **error** `media-caption-long` |
| Вопрос опроса/викторины | `TG_POLL_QUESTION_MAX` | 300 | **error** `poll-question-long` / `quiz-question-long` |
| Вариант опроса/викторины | `TG_POLL_OPTION_MAX` | 100 | **error** `poll-option-long` / `quiz-option-long` |
| Тело вебхука Telegram | `MAX_WEBHOOK_BODY_BYTES` (index.ts) | 1 МБ | 200 ack + лог `webhook.oversized` (не парсим) |
| Частота simulate | `minuteLimited(…, 30)` | 30/мин на актора | 429 + `retry-after: 60` |
| Частота publish | `minuteLimited(…, 10)` | 10/мин на бота | 429 + `retry-after: 60` |
| Мини-аппы | `MINI_LIMITS` (`shared/miniapp.ts`) | pages 20, els 80/страница, media 100 МБ/бот, api 120/мин на пару бот+юзер, ai 20/сутки на пользователя | публикация отклоняется текстом нарушения; /m/api — 429; AI — отказ |

Статические проверки длины (`checkStaticLength` в `shared/validate.ts`) дают
**error**, а не warn: Telegram отклоняет запрос целиком, и пользователь не
получает ничего. Проверка пропускается для шаблонов с `{{` (длину заранее не
узнать). `tight-loop` — тоже **error**: публикация сценария с циклом без ожидания
ввода заблокирована; легальными остаются циклы через `breaksInstantLoop`
(foreach) и `PARK_UNTIL_UPDATE_TYPES` (блоки, паркующие сессию до апдейта:
wait/poll/quiz/location/input/buttons…).

Лог-события лимитов видны в журнале бота и в конструкторе (подписи —
`web/src/logLabels.ts`): `engine.budget.resume.*`, `engine.budget.gaveup`,
`engine.loop.break.*`, `engine.loop.deferred.*`, `async.chain.deferred.*`,
`ai.history.truncated.*`, `data.scan.capped.*`, `schedule.registered.*`,
`schedule.fired.*`, `schedule.disabled.*`, `schedule.limit.*`,
`schedule.invalid.*`. События не содержат секретов и payload'ов — только id
блоков и числа.

## Изменения 30.09 (снятие жёстких потолков — аудит §1–§8)

- **§1 бюджет шагов:** `guard>200` с молчаливой парковкой заменён на
  `MAX_ENGINE_STEPS=1000` + resume-продолжение через `scheduled_sends`
  (флаг `guardCutoff` теперь РЕАЛЬНО потребляется `dispatchOuts`). Отдельный
  visit-guard 100 на блок ловит настоящий runaway (`engine.loop.break.*`).
  Цепочка 250 блоков проходит за один вебхук; 1500 — за запрос + один тик крона.
- **§2 foreach:** hard cap = MAX_ENGINE_STEPS (было 500, фактически ~40–60);
  состояние цикла переживает срез бюджета (trace `engine.loop.deferred.<id>.<i>/<n>`);
  подсказка валидатора `fe-pass-capacity` считает реальную вместимость прохода
  по размеру тела (`foreachBodySize` в graph.ts). 300 итераций × тело 5 блоков
  доезжают за ≤2 продолжения.
- **§3 коллекции:** `FIND_SCAN_LIMIT` 500 → 5000 + SQL-префильтр
  `search_text LIKE` (семантика неизменна: JS-`matches()` остаётся финальным
  фильтром) в find/update/remove; переполнение — `data.scan.capped.*`.
  Строка 1 из 2000 находится; кросс-полевое ложное попадание отсеивается.
- **§4 расписания:** блок `schedule` + таблица `bot_schedules` (0027) +
  `processSchedules` в кроне: daily/weekly/interval/cron, зоны IANA (UTC-хранение),
  audience all/tag/single, атомарный анти-дубль (`WHERE last_run_at < ?`),
  лимит 20/бот, 2000 получателей/тик, backfill исключён, мёртвый блок →
  `enabled=0` + лог. Математика времени — чистый `shared/cron.ts`.
- **§5 память ИИ:** `historyVar`/`historyTurns`/`persistHistoryTo` (opt-in;
  без них вызов байт-в-байт прежний); messages 1→3→5 на трёх последовательных
  вызовах; бюджет 8 КБ режет старьё (`ai.history.truncated.<n>`); пустой ответ
  не пишет assistant-ход. Логика — `worker/src/aiHistory.ts`.
- **§6 async-цепочки:** depth 5 → `MAX_ASYNC_CHAIN=25`, превышение — отложение
  (`async.chain.deferred.<depth>`), не молчаливый обрыв. 12 http подряд —
  один запрос; 30 — запрос + тик крона.
- **§7 лимиты Telegram в валидаторе:** `btn-value-long` (ERROR, 64 байта
  callback_data), `invoice-title-long`/`invoice-desc-long` (warn, 32/255),
  `cbt-toast-long` (warn, 200); EN-формулировки в journey.ts.
- **§8 видимость:** таблица выше, `shared/limits.ts` как единый источник,
  новые лог-события с подписями в logLabels.ts.
- **Попутный баг-фикс:** resume-проходы (delay/wait_timeout/бюджет/расписания)
  слали сообщения с `chat_id: undefined` — Telegram их отклонял молча.
  Добавлена `__chat` (последний живой чат; для расписаний — user_id получателя).
- **Тесты:** 1137 → +75 новых (engine-budget 9, worker-limits 20,
  validate-schedule 17, cron-expr 22, data-find-scan 9, validate-tg-limits 15,
  schedule-ui 15); обновлён simulate-тест foreach (старое ожидание фиксировало
  баг «срезано guard'ом»).

## Изменения 28.09–02.10 (мини-аппы + набор 2026-10 + панель мини-редактора)

- **Мини-аппы (28–29.09):** подсистема `/m/*` — SPA-оболочка, initData HMAC,
  серверная фильтрация, Stars-платежи. Полное описание — раздел «Мини-аппы».
  Миграции 0025 (mini_apps + mini_app_versions), 0026 (mini_app_usage).
- **Набор 2026-10 (01.10): 8 новых блоков** → 55 BlockType (пересчёт аудита 30.10).
  - `edit_message` — правка сообщения по id (`__bot_msg` и др.): ветки
    ok/too_old/not_found («message is not modified» — событие, не ошибка).
  - `delete_message` — удаление сообщения по id (без веток).
  - `quiz` — викторина (sendPoll type=quiz): ветки passed/failed, объяснение
    (explanation), ждёт poll_answer.
  - `language` — определение языка пользователя: ветки по кодам языка +
    fallback; код языка доступен как переменная.
  - `timer_deadline` — фоновый дедлайн: поток идёт по next сразу, крон в срок
    проверяет флаг отмены и возобновляет сессию с ветки done/expired
    (регистрационный, как schedule; NOT пауза потока — бронь слота должна
    отправить ссылку на оплату сразу).
  - `ai_classify` — классификация ответа моделью по списку меток: ветки по
    меткам + fallback (ветки синхронизируются со списком меток, включая
    ПЕРЕИМЕНОВАНИЕ — связь переносится со старого ключа на новый).
  - `webhook_in` — входящий вебхук как триггер сценария: регистрационный блок,
    при публикации создаёт токен-эндпоинт `POST /wh/:token` (таблица
    `bot_webhooks`, миграция 0028); поля тела раскладываются в переменные
    `wh.<field>` ('[]' = всё тело в `wh.body`), сценарий продолжается с блока.
    Защита: токен, fail-счётчик, дедупликация `whseen:` (KV, TTL 1 день).
  - `location` — запрос геопозиции: reply-клавиатура request_location, ветки
    sent/declined, координаты в `user.lat`/`user.lon`.
  - Новые группы палитры «Время» и «ИИ» (schedule/wait/timer_deadline;
    ai/ai_classify/random_text) — 13 групп вместо 11.
  - Новые error-коды валидатора: `cond-regex-danger`, `input-regex-danger`
    (катастрофический backtracking в regex автора), `subflow-alias-dup`
    (совпавшие alias двух вызовов), `poll-question-long`, `poll-option-long`,
    `quiz-question-long`, `quiz-option-long`, `msg-text-long`,
    `media-caption-long`, `editm-text-long`; `tight-loop` повышен до ERROR.
  - Рантайм блоков разложен по модулям `worker/src/blocks/`: aiclassify,
    deadline, lang, location, msgops (edit/delete), payments, quiz, referral,
    webhookin.
- **Панель мини-редактора как у ботов (01.10):** топбар мини-аппов
  переиспользует классы ботовского (`constructor-top`, `bar-strip`, `bar-row`,
  `conflict-pop more-pop`) — темы и мобильные правила наследуются; хардкод
  цветов тёмной темы убран.

## Изменения 18–20.10 (аудит 2026-10-18, волны 1–2)

Отчёт — `docs/AUDIT-2026-10-18.md`, задачи — `docs/AUDIT-TASKS-2026-10-18.md`.
Миграция волны 2 — `0029_audit_wave2.sql`. Ключевое (задеплоено):

- **Гонки и идемпотентность:** оптимистичная блокировка версии сценария
  (`PUT /api/bots/:id/scenario` с `body.version` → 409 `version-conflict` при
  устаревшей версии, last-write-wins больше не затирает чужие правки);
  CAS-персист сессий вебхука (`upsertSessionCas` — сверка `updated_at`,
  наложение только своего diff переменных); атомарный claim очереди
  `scheduled_sends` (`claimScheduledSend`, колонка `claimed_at`, 0029 —
  дублирующий тик cron at-least-once не шлёт сообщение дважды); атомарный
  дневной лимит рассылки (`tryBumpBroadcastCounter` — bump ДО постановки в
  очередь, ok=false → «дневной лимит исчерпан»).
- **429 Telegram:** `tgCall` разбирает `retry_after` → `TgRateLimitError`
  (кап 300 с); крон переносит задачу (`rescheduleScheduledSend`, лог
  `scheduled.rate_limited.<n>s`), рассылка учитывает максимальный retry_after
  пачки.
- **Частотные лимиты дорогих путей (F-011):** `minuteLimited` — simulate 30/мин
  на актора, publish 10/мин на бота (429 + `retry-after: 60`; KV-окно 60 с).
- **Вебхук (F-014/F-006/F-007):** лимит тела 1 МБ (`MAX_WEBHOOK_BODY_BYTES`,
  content-length + фактическая длина до JSON.parse; всегда 200 ack + лог
  `webhook.oversized`); битый `token_enc` — 200 + `bot.token_broken` вместо 500
  и бесконечных ретраев; сравнение `secret_token` — constant-time `keysEqual`.
- **Мини-аппы:** Stars-платежи (F-041: `mini_payments`, payload `mini:<id>`,
  pre_checkout со сверкой суммы/валюты, идемпотентная отметка paid по
  charge_id); AI-лимит на пользователя (F-039: PK(bot_id, user_id, date) в
  `mini_app_usage`, было на бота); `mini_payments` в deleteBotCascade.
- **Платежи:** yookassa — `linkTemplate` обязателен (WS-02: quickpay-форма не
  совместима с вебхуком); custom-провайдер — обязательный `X-Timestamp`
  (WS-06, replay-окно 5 мин).
- **Индексы (F-010):** `bots(owner_id, created_at)`,
  `support_tickets(status, created_at)` — списки без TEMP B-TREE.
- **Бандл:** `@aws-sdk/client-s3` в `media.ts` — динамический `import()` внутри
  функций загрузки (S5-10): холодный путь вебхука больше не тянет SDK.
- **Инфраструктура:** `compatibility_date` 2025-10-01 (DH-13); `npm audit fix`
  применён (source-map-js закрыт); vitest остаётся 2.x — обновление на 5.x
  breaking, отложено (DH-17); `ADMIN_TG_ID` — plain-переменная в [vars].

## Изменения 28.10–30.10 (платформа VK + волна 3 аудита)

- **Платформа VK** (миграция 0030, описание — раздел «Платформа VK» выше):
  создание VK-бота, Callback API, адаптер vk.ts, платформенная палитра,
  платежи внешними провайдерами, медиа-цепочки (коммиты 1ea7211, f25f7ad,
  6161114).
- **Аудит волна 3** (30.10, отчёт `docs/AUDIT-2026-10-30.md`): 65 находок,
  Critical 0. Фиксы групп 1–3 (коммит 1b5355c): вложенный формат message_new
  5.131 (F3-100), VK unpublish/delete + гард active + group_id (F3-105/115),
  platform в /wh и ai-reply (F3-101/102), SSRF-гарды vkDownloadMedia
  (F3-113), клавиатуры ≤4 (F3-103), attachments на входе (F3-108), чипы
  op:'in' (F3-202), CAS в /m/api (F3-204), MINI_APPS_ENABLED (F3-200),
  rollback-санитизация (F3-208), escapeLike tag-ветки (P-R01), тесты VK
  (F3-402/403/404), @aws-sdk из devDeps (F3-405), хоткеи ev.code, бейдж
  Telegram-only у шаблонов (F3-310).
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) — tsc×2 + vitest на
  push/PR. Решения владельца по ретеншну/SEC-03/vitest 5 — открыты.

## Принятые риски (решения владельца, 19.10.2026)

Зафиксировано осознанно, НЕ «чинить» без нового решения владельца:

- **F-012: rate-limit fail-open при деградации KV.** Все счётчики (антибрут,
  minuteLimited, rateLimitMiniApi) при ошибке KV пропускают запрос.
  Доступность важнее строгости: деградация KV не должна класть платформу.
- **SEC-03: ADMIN_KEY = полный доступ ко всем ботам** (включая запись:
  `loadOwnedBot` возвращает бота при `id.admin`). Ключ — root платформы,
  хранится у владельца; staff-роли (moderator) ограничены read-only.
- **WS-14: минимальный пароль 6 символов и различимые ответы login**
  («Логин занят» / «Логин не найден» / «Пароль не верный»). Принято ранее:
  UX важнее, перечисление логинов гасится паузой и счётчиками неудач.
- **F-044: initData мини-аппов — реплей-окно 24ч** без nonce/одноразовости.
  Это стандарт Telegram WebApp (hash действителен сутки); серверная фильтрация
  данных ограничивает ущерб рамками доступа самого пользователя.
- **ES-07: оператор `in` режет список по запятой** (`right.split(',')`).
  Значение с запятой в списке несовместимо — by-design (список через запятую),
  задокументировано в гайде редактора.
- **PBKDF2 100k итераций** — жёсткий потолок WebCrypto в Workers (выше — 500).
  Ниже рекомендации OWASP (210k для PBKDF2-SHA256); pepper не добавляем —
  решение владельца.

## Восстановление данных (D1 time travel / PITR)

D1 `bots_constructor` (id и аккаунт — твои, из `wrangler.toml`) — time travel включён платформой по умолчанию
(проверено 20.10.2026: bookmark выдаётся). Глубина истории зависит от тарифа CF.

Процедура восстановления:
1. **Снимок текущего состояния** (до любых действий): `wrangler d1 execute bots_constructor --remote --command "SELECT ..."` по затронутым таблицам; при массовом повреждении — экспорт всей БД: CF API `POST /accounts/<acc>/d1/database/<db>/export` (даёт SQL-дамп).
2. **Точка отката**: bookmark на момент до инцидента — CF API `GET .../time_travel/bookmark?timestamp=<RFC3339>` (или wrangler `d1 time-travel ... --timestamp`).
3. **Два варианта**:
   - *Чтение из прошлого* (безопасный): `wrangler d1 execute --remote --command "SELECT ..." --back-from=<bookmark>` — вычитать нужные строки и перенести их в текущую БД вручную. Основную БД не трогает.
   - *Полный откат* (разрушающий): CF API `POST .../time_travel/restore` с bookmark — БД возвращается в прошлое; все записи ПОСЛЕ точки теряются. Только с согласия владельца и после шага 1.
4. **Бэкап истории git**: push remote после крупных сессий. Рабочая ветка одна — `main` (`ui-redesign` слита и удалена 20.10.2026). Дополнительная локальная копия — `git bundle create ../bots-<дата>.bundle --all`.
