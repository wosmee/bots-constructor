// RU-фрагмент словаря: страница «Оплата» (Промпт 2).
// Фрагменты соединяются в i18n.ts через spread — TKey выводится из суммы.
// Владелец файла — задача PAY; ключи из базового i18n.ts здесь НЕ переопределять.
export const PAY_RU = {
  // вход на страницу (кнопка в карточке бота)
  'nav.payments': 'Оплата',

  // ============================================================ страница «Оплата»
  'payments.title': 'Оплата',
  'payments.principle':
    'Принцип платформы: она НЕ использует свой платёжный аккаунт, НЕ проксирует деньги и НЕ видит данные карт. Владелец подключает СВОЕГО платёжного провайдера — деньги идут напрямую между клиентом бота и провайдером. Секреты принимаются один раз и хранятся зашифрованными: посмотреть их снова нельзя, можно только заменить.',
  'payments.loading': 'Загружаю…',
  'payments.refresh': 'Обновить',

  // ---- пустое состояние ----
  'payments.empty.title': 'Платёжных подключений пока нет',
  'payments.empty.text':
    'Подключение — это настроенный платёжный провайдер владельца: через него бот принимает деньги, а платформа хранит только конфиг и проверяет подписи вебхуков. Добавьте первое подключение — и используйте его в блоках «Платёжная ссылка» и «Проверка оплаты».',
  'payments.empty.guide': 'Открыть рецепт в гайде',

  // ---- провайдеры ----
  'payments.provider.telegram': 'Telegram Payments',
  'payments.provider.yookassa': 'ЮKassa',
  'payments.provider.robokassa': 'Robokassa',
  'payments.provider.stripe': 'Stripe',
  'payments.provider.custom': 'Свой провайдер',

  // ---- карточка подключения ----
  'payments.enabled': 'включено',
  'payments.disabled': 'выключено',
  'payments.toggle.on': 'Выключить подключение',
  'payments.toggle.off': 'Включить подключение',
  'payments.webhook.label': 'URL вебхука',
  'payments.webhook.hint': 'Укажите этот адрес в своём кабинете платёжки — сюда провайдер будет присылать подтверждения оплаты.',
  // Адрес короткого вебхука вставляется в кабинет провайдера (Result/Notification
  // URL); при ротации кабинет обязательно обновить. Старые длинные адреса
  // /pay/… отключены навсегда (410) — в кабинете должен стоять адрес отсюда.
  'payments.webhook.cabinetHint':
    'Этот адрес вставляется в кабинет платёжного провайдера (Notification URL / Result URL). Старые длинные адреса больше не работают — замените их на этот. Если адрес сменится, обновите его в кабинете, иначе подтверждения оплаты перестанут приходить.',
  'payments.webhook.telegram':
    'У Telegram Payments нет внешнего вебхука: счёт показывается прямо в чате (sendInvoice), а об оплате Telegram сообщает в апдейтах бота.',
  'payments.webhook.regenerate': 'Сгенерировать новый адрес',
  'payments.webhook.regenerateConfirm':
    'Сгенерировать новый адрес вебхука? Старый адрес сразу перестанет работать: события на него будут отклоняться. Новый адрес нужно вставить в кабинет платёжного провайдера.',
  'payments.webhook.regenerateYes': 'Да, сгенерировать новый',
  'payments.webhook.rotated': 'Адрес вебхука обновлён — вставьте новый адрес в кабинет провайдера',
  'payments.copy': 'Скопировать URL вебхука',
  'payments.copied': 'скопировано',

  // ---- секреты (write-only) ----
  'payments.secrets': 'Секреты',
  'payments.secrets.set': 'задан',
  'payments.secrets.notSet': 'не задан',
  'payments.replace': 'Заменить',
  'payments.replace.hint': 'Введите новые значения. Пустое поле — прежний секрет останется без изменений.',
  'payments.replace.save': 'Сохранить секреты',

  // ---- проверка ----
  // Три честных исхода: живой ответ провайдера, только формат (внешнего API
  // у провайдера нет) и провал со списком замечаний. Обещать «проверено»
  // при форматной валидации нельзя — это было бы неправдой.
  'payments.check': 'Проверить подключение',
  'payments.checking': 'Проверяю…',
  'payments.check.okLive': 'Подключение проверено: провайдер принял ключи (живая проверка).',
  'payments.check.okFormat': 'Формат полей корректный. Живая проверка для этого провайдера недоступна — проверьте ключи в кабинете провайдера.',
  'payments.check.failed': 'Проверка не пройдена',

  // ---- удаление ----
  'payments.delete': 'Удалить подключение',
  'payments.delete.confirm':
    'Удалить подключение «{title}»? Секреты будут стёрты; если вебхук был указан у провайдера, его придётся перенастроить.',
  'payments.delete.yes': 'Да, удалить',
  'payments.deleted': 'Подключение удалено',

  // ---- форма добавления ----
  'payments.new.open': 'Добавить подключение',
  'payments.new.title': 'Новое подключение',
  'payments.new.provider': 'Провайдер',
  'payments.new.name': 'Название (для себя, необязательно)',
  'payments.new.name.placeholder': 'например: основная касса',
  'payments.new.submit': 'Добавить подключение',
  'payments.created': 'Подключение добавлено',
  'payments.updated': 'Подключение обновлено',
  'payments.save': 'Сохранить',
  'payments.cancel': 'Отмена',

  // ---- поля ----
  'payments.field.providerToken': 'Provider token',
  'payments.field.secretKey': 'Секретный ключ',
  'payments.field.password1': 'Password1',
  'payments.field.password2': 'Password2',
  'payments.field.webhookSecret': 'Signing secret вебхука',
  'payments.field.shopId': 'ID магазина (shopId)',
  'payments.field.merchantLogin': 'MerchantLogin (логин магазина)',
  'payments.field.linkTemplate': 'Шаблон ссылки на оплату',
  'payments.field.linkTemplate.placeholder': 'https://pay.example.com/checkout?order={{order}}&sum={{amount}}',
  'payments.field.successUrl': 'URL возврата при успехе',
  'payments.field.failUrl': 'URL возврата при отказе',
  'payments.field.testMode': 'Тестовый режим',

  // ---- inline-помощь: где брать значение (по RUNBOOK миграции 0018) ----
  'payments.help.telegram.providerToken':
    'Где взять: @BotFather → /mybots → ваш бот → Bot Settings → Payments. Выберите платёжного провайдера и скопируйте выданный provider token.',
  'payments.help.yookassa.shopId': 'Где взять: кабинет ЮKassa → Профиль — идентификатор магазина (shopId).',
  'payments.help.yookassa.linkTemplate':
    'Ссылка на API-checkout YooKassa — без неё платежи не фиксируются. Создайте платёжную страницу через API ЮKassa (/v3/payments с вебхуками) и укажите её шаблон с плейсхолдерами {{order}}, {{amount}}. Ссылка вида yoomoney.ru/quickpay не подходит — с неё вебхук не приходит и оплата не отмечается.',
  'payments.help.yookassa.secretKey':
    'Где взять: кабинет ЮKassa → Интеграции → HTTP-уведомления: укажите там URL вебхука подключения (он появится после добавления) и выпустите секретный ключ.',
  'payments.help.robokassa.shopId': 'Где взять: кабинет Robokassa → Настройки → Технические настройки — логин магазина (MerchantLogin).',
  'payments.help.robokassa.password1':
    'Где взять: кабинет Robokassa → Настройки → Технические настройки. Password1 подписывает ссылку на оплату.',
  'payments.help.robokassa.password2':
    'Где взять: там же, в технических настройках. Password2 платформа использует для проверки подписи Result URL (вебхука).',
  'payments.help.stripe.secretKey':
    'Где взять: Stripe Dashboard → Developers → API keys — Secret key вашего аккаунта.',
  'payments.help.stripe.linkTemplate':
    'Необязательно: шаблон своей checkout-ссылки. Платформа подставит в него {{order}}, {{amount}}, {{currency}}, {{description}}, {{success}}, {{fail}}.',
  'payments.help.stripe.webhookSecret':
    'Где взять: Stripe Dashboard → Developers → Webhooks: создайте endpoint на URL вебхука подключения (он появится после добавления) и скопируйте Signing secret (whsec_…).',
  'payments.help.custom.linkTemplate':
    'Шаблон ссылки на оплату. Платформа подставит в него {{order}}, {{amount}}, {{currency}}, {{description}}, {{success}}, {{fail}}.',
  'payments.help.custom.webhookSecret':
    'Любой общий секрет. Ваш сервер должен подписывать сырое тело вебхука HMAC-SHA256 с этим секретом и присылать результат в заголовке X-Signature.',
  'payments.help.successUrl': 'Необязательно: страница, куда клиент вернётся после успешной оплаты.',
  'payments.help.failUrl': 'Необязательно: страница, куда клиент вернётся при отказе или отмене оплаты.',
  'payments.help.testMode': 'Добавляет в ссылку оплаты IsTest=1 — Robokassa не спишет настоящие деньги.',
} as const;
