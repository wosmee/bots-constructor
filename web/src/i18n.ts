// Словарь RU/EN. Архитектура расширяемая: строки лежат одним объектом, типы
// ключей выводятся из ru-словаря — добавление языка = добавление ключей в `en`
// (TS подсветит, чего не хватает).
//
// Правило проекта: ни одного пользовательского строкового литерала в JSX.
// Всё, что видит человек, идёт через t('key').
import { useCallback, useEffect, useState } from 'react';
import { useSettings } from './settings';
// Фрагменты словаря Промпта 2: каждая задача ведёт свой файл, а TKey
// выводится из суммы — ключ обязан существовать и в RU, и в EN (тип EN
// фрагмента повторяет RU через Record<keyof …, string>).
import { GUIDE_RU } from './i18n.frag.guide';
import { INSP_RU } from './i18n.frag.insp';
import { CANVAS_RU } from './i18n.frag.canvas';
import { PAY_RU } from './i18n.frag.pay';
import { SUBFLOW_RU } from './i18n.frag.subflow';
import { ADMIN_RU } from './i18n.frag.admin';
import { MINI_RU } from './i18n.frag.mini';
import { BLOCKS2610_RU } from './i18n.frag.blocks2610';

export type Lang = 'ru' | 'en';

const ru = {
  // ============================================================ настройки
  'settings.title': 'Настройки',
  'settings.subtitle': 'Хранятся на сервере — подхватываются на любом устройстве',
  'settings.theme': 'Тема',
  'settings.theme.dark': 'Тёмная',
  'settings.theme.light': 'Светлая',
  'settings.language': 'Язык интерфейса',
  'settings.hints': 'Подсказки',
  'settings.hints.hint': 'Пояснения в интерфейсе и на холсте',
  'settings.whatif': '«Что если»',
  'settings.whatif.hint': 'Предсказание при протяжке связи',
  'settings.conflicts': 'Инспектор конфликтов',
  'settings.conflicts.hint': 'Поиск проблем в графе и подсветка на схеме',
  'settings.sleep': 'Режим «сон»',
  'settings.sleep.hint': 'Затемнять всё, кроме редактируемой ветки',
  'settings.advanced': 'Продвинутые блоки',
  'settings.advanced.hint': 'Группа «Продвинутое» в палитре: http, ИИ, переменные и цикл одним разделом',
  'settings.role': 'Роль',
  'settings.close': 'Закрыть',
  'settings.saving': 'Сохраняю…',
  'settings.saved': 'Сохранено',
  'settings.error': 'Не удалось сохранить',
  'settings.skill': 'Уровень подготовки',
  'settings.skill.hint': 'Влияет на плотность интерфейса и подсказки',
  'settings.paletteMode': 'Раскрытие групп блоков',
  'settings.paletteMode.hint': 'Как ведут себя разделы палитры слева',
  'settings.paletteMode.accordion': 'Аккордеон',
  'settings.paletteMode.free': 'Свободно',

  // ============================================================ безопасность
  'settings.security': 'Безопасность',
  'settings.password.title': 'Смена пароля',
  'settings.password.hint': 'После смены все сессии закрываются — на других устройствах придётся войти заново.',
  'settings.password.old': 'текущий пароль',
  'settings.password.new': 'новый пароль (минимум 6 символов)',
  'settings.password.submit': 'Сменить пароль',
  'settings.password.done': 'Пароль сменён, закрыто сессий: {n}',
  'settings.sessions.title': 'Сессии',
  'settings.logoutAll': 'Выйти на всех устройствах',
  'settings.logoutAll.hint': 'Закрывает все входы в аккаунт, включая этот.',
  'settings.logoutAll.done': 'Закрыто сессий: {n}',
  'settings.logoutAll.confirm': 'Закрыть все сессии аккаунта? Придётся войти заново.',
  'settings.delete.title': 'Удалить аккаунт',
  'settings.delete.hint': 'Все ваши боты, сценарии, версии, данные и сессии будут удалены безвозвратно.',
  'settings.delete.password': 'Введите текущий пароль',
  'settings.delete.start': 'Удалить аккаунт',
  'settings.delete.confirmHint': 'Это действие нельзя отменить. Подтвердите удаление аккаунта.',
  'settings.delete.confirm': 'Да, удалить аккаунт',
  'settings.delete.cancel': 'Отмена',
  'settings.delete.passwordError': 'Неверный пароль',
  'issue.input-regex': 'Недопустимое регулярное выражение',
  'notFound.title': 'Страница не найдена',
  'notFound.hint': 'Такой страницы нет или она была перемещена.',
  'notFound.back': 'На главную',

  // ============================================================ уровень навыков
  'skill.title': 'Какой у вас уровень в программировании и создании ботов?',
  'skill.subtitle': 'От этого зависит, сколько подсказок вы увидите и насколько подробным будет интерфейс. Уровень можно сменить позже в Настройках.',
  'skill.high': 'Высокий',
  'skill.high.desc': 'Пишу код, разбираюсь в API и webhook. Мне нужен плотный интерфейс и минимум объяснений.',
  'skill.medium': 'Средний',
  'skill.medium.desc': 'Собирал что-то по инструкциям, понимаю логику блоков. Подсказки пригодятся.',
  'skill.low': 'Низкий',
  'skill.low.desc': 'Только начинаю. Нужен пошаговый тур, понятные подписи и ничего лишнего на экране.',
  'skill.more': 'Продвинутые функции',

  // ============================================================ онбординг-тур
  'tour.title': 'Знакомство с конструктором',
  'tour.next': 'Далее',
  'tour.back': 'Назад',
  'tour.skip': 'Пропустить',
  'tour.finish': 'Начать собирать',
  'tour.step': 'Шаг {n} из {total}',
  'tour.welcome.title': 'Соберите бота из блоков',
  'tour.welcome.text': 'Короткий тур по экрану: что где лежит и как сделать первый рабочий сценарий. Если забудете термин или блок — в «Гайдах» (кнопка «?» сверху) есть поиск по справке, рецептам и вопросам.',

  // Тур как задача: «собери бота, который спрашивает имя и здоровается».
  // Раньше тур объяснял, где какой элемент экрана, и после него не оставалось
  // ничего работающего.
  'tour.step1.title': 'Шаг 1 — положите приветствие',
  'tour.step1.text': 'Слева найдите «Сообщение» и кликните по нему. Блок появится на холсте со стартовым текстом «Привет, {{name}}!».',
  'tour.step2.title': 'Шаг 2 — соедините со Стартом',
  'tour.step2.text': 'От правого порта блока «Старт» протяните стрелку к блоку «Сообщение». Без стрелки бот после /start промолчит.',
  'tour.step3.title': 'Шаг 3 — напишите свой текст',
  'tour.step3.text': 'Кликните по блоку «Сообщение». Справа откройте поле «Текст» и напишите: «Привет! Как тебя зовут?» Под полем — чипсы переменных, они вставляются по клику.',
  'tour.step4.title': 'Шаг 4 — спросите имя',
  'tour.step4.text': 'В палитре слева раскройте группу «Ввод данных», добавьте блок «Ввод» и соедините Сообщение → Ввод. В панели справа поставьте переменную name и подсказку «Как тебя зовут?».',
  'tour.step5.title': 'Шаг 5 — проверьте и запустите',
  'tour.step5.text': 'Нажмите «Превью» сверху: прогоните сценарий как пользователь. Если всё отвечает — «Опубликовать», и пишите боту /start в Telegram.',
  'tour.reopen': 'Показать тур',

  // ============================================================ шапка
  'nav.settings': 'Настройки',
  'nav.catalog': 'Каталог шаблонов',
  'nav.back': '← боты',
  'nav.backIcon': '←',
  'nav.toBots': 'К ботам',
  'nav.toEditor': 'в конструктор',
  'support.open': 'Поддержка',
  'support.title': 'Поддержка',
  'support.back': '← назад',
  'support.new': 'Новое обращение',
  'support.submit': 'Отправить',
  'support.subject': 'Тема обращения',
  'support.body': 'Опишите проблему или вопрос',
  'support.reply': 'Ответить',
  'support.reply.placeholder': 'Ваш ответ',
  'support.empty': 'Обращений пока нет',
  'support.select': 'Выберите обращение',
  'support.search': 'Поиск по обращениям',
  'support.staff.open': 'Обращения',
  'support.staff.title': 'Центр поддержки',
  'support.assign': 'Взять в работу',
  'support.close': 'Закрыть',
  'support.reopen': 'Открыть заново',
  'support.filter.all': 'Все',
  'support.filter.any': 'Любое назначение',
  'support.filter.mine': 'Только мои',
  'support.filter.unassigned': 'Не назначенные',
  'support.kind.bug': 'Ошибка',
  'support.kind.question': 'Вопрос',
  'support.kind.idea': 'Идея',
  'support.kind.billing': 'Оплата и доступ',
  'support.kind.abuse': 'Жалоба',
  'support.kind.other': 'Другое',
  'support.status.new': 'Новое',
  'support.status.in_progress': 'В работе',
  'support.status.closed': 'Закрыто',
  // Подпись бейджа номера обращения (#N). Сам номер — данные, а для легаси-
  // тикетов без номера показывается короткий id (ticketLabel в api.ts).
  'support.number': 'Номер обращения',

  // ============================================================ вход / регистрация
  'app.brand': 'Конструктор ботов',
  'auth.tab.login': 'Войти',
  'auth.tab.register': 'Регистрация',
  'auth.tab.admin': 'Админ',
  'auth.admin.title': 'Вход для админа платформы',
  'auth.admin.hint': 'Admin-ключ хранится только в этой вкладке (sessionStorage) и не зашит в бандл. Ключ проверяется сервером до открытия дашборда.',
  'auth.admin.placeholder': 'admin-ключ (из wrangler secret ADMIN_KEY)',
  'auth.admin.enter': 'Войти',
  'auth.login.title': 'Вход',
  'auth.register.title': 'Создать аккаунт',
  'auth.login.hint': 'Войдите — и ваши боты будут видны только вам.',
  'auth.register.hint': 'Логин: 3–32 символа, латиница, цифры, точка, подчёркивание, дефис. Пароль — минимум 6 символов.',
  'auth.login.placeholder': 'логин',
  'auth.password.placeholder': 'пароль',
  'auth.submit.login': 'Войти',
  'auth.submit.register': 'Зарегистрироваться',
  'auth.busy': '…',
  // Точные тексты ошибок экрана входа (authErrorMessage в journey.ts). Они же
  // продублированы там — экран входа до загрузки английского чанка обязан
  // показывать правильный язык, а t() в момент ошибки может быть ещё русским.
  'auth.error.loginNotFound': 'Логин не найден',
  'auth.error.wrongPassword': 'Пароль не верный',
  'auth.error.adminKey': 'Неверный админ-ключ',

  // ============================================================ дашборд
  'dash.newBot': 'Новый бот',
  'dash.newBot.hint': 'Токен шифруется (AES-256-GCM) и хранится в D1 — в репо он не попадает.',
  'dash.name.placeholder': 'имя бота',
  'dash.token.placeholder': 'BOT_TOKEN (от @BotFather)',
  // Платформа нового бота: выбор Telegram/VK в форме создания.
  'dash.platform.label': 'Платформа бота',
  'dash.platform.telegram': 'Telegram',
  'dash.platform.vk': 'VK',
  'dash.token.vkPlaceholder': 'Ключ доступа сообщества VK',
  'dash.token.vkHint': 'Управление → Работа с API → Ключи доступа. Права: сообщения, фотографии, документы.',
  'dash.create': 'Создать',
  'dash.cancel': 'Отмена',
  'dash.loading': 'Загрузка…',
  'dash.empty.title': 'Пока нет ни одного бота',
  'dash.empty.text': 'Создайте первого — и соберите сценарий из блоков перетаскиванием.',
  'dash.status.published': 'опубликован',
  'dash.status.draft': 'черновик',
  'dash.owner': 'владелец:',
  'dash.owner.admin': 'админ платформы',
  'dash.status.webhookError': 'ошибка webhook',
  'dash.webhookUnchecked': 'webhook не проверен — нажмите «Обновить статусы»',
  'dash.webhookUnchecked.short': 'webhook не проверен',
  'dash.open': 'открыть →',
  'dash.bots.title': 'Мои боты',
  'dash.bots.shown': 'Показано {shown} из {total}',
  'dash.refresh': 'Обновить статусы',
  'dash.refresh.title': 'проверить webhook у всех ботов',
  'dash.createBot': '+ Создать бота',
  'dash.logout': 'Выйти',
  'dash.logout.title': 'Выйти из этого аккаунта',
  'dash.settings.title': 'Настройки',
  'dash.delete': 'удалить',
  'dash.delete.title': 'удалить бота: webhook, сценарий, подписчики и логи',
  'dash.delete.confirm': 'Удалить бота «{name}»? Сценарий, версии, подписчики и логи сотрутся безвозвратно.',
  'dash.deleting': 'Удаляю…',
  'dash.deleted': 'Бот удалён',
  // Сессия ADMIN_KEY без аккаунта: глобальный список ботов больше не отдаётся,
  // дашборд пуст — записка отправляет сотрудника на страницу «Пользователи».
  'dash.adminKey.note': 'Вход по admin-ключу: список ботов пуст. Пользователи и их боты — на странице «Пользователи».',
  'dash.adminKey.toAdmin': 'Открыть страницу «Пользователи»',

  // ============================================================ редактор: шапка
  'editor.undo': 'отменить (Ctrl+Z)',
  'editor.redo': 'повторить (Ctrl+Shift+Z)',
  'editor.find': 'Найти',
  'editor.find.title': 'поиск по блокам (Ctrl+F)',
  'editor.vars': 'переменные сценария',
  'editor.tidy': 'Упорядочить',
  'editor.tidy.title': 'разложить блоки по уровням от точки входа',
  'editor.versions': 'История',
  'editor.versions.title': 'история версий и откат',
  'editor.logs': 'События',
  'editor.logs.title': 'события бота',
  'editor.guides': '? Гайды',
  'editor.guides.title': 'Гайды и подсказки',
  'editor.preview': 'Превью',
  'editor.edit': 'Редактор',
  'editor.templates': 'Шаблоны',
  'editor.templates.title': 'Готовые сценарии',
  'editor.stats': 'Статистика',
  'stats.title': 'Статистика бота',
  'stats.users': 'пользователей',
  'stats.steps': 'шагов сценария',
  'stats.versions': 'версий сценария',
  'stats.subscribers': 'подписчиков',
  'stats.empty': 'Статистики пока нет: бот ещё не получал сообщений.',
  'stats.error': 'Не удалось загрузить статистику.',
  'stats.loading': 'Загружаю статистику…',
  'editor.errors.title': 'Есть ошибки в сценарии',
  'editor.save': 'Сохранить',
  'editor.publish': 'Опубликовать',
  'error.unauthorized': 'Сессия истекла — войдите заново',
  'error.forbidden': 'У вас нет доступа к этому боту',
  'error.botRequired': 'Введите имя и токен бота',
  'error.notSaved': 'Сценарий пока не сохранён',
  'error.loginTaken': 'Этот логин уже занят',
  'error.rateLimited': 'Слишком много запросов. Попробуйте позже',
  'error.network': 'Не удалось подключиться. Проверьте интернет и повторите попытку',
  'error.timeout': 'Сервер не ответил вовремя. Попробуйте ещё раз',
  'error.server': 'Сервер временно недоступен. Попробуйте ещё раз',
  'error.validation': 'Проверьте данные и исправьте ошибки',
  'error.unknown': 'Не удалось выполнить действие. Попробуйте ещё раз',
  // Корневой error boundary (A4): интерфейс не отрисовался — показываем карточку
  // вместо голого фона страницы.
  'error.app.title': 'Не удалось отрисовать интерфейс',
  'error.app.text': 'Произошла непредвиденная ошибка. Перезагрузите страницу — если черновик сценария успел записаться, он не потеряется.',
  'error.reload': 'Перезагрузить',
  'editor.group.edit': 'Правка',
  'editor.group.info': 'Инфо',
  'editor.group.run': 'Запуск',

  // ============================================================ редактор: состояния
  'save.saving': 'сохраняю…',
  'save.dirty': 'есть изменения',
  'save.saved': 'сохранено',
  'save.title': 'изменения сохраняются автоматически',
  'status.emptyScenario': 'сценарий пуст — добавь блоки',
  'status.noScenario': 'нет сценария — добавь блоки',
  'status.saved': 'сохранено ✔',
  'status.saveError': 'не сохранилось: {msg}',
  // F-015: сервер отклонил сохранение — сценарий изменили в другой вкладке.
  'status.versionConflict': 'Сценарий изменён в другой вкладке — сохранение отклонено, чтобы не затереть чужие правки',
  'conflict.reload': 'Загрузить актуальную версию',
  'conflict.overwrite': 'Сохранить поверх',
  'status.copied': 'скопировано блоков: {n}',
  'status.pasted': 'вставлено блоков: {n}',
  'status.template': 'шаблон: {name}',
  'status.tidy': 'блоки разложены по уровням',
  'status.draftRestored': 'черновик восстановлен',
  'status.makeStart': 'блок сделан точкой входа',
  'status.published': 'опубликовано ✔',
  'status.rollback': 'откат выполнен ✔',
  'status.idCopied': 'id скопирован: {id}',
  'status.duplicatedWithLinks': 'дублировано со связями: {n}',
  'node.frozen': 'заморожен',

  // ============================================================ редактор: палитра и пустой холст
  'palette.dragHint': 'Клик — добавить, перетащи — на холст',
  'palette.hint': 'Клик — добавить блок в центр холста. Перетащи — в нужное место. ПКМ по блоку — меню. Shift+рамка — выделить несколько. Delete — удалить, Ctrl+D — дублировать, Ctrl+C/V — копировать, Ctrl+Z / Ctrl+Shift+Z — отменить/повторить, Ctrl+S — сохранить, Ctrl+F — поиск.',
  'palette.search.placeholder': 'Найти блок…',
  'palette.search.clear': 'очистить поиск',
  'palette.search.empty': 'Ничего не найдено',
  'connect.hint': 'Кликните по блоку — связь придёт в него. Escape — отмена.',

  // ============================================================ порты веток
  'port.then': 'да',
  'port.else': 'нет',
  'port.hit': 'есть совпадение',
  'port.miss': 'нет совпадения',
  'port.found': 'найдено',
  'port.notFound': 'не найдено',
  'port.paid': 'оплатил',
  'port.cancelled': 'отменил',
  'port.default': 'иначе',

  // ============================================================ верхняя панель
  'bar.toggle': 'Показать все кнопки',
  'bar.more': 'Ещё',
  'bar.more.title': 'Редкие действия',
  // Заголовок группы в «Настройках»: этот вход в настройки единственный,
  // поэтому и подпись живёт рядом с остальными settings.*
  'settings.barMode': 'Верхняя панель',
  'bar.mode.slide': 'Выезжает',
  'bar.mode.always': 'Всегда видна',
  'bar.mode.hint': 'Настройка хранится в этом браузере, а не в аккаунте.',
  'bar.mode.slide.hint': 'Панель выезжает, когда курсор подходит к верху окна.',
  'bar.mode.always.hint': 'Панель остаётся раскрытой всё время.',
  'bar.help': 'Помощь',
  'bar.help.title': 'Помощь и обучение',

  // ============================================================ уровни: примеры и термины
  'insp.example': 'Как пользоваться:',
  // Заголовки секций инспектора. Поля одного блока разбиты на группы: без них
  // панель читалась как одна колонка из 20 одинаковых строк.
  'insp.section.content': 'Содержание',
  'insp.section.behavior': 'Поведение',
  'insp.section.branching': 'Ветки и связи',
  'insp.section.data': 'Данные',
  'insp.section.advanced': 'Дополнительно',
  'insp.section.danger': 'Опасная зона',
  'chips.title': 'Вставить переменную:',
  'chips.origin': 'из «{block}»',
  'chips.empty': 'Переменных пока нет — добавьте блок «Ввод», и он появится здесь.',
  'chips.insert': 'Вставить {{var}}',
  'insp.footer.makeStart': 'Сделать точкой входа',
  'insp.footer.disable': 'Выключить блок',
  'insp.footer.enable': 'Включить блок',
  'insp.footer.delete': 'Удалить',
  'insp.help.more': 'Что это за блок',
  'insp.value.hidden': 'Значение кнопки задаётся автоматически — менять его не нужно.',
  'f.buttons.where': 'Где показать кнопки',
  'f.layout.inline.new': 'под текстом сообщения',
  'f.layout.reply.new': 'внизу экрана, как клавиатура',
  'f.condition.phrase': 'Проверить',
  'f.condition.varPlaceholder': 'переменная, например age',
  'f.condition.valuePlaceholder': 'значение',
  'f.condition.help': 'Переменную задаёт блок «Ввод»: что человек написал, то и попадает в неё.',
  'f.goto.search': 'Прыгнуть в блок',
  'f.goto.search.placeholder': 'начните вводить название',
  'f.goto.noTarget': 'Блок не выбран — переход никуда не ведёт.',
  'f.start.command.label': 'Команда, на которую отвечает бот',
  'f.start.command.help': 'Пользователь напишет {cmd} — бот пойдёт по сценарию.',

  // ============================================================ глоссарий
  'glossary.title': 'Словарь',
  'glossary.var': 'переменная',
  'glossary.var.text': 'Ячейка с данными: то, что человек написал или бот посчитал. Подставляется в текст как {{имя}}.',
  'glossary.branch': 'ветка',
  'glossary.branch.text': 'Один из выходов блока: у кнопки — нажатие, у условия — «да» или «нет». Каждая ветка ведёт к своему блоку.',
  'glossary.scenario': 'сценарий',
  'glossary.scenario.text': 'Весь путь бота: блоки и стрелки между ними. Пока сценарий не опубликован, бот работает по прежней версии.',
  'glossary.webhook': 'webhook',
  'glossary.webhook.text': 'Адрес, по которому Telegram присылает боту сообщения пользователей. Его ставит кнопка «Опубликовать».',

  // ============================================================ шпаргалка профи
  'pro.shortcuts': 'Горячие клавиши',
  'pro.shortcuts.save': 'Ctrl+S — сохранить',
  'pro.shortcuts.undo': 'Ctrl+Z — отменить, Ctrl+Shift+Z — повторить',
  'pro.shortcuts.find': 'Ctrl+F — поиск по блокам',
  'pro.shortcuts.copy': 'Ctrl+C / Ctrl+V — копировать и вставить',
  'pro.shortcuts.dup': 'Ctrl+D — дублировать',
  'pro.shortcuts.del': 'Delete — удалить выбранное',
  'pro.advanced': 'Дополнительно',
  'pro.blockId': 'id блока',
  'pro.rawParams': 'Параметры блока',
  'pro.copyId': 'Копировать id',
  'ctx.copyId': 'Копировать id',
  'ctx.duplicateWithLinks': 'Дублировать со связями',
  'ctx.jumpToTarget': 'Перейти к цели',
  'ctx.disable': 'Выключить',
  'ctx.enable': 'Включить',
  'empty.title': 'Начните сценарий',
  'empty.text1': 'Перетащите блок из палитры слева на холст',
  'empty.text2': 'или кликните по нему.',
  'empty.cta': 'Открыть гайд для новичков',
  'empty.beginner.text': 'Соберите бота из готового шаблона — потом поменяете текст под себя',
  'empty.beginner.template': 'Взять готовый шаблон',

  // ============================================================ черновик
  'draft.found': 'Найдена несохранённая копия от {when} ({n} блоков)',
  'draft.restore': 'Восстановить',
  'draft.drop': 'Не нужно',

  // ============================================================ контекстное меню блока
  'ctx.duplicate': 'Дублировать',
  'ctx.copy': 'Копировать',
  'ctx.paste': 'Вставить',
  'ctx.makeStart': 'Сделать точкой входа',
  'ctx.freeze': 'Заморозить',
  'ctx.unfreeze': 'Разморозить',
  'ctx.clearLinks': 'Убрать все связи',
  'ctx.delete': 'Удалить блок',
  'ctx.explain': 'Объяснить',
  'ctx.frozen': 'Заморожен',
  'ctx.count': '{n} шт.',
  'ctx.duplicateN': 'Дублировать ({n})',
  'ctx.deleteN': 'Удалить блоки ({n})',
  'ctx.deleteOne': 'Удалить блок',

  // ============================================================ «объясни»
  'explain.title': 'Что делает эта ветка',
  'explain.empty': 'У блока нет продолжения — ветка на нём заканчивается.',
  'explain.loop': '…и дальше по кругу (цикл).',
  'explain.more': 'и ещё {n} шагов',
  'explain.close': 'Понятно',

  // ============================================================ «что если»
  'whatif.title': 'Подсказка',

  // ============================================================ инспектор конфликтов
  'conflict.title': 'Конфликты',
  'conflict.dupTrigger': 'Два триггера на «{value}»',
  'conflict.unreachable': 'До блока нельзя дойти',
  'conflict.loop': 'Зацикленный путь без выхода',
  'conflict.deadEnd': 'Нет исходящей связи',
  'conflict.hint': 'Кликните по блоку — увидите описание',
  'conflict.pill': 'Конфликты сценария: {n}',
  'conflict.pill.title': 'Открыть список конфликтов',
  'conflict.list.title': 'Конфликты сценария',
  'conflict.list.empty': 'Конфликтов нет',

  // ============================================================ режим «сон»
  'sleep.on': 'Режим «сон» включён: активна только выбранная ветка',
  'sleep.off': 'Режим «сон» выключен',

  // ============================================================ инспектор блока
  'insp.entry': 'точка входа',
  'insp.help.what': 'Блок «{block}» — один шаг сценария. Заполните поля ниже и соедините его стрелкой с продолжением.',
  'insp.help.mistakes': 'Частая ошибка:',
  'insp.help.mistakes.text': 'оставить обязательное поле пустым или забыть исходящую связь.',
  'insp.remove': 'удалить',
  'insp.add': '＋ {name}',
  'insp.buttons.hint': 'Если в поле значения вставить ссылку (http…) — получится кнопка-ссылка без перехода.',
  'insp.buttons.portHint': 'Ведёт туда, куда стрелка от порта «{name}»',
  'f.message.text': 'Текст',
  'f.goto.current': 'Сейчас ведёт в:',
  'insp.textPlaceholder': 'Текст, можно {{var}}',
  'vars.sys.lastInput': 'последний ввод пользователя',
  'vars.sys.refLink': 'персональная ссылка приглашения',
  'vars.sys.refInviter': 'кто пригласил',
  'vars.sys.refCount': 'сколько человек пригласил',

  'f.command': 'Команда',
  'f.command.placeholder': '/help',
  'f.description': 'Описание (для себя)',
  'f.enterMessage': 'Сообщение при входе (необязательно)',
  'f.command.hint': 'Блок срабатывает, когда пользователь пишет эту команду. Основной вход (/start) — блок Старт.',

  'f.var': 'Переменная',
  'f.kind': 'Тип',
  'f.kind.text': 'текст',
  'f.kind.number': 'число',
  'f.kind.email': 'email',
  'f.kind.photo': 'фото',
  'f.prompt': 'Подсказка',
  'f.regex': 'Проверка (regex, необязательно)',
  'f.regex.placeholder': '^\\+?\\d{10,15}$',
  'f.errorText': 'Текст при ошибке',
  'f.errorText.placeholder': 'Похоже, это не номер. Попробуйте ещё раз',
  'f.errorText.kindHint': 'Срабатывает, когда ответ не проходит проверку типа (не число / не e-mail).',

  'f.contact.request': 'Что просим',
  'f.contact.phone': 'телефон (кнопка «Отправить контакт»)',
  'f.contact.location': 'геолокация (кнопка «Отправить гео»)',
  'f.contact.varPlaceholder': 'phone',

  'f.layout': 'Раскладка',
  'f.button': 'Кнопка',
  'f.item': 'Пункт',
  'f.menu.prompt': 'Подсказка меню',
  'f.menu.hint': 'Постоянная клавиатура: прикрепляется к сообщениям, пока не заменена/не очищена.',

  'f.op': 'Оператор',
  'f.op.eq': 'равно',
  'f.op.neq': 'не равно',
  'f.op.gt': 'больше',
  'f.op.lt': 'меньше',
  'f.op.contains': 'содержит',
  'f.value': 'Значение',

  'f.switch.casePlaceholder': 'значение',
  'f.switch.add': '＋ вариант',

  'f.keywords': 'Слова или фразы (через запятую)',
  'f.keywords.placeholder': 'цена, сколько стоит, прайс',
  'f.match': 'Совпадение',
  'f.match.contains': 'содержит слово',
  'f.match.equals': 'точное совпадение',
  'f.keyword.hint': 'Блок ждёт обычный текст пользователя — удобно для живых диалогов и ИИ-ботов.',

  'f.random.branchPlaceholder': 'ветка',
  'f.random.weightPlaceholder': 'вес',
  'f.random.add': '＋ ветка',
  'f.random.hint': 'Вес 1 и 1 — это 50/50. Вес 3 и 1 — 75% на первую ветку.',

  'f.setvar.expr': 'Значение или выражение',
  'f.setvar.exprPlaceholder': '{{score}} + 1',
  'f.setvar.varPlaceholder': 'score',
  'f.setvar.hint': 'Доступно: числа, + − × ÷, скобки и подстановка {{var}}. Всё остальное сохраняется как текст.',

  'f.referral.var': 'Переменная для ссылки',
  'f.referral.varPlaceholder': 'ref.link',
  'f.referral.hint1': 'Блок соберёт ссылку вида',
  'f.referral.hint2': 'и положит её в эту переменную. Покажите её сообщением или кнопкой — дальше собирайте награду сами:',
  'f.referral.hint3': '— кто пригласил,',
  'f.referral.hint4': '— сколько человек пригласил пользователь.',

  'f.url': 'URL',
  'f.url.placeholder': 'https://api.example.com/v1/price',
  'f.method': 'Метод',
  'f.headers': 'Заголовки (JSON, необязательно)',
  'f.headers.placeholder': '{"Authorization":"Bearer ..."}',
  'f.body': 'Тело (JSON, необязательно)',
  'f.body.placeholder': '{"user_id":123}',
  'f.jsonPath': 'Путь до значения (через точку)',
  'f.jsonPath.placeholder': 'data.price',
  'f.outVar': 'Куда положить ответ',
  'f.outVar.placeholder': 'price',

  'f.ai.prompt': 'Промпт',
  'f.ai.promptPlaceholder': 'Ответь клиенту: {{last_input}}',
  'f.ai.system': 'Роль / системный промпт',
  'f.ai.systemPlaceholder': 'Ты вежливый консультант компании X',
  'f.ai.model': 'Модель (необязательно)',
  'f.ai.modelPlaceholder': 'по умолчанию платформенная',
  'f.ai.var': 'Переменная для ответа',
  'f.ai.varPlaceholder': 'ai',
  'f.ai.reply': 'отправить ответ пользователю',

  'f.action.kind': 'Тип',
  'f.action.webhook': 'webhook',
  'f.action.notify': 'notify (уведомление админу)',
  'f.action.delay': 'delay (пауза)',
  'f.action.broadcast': 'broadcast (всем подписчикам)',
  'f.action.text': 'Текст',
  'f.action.seconds': 'Секунд',
  'f.action.broadcastText': 'Текст рассылки',
  'f.action.broadcastPlaceholder': 'Привет, {{name}}!',

  'f.media.type': 'Тип',
  'f.media.photo': 'фото',
  'f.media.video': 'видео',
  'f.media.document': 'документ',
  'f.media.url': 'URL (публичная ссылка)',
  'f.media.fileId': 'file_id (приоритетнее URL)',
  'f.media.caption': 'Подпись',
  'f.media.captionPlaceholder': '{{var}}',

  'f.mg.add': 'Добавить элемент',
  'f.mg.item.type': 'Тип',
  'f.mg.item.url': 'URL',
  'f.mg.item.fileId': 'file_id',
  'f.mg.item.caption': 'Подпись',
  'f.mg.hint': 'Альбом должен содержать от 2 до 10 медиа (лимит Telegram).',

  'f.inv.title': 'Заголовок счёта',
  'f.inv.description': 'Описание',
  'f.inv.amount': 'Сумма (в копейках для RUB)',
  'f.inv.currency': 'Валюта',
  'f.inv.label': 'Подпись позиции',
  'f.inv.payload': 'Payload (вернётся после оплаты)',
  'f.inv.providerToken': 'provider_token (из BotFather)',
  'f.inv.photoUrl': 'URL фото товара (необязательно)',
  'f.inv.hint': 'provider_token обязателен — без него Telegram не примет счёт.',

  'f.sub.action': 'Действие',
  'f.sub.subscribe': 'подписать пользователя',
  'f.sub.unsubscribe': 'отписать пользователя',

  'f.note.placeholder': 'Комментарий на холсте',

  // ============================================================ подписи узлов
  'node.subscription': 'подписка: {value}',
  'node.menu': 'меню: {value}',
  'node.aiReply': 'ИИ → ответить',
  'node.aiVar': 'ИИ → {var}',
  'node.location': 'геолокация',
  'node.phone': 'телефон → {var}',
  'node.branches': '{var} → {n} веток',

  // ============================================================ блоки
  'block.start.label': 'Старт',
  'block.start.hint': 'Точка входа в сценарий. Сюда попадает пользователь по /start.',
  'block.message.label': 'Сообщение',
  'block.message.hint': 'Отправляет текст. Поддерживает подстановку переменных {{var}}.',
  'block.buttons.label': 'Кнопки',
  'block.buttons.hint': 'Показывает кнопки под сообщением. Каждая кнопка ведёт в своё место сценария.',
  'block.input.label': 'Ввод',
  'block.input.hint': 'Спрашивает у человека ответ и запоминает его под именем, чтобы потом вставить в текст.',
  'block.condition.label': 'Условие',
  'block.condition.hint': 'Сравнивает то, что уже известно о человеке, и выбирает, куда идти дальше — по одному из двух путей.',
  'block.action.label': 'Действие',
  'block.action.hint': 'Делает что-то за кулисами: уведомляет вас, ждёт паузу или рассылает сообщение.',
  'block.goto.label': 'Переход',
  'block.goto.hint': 'Отправляет человека в другой блок сценария — например назад в меню.',
  'block.end.label': 'Конец',
  'block.end.hint': 'Заканчивает разговор. Следующее сообщение начнёт сценарий заново.',
  'block.media.label': 'Медиа',
  'block.media.hint': 'Отправляет одно фото, видео или документ — по ссылке или загруженный заранее.',
  'block.subscription.label': 'Подписка',
  'block.subscription.hint': 'Включает или выключает для человека рассылку сообщений.',
  'block.menu.label': 'Меню',
  'block.menu.hint': 'Показывает кнопки, которые остаются внизу экрана на всех следующих сообщениях.',
  'block.command.label': 'Команда',
  'block.command.hint': 'Отдельный вход в сценарий: бот откликнется, если человек напишет эту команду.',
  'block.keyword.label': 'Ключевые слова',
  'block.keyword.hint': 'Смотрит, что написал человек, и по знакомым словам понимает, куда его вести.',
  'block.setvar.label': 'Переменная',
  'block.setvar.hint': 'Запоминает значение под именем или считает: например {{count}} + 1.',
  'block.http.label': 'HTTP-запрос',
  'block.http.hint': 'Берёт данные из другого сервиса и запоминает их, чтобы показать человеку.',
  'block.ai.label': 'ИИ-ответ',
  'block.ai.hint': 'Спрашивает у нейросети ответ на вопрос человека и либо отправляет его, либо запоминает.',
  'block.random.label': 'Случайный выбор',
  'block.random.hint': 'Разводит людей по нескольким вариантам наугад — удобно сравнивать тексты.',
  'block.switch.label': 'Переключатель',
  'block.switch.hint': 'Выбирает один из многих путей по известному значению — вместо цепочки условий.',
  'block.contact.label': 'Контакт / гео',
  'block.contact.hint': 'Просит телефон или геолокацию отдельной кнопкой и запоминает ответ.',
  'block.note.label': 'Заметка',
  'block.note.hint': 'Заметка на холсте для себя. Бот её не видит.',
  'block.referral.label': 'Рефералка',
  'block.referral.hint': 'Готовит человеку личную ссылку для приглашения друзей ({{ref.link}}).',
  'block.media_group.label': 'Альбом медиа',
  'block.media_group.hint': 'Отправляет несколько фото одним сообщением — от 2 до 10 штук.',
  'block.invoice.label': 'Оплата',
  'block.invoice.hint': 'Показывает счёт на оплату прямо в Telegram и ведёт дальше по-разному: оплатил или отменил.',

  'whatif.start': 'Обычно после Старта ставят приветствие или меню.',
  'whatif.message': 'Часто здесь ставят кнопки или ввод — иначе бот просто замолчит.',
  'whatif.buttons': 'У кнопок несколько ветвей: проверьте, что каждая куда-то ведёт.',
  'whatif.input': 'После ввода обычно проверяют ответ условием.',
  'whatif.condition': 'У условия две ветви — «да» и «нет». Заполните обе.',
  'whatif.action': 'Действие выполнится молча: добавьте сообщение, чтобы пользователь понял результат.',
  'whatif.goto': 'Переход часто создаёт цикл — убедитесь, что из него есть выход.',
  'whatif.end': 'Конец сценария: дальше отсюда ничего не идёт.',
  'whatif.media': 'После медиа логично поставить текст или кнопки.',
  'whatif.subscription': 'После подписки подтвердите действие сообщением.',
  'whatif.menu': 'Меню — развилка: у каждой кнопки своя ветка.',
  'whatif.command': 'Команда — вторая точка входа. Не забудьте описание для меню бота.',
  'whatif.keyword': 'У ключевых слов две ветви: «есть совпадение» и «мимо».',
  'whatif.setvar': 'Переменную обычно проверяют условием сразу после записи.',
  'whatif.http': 'Внешний запрос может упасть — здесь чаще всего забывают обработку ошибок.',
  'whatif.ai': 'ИИ может вернуть пустой ответ. Добавьте условие или повтор запроса.',
  'whatif.random': 'Случайный выбор делит аудиторию — веток обычно две или больше.',
  'whatif.switch': 'У переключателя есть ветка по умолчанию — без неё часть пользователей застрянет.',
  'whatif.contact': 'Пользователь может не прислать контакт — предусмотрите это.',
  'whatif.note': 'Заметка — комментарий на холсте, в работе бота не участвует.',
  'whatif.referral': 'Дальше обычно проверяют {{ref.count}} условием и выдают награду.',
  'whatif.media_group': 'После альбома обычно идёт описание или кнопки.',
  'whatif.invoice': 'Счёт ждёт оплату — заполните обе ветки: «оплачено» и «отменено».',

  'palette.messages': 'Сообщения',
  'palette.input': 'Ввод данных',
  'palette.logic': 'Логика',
  'palette.integrations': 'Интеграции',
  'palette.flow': 'Поток',

  // ============================================================ превью
  'preview.title': 'Превью бота',
  'preview.localBadge': 'локальный прогон',
  'preview.serverBadge': 'точный прогон',
  'preview.serverBadge.title': 'прогон настоящим движком на сервере',
  'preview.restart': '⟲ сначала',
  'preview.fallback': 'локальный прогон',
  'preview.empty': 'пусто',
  'preview.done': 'сценарий завершён',
  'preview.inputPlaceholder': 'введите значение',
  'preview.keywordPlaceholder': 'напишите фразу (в боте это обычный текст)',
  'preview.geoPlaceholder': '📍 геолокация',
  'preview.contactPlaceholder': '📱 контакт',
  'preview.sendGeo': '📍 отправить геолокацию',
  'preview.sendContact': '📱 отправить контакт',
  'preview.geoSent': '📍 геолокация отправлена',
  'preview.contactSent': '📱 контакт отправлен',
  'preview.runUnavailable': 'прогон недоступен',
  'preview.end': '■ конец сценария',
  'preview.startCmd': '▶ запуск по команде {cmd}',
  'preview.command': '▶ команда {cmd}',
  'preview.media': '[{type}]',
  'preview.action': '[действие: {kind}]',
  'preview.subscription': '[подписка: {action}]',
  'preview.http': '[HTTP {method} {url}]',
  'preview.ai': '[ИИ] (в превью ответ не генерируется)',
  'preview.noLink': '⚠ нет связи дальше',

  // ============================================================ публикация
  'publish.title': 'Публикация',
  'publish.close.title': 'закрыть',
  'publish.published': 'опубликован',
  'publish.draft': 'черновик',
  'publish.version': 'версия',
  'publish.errors': '{n} ошибок',
  'publish.noErrors': 'ошибок нет',
  'publish.warnings': '{n} предупреждений',
  'publish.noWarnings': 'предупреждений нет',
  'publish.blocks': 'блоков: {n}',
  'publish.ok': 'Бот опубликован.',
  'publish.ok.text': 'Напишите ему /start в Telegram — если не отвечает, откройте «? Гайды» → «Публикация».',
  'publish.intro': 'Публикация сохраняет версию сценария, проверяет её, ставит webhook и обновляет меню команд. С ошибками бот не публикуется — прежняя версия продолжает работать.',
  'publish.confirm': 'Я проверил сценарий в превью и понимаю, что публикация изменит работающего бота.',
  'publish.unpublish': 'Снять с публикации',
  'publish.fixErrors': 'Исправьте ошибки — кнопка откроется',
  'publish.close': 'Закрыть',
  'publish.publishing': 'Публикуем…',
  'publish.error': 'публикация не удалась',
  'publish.unpublishError': 'не удалось снять с публикации',
  'publish.step.save': 'Сценарий сохранён',
  'publish.step.validate': 'Проверка сценария',
  'publish.step.webhook': 'Webhook установлен',
  'publish.step.commands': 'Меню команд',
  'publish.step.activate': 'Бот опубликован',
  'publish.step.db': 'Данные удалены',
  'publish.step.unknown': 'Шаг публикации',

  // ============================================================ события (логи)
  'logs.title': 'События',
  'logs.userId': 'user_id (необязательно)',
  'logs.onlyErrors': 'только ошибки',
  'logs.refresh': 'Обновить',
  'logs.explanation': 'События — это технический журнал работы бота: здесь видны сохранения, публикации, шаги и ошибки.',
  'logs.clear': 'Очистить события',
  'logs.clearConfirm': 'Очистить все события этого бота? Действие необратимо.',
  'logs.empty': 'Событий пока нет.',
  'logs.loadError': 'не удалось загрузить события',
  'log.ev.scenarioSaved': 'Сценарий сохранён (версия {value})',
  'log.ev.botCreated': 'Бот создан',
  'log.ev.delay': 'Ожидание',
  'log.ev.subscription': 'Подписка',
  'log.ev.http': 'HTTP-запрос',
  'log.ev.send': 'Отправка',
  'log.ev.invoice': 'Счёт',
  'log.ev.broadcast': 'Рассылка',
  'log.ev.scheduled': 'Запланированное действие',
  'log.ev.rollback': 'Выполнен откат (версия {value})',
  'log.ev.publishOk': 'Бот опубликован',
  'log.ev.publishBlocked': 'Публикация заблокирована: ошибок {value}',
  'log.ev.webhook': 'Ошибка проверки webhook',
  'log.ev.step': 'Шаг сценария',
  'log.ev.error': 'Ошибка операции',
  // --- события набора 2026-09-30 (бюджет движка, расписания, память ИИ) ---
  'log.ev.engineResume': 'Поток продолжен фоново',
  'log.ev.engineGaveup': 'Поток остановлен: лимит продолжений',
  'log.ev.loopBreak': 'Прерван бесконечный цикл',
  'log.ev.chainDeferred': 'Цепочка отложена фоново',
  'log.ev.aiTruncated': 'История ИИ урезана',
  'log.ev.scanCapped': 'Поиск частичный: слишком много совпадений',
  'log.ev.scheduleReg': 'Расписание зарегистрировано',
  'log.ev.scheduleFired': 'Сработало расписание',
  'log.ev.scheduleDisabled': 'Расписание отключено',
  'log.ev.scheduleLimit': 'Лимит расписаний на бота',

  // ============================================================ переменные
  'vars.title': 'Переменные',
  'vars.notDefined': '⚠ Нигде не записываются:',
  'vars.empty': 'Переменных пока нет.',
  'vars.written': 'пишется: ',
  'vars.read': 'читается: ',
  'vars.system': 'системная',
  'vars.dash': '—',
  'vars.notUsed': 'не используется',
  'vars.andMore': ' и ещё {n}',
  'vars.foot': 'last_input — последний ввод пользователя, доступен всегда.',

  // ============================================================ поиск
  'search.placeholder': 'поиск: текст, команда, переменная…',
  'search.close': 'закрыть поиск',
  'search.empty': 'ничего не найдено',

  // ============================================================ версии
  'versions.title': 'История версий',
  'versions.loading': 'Загрузка…',
  'versions.empty': 'Сохранений пока нет.',
  'versions.current': 'текущая',
  'versions.published': 'опубликована',
  'versions.rollback': 'Откатиться',
  'versions.publish': 'Опубликовать',
  'versions.publishConfirm': 'Опубликовать сохранённую версию {v}?',
  'versions.confirm': 'Откатиться на версию {v}? Текущий холст будет заменён.',
  'versions.delete': 'удалить',
  'versions.deleteAll': 'удалить историю',
  'versions.deleteConfirm': 'Удалить версию v{v}? Это действие необратимо.',
  'versions.deleteAllConfirm': 'Удалить всю историю, кроме текущей и опубликованной версии?',
  'versions.rollbackError': 'откат не удался',
  'versions.loadError': 'не удалось загрузить историю',
  'versions.kb': '{size} КБ',

  // ============================================================ готовые сценарии
  'tpl.title': 'Готовые сценарии',
  'tpl.intro': 'Откроется полный сценарий из блоков.',
  'tpl.blocks': '{n} блоков',
  // F3-310: пометка шаблонов с Telegram-only блоками для VK-бота
  'tpl.tgOnly': 'Telegram-only',
  'tpl.tgOnly.hint': 'В шаблоне есть блоки, которые не работают на VK. После вставки валидатор подсветит их.',
  'tpl.confirm': 'На холсте уже есть блоки. Шаблон «{name}» можно открыть вместо них или добавить рядом.',
  'tpl.replace': 'Заменить холст',
  'tpl.append': 'Добавить рядом',
  'tpl.open': 'Открыть шаблон',
  'tpl.select': 'Выбрать',
  'tpl.selected': 'Выбрано',
  'tpl.apply': 'Применить шаблон',
  'tpl.empty.title': 'Начать с пустого сценария',
  'tpl.empty.text': 'Соберите путь самостоятельно: Старт → Сообщение → Ввод или Кнопки → Конец.',
  'tpl.empty.action': 'Начать пустой',

  // ============================================================ каталог шаблонов
  'catalog.title': 'Каталог шаблонов',
  'catalog.subtitle': 'Общая галерея: сценарии, которыми поделились пользователи',
  'catalog.search': 'Поиск по названию, описанию или тегу…',
  'catalog.sort.popularity': 'По популярности',
  'catalog.sort.newest': 'По новизне',
  'catalog.empty': 'Пока ничего нет. Загрузите свой сценарий первым.',
  'catalog.notFound': 'Ничего не найдено',
  'catalog.loading': 'Загрузка…',
  'catalog.uses': 'использований',
  'catalog.blocks': 'блоков',
  'catalog.by': 'автор',
  'catalog.upload': 'Загрузить мой шаблон',
  'catalog.use': 'Использовать',
  'catalog.delete': 'Удалить',
  'catalog.confirmUse': 'Текущий сценарий бота «{name}» будет заменён шаблоном. Продолжить?',
  'catalog.confirmDelete': 'Удалить шаблон «{title}»? Действие необратимо.',
  'catalog.pickBot': 'Куда загрузить шаблон?',
  'catalog.needBot': 'Откройте бота, чтобы загрузить в него шаблон',
  'catalog.form.title': 'Название',
  'catalog.form.description': 'Описание',
  'catalog.form.tags': 'Теги через запятую',
  'catalog.form.submit': 'Опубликовать в каталог',
  'catalog.form.cancel': 'Отмена',
  'catalog.loaded': 'Шаблон загружен в бота',
  'catalog.deleted': 'Шаблон удалён',
  'catalog.all': 'все',

  // ============================================================ общие
  'common.cancel': 'Отмена',
  'common.error': 'Ошибка',
  'common.retry': 'Повторить',

  'common.close': 'Закрыть',
  'common.close.title': 'закрыть',

  // ============================================================ гайд
  'guide.tab.start': 'Быстрый старт',
  'guide.tab.blocks': 'Все блоки',
  'guide.tab.recipes': 'Рецепты',
  'guide.tab.publish': 'Публикация',
  'guide.tab.faq': 'Частые вопросы',
  'guide.beginner.first': 'Что сделать сначала:',
  'guide.beginner.first.text': 'добавьте Старт, соедините его с Сообщением, заполните текст и проверьте результат в Превью.',
  'guide.beginner.blocks': 'Начните с зелёного Старта и синего Сообщения. Остальные блоки добавляйте, когда базовая цепочка уже отвечает.',

  'guide.start.title': 'Собрать бота за 5 минут',
  'guide.start.s1.b': 'Создайте бота.',
  'guide.start.s1.a': 'Зайдите к @BotFather, команда',
  'guide.start.s1.c': ', получите токен. На главной странице конструктора — «+ Создать бота», вставьте имя и токен.',
  'guide.start.s2.b': 'Положите блоки.',
  'guide.start.s2.a': 'Слева — палитра. Кликните по блоку или перетащите его на холст. Первым обычно идёт',
  'guide.start.s2.c': ', дальше',
  'guide.start.s2.d': '.',
  'guide.start.s3.b': 'Соедините их.',
  'guide.start.s3.a': 'Тяните стрелку от правого кружка одного блока к левому кружку следующего. Без связи бот остановится — в превью это видно как «⚠ нет связи дальше».',
  'guide.start.s4.b': 'Настройте блок.',
  'guide.start.s4.a': 'Клик по блоку — справа открываются его поля: текст, переменная, кнопки. В тексте можно писать',
  'guide.start.s4.c': '— подставится то, что пользователь ввёл раньше.',
  'guide.start.s5.b': 'Проверьте в превью.',
  'guide.start.s5.a': 'Кнопка «Превью» вверху — прогоните сценарий как пользователь, не трогая Telegram.',
  'guide.start.s6.b': 'Сохраните и нажмите «Опубликовать».',
  'guide.start.s6.a': 'После этого бот живой: напишите ему /start в Telegram.',
  'guide.start.rule.b': 'Главное правило:',
  'guide.start.rule': 'у каждого блока должен быть выход. Если стрелка дальше не ведёт — сценарий на этом заканчивается.',
  'guide.start.examples': 'Три базовых сценария, с которых стоит начать',
  'guide.start.ex1': 'Визитка:',
  'guide.start.ex1.t': 'Старт → Сообщение → Меню → ветки → Переход обратно в Меню.',
  'guide.start.ex2': 'Заявка:',
  'guide.start.ex2.t': 'Старт → Ввод (имя) → Ввод (телефон) → Действие notify → Сообщение → Конец.',
  'guide.start.ex3': 'Квиз:',
  'guide.start.ex3.t': 'Переменная score = 0 → вопросы на Кнопках → Переменная score = {{score}} + 1 → Условие → результат.',
  'guide.start.hotkeys': 'Горячие клавиши и меню',
  'guide.start.hk1': 'ПКМ по блоку',
  'guide.start.hk1.t': '— меню: дублировать, копировать, вставить, сделать точкой входа, отключить, убрать связи, удалить.',
  'guide.start.hk2': 'Delete',
  'guide.start.hk2.t': '— удалить выбранный блок.',
  'guide.start.hk3': 'Ctrl+D',
  'guide.start.hk3.t': '— продублировать выбранный блок.',

  'guide.blocks.title': 'Справочник блоков',
  'guide.blocks.search': 'поиск по названию или описанию…',
  'guide.blocks.empty': 'ничего не найдено',

  'guide.recipes.title': 'Готовые рецепты',
  'guide.recipes.intro': 'Берите схему и собирайте её из блоков — так быстрее, чем придумывать с нуля.',

  'guide.recipe.0.title': 'Бот-визитка с меню',
  'guide.recipe.0.s0': 'Старт → Сообщение «Привет! Я бот компании Х»',
  'guide.recipe.0.s1': 'Меню с пунктами: Услуги / Цены / Контакты (у каждого пункта своя ветка)',
  'guide.recipe.0.s2': 'В конце каждой ветки — Переход обратно на блок Меню, чтобы пользователь не упирался в тупик',

  'guide.recipe.1.title': 'Заявка с уведомлением в Telegram',
  'guide.recipe.1.s0': 'Ввод → переменная name, подсказка «Как вас зовут?»',
  'guide.recipe.1.s1': 'Ввод → переменная phone (или Контакт/гео, если нужен номер кнопкой)',
  'guide.recipe.1.s2': 'Действие → notify, текст «Заявка: {{name}}, {{phone}}» — уйдёт админу',
  'guide.recipe.1.s3': 'Сообщение «Спасибо, заявка принята» → Конец',

  'guide.recipe.2.title': 'Квиз с подсчётом баллов',
  'guide.recipe.2.s0': 'В начале: Переменная score = 0',
  'guide.recipe.2.s1': 'Вопрос: Кнопки с вариантами, верная ветка ведёт на Переменную score = {{score}} + 1',
  'guide.recipe.2.s2': 'Повторите для каждого вопроса, в конце — Сообщение «Ваш результат: {{score}}»',
  'guide.recipe.2.s3': 'Условие: если {{score}} > 3 — одна ветка, иначе другая',

  'guide.recipe.3.title': 'Бот-помощник с ИИ',
  'guide.recipe.3.s0': 'Старт → Меню: «Задать вопрос» / «О нас»',
  'guide.recipe.3.s1': 'Ветка вопроса: Ввод last_input → ИИ-ответ с промптом «Ответь на вопрос: {{last_input}}», включите «ответить пользователю»',
  'guide.recipe.3.s2': 'После ИИ — Переход обратно в Меню, получится диалог',
  'guide.recipe.3.s3': 'Ключевые слова «цена, прайс» можно пустить в обход ИИ на готовый ответ',

  'guide.recipe.4.title': 'Рассылка по подписчикам',
  'guide.recipe.4.s0': 'Где-то в сценарии поставьте Подписка → подписать (например, после согласия на рассылку)',
  'guide.recipe.4.s1': 'Отдельная ветвь: Действие → broadcast с текстом письма — уйдёт всем, кто подписался',
  'guide.recipe.4.s2': 'Подписка → отписать ставьте на кнопку «Отключить уведомления»',

  'guide.recipe.5.title': 'A/B-тест текста',
  'guide.recipe.5.s0': 'Случайный выбор: две ветки с весами 1 и 1 (или 3 и 7)',
  'guide.recipe.5.s1': 'В каждой ветке свой вариант сообщения',
  'guide.recipe.5.s2': 'Обе ветки сходятся на общем блоке дальше — так удобнее сравнивать',

  'guide.publish.title': 'Публикация бота',
  'guide.publish.intro': 'Кнопка «Опубликовать» в конструкторе прогоняет сценарий по шагам и показывает, на каком шаге что произошло. Если валидатор нашёл ошибку, до Telegram дело не дойдёт — бот останется на прежней версии.',
  'guide.publish.s0': 'Сохранение сценария — новая версия уходит в базу, предыдущие остаются в истории.',
  'guide.publish.s1': 'Проверка сценария — валидатор ищет ошибки и предупреждения. Ошибки останавливают публикацию, предупреждения — нет.',
  'guide.publish.s2': 'Установка webhook — Telegram получает адрес, по которому будет стучаться ботом.',
  'guide.publish.s3': 'Меню команд — блоки Старт и Команда уходят в /-меню бота.',
  'guide.publish.s4': 'Бот активен — карточка в списке помечается «опубликован».',
  'guide.publish.note.b': 'Полезно знать:',
  'guide.publish.note': 'публикация не стирает прежнюю версию сценария. Версии копятся в базе, и на любую можно откатиться — кнопка «История».',
  'guide.publish.checks': 'Что проверяет валидатор',
  'guide.publish.checklist': 'Чек-лист перед публикацией',
  'guide.publish.cl0': 'Прогоните сценарий в «Превью» — так видны обрывы и пустые сообщения.',
  'guide.publish.cl1.a': 'Проверьте, что все переменные, которые вы подставляете как',
  'guide.publish.cl1.b': ', где-то записываются (Ввод, Контакт, Переменная, HTTP, ИИ).',
  'guide.publish.cl2': 'Убедитесь, что токен бота от @BotFather актуален — его меняют, если токен утерян.',
  'guide.publish.cl3': 'После публикации напишите боту /start в Telegram и пройдите путь целиком.',

  'guide.check.0.q': 'Нет блока Старт',
  'guide.check.0.a': 'Положите блок Старт и сделайте его точкой входа (ПКМ по блоку → «Сделать точкой входа»).',
  'guide.check.1.q': 'Блок никуда не ведёт',
  'guide.check.1.a': 'У каждого блока должен быть выход: стрелка к следующему блоку либо блок Конец. Иначе сценарий на нём обрывается.',
  'guide.check.2.q': 'Пустой текст сообщения',
  'guide.check.2.a': 'Откройте блок и напишите текст — пустое сообщение Telegram не отправит.',
  'guide.check.3.q': 'У кнопки нет перехода',
  'guide.check.3.a': 'Для каждой кнопки выберите блок, куда она ведёт. Кнопка-ссылка (значение вида http…) перехода не требует.',
  'guide.check.4.q': 'У ветки условия нет продолжения',
  'guide.check.4.a': 'Заполните обе ветки: «если да» и «иначе». Пустая ветка — обрыв сценария.',
  'guide.check.5.q': 'Блок недостижим',
  'guide.check.5.a': 'До блока нельзя дойти из Старта или из Команды — проверьте стрелки. Это предупреждение, а не ошибка.',
  'guide.check.6.q': 'Бесконечный цикл',
  'guide.check.6.a': 'Цикл без Ввода, Кнопок, Ключевых слов или паузы: бот будет слать сообщения без остановки. Вставьте блок ожидания.',

  'guide.faq.title': 'Частые вопросы',
  'guide.faq.0.q': 'Бот не отвечает после деплоя',
  'guide.faq.0.a': 'Проверьте: нажата ли «Опубликовать» (она ставит webhook), верный ли токен от @BotFather, есть ли блок Старт и связь от него. Если сценарий пуст — бот ответит «в разработке».',
  'guide.faq.1.q': 'Как подставить имя пользователя в текст?',
  'guide.faq.1.a': 'Пишите {{name}} — переменная подставится, если раньше был блок Ввод с переменной name. Так работает в любом тексте: сообщениях, подсказках, промптах ИИ.',
  'guide.faq.2.q': 'Как сделать возврат в меню?',
  'guide.faq.2.a': 'Блок Переход (goto) с целью «Меню». Поставьте его в конце каждой ветки — иначе сценарий упрётся в Конец и сессия сбросится.',
  'guide.faq.3.q': 'Чем отличаются Кнопки от Меню?',
  'guide.faq.3.a': 'Кнопки — разовые, под конкретным сообщением. Меню — постоянная клавиатура снизу, висит на всех сообщениях, пока вы её не замените.',
  'guide.faq.4.q': 'Зачем «Заморозить» в меню по ПКМ?',
  'guide.faq.4.a': 'Чтобы временно убрать кусок сценария, не удаляя его и не пересобирая связи: бот просто проходит сквозь блок. Удобно для тестов.',
  'guide.faq.5.q': 'Как работает пауза перед сообщением?',
  'guide.faq.5.a': 'Действие → delay, укажите секунды. Платформа поставит отправку в расписание и продолжит сценарий позже (обработчик тикает раз в минуту).',
  'guide.faq.6.q': 'Где хранятся данные пользователей?',
  'guide.faq.6.a': 'В облачной базе платформы: сессии, переменные, подписчики, логи. Токен бота шифруется и в открытом виде никуда не передаётся.',
  'guide.faq.7.q': 'Можно ли писать свой текст кнопкой, а не выбирать из меню?',
  'guide.faq.7.a': 'Да, для этого есть блок Ключевые слова: перечислите фразы через запятую, и живой текст пользователя попадёт на нужную ветку.',

  'guide.foot': 'Подсказка: гайд открывается кнопкой «? Гайды» в верхней панели конструктора.',
  'guide.skill.title': 'Чем отличаются уровни подготовки',
  'guide.skill.intro': 'Уровень меняет не внешний вид, а объём помощи и доступные инструменты.',
  'guide.skill.col': 'Что получаете',
  'guide.skill.low': 'Новичок',
  'guide.skill.low.text': 'Подсказка и пример у каждого блока прямо в списке, пошаговый тур «соберите бота», кликабельные термины, пустой холст предлагает готовый шаблон.',
  'guide.skill.medium': 'Средний',
  'guide.skill.medium.text': 'Объяснений нет, но подсказки к полям включены. Это средний вариант по умолчанию.',
  'guide.skill.high': 'Продвинутый',
  'guide.skill.high.text': 'Плотная верхняя панель со сворачиванием, горячие клавиши, id и параметры блока в инспекторе, коды ошибок валидатора, быстрые действия в меню блока.',
  'guide.skill.change': 'Уровень меняется в Настройках в любой момент. Стартовый экран выбора показывается один раз на аккаунт.',
  'guide.ok': 'Понятно',

  // ============================================================ данные бота
  'nav.data': 'Данные',
  'block.data.label': 'Данные',
  'block.data.hint': 'Пишет, ищет, обновляет и удаляет записи в таблицах этого бота.',
  'block.data.example': 'Сначала создайте таблицу «Заказы» на вкладке «Данные», затем записывайте туда заявку и ищите её по номеру телефона.',
  'whatif.data': 'Заполните ветки «найдено» и «не найдено» — иначе поиск ни на что не влияет.',
  'palette.data': 'Данные',

  // Примеры использования: что делать после этого блока. Показываются новичку
  // рядом с подсказкой — сама подсказка отвечает «что это», пример — «как этим
  // пользоваться». F7, часть A.
  'block.start.example': 'После Старта обычно ставят Приветствие или Меню — иначе пользователь увидит пустоту.',
  'block.message.example': 'Напишите «Привет, {{name}}!» — если раньше был блок «Ввод» с переменной name, подставится имя.',
  'block.buttons.example': 'Две кнопки → два порта. От каждого протяните стрелку к своему блоку: «Каталог» и «Помощь» ведут в разные места.',
  'block.input.example': 'Спросите «Как тебя зовут?» — ответ попадёт в {{name}}, и дальше его можно вставить в любое сообщение.',
  'block.condition.example': 'Проверьте {{age}} > 18: ветка «да» ведёт в каталог, ветка «нет» — к отказу.',
  'block.action.example': 'notify отправит вам заявку: текст «Новая заявка: {{name}}, {{phone}}» придёт в Telegram.',
  'block.goto.example': 'Поставьте в конце каждой ветки переход на блок «Меню» — так пользователь вернётся к выбору, а не упрётся в конец.',
  'block.end.example': 'Ставьте Конец, когда разговор действительно завершён. После него пользователю придётся написать /start заново.',
  'block.media.example': 'Вставьте ссылку на фото и добавьте подпись «{{name}}, вот наш каталог» — медиа уйдёт с подписью.',
  'block.subscription.example': 'Кнопка «Подписаться» ставит подписку, а блок «Действие → broadcast» потом напишет всем подписчикам.',
  'block.menu.example': 'Меню из трёх пунктов остаётся внизу экрана на всех сообщениях — удобно для каталога услуг.',
  'block.command.example': 'Пусть /price отвечает прайсом, а /help — справкой: команды уходят в меню бота.',
  'block.keyword.example': 'Перечислите «цена, сколько стоит» — и на любую из этих фраз бот пойдёт по ветке «есть совпадение».',
  'block.setvar.example': 'Сначала «Переменная score = 0», потом квиз прибавляет баллы: {{score}} + 1.',
  'block.http.example': 'Запросите курс валют и положите в {{rate}}, затем покажите его текстом «Сегодня {{rate}} ₽».',
  'block.ai.example': 'Промпт «Ответь вежливо: {{last_input}}» и включённый «ответить пользователю» — бот поддержит разговор.',
  'block.random.example': 'Половина пользователей увидит вариант A, половина — B: две ветки, вес 1 и 1.',
  'block.switch.example': 'По переменной {{city}} разведите пользователей по трём городам: у каждого варианта свой порт.',
  'block.contact.example': 'Попросите номер кнопкой «Отправить контакт» — номер сам попадёт в {{phone}}, ошибиться нельзя.',
  'block.note.example': 'Напишите себе «здесь чинить скидку» — заметку видите только вы, бот её игнорирует.',
  'block.referral.example': 'Покажите {{ref.link}} пользователю, а через условие на {{ref.count}} выдайте награду.',
  'block.media_group.example': 'Два-три фото одним сообщением: альбом выглядит как галерея, а не как три отдельных файла.',
  'block.invoice.example': 'Подключите provider_token из BotFather, и ветка «оплатил» выведет к выдаче, а «отменил» — обратно в меню.',

  'f.data.op': 'Действие',
  'f.data.op.add': 'Добавить запись',
  'f.data.op.find': 'Найти записи',
  'f.data.op.update': 'Обновить записи',
  'f.data.op.remove': 'Удалить записи',
  'f.data.collection': 'Таблица',
  'f.data.collection.none': 'таблиц нет — создайте на вкладке «Данные»',
  'f.data.fields': 'Что записать',
  'f.data.where': 'Искать по полям',
  'f.data.field': 'поле',
  'f.data.value': 'значение (можно {{var}})',
  'f.data.addField': '+ поле',
  'f.data.outVar': 'Переменная результата',
  'f.data.outVar.hint': '{{order.name}} — поле найденной записи, {{order_count}} — сколько найдено, {{order_json}} — всё текстом',
  'f.data.limit': 'Сколько записей',

  // ------------------------------------------------------------------ теги (F2)
  'block.tag.label': 'Тег',
  'block.tag.hint': 'Ставит, снимает или показывает метки человека: «VIP», «купил», «из рассылки X».',
  'block.tag.example': 'Поставьте тег «купил» после оплаты, а потом условием по тегу отправляйте таких людей в отдельную ветку.',
  'whatif.tag': 'Поставьте после тега условие по этому тегу — иначе метка ни на что не влияет.',
  'f.tag.op': 'Действие',
  'f.tag.op.add': 'Поставить тег',
  'f.tag.op.remove': 'Снять тег',
  'f.tag.op.clear': 'Очистить все теги',
  'f.tag.op.list': 'Показать список тегов',
  'f.tag.name': 'Имя тега',
  'f.tag.namePlaceholder': 'vip, купил, новенький',
  'f.tag.outVar': 'Переменная результата',
  'f.tag.outVar.hint': '{{tags}} — теги через запятую, {{tags_count}} — сколько их',
  'f.tag.hint': 'Имя тега не зависит от регистра: «VIP» и «vip» — один и тот же тег.',
  'f.condition.source': 'Что проверяем',
  'f.condition.source.var': 'Переменную',
  'f.condition.source.tag': 'Тег',
  'f.condition.tagHelp': 'Проверяет, стоит ли на человеке этот тег. Ставит теги блок «Тег».',
  'node.chain': '{n} сообщений подряд',

  // ------------------------------------------------------------------ цепочка (F3)
  'block.chain.label': 'Цепочка',
  'block.chain.hint': 'Отправляет несколько сообщений подряд: текст, фото с подписью, документ — в заданном порядке.',
  'block.chain.example': 'Опишите товар текстом, следом фото с ценой подписью, затем документ с условиями — тремя сообщениями по порядку.',
  'whatif.chain': 'После цепочки обычно идут кнопки или конец сценария.',
  'f.chain.add': '+ сообщение',
  'f.chain.item.text': 'текст сообщения',
  'f.chain.kind.text': 'Текст',
  'f.chain.kind.audio': 'Аудио',
  'f.chain.kind.document': 'Документ',
  'f.chain.hint': 'Каждый элемент — отдельное сообщение. Если нужно несколько медиа одним сообщением, это «Альбом медиа».',

  'data.title': 'Данные бота',
  'data.hint': 'Клиенты — все, кто писал боту, вместе с их переменными. Таблицы — ваши собственные: заказы, заявки, записи. Внешняя база не нужна.',
  'data.tab.clients': 'Клиенты',
  'data.tab.collections': 'Таблицы',
  'data.back': 'Назад',
  'data.loading': 'Загружаю…',
  'data.export': 'Выгрузить CSV',
  'data.refresh': 'Обновить',
  'data.clients.total': '{n} клиентов',
  'data.clients.search': 'поиск: имя, @ник, id, переменные',
  'data.clients.empty': 'Никто ещё не писал боту',
  'data.client.id': 'ID',
  'data.client.name': 'Имя',
  'data.client.username': 'Ник',
  'data.client.firstSeen': 'Первый визит',
  'data.client.lastSeen': 'Последний визит',
  'data.client.vars': 'Переменные',
  'data.client.vars.empty': 'пусто',
  'data.client.edit': 'Изменить',
  'data.client.delete': 'Удалить',
  'data.client.delete.confirm': 'Удалить клиента {id}? Сессия, подписки и его записи в таблицах будут стёрты.',
  'data.client.edit.title': 'Переменные клиента {id}',
  'data.var.add': '+ переменная',
  'data.var.name': 'имя',
  'data.var.value': 'значение',
  'data.save': 'Сохранить',
  'data.cancel': 'Отмена',
  'data.saved': 'Сохранено',
  'data.deleted': 'Удалено',
  'data.collections.empty': 'Таблиц пока нет. Создайте первую — например «Заказы».',
  'data.collection.new': 'Новая таблица',
  'data.collection.name': 'Название',
  'data.collection.name.placeholder': 'Заказы',
  'data.collection.fields': 'Поля (латиницей через запятую)',
  'data.collection.fields.hint': 'name, phone, city — эти же имена потом подставляются как {{order.name}}',
  'data.collection.create': 'Создать',
  'data.collection.records': '{n} записей',
  'data.collection.delete': 'Удалить таблицу',
  'data.collection.delete.confirm': 'Удалить таблицу «{name}» вместе со всеми записями?',
  'data.items.empty': 'Записей нет',
  'data.items.search': 'поиск по записям',
  'data.item.new': 'Добавить запись',
  'data.item.edit': 'Запись',
  'data.item.add': 'Добавить',
  'data.item.delete': 'Удалить',
  'data.item.fromUser': 'клиент',
  'data.item.date': 'Создана',

  // ============================================================ словарь (расширение)
  'glossary.count': '{n} терминов',
  'glossary.group.scenario': 'Сценарий',
  'glossary.group.telegram': 'Telegram',
  'glossary.group.commerce': 'Оплаты',
  'glossary.group.referral': 'Рефералы',
  'glossary.polling': 'polling',
  'glossary.polling.text': 'Способ получения сообщений: бот сам регулярно спрашивает у Telegram «что нового?». Платформа вместо него использует webhook.',
  'glossary.update': 'update (событие)',
  'glossary.update.text': 'Любое событие, которое Telegram отправляет боту: сообщение, нажатие кнопки, оплата. Из одного события сценарий делает один шаг.',
  'glossary.command': 'команда',
  'glossary.command.text': 'Сообщение, начинающееся с «/»: /start, /help, /price. Блок «Команда» реагирует на свою команду из любого места сценария.',
  'glossary.deeplink': 'deep link',
  'glossary.deeplink.text': 'Ссылка, которая открывает бота и сразу передаёт ему данные: t.me/ваш_бот?start=что_угодно. Так работают реферальные ссылки.',
  'glossary.startparam': 'start-параметр',
  'glossary.startparam.text': 'Текст после ?start= в ссылке на бота. Бот получает его в первом сообщении и может использовать, например, чтобы узнать, кто пригласил человека.',
  'glossary.inlinequery': 'inline query',
  'glossary.inlinequery.text': 'Запрос к боту прямо из поля ввода любого чата: «@ваш_бот текст». Результат показывается списком над сообщением.',
  'glossary.callbackquery': 'callback query',
  'glossary.callbackquery.text': 'Нажатие inline-кнопки. Telegram отправляет его боту отдельным событием, а «часики» на кнопке снимает ответ answerCallbackQuery.',
  'glossary.sendmessage': 'sendMessage',
  'glossary.sendmessage.text': 'Главный метод Telegram Bot API: отправить текстовое сообщение в чат. Блок «Сообщение» внутри вызывает именно его.',
  'glossary.editmessage': 'editMessage',
  'glossary.editmessage.text': 'Изменение уже отправленного сообщения: текст или кнопки. Используется, чтобы меню обновлялось на месте, без спама новыми сообщениями.',
  'glossary.answercallbackquery': 'answerCallbackQuery',
  'glossary.answercallbackquery.text': 'Ответ Telegram на нажатие inline-кнопки: убирает «часики» и может показать всплывающую плашку. Платформа вызывает его автоматически.',
  'glossary.setmycommands': 'setMyCommands',
  'glossary.setmycommands.text': 'Регистрация списка команд бота — они появляются в меню Telegram. Кнопка «Опубликовать» делает это сама по блокам «Команда».',
  'glossary.getchatmember': 'getChatMember',
  'glossary.getchatmember.text': 'Запрос к Telegram о статусе человека в чате: участник, админ, вышел. Используется, например, для проверки подписки на канал.',
  'glossary.chattype': 'chat_type',
  'glossary.chattype.text': 'Тип чата, откуда пришло событие: private (личные), group, supergroup, channel. В группе боту доступны не все данные пользователя.',
  'glossary.scenblock': 'блок',
  'glossary.scenblock.text': 'Один шаг сценария: сообщение, условие, запрос. Блоки перетаскиваются из палитры и соединяются стрелками.',
  'glossary.edge': 'связь (стрелка)',
  'glossary.edge.text': 'Стрелка между блоками: по ней сценарий переходит дальше. У развилок каждая стрелка подписана своей веткой.',
  'glossary.fallback': 'fallback (запасной путь)',
  'glossary.fallback.text': 'Что делает бот, когда основной путь не сработал: не нашёл совпадение, запрос упал. Веткам «нет», «мимо», «ошибка» нужен продолжение.',
  'glossary.snapshot': 'снимок версии',
  'glossary.snapshot.text': 'Копия сценария на момент публикации. В «Истории» можно посмотреть любой снимок и откатиться к нему.',
  'glossary.version': 'версия',
  'glossary.version.text': 'Каждая публикация создаёт новую версию сценария. Бот работает по опубликованной версии, а не по черновику в редакторе.',
  'glossary.publish': 'публикация',
  'glossary.publish.text': 'Момент, когда сценарий из редактора становится рабочим: платформа ставит webhook, регистрирует команды и включает бота.',
  'glossary.validation': 'валидация',
  'glossary.validation.text': 'Проверка сценария на ошибки: пустые сообщения, оборванные ветки, циклы без ожидания. Красный треугольник в шапке — о них.',
  'glossary.dryrun': 'dry-run (прогон)',
  'glossary.dryrun.text': 'Прогон сценария без реальных сообщений: превью в редакторе. Так проверяют логику до публикации.',
  'glossary.invoice': 'invoice (счёт)',
  'glossary.invoice.text': 'Платёж внутри Telegram: бот выставляет счёт, пользователь платит картой или Telegram Stars. Блок «Оплата» работает через sendInvoice.',
  'glossary.sendinvoice': 'sendInvoice',
  'glossary.sendinvoice.text': 'Метод Telegram, который показывает пользователю карточку оплаты: сумма, описание, кнопка «Оплатить».',
  'glossary.precheckout': 'pre_checkout_query',
  'glossary.precheckout.text': 'Последний вопрос Telegram перед списанием денег: «всё в порядке?». Бот обязан ответить за несколько секунд, иначе платёж отменится.',
  'glossary.successfulpayment': 'successful payment',
  'glossary.successfulpayment.text': 'Событие «деньги списаны»: приходит боту сразу после успешной оплаты. Сценарий уходит по ветке «оплатил».',
  'glossary.providertoken': 'provider token',
  'glossary.providertoken.text': 'Ключ платёжного провайдера (ЮKassa, Stripe…), который выдаёт BotFather в разделе Payments. Без него счёт не выставится.',
  'glossary.payload': 'payload',
  'glossary.payload.text': 'Ваша метка внутри платежа (например, «подписка на месяц»). Вернётся в событии об оплате и поможет понять, за что заплатили.',
  'glossary.referrer': 'пригласивший (referrer)',
  'glossary.referrer.text': 'Пользователь, который поделился реферальной ссылкой. Бонусы начисляются именно ему.',
  'glossary.referee': 'приглашённый (referee)',
  'glossary.referee.text': 'Пользователь, который пришёл по чужой ссылке. Засчитывается за пригласившим один раз — повторные переходы не перебьют связь.',
  'glossary.reflink': 'реферальная ссылка',
  'glossary.reflink.text': 'Персональная ссылка вида t.me/бот?start=ref_123. По её start-параметру бот понимает, кто привёл человека.',
  'glossary.attribution': 'атрибуция',
  'glossary.attribution.text': 'Определение, откуда пришёл пользователь: по ссылке, QR или рекламе. В блоке «Реферальная ссылка» за это отвечает payload в ?start=.',
  'glossary.antifraud': 'антифрод',
  'glossary.antifraud.text': 'Защита от накрутки: один бонус на человека, запрет приглашать самого себя, пауза между выдачами. Настраивается блоком «Антифрод».',
  'glossary.multilevel': 'многоуровневость',
  'glossary.multilevel.text': 'Награды по цепочке приглашений: пригласивший получает долю, его пригласивший — долю поменьше. Настраивается в блоке «Иерархия».',

  // ============================================================ реферальная система
  'palette.referral': 'Реферальная система',

  'port.ref.ok': 'засчитан',
  'port.ref.alreadyTracked': 'уже засчитан',
  'port.ref.selfBlocked': 'сам себя пригласил',
  'port.ref.yes': 'да',
  'port.ref.no': 'нет',
  'port.ref.granted': 'выдан',
  'port.ref.skipped': 'пропущен',
  'port.ref.failed': 'ошибка',
  'port.ref.joined': 'участвует',
  'port.ref.alreadyIn': 'уже участвует',
  'port.ref.notRunning': 'турнир не идёт',

  'block.referral_track.label': 'Учёт приглашения',
  'block.referral_track.hint': 'Записывает, кто пригласил этого пользователя. Три ветки: засчитан, уже засчитан, сам себя пригласил.',
  'block.referral_track.example': 'Поставьте сразу после Старта: все, кто пришёл по ссылке, засчитаются за пригласившим, а остальные пойдут по обычной ветке.',
  'whatif.referral_track': 'После учёта обычно благодарят пришедшего и ведут в основную воронку.',

  'block.referral_check.label': 'Пришёл по ссылке?',
  'block.referral_check.hint': 'Проверяет, есть ли у пользователя пригласивший. Ветки «да» и «нет».',
  'block.referral_check.example': 'Веткой «да» покажите приглашённому приветствие от друга, веткой «нет» — обычное начало.',
  'whatif.referral_check': 'Из «да» обычно идёт персональное приветствие, из «нет» — общий сценарий.',

  'block.referral_bonus.label': 'Бонус за приглашение',
  'block.referral_bonus.hint': 'Награждает пригласившего, когда срабатывает триггер: N-й реферал, первая оплата, подписка или своё событие.',
  'block.referral_bonus.example': 'Триггер «каждый 5-й реферал» и награда «сообщение» — пригласивший получит благодарность, когда приведёт пятого друга.',
  'whatif.referral_bonus': 'Ветку «пропущен» обязательно нужно вести дальше — по ней идёт большинство запусков.',

  'block.referral_stats.label': 'Статистика приглашений',
  'block.referral_stats.hint': 'Отправляет пользователю его счёт: сколько пригласил, кого, сколько заработал.',
  'block.referral_stats.example': 'Добавьте кнопку «Мои приглашения» и выведите на неё этот блок: {{ref.count}} и {{ref.earnings}} подставятся в текст.',
  'whatif.referral_stats': 'Обычно это тупиковая ветка — после статистики возвращают в меню.',

  'block.referral_leaderboard.label': 'Топ пригласивших',
  'block.referral_leaderboard.hint': 'Показывает рейтинг: сортировка по числу приглашений или доходу, период — всё время, месяц, неделя или свой.',
  'block.referral_leaderboard.example': 'Топ-10 за месяц подогревает соревнование: {{ref.leaderboard}} вставит список прямо в сообщение.',
  'whatif.referral_leaderboard': 'Рейтинг хорошо смотрится рядом с турниром или наградой за первое место.',

  'block.referral_hierarchy.label': 'Многоуровневый бонус',
  'block.referral_hierarchy.hint': 'Делит событие (например, оплату) между цепочкой пригласивших: доля каждого уровня настраивается, глубина до 5.',
  'block.referral_hierarchy.example': 'Глубина 2 и доли 10% / 5%: прямой пригласивший получит 10% от оплаты, его пригласивший — 5%.',
  'whatif.referral_hierarchy': 'Уровни выплачиваются только «живым» рефералам — добавьте блок проверки перед оплатами.',

  'block.referral_tournament.label': 'Турнир',
  'block.referral_tournament.hint': 'Соревнование с датами: кто больше пригласит (или принесёт дохода) за окно турнира. Призовой фонд делится по местам.',
  'block.referral_tournament.example': 'Турнир на месяц с фондом «1000 ₽» и делением 50/30/20: трое лучших получат половину, 30% и 20%.',
  'whatif.referral_tournament': 'Вне окна турнира сценарий пойдёт по ветке «турнир не идёт» — выведите там анонс следующего.',

  'block.referral_verification.label': 'Проверка реферала',
  'block.referral_verification.hint': 'Засчитывает реферала только после условия: подписка, первая оплата, оплата от суммы или своя переменная-цель.',
  'block.referral_verification.example': 'Ставьте после оплаты приглашённого: бонусы начнут начисляться только за платящих, а не за «мёртвые души».',
  'whatif.referral_verification': 'После проверки обычно идёт бонус пригласившему или иерархия.',

  'block.antifraud.label': 'Антифрод',
  'block.antifraud.hint': 'Общие ограничения бонусов: один раз на человека, запрет самоприглашения, пауза между выдачами, минимальный возраст аккаунта.',
  'block.antifraud.example': 'Достаточно одного блока в сценарии: его лимиты автоматически применяются ко всем выдачам бонусов и турниров.',
  'whatif.antifraud': 'Это декларация правил — в потоке он не нужен, просто добавьте его на холст.',

  'node.referral_track': 'кто кого пригласил',
  'node.referral_check': 'есть пригласивший?',
  'node.referral_stats': 'счёт приглашений',
  'node.referral_hierarchy': 'доли по уровням',
  'node.referral_tournament': 'соревнование',
  'node.antifraud': 'лимиты выдач',

  // инспектор: реферальные поля
  'f.ref.payload': 'Метка источника (payload)',
  'f.ref.payloadPlaceholder': 'например: vk_ads',
  'f.ref.payload.hint': 'Добавится к ссылке как ?start=ref_<id>_<метка>. Допустимы латиница, цифры, - и _; по метке видно, откуда пришли.',
  'f.ref.trigger': 'Когда выдавать бонус',
  'f.ref.trigger.nth_referral': 'Каждый N-й приглашённый',
  'f.ref.trigger.first_payment': 'Первая оплата приглашённого',
  'f.ref.trigger.subscription_started': 'Оформил подписку',
  'f.ref.trigger.custom_event': 'Своё событие ({{ref.event}})',
  'f.ref.triggerN': 'Какой по счёту реферал',
  'f.ref.eventName': 'Имя события',
  'f.ref.eventName.hint': 'Бонус сработает, когда {{ref.event}} совпадёт с этим именем. Событие можно выставить, например, из ответа HTTP.',
  'f.ref.bonusKind': 'Что выдаём',
  'f.ref.bonus.send_message': 'Сообщение пригласившему',
  'f.ref.bonus.increment_variable': 'Прибавить к переменной',
  'f.ref.bonus.grant_subscription_days': 'Дни подписки',
  'f.ref.bonusText': 'Текст награды',
  'f.ref.bonusVar': 'Переменная',
  'f.ref.bonusAmount': 'Прибавляемое значение',
  'f.ref.bonusDays': 'Дней подписки',
  'f.ref.depth': 'Глубина цепочки (1–5)',
  'f.ref.shares': 'Доли уровней',
  'f.ref.shares.hint': 'Уровень 1 — прямой пригласивший. Сумма долей не должна превышать 1.',
  'f.ref.text': 'Текст сообщения',
  'f.ref.text.statsHint': 'Доступны {{ref.count}}, {{ref.earnings}}, {{ref.referred}}.',
  'f.ref.text.leaderboardHint': 'Вставьте {{ref.leaderboard}} — подставится готовый список.',
  'f.ref.limit': 'Сколько строк показать',
  'f.ref.sort': 'Сортировка',
  'f.ref.sort.count': 'по числу приглашений',
  'f.ref.sort.revenue': 'по доходу',
  'f.ref.sort.activity_period': 'по активности за период',
  'f.ref.period': 'Период',
  'f.ref.period.all_time': 'всё время',
  'f.ref.period.month': 'за месяц',
  'f.ref.period.week': 'за неделю',
  'f.ref.period.custom': 'свой период',
  'f.ref.periodFrom': 'Начало (ГГГГ-ММ-ДД)',
  'f.ref.periodTo': 'Конец (ГГГГ-ММ-ДД)',
  'f.ref.tournamentName': 'Название турнира',
  'f.ref.startsAt': 'Начало',
  'f.ref.endsAt': 'Конец',
  'f.ref.metric': 'Метрика',
  'f.ref.metric.count': 'приглашения',
  'f.ref.metric.revenue': 'доход',
  'f.ref.prizePool': 'Призовой фонд (описание)',
  'f.ref.prizeSplit': 'Деление призов, %',
  'f.ref.prizeSplit.hint': 'Доли по местам через «/», сумма 100: например 50/30/20.',
  'f.ref.gate': 'Чем подтверждаем реферала',
  'f.ref.gate.subscribed': 'подпиской',
  'f.ref.gate.paid_once': 'любой оплатой',
  'f.ref.gate.paid_min_amount': 'оплатой от суммы',
  'f.ref.gate.custom_goal': 'своей целью (переменная)',
  'f.ref.minAmount': 'Минимальная сумма',
  'f.ref.minAmount.hint': 'В минимальных единицах валюты: для RUB — копейки.',
  'f.ref.goalVar': 'Переменная цели',
  'f.ref.goalVar.hint': 'Булева переменная сценария: 1 или true означает «цель достигнута».',
  'f.ref.af.onePerUser': 'Один бонус на приглашённого',
  'f.ref.af.onePerUser.short': '1 бонус/чел',
  'f.ref.af.blockSelf': 'Запретить приглашать себя',
  'f.ref.af.blockSelf.short': 'без самоприглашения',
  'f.ref.af.cooldown': 'Пауза между бонусами, сек',
  'f.ref.af.cooldown.short': 'пауза',
  'f.ref.af.minAge': 'Минимальный возраст аккаунта, дней',
  'f.ref.af.minAge.short': 'возраст',
  'f.ref.af.hint': 'Лимиты применяются ко всем выдачам бонусов и турниров этого бота. Достаточно одного блока в сценарии.',

  'vars.sys.refVerified': 'реферал подтверждён (0/1)',
  'vars.sys.refEarnings': 'заработано бонусами',
  'vars.sys.refLeaderboard': 'готовый список топа',
  'vars.sys.refReferred': 'кого пригласил (id через запятую)',
  'vars.sys.refEvent': 'имя события для бонусов',

  // ============================================================ набор 2026-09
  // TODO(prompt-2): full UI — ключи добавлены заранее, чтобы словарь и типы
  // сходились; группы полей в инспекторе появятся в Prompt 2.

  // --- порты новых веток ---
  'port.answered': 'ответил', // TODO(prompt-2): full UI
  'port.pollSkipped': 'пропустил', // TODO(prompt-2): full UI
  'port.fwdOk': 'переслано', // TODO(prompt-2): full UI
  'port.fwdFailed': 'не удалось', // TODO(prompt-2): full UI
  'port.reply': 'ответил', // TODO(prompt-2): full UI
  'port.timeout': 'таймаут', // TODO(prompt-2): full UI
  'port.member': 'состоит', // TODO(prompt-2): full UI
  'port.notMember': 'не состоит', // TODO(prompt-2): full UI
  'port.error': 'ошибка', // TODO(prompt-2): full UI
  'port.queued': 'в очереди', // TODO(prompt-2): full UI
  'port.empty': 'пусто', // TODO(prompt-2): full UI
  'port.created': 'создано', // TODO(prompt-2): full UI
  'port.failed': 'не удалось', // TODO(prompt-2): full UI
  'port.pending': 'ждём оплату', // TODO(prompt-2): full UI
  'port.each': 'итерация', // TODO(prompt-2): full UI
  'port.done': 'список закончился', // TODO(prompt-2): full UI
  'port.pass': 'прошло', // TODO(prompt-2): full UI
  'port.fail': 'не прошло', // TODO(prompt-2): full UI
  'port.ok': 'ок', // TODO(prompt-2): full UI
  'port.limitReached': 'лимит достигнут', // TODO(prompt-2): full UI

  // --- блоки: подписи, подсказки, примеры, «что если» ---
  'block.poll.label': 'Опрос', // TODO(prompt-2): full UI
  'block.poll.hint': 'Отправляет опрос или викторину Telegram и ждёт ответа: ветки «ответил» и «пропустил».', // TODO(prompt-2): full UI
  'block.poll.example': 'Вопрос викторины с вариантами: ответ попадёт в {{poll.answer}}, ветка «ответил» продолжит сценарий, «пропустил» — вернёт в меню.', // TODO(prompt-2): full UI
  'whatif.poll': 'Опрос ждёт ответа: соедините обе ветки — «ответил» и «пропустил».', // TODO(prompt-2): full UI

  'block.forward.label': 'Пересылка', // TODO(prompt-2): full UI
  'block.forward.hint': 'Пересылает или копирует сообщение в другой чат — канал, админу или самому пользователю.', // TODO(prompt-2): full UI
  'block.forward.example': 'Пользователь оставил отзыв — перешлите его в чат команды; ветка «не удалось» — напишите админу.', // TODO(prompt-2): full UI
  'whatif.forward': 'Заполните ветку «не удалось» — иначе сбой пересылки пройдёт молча.', // TODO(prompt-2): full UI

  'block.chat_action.label': 'Печатает…', // TODO(prompt-2): full UI
  'block.chat_action.hint': 'Показывает индикатор действия («печатает…», «отправляет фото…»). Сценарий не останавливает — идёт дальше по next.', // TODO(prompt-2): full UI
  'block.chat_action.example': 'Поставьте перед ИИ-ответом: бот «печатает», пока генерируется ответ — выглядит как живой диалог.', // TODO(prompt-2): full UI
  'whatif.chat_action': 'Блок ничего не ждёт и идёт дальше: ставьте его перед долгой операцией.', // TODO(prompt-2): full UI

  'block.wait.label': 'Ожидание ответа', // TODO(prompt-2): full UI
  'block.wait.hint': 'Ждёт ответ пользователя заданное время: ветки «ответил» и «таймаут».', // TODO(prompt-2): full UI
  'block.wait.example': 'Ждите ответ 10 минут; по таймауту отправьте напоминание — ветка «таймаут».', // TODO(prompt-2): full UI
  'whatif.wait': 'Соедините обе ветки: пользователь может ответить, а может промолчать.', // TODO(prompt-2): full UI

  'block.channel_check.label': 'Проверка канала', // TODO(prompt-2): full UI
  'block.channel_check.hint': 'Проверяет подписку на канал или чат: ветки «состоит», «не состоит» и «ошибка».', // TODO(prompt-2): full UI
  'block.channel_check.example': 'Перед выдачей файла проверьте подписку на канал: «не состоит» — отправьте ссылку-приглашение.', // TODO(prompt-2): full UI
  'whatif.channel_check': 'Бот должен быть администратором канала — иначе проверка всегда даёт «ошибка».', // TODO(prompt-2): full UI

  'block.segment_broadcast.label': 'Рассылка сегменту', // TODO(prompt-2): full UI
  'block.segment_broadcast.hint': 'Ставит в очередь рассылку сегменту пользователей: по тегу и/или условиям отбора.', // TODO(prompt-2): full UI
  'block.segment_broadcast.example': 'Тег «купил» и текст «новинка» — рассылка уйдёт только тем, кто уже платил.', // TODO(prompt-2): full UI
  'whatif.segment_broadcast': 'Рассылка уходит асинхронно: сценарий сразу идёт по ветке «в очереди».', // TODO(prompt-2): full UI

  'block.user_stats.label': 'Профиль пользователя', // TODO(prompt-2): full UI
  'block.user_stats.hint': 'Выставляет данные пользователя переменными {{user.name}}, {{user.paid_total}} и др., может отправить сообщение по шаблону.', // TODO(prompt-2): full UI
  'block.user_stats.example': 'Кнопка «Мой профиль»: шаблон с {{user.name}} и {{user.subscription}} — бот покажет, что знает о человеке.', // TODO(prompt-2): full UI
  'whatif.user_stats': 'После блока доступны переменные user.* — подставьте их в любой текст.', // TODO(prompt-2): full UI

  'block.payment_link.label': 'Платёжная ссылка', // TODO(prompt-2): full UI
  'block.payment_link.hint': 'Создаёт заказ и кладёт ссылку на оплату в {{pay.link}}: ветки «создано» и «не удалось».', // TODO(prompt-2): full UI
  'block.payment_link.example': 'Покажите ссылку кнопкой-URL или сообщением, а статус оплаты проверьте блоком «Проверка оплаты».', // TODO(prompt-2): full UI
  'whatif.payment_link': 'Отправьте ссылку пользователю сообщением или кнопкой-URL, затем проверьте оплату.', // TODO(prompt-2): full UI

  'block.payment_check.label': 'Проверка оплаты', // TODO(prompt-2): full UI
  'block.payment_check.hint': 'Проверяет статус заказа из «Платёжной ссылки»: ветки «оплачено», «ждём оплату» и «не удалось».', // TODO(prompt-2): full UI
  'block.payment_check.example': 'После оплаты выдайте доступ по ветке «оплачено»; «ждём оплату» — напомните позже.', // TODO(prompt-2): full UI
  'whatif.payment_check': 'Заполните все три ветки: оплата прошла, ещё ждём, не получилось.', // TODO(prompt-2): full UI

  'block.foreach.label': 'Цикл по списку', // TODO(prompt-2): full UI
  'block.foreach.hint': 'Перебирает список из переменной: каждая итерация — ветка «итерация», конец — «список закончился».', // TODO(prompt-2): full UI
  'block.foreach.example': 'Найдите записи блоком «Данные» и в цикле отправьте каждую отдельным сообщением.', // TODO(prompt-2): full UI
  'whatif.foreach': 'Тело цикла должно возвращаться в этот же блок — иначе следующей итерации не будет.', // TODO(prompt-2): full UI

  'block.random_text.label': 'Случайный текст', // TODO(prompt-2): full UI
  'block.random_text.hint': 'Выбирает один из вариантов текста по весам и отправляет его или кладёт в переменную.', // TODO(prompt-2): full UI
  'block.random_text.example': 'Три приветствия с весами 1/1/1 — бот каждый раз здоровается по-разному, это оживляет диалог.', // TODO(prompt-2): full UI
  'whatif.random_text': 'Веток у блока нет: он просто идёт дальше по next.', // TODO(prompt-2): full UI

  'block.assert.label': 'Утверждение', // TODO(prompt-2): full UI
  'block.assert.hint': 'Проверяет условие и разводит сценарий: «прошло» / «не прошло». При провале отправляет сообщение.', // TODO(prompt-2): full UI
  'block.assert.example': 'Перед выдачей проверьте {{score}} > 0: если что-то сломалось, бот сообщит об этом прямо в чат.', // TODO(prompt-2): full UI
  'whatif.assert': 'Заполните обе ветки — «прошло» и «не прошло».', // TODO(prompt-2): full UI

  'block.counter.label': 'Счётчик', // TODO(prompt-2): full UI
  'block.counter.hint': 'Увеличивает, уменьшает или сбрасывает счётчик — на пользователя или общий — и кладёт значение в переменную.', // TODO(prompt-2): full UI
  'block.counter.example': 'Лимит 3 бесплатных запроса: каждый запрос — плюс один, ветка «лимит достигнут» — предложить оплату.', // TODO(prompt-2): full UI
  'whatif.counter': 'Поставьте порог и заполните ветку «лимит достигнут» — в этом весь смысл счётчика.', // TODO(prompt-2): full UI

  'block.web_app.label': 'Mini App',
  'block.web_app.hint': 'Отправляет сообщение с кнопкой, которая открывает веб-приложение Telegram (Mini App). Ветвей нет — сценарий идёт дальше по next.',
  'block.web_app.example': 'Каталог или запись: кнопка «Открыть» раскрывает Mini App прямо в Telegram, а сценарий продолжает идти дальше.',
  'whatif.web_app': 'Ветвей нет: блок отправляет сообщение и идёт дальше по next.',

  'node.web_app.empty': 'кнопка Mini App',

  'f.webapp.text': 'Текст сообщения',
  'f.webapp.button': 'Подпись кнопки',
  'f.webapp.url': 'Ссылка Mini App',
  'f.webapp.urlPlaceholder': 'https://t.me/<username_бота>/<slug>',
  'f.webapp.urlHint': 'Полная ссылка https://t.me/<username_бота>/<slug>. Кнопка Mini App работает только в сообщении с инлайн-кнопкой — Telegram не принимает её в обычном меню.',

  // --- расписание (набор 2026-09-30) ---
  'block.schedule.label': 'Расписание',
  'block.schedule.hint': 'Регистрирует расписание: поток после блока запускается по времени — ежедневно, по дням недели, с интервалом или по cron-выражению.',
  'block.schedule.example': 'Утреннее напоминание в 10:00 каждый день: подключите после блока цепочку сообщений — она будет уходить по расписанию.',
  'whatif.schedule': 'Ветвей нет: сценарий после блока запускается по расписанию, а не по связи.',

  'node.schedule.daily': '{time} ежедневно',
  'node.schedule.weekly': '{time}, {n} дн./нед',
  'node.schedule.interval': 'каждые {n} мин',
  'node.schedule.cron': 'cron: {expr}',
  'node.schedule.aud.all': 'всем',
  'node.schedule.aud.tag': 'тег',
  'node.schedule.aud.single': 'одному',

  'f.sched.kind': 'Вид расписания',
  'f.sched.kind.daily': 'Каждый день',
  'f.sched.kind.weekly': 'По дням недели',
  'f.sched.kind.interval': 'С интервалом',
  'f.sched.kind.cron': 'Cron-выражение',
  'f.sched.atTime': 'Время, ЧЧ:ММ',
  'f.sched.weekdays': 'Дни недели',
  'f.sched.day.1': 'Пн',
  'f.sched.day.2': 'Вт',
  'f.sched.day.3': 'Ср',
  'f.sched.day.4': 'Чт',
  'f.sched.day.5': 'Пт',
  'f.sched.day.6': 'Сб',
  'f.sched.day.7': 'Вс',
  'f.sched.everyMinutes': 'Интервал, минут',
  'f.sched.cronExpr': 'Cron-выражение (5 полей)',
  'f.sched.cron.hint': '5 полей: минуты часы день месяц день_недели. Поддерживаются «*», списки, диапазоны и шаги («*/5»).',
  'f.sched.cron.ok': 'Выражение корректно',
  'f.sched.cron.bad': 'Выражение не распознано: нужно 5 полей — минуты часы день месяц день_недели.',
  'f.sched.audience': 'Кому запускать',
  'f.sched.aud.all': 'всем подписчикам',
  'f.sched.aud.tag': 'по тегу',
  'f.sched.aud.single': 'текущему пользователю',
  'f.sched.audienceTag': 'Тег аудитории',
  'f.sched.timezone': 'Часовой пояс',
  'f.sched.limit': 'Не больше {max} расписаний на одного бота.',

  // --- память диалога блока ИИ (набор 2026-09-30) ---
  'insp.section.aiMemory': 'Память диалога',
  'f.ai.historyVar': 'Переменная истории',
  'f.ai.historyVarPlaceholder': 'ai_history',
  'f.ai.historyVar.hint': 'Имя переменной сценария, где хранится история диалога. Пусто — каждый запрос без контекста прежних реплик.',
  'f.ai.historyTurns': 'Ходов в памяти',
  'f.ai.historyTurns.hint': 'Сколько последних ходов учитывать. По умолчанию 6, максимум {max}.',
  'f.ai.persistHistoryTo': 'Сохранять историю в таблицу',
  'f.ai.persistHistoryTo.hint': 'Таблица, куда дублируется история: там она переживает сброс сессии пользователя.',

  'node.random_text': '{n} вариантов', // TODO(prompt-2): full UI

  // --- разметка сообщений ---
  'f.parseMode': 'Разметка текста', // TODO(prompt-2): full UI
  'f.parseMode.none': 'без разметки', // TODO(prompt-2): full UI
  'f.parseMode.HTML': 'HTML', // TODO(prompt-2): full UI
  'f.parseMode.MarkdownV2': 'MarkdownV2', // TODO(prompt-2): full UI
  'f.disablePreview': 'отключить превью ссылок', // TODO(prompt-2): full UI

  // --- UX инлайн-кнопок ---
  'f.cb.toast': 'Всплывающее уведомление при нажатии', // TODO(prompt-2): full UI
  'f.cb.alert': 'Окно с сообщением при нажатии', // TODO(prompt-2): full UI
  'f.cb.updateMode': 'После нажатия кнопки', // TODO(prompt-2): full UI
  'f.cb.updateMode.send': 'отправить новое сообщение', // TODO(prompt-2): full UI
  'f.cb.updateMode.edit': 'изменить текущее на месте', // TODO(prompt-2): full UI

  // --- удаление сообщений ---
  'f.deleteUserMessage': 'удалить сообщение пользователя', // TODO(prompt-2): full UI
  'f.deleteBotMessage': 'удалить последнее сообщение бота', // TODO(prompt-2): full UI

  // --- типы ввода (расширение kind) ---
  'f.kind.document': 'документ', // TODO(prompt-2): full UI
  'f.kind.video': 'видео', // TODO(prompt-2): full UI
  'f.kind.voice': 'голосовое', // TODO(prompt-2): full UI
  'f.kind.audio': 'аудио', // TODO(prompt-2): full UI
  'f.kind.location': 'геолокация', // TODO(prompt-2): full UI
  'f.kind.any': 'любое сообщение', // TODO(prompt-2): full UI

  // --- операторы условий (расширение op) ---
  'f.op.in': 'в списке', // TODO(prompt-2): full UI
  'f.op.notIn': 'не в списке', // TODO(prompt-2): full UI
  'f.op.startsWith': 'начинается с', // TODO(prompt-2): full UI
  'f.op.endsWith': 'заканчивается на', // TODO(prompt-2): full UI
  'f.op.empty': 'пустое', // TODO(prompt-2): full UI
  'f.op.notEmpty': 'не пустое', // TODO(prompt-2): full UI
  'f.op.regex': 'по регексу', // TODO(prompt-2): full UI
  'f.op.gte': 'больше или равно', // TODO(prompt-2): full UI
  'f.op.lte': 'меньше или равно', // TODO(prompt-2): full UI

  // --- составные условия ---
  'f.conditions': 'Список условий', // TODO(prompt-2): full UI
  'f.conditions.add': '＋ условие', // TODO(prompt-2): full UI
  'f.conditions.logic': 'Как объединять', // TODO(prompt-2): full UI
  'f.conditions.logic.and': 'все (И)', // TODO(prompt-2): full UI
  'f.conditions.logic.or': 'любое (ИЛИ)', // TODO(prompt-2): full UI
  'f.condition.source.user': 'Поле профиля пользователя', // TODO(prompt-2): full UI

  // --- http: повторы и постраничный обход ---
  'f.http.retries': 'Повторов при сбое', // TODO(prompt-2): full UI
  'f.http.backoffMs': 'Пауза между повторами, мс', // TODO(prompt-2): full UI
  'f.http.collectVar': 'Переменная для накопленного результата', // TODO(prompt-2): full UI
  'f.http.paginate': 'Постраничный обход', // TODO(prompt-2): full UI
  'f.http.paginate.kind': 'Способ', // TODO(prompt-2): full UI
  'f.http.paginate.page': 'номер страницы', // TODO(prompt-2): full UI
  'f.http.paginate.offset': 'смещение (offset)', // TODO(prompt-2): full UI
  'f.http.paginate.cursor': 'курсор в ответе', // TODO(prompt-2): full UI
  'f.http.paginate.param': 'Имя параметра запроса', // TODO(prompt-2): full UI
  'f.http.paginate.start': 'Начальное значение', // TODO(prompt-2): full UI
  'f.http.paginate.step': 'Шаг', // TODO(prompt-2): full UI
  'f.http.paginate.maxPages': 'Максимум страниц', // TODO(prompt-2): full UI
  'f.http.paginate.cursorPath': 'Путь к курсору в ответе', // TODO(prompt-2): full UI
  'f.http.paginate.nextCursorPath': 'Путь к следующему курсору', // TODO(prompt-2): full UI
  'f.http.paginate.delayMs': 'Пауза между запросами, мс', // TODO(prompt-2): full UI

  // --- поля новых блоков ---
  'f.poll.question': 'Вопрос', // TODO(prompt-2): full UI
  'f.poll.options': 'Варианты ответа (2–10)', // TODO(prompt-2): full UI
  'f.poll.add': '＋ вариант', // TODO(prompt-2): full UI
  'f.poll.anonymous': 'анонимный опрос', // TODO(prompt-2): full UI
  'f.poll.multiple': 'разрешить несколько ответов', // TODO(prompt-2): full UI
  'f.poll.correct': 'Правильный вариант (викторина)', // TODO(prompt-2): full UI
  'f.poll.correct.none': '— нет, обычный опрос —', // TODO(prompt-2): full UI
  'f.poll.explanation': 'Пояснение к правильному ответу', // TODO(prompt-2): full UI

  'f.forward.mode': 'Как пересылать', // TODO(prompt-2): full UI
  'f.forward.mode.forward': 'пересылка (видно автора)', // TODO(prompt-2): full UI
  'f.forward.mode.copy': 'копия (без автора)', // TODO(prompt-2): full UI
  'f.forward.mode.text': 'своим текстом', // TODO(prompt-2): full UI
  'f.forward.toChatId': 'Чат-получатель', // TODO(prompt-2): full UI
  'f.forward.toChatIdPlaceholder': '@канал или -100…; пусто — сам пользователь', // TODO(prompt-2): full UI
  'f.forward.text': 'Текст сообщения', // TODO(prompt-2): full UI
  'f.forward.fromVar': 'Переменная с id сообщения', // TODO(prompt-2): full UI

  'f.chatAction': 'Действие', // TODO(prompt-2): full UI
  'f.chatAction.typing': 'печатает…', // TODO(prompt-2): full UI
  'f.chatAction.upload_photo': 'отправляет фото…', // TODO(prompt-2): full UI
  'f.chatAction.upload_document': 'отправляет документ…', // TODO(prompt-2): full UI
  'f.chatAction.find_location': 'выбирает геолокацию…', // TODO(prompt-2): full UI
  'f.chatAction.record_voice': 'записывает голосовое…', // TODO(prompt-2): full UI

  'f.wait.seconds': 'Сколько ждать, секунд', // TODO(prompt-2): full UI
  'f.wait.prompt': 'Сообщение перед ожиданием', // TODO(prompt-2): full UI
  'f.wait.reminder': 'Напоминание при таймауте', // TODO(prompt-2): full UI
  'f.wait.maxMinutes': 'Потолок ожидания, минут', // TODO(prompt-2): full UI

  'f.channel.id': 'Канал или чат', // TODO(prompt-2): full UI
  'f.channel.idPlaceholder': '@my_channel или -1001234567890', // TODO(prompt-2): full UI
  'f.channel.requireMembership': 'не пускать дальше без подписки', // TODO(prompt-2): full UI
  'f.channel.cacheMinutes': 'Кэшировать результат, минут', // TODO(prompt-2): full UI

  'f.segment.tag': 'Тег сегмента', // TODO(prompt-2): full UI
  'f.segment.where': 'Условия отбора', // TODO(prompt-2): full UI
  'f.segment.text': 'Текст рассылки', // TODO(prompt-2): full UI
  'f.segment.mediaUrl': 'URL медиа (необязательно)', // TODO(prompt-2): full UI
  'f.segment.chunkSize': 'Пользователей в пачке', // TODO(prompt-2): full UI
  'f.segment.delayMs': 'Пауза между пачками, мс', // TODO(prompt-2): full UI
  'f.segment.dailyCap': 'Дневной лимит', // TODO(prompt-2): full UI

  'f.userstats.prefix': 'Префикс переменных', // TODO(prompt-2): full UI
  'f.userstats.template': 'Шаблон сообщения', // TODO(prompt-2): full UI
  'f.userstats.hint': 'Доступны {{user.name}}, {{user.username}}, {{user.tags}}, {{user.subscription}}, {{user.paid_total}}, {{user.ref_count}}, {{user.first_seen}}.', // TODO(prompt-2): full UI

  'f.pay.connection': 'Платёжное подключение', // TODO(prompt-2): full UI
  'f.pay.amount': 'Сумма (в копейках для RUB)', // TODO(prompt-2): full UI
  'f.pay.currency': 'Валюта', // TODO(prompt-2): full UI
  'f.pay.description': 'Описание заказа', // TODO(prompt-2): full UI
  'f.pay.linkVar': 'Переменная для ссылки', // TODO(prompt-2): full UI
  'f.pay.orderIdVar': 'Переменная с номером заказа', // TODO(prompt-2): full UI
  'f.pay.autoOrderId': 'генерировать номер заказа автоматически', // TODO(prompt-2): full UI

  'f.foreach.listVar': 'Переменная со списком', // TODO(prompt-2): full UI
  'f.foreach.itemVar': 'Переменная элемента', // TODO(prompt-2): full UI
  'f.foreach.indexVar': 'Переменная индекса', // TODO(prompt-2): full UI
  'f.foreach.maxIterations': 'Лимит итераций', // TODO(prompt-2): full UI

  'f.rt.variants': 'Варианты текста', // TODO(prompt-2): full UI
  'f.rt.add': '＋ вариант', // TODO(prompt-2): full UI
  'f.rt.weight': 'вес', // TODO(prompt-2): full UI
  'f.rt.send': 'отправить выбранный текст пользователю', // TODO(prompt-2): full UI
  'f.rt.outVar': 'Переменная для текста', // TODO(prompt-2): full UI

  'f.assert.failMessage': 'Сообщение при провале', // TODO(prompt-2): full UI

  'f.counter.name': 'Имя счётчика', // TODO(prompt-2): full UI
  'f.counter.scope': 'Счётчик', // TODO(prompt-2): full UI
  'f.counter.scope.user': 'на пользователя', // TODO(prompt-2): full UI
  'f.counter.scope.bot': 'общий (на бота)', // TODO(prompt-2): full UI
  'f.counter.op': 'Операция', // TODO(prompt-2): full UI
  'f.counter.op.inc': 'увеличить', // TODO(prompt-2): full UI
  'f.counter.op.dec': 'уменьшить', // TODO(prompt-2): full UI
  'f.counter.op.reset': 'сбросить', // TODO(prompt-2): full UI
  'f.counter.op.get': 'прочитать значение', // TODO(prompt-2): full UI
  'f.counter.amount': 'Шаг', // TODO(prompt-2): full UI
  'f.counter.max': 'Порог (лимит)', // TODO(prompt-2): full UI
  'f.counter.outVar': 'Переменная для значения', // TODO(prompt-2): full UI

  // ============================================================ Промпт 2 (UI набора 2026-09)
  // --- превью: служебные вводы прогона (TASK 7) ---
  'preview.sim.title': 'Служебные вводы прогона',
  'preview.sim.hint': 'Эти команды понимает прогон на сервере: они переключают результат проверки канала и статуса оплаты, имитируют вложения. Так проверяют ветки новых блоков без живого бота.',
  'preview.sim.member': 'подписан на канал',
  'preview.sim.notMember': 'не подписан',
  'preview.sim.paid': 'оплата прошла',
  'preview.sim.pending': 'платёж в ожидании',
  'preview.sim.failed': 'оплата не прошла',
  'preview.sim.document': 'отправить документ',
  'preview.sim.video': 'отправить видео',
  'preview.sim.voice': 'отправить голосовое',
  'preview.sim.audio': 'отправить аудио',
  'preview.sim.any': 'отправить стикер (любое)',
  'preview.wait.countdown': 'ждёт ответ ещё',
  'preview.wait.branches': 'Ответите текстом — сценарий пойдёт по ветке «ответил». Промолчите до конца отсчёта — в реальном боте сработает ветка «таймаут».',
  'preview.menu.title': 'Меню бота (нажатие приходит текстом, как в бою)',
  'preview.noButtons': 'Все кнопки этого блока — ссылки: нажатие открывает сайт и бота не уведомляет, поэтому сценарий здесь стоит. В живом боте так же.',

  // --- группы палитры ---
  'palette.content': 'Содержимое',
  'palette.keyboards': 'Кнопки и меню',
  'palette.audience': 'Аудитория',
  'palette.payments': 'Платежи',
  'palette.advanced': 'Продвинутое',
  'palette.advanced.toggle': 'Продвинутые блоки ({n})',
  'palette.advanced.hint': 'Те же http, ИИ, переменные и цикл — отдельной группой для опытных сценариев.',
  'palette.groupCount': '{n} блоков',
  'palette.groupCount1': '{n} блок',
  'palette.groupCount2': '{n} блока',

  // --- подписи узлов (summary) ---
  'node.editMsg': 'правка сообщения',
  'node.deleteMsg': 'удалить сообщение',
  'node.conditions': '{n} условий',
  'node.retries': 'повторов: {n}',
  'node.poll': 'опрос',
  'node.poll.quiz': 'викторина',
  'node.poll.options': '{n} вариантов',
  'node.forward.forward': 'пересылка',
  'node.forward.copy': 'копия',
  'node.forward.text': 'текстом',
  'node.wait': 'ждать {s}с',
  'node.channel_check.empty': 'канал не задан',
  'node.segment.tag': 'сегмент: {tag}',
  'node.segment.empty': 'текст рассылки',
  'node.payment': 'оплата · {amount} {currency}',
  'node.payment_check': 'статус {{{var}}}',
  'node.foreach': 'цикл: {{{list}}}',
  'node.assert.empty': 'условие не задано',
  'node.counter.limit': 'счётчик: {name} ≤ {max}',
  'node.counter.inc': '+ {name}',
  'node.counter.dec': '− {name}',
  'node.counter.reset': 'сброс: {name}',
  'node.counter.get': 'чтение: {name}',

  // ============================================================ библиотека подсценариев
  'subflows.nav': 'Библиотека',
  'subflows.title': 'Библиотека подсценариев',
  'subflows.hint': 'Фрагменты вашего аккаунта: один раз собрали — вызываете из любого бота блоком «Подсценарий».',
  'subflows.hint.canvas': 'Чтобы перенести готовые блоки во фрагмент, выделите их на холсте конструктора и выберите «Создать подсценарий из выделения».',
  'subflows.search': 'Поиск по имени или описанию',
  'subflows.search.empty': 'Ничего не нашлось — уточните запрос.',
  'subflows.count': 'Фрагментов: {n}',
  'subflows.new': 'Новый фрагмент',
  'subflows.create.title': 'Новый подсценарий',
  'subflows.create.starter': 'Привет из фрагмента',
  'subflows.create.submit': 'Создать',
  'subflows.create.done': 'Фрагмент создан. Содержимое правится на холсте конструктора: добавьте блок «Подсценарий» и выберите этот фрагмент.',
  'subflows.name': 'Название',
  'subflows.name.placeholder': 'например, «Отправить меню»',
  'subflows.description': 'Описание',
  'subflows.description.placeholder': 'зачем этот фрагмент (необязательно)',
  'subflows.edit': 'Имя и описание',
  'subflows.edit.title': 'Правка фрагмента',
  'subflows.save': 'Сохранить',
  'subflows.saved': 'Изменения сохранены',
  'subflows.cancel': 'Отмена',
  'subflows.duplicate': 'Дублировать',
  'subflows.duplicate.done': 'Копия создана',
  'subflows.copySuffix': ' (копия)',
  'subflows.delete': 'Удалить',
  'subflows.delete.confirm': 'Удалить фрагмент «{name}»? Действие необратимо.',
  'subflows.delete.warn': 'Боты, использующие фрагмент, покажут ошибку валидации, пока вызов не заменён.',
  'subflows.delete.yes': 'Да, удалить',
  'subflows.deleted': 'Фрагмент удалён',
  'subflows.rev': 'Ревизия {n}',
  'subflows.rev.short': 'рев. {n}',
  'subflows.usedBy': 'Используют ботов: {n}',
  'subflows.inputs': 'Входы',
  'subflows.outputs': 'Выходы',
  'subflows.io.none': 'нет',
  'subflows.io.required': 'обязательный',
  'subflows.versions': 'Ревизии',
  'subflows.versions.title': 'История ревизий',
  'subflows.versions.empty': 'История пуста.',
  'subflows.versions.current': 'текущая',
  'subflows.restore': 'Восстановить',
  'subflows.restored': 'Ревизия {n} восстановлена как новая',
  'subflows.preview': 'Проверить',
  'subflows.preview.title': 'Прогон фрагмента',
  'subflows.preview.hint': 'Фрагмент прогоняется отдельно от бота: движок тот же, вместо живого чата — лог ниже. Образцы входов подставляются в {{переменные}} фрагмента.',
  'subflows.preview.inputs': 'Образцы входов',
  'subflows.preview.run': 'Запустить прогон',
  'subflows.preview.issues': 'Замечания',
  'subflows.preview.logEmpty': 'Прогон прошёл без замечаний, но ни одной реплики не отправил.',
  'subflows.empty.title': 'Пока пусто',
  'subflows.empty.text': 'Подсценарий — это именованный фрагмент сценария: «отправить меню», «принять оплату». Соберите его один раз и вызывайте из любого бота своего аккаунта вместо копирования одних и тех же блоков. Правки фрагмента не меняют работающих ботов: вызов обновляется и публикуется явно.',
  'subflows.guideLink': 'Открыть гайд',

  // --- фрагменты Промпта 2 (см. i18n.frag.*.ts) ---
  ...GUIDE_RU,
  ...INSP_RU,
  ...CANVAS_RU,
  ...PAY_RU,
  // --- подсценарии (библиотека фрагментов) ---
  ...SUBFLOW_RU,
  // --- страница «Пользователи» (staff) ---
  ...ADMIN_RU,
  // --- мини-аппы (конструктор) ---
  ...MINI_RU,
  // --- набор блоков 2026-10 ---
  ...BLOCKS2610_RU,
} as const;

type Dict = Record<keyof typeof ru, string>;

export type TKey = keyof typeof ru;

// Английский словарь лежит в отдельном чанке: на первом экране он не нужен,
// а в главном бандле весил бы десятки килобайт. Пока чанк не доехал, строки
// остаются русскими — пустая подпись хуже, чем русская.
let enDict: Dict | null = null;
let enPromise: Promise<void> | null = null;

export function loadDict(lang: Lang): Promise<void> {
  if (lang !== 'en' || enDict) return Promise.resolve();
  if (!enPromise) {
    enPromise = import('./i18n.en')
      .then((m) => {
        enDict = m.default;
      })
      .catch(() => {
        // Чанк не доехал — остаёмся на русском, интерфейс не ломается.
        enPromise = null;
      });
  }
  return enPromise;
}

function dictFor(lang: Lang): Dict {
  return lang === 'en' ? enDict ?? (ru as unknown as Dict) : (ru as unknown as Dict);
}

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  const raw = dictFor(lang)[key] ?? (ru as unknown as Dict)[key] ?? String(key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

// Хук: перевод в языке, выбранном в настройках. Компонент перерисуется сам,
// когда настройки изменятся (store — внешний, подписка через useSyncExternalStore).
export function useT() {
  const { language } = useSettings();
  const [, bump] = useState(0);

  // Догружаем английский словарь после выбора языка и перерисовываем компонент.
  useEffect(() => {
    if (language !== 'en' || enDict) return;
    let alive = true;
    void loadDict('en').then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [language]);

  return useCallback(
    (key: TKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language]
  );
}
