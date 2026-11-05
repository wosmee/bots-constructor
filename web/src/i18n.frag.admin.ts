// RU-фрагмент словаря: страница «Пользователи» (staff-поиск по аккаунтам).
// Фрагменты соединяются в i18n.ts через spread — TKey выводится из суммы.
// Владелец файла — задача ADMIN; ключи из базового i18n.ts здесь НЕ переопределять.
export const ADMIN_RU = {
  'admin.nav': 'Пользователи',
  'admin.title': 'Поиск пользователя',
  'admin.hint':
    'Страница сотрудника: введите логин пользователя — увидите его аккаунт, ботов и журнал событий. Обычный пользователь видит здесь 403.',
  'admin.search.placeholder': 'логин пользователя',
  'admin.search.submit': 'Найти',
  'admin.searching': 'Ищу…',
  'admin.notFound': 'Аккаунт с таким логином не найден',
  'admin.forbidden': 'Страница доступна только сотрудникам (admin/moderator)',

  // ---- блок личности ----
  'admin.user.id': 'ID аккаунта',
  'admin.user.login': 'Логин',
  'admin.user.role': 'Роль',
  'admin.user.role.user': 'пользователь',
  'admin.user.role.moderator': 'модератор',
  'admin.user.role.admin': 'админ',
  'admin.user.registered': 'Регистрация',
  'admin.user.totals': 'Ботов: {bots} · Событий в логах: {events}',

  // ---- таблица ботов ----
  'admin.bots.title': 'Боты пользователя',
  'admin.bots.empty': 'У пользователя нет ботов',
  'admin.bots.name': 'Бот',
  'admin.bots.status': 'Статус',
  'admin.bots.status.published': 'опубликован',
  'admin.bots.status.draft': 'черновик',
  'admin.bots.versions': 'Текущая / опубликованная',
  'admin.bots.created': 'Создан',
  'admin.bots.logs': 'Логи бота',

  // ---- агрегированные логи ----
  'admin.logs.title': 'События всех ботов',
  'admin.logs.hint': 'Журнал событий по всем ботам пользователя — новые сверху.',
  'admin.logs.botFilter': 'Бот',
  'admin.logs.botFilter.all': 'все боты',
  'admin.logs.userId': 'user_id клиента Telegram (необязательно)',
  'admin.logs.limit': 'Строк',
  'admin.logs.refresh': 'Обновить',
  'admin.logs.empty': 'Событий пока нет.',
  'admin.logs.bot': 'Бот',
} as const;
