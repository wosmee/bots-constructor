// EN-фрагмент словаря: страница «Пользователи» (staff-поиск по аккаунтам).
// Тип обязан повторять RU-фрагмент: расхождение RU/EN не компилируется.
import { ADMIN_RU } from './i18n.frag.admin';

export const ADMIN_EN: Record<keyof typeof ADMIN_RU, string> = {
  'admin.nav': 'Users',
  'admin.title': 'User lookup',
  'admin.hint':
    'Staff page: enter a user’s login to see their account, bots and event journal. A regular user gets 403 here.',
  'admin.search.placeholder': 'user login',
  'admin.search.submit': 'Find',
  'admin.searching': 'Searching…',
  'admin.notFound': 'No account with this login',
  'admin.forbidden': 'This page is for staff only (admin/moderator)',

  'admin.user.id': 'Account id',
  'admin.user.login': 'Login',
  'admin.user.role': 'Role',
  'admin.user.role.user': 'user',
  'admin.user.role.moderator': 'moderator',
  'admin.user.role.admin': 'admin',
  'admin.user.registered': 'Registered',
  'admin.user.totals': 'Bots: {bots} · Log events: {events}',

  'admin.bots.title': 'User bots',
  'admin.bots.empty': 'This user has no bots',
  'admin.bots.name': 'Bot',
  'admin.bots.status': 'Status',
  'admin.bots.status.published': 'published',
  'admin.bots.status.draft': 'draft',
  'admin.bots.versions': 'Current / published',
  'admin.bots.created': 'Created',
  'admin.bots.logs': 'Bot logs',

  'admin.logs.title': 'Events across all bots',
  'admin.logs.hint': 'Event journal across all of the user’s bots — newest first.',
  'admin.logs.botFilter': 'Bot',
  'admin.logs.botFilter.all': 'all bots',
  'admin.logs.userId': 'Telegram client user_id (optional)',
  'admin.logs.limit': 'Rows',
  'admin.logs.refresh': 'Refresh',
  'admin.logs.empty': 'No events yet.',
  'admin.logs.bot': 'Bot',
};
