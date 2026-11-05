-- 0018: приём платежей в боте — подключения и заказы (RUNBOOK + схема).
--
-- ==========================================================================
-- RUNBOOK: как автор подключает СВОЙ платёжный провайдер
-- ==========================================================================
--
-- Главный принцип: платформа НЕ использует свой платёжный аккаунт, не
-- проксирует деньги и никогда не видит данные карт. Деньги идут напрямую
-- между клиентом бота и провайдером автора. Конструктор здесь — только
-- «клей»:
--   1) хранит конфиг подключения (shop id, ссылки success/fail, шаблон
--      ссылки) — это НЕ секреты, поэтому лежит в config_json открытым текстом;
--   2) собирает ссылку на оплату для конкретного заказа;
--   3) принимает вебхук провайдера и проверяет подпись/пароль вебхука;
--   4) отмечает заказ оплаченным и двигает сценарий дальше.
-- Никаких списаний «от платформы» нет: если провайдер отключён у автора или
-- аккаунт заблокирован, конструктор просто получит ошибку — своих денег он
-- не тратит и чужие не держит.
--
-- Секреты (provider_token бота, secret_key ЮKassa, пароль вебхука Robokassa,
-- signing secret Stripe, произвольный shared secret для custom) НИКОГДА не
-- пишутся в открытые колонки: они шифруются AES-256-GCM и лежат в secrets_enc
-- как блоб (см. worker/src/crypto.ts, формат «base64(iv)|base64(ciphertext)»).
-- Ключ шифрования приходит из env ENCRYPTION_KEY и в базу не попадает.
--
-- Как подключить по провайдерам:
--
--   * telegram — платежи силами самого Telegram. Автор идёт в @BotFather →
--     Payments → выбирает платёжного бота (YooKassa / Stripe / свой) → получает
--     provider token. Токен кладём в secrets_enc, в config_json — необязательные
--     поля (например, currency). Ничего дополнительно хостить не нужно:
--     Telegram сам присылает successful_payment в апдейтах вебхука бота, а
--     отдельная платёжная ссылка не требуется.
--
--   * yookassa — автор регистрируется в ЮKassa на своё юрлицо/самозанятость,
--     забирает shopId и secret_key из личного кабинета. shopId → config_json,
--     secret_key → secrets_enc. Вебхук: в кабинете ЮKassa указывается URL
--     https://<worker>/pay/<webhook_path> на событие payment.succeeded; подпись
--     проверяется по паре shopId + secret_key (HTTP Basic), поэтому храним оба.
--     В config_json ещё кладём return_url — куда вернуть клиента после оплаты.
--
--   * robokassa — автор берёт в кабинете логин магазина и пароли (пароль №1
--     для подписи ссылки, пароль №2 для подписи Result URL). Логин → config_json,
--     оба пароля → secrets_enc. URL результата (ResultURL) в кабинете указывается
--     на https://<worker>/pay/<webhook_path>; в config_json — SuccessURL/FailURL
--     и шаблон ссылки. Подпись считается по MD5 от логина, суммы, номера заказа
--     и пароля — без паролей из secrets_enc проверить её нельзя.
--
--   * stripe — автор создаёт свой Stripe-аккаунт, забирает publishable и
--     secret key, а для вебхука создаёт endpoint на
--     https://<worker>/pay/<webhook_path> и получает whsec_... signing secret.
--     secret key и signing secret → secrets_enc, success/cancel URL → config_json.
--     Без signing secret вебхук неотличим от подделки, поэтому он обязателен.
--
--   * custom — свой провайдер или самописная платёжка. Автор задаёт любой
--     shared secret (он же пароль вебхука) и сам строит URL оплаты по шаблону
--     из config_json. Платформа не знает о его протоколе: она лишь подставляет
--     параметры в шаблон и сравнивает подпись, которую пришлёт его сервер.
--
-- Почему webhook_path случайный и непрозрачный: это фактически капабилити-URL.
-- Один воркер обслуживает много ботов, а путь вебхука не должен угадываться по
-- bot_id — иначе чужой человек сможет слать поддельные уведомления об оплате.
-- Поэтому путь генерируется криптослучайным и живёт в UNIQUE-колонке; при
-- утечке автор просто переподключает провайдера и получает новый путь.
-- ==========================================================================

-- ---------------- подключения провайдеров ----------------
-- Одно подключение = одна настроенная автором платёжка для одного бота. Бот
-- может иметь несколько (например, Telegram Payments + резервная Robokassa).
-- title — подпись для автора в интерфейсе, чтобы не путать подключения.
CREATE TABLE IF NOT EXISTS payment_connections (
  id           TEXT PRIMARY KEY,
  bot_id       TEXT NOT NULL,
  provider     TEXT NOT NULL CHECK (provider IN ('telegram','yookassa','robokassa','stripe','custom')),
  title        TEXT NOT NULL DEFAULT '',
  config_json  TEXT NOT NULL DEFAULT '{}',   -- НЕ секреты: shop id, success/fail URL, шаблон ссылки
  secrets_enc  TEXT NOT NULL DEFAULT '',     -- AES-256-GCM блоб (provider_token / secret_key / webhook password / signing secret)
  webhook_path TEXT NOT NULL UNIQUE,         -- непрозрачный случайный путь; по нему приходит вебхук провайдера
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Отключённое подключение остаётся в базе (автор может вернуть его обратно),
-- поэтому выборки почти всегда идут парой bot_id + enabled.
CREATE INDEX IF NOT EXISTS idx_payconn_bot ON payment_connections(bot_id);
CREATE INDEX IF NOT EXISTS idx_payconn_bot_enabled ON payment_connections(bot_id, enabled);

-- ---------------- заказы ----------------
-- Заказ — это намерение клиента заплатить. Живёт отдельно от сценария, чтобы
-- повторный вебхук или возврат клиента на страницу оплаты не создавали новый
-- платёж. external_id — номер заказа во внешней системе (инвойс Telegram,
-- InvId Robokassa, order id ЮKassa/Stripe); UNIQUE(bot_id, external_id) не даёт
-- вебхуку создать второй заказ вместо того, чтобы обновить существующий.
-- amount — в минимальных единицах (копейки для RUB), как у провайдеров, чтобы
-- не терять точность на дробных суммах.
CREATE TABLE IF NOT EXISTS payment_orders (
  id            TEXT PRIMARY KEY,
  bot_id        TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  user_id       INTEGER NOT NULL,
  external_id   TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'RUB',
  status        TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','paid','failed','cancelled')),
  payload_json  TEXT NOT NULL DEFAULT '{}',
  paid_at       INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(bot_id, external_id)
);

-- История платежей конкретного клиента (и проверка «уже платил?»).
CREATE INDEX IF NOT EXISTS idx_payorders_bot_user ON payment_orders(bot_id, user_id);
-- Поиск заказа по внешнему номеру — самый частый путь из вебхука.
CREATE INDEX IF NOT EXISTS idx_payorders_bot_external ON payment_orders(bot_id, external_id);
-- Разбор заказов по подключению (диагностика провайдера, сверка).
CREATE INDEX IF NOT EXISTS idx_payorders_connection ON payment_orders(connection_id);
