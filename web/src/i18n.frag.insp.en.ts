// EN-фрагмент словаря: инспектор новых блоков, переменные, превью (Промпт 2).
// Тип обязан повторять RU-фрагмент: расхождение RU/EN не компилируется.
import { INSP_RU } from './i18n.frag.insp';

export const INSP_EN: Record<keyof typeof INSP_RU, string> = {
  'f.format.bold': 'Bold',
  'f.format.italic': 'Italic',
  'f.format.link': 'Link',
  'insp.section.formatting': 'Formatting',

  'f.wait.timeoutCallout':
    'When the time runs out, the scenario continues through the “timeout” branch. Leave it unconnected and a silent user keeps waiting while the reminder never fires.',
  'f.channel.adminCallout':
    'The bot must be an administrator of the channel: without admin rights Telegram does not return the member status and the check goes to the “error” branch.',
  'f.kind.attachmentHint':
    'The variable receives the attachment file_id (“lat,lon” for a location). Extra variables with the _file_name and _mime_type suffixes hold the name and type of the file.',
  'f.condition.userVarPlaceholder': 'profile field, e.g. name',
  'f.condition.listPlaceholder': 'comma-separated values',

  'f.conditions.mode.single': 'single condition',
  'f.conditions.mode.list': 'condition list',
  'f.conditions.hint':
    'Up to five conditions joined by AND / OR. An empty list is an error: add a condition or switch back to a single one.',
  'f.conditions.op': 'Operator',
  'f.segment.where.hint':
    'Up to three conditions on session variables — they filter recipients together with the tag.',

  'f.poll.count': '{n}/10',
  'f.poll.optionPlaceholder': 'answer option',
  'f.rt.textPlaceholder': 'variant text',

  'f.pay.empty':
    'No payment connections — the block cannot create an order. Add a connection on the Payments page.',
  'f.pay.openPayments': 'Open the Payments page',
  'f.pay.amountHint': 'Expressions work: {{price}} * 100 or round({{total}}) — the engine evaluates them.',
  'f.pay.linkHint':
    'The checkout link lands in {{pay.link}}: send it to the user with a following Message block.',
  'f.pay.vkHint':
    'VK: no native invoices — use a YooKassa / Robokassa / Stripe / custom connection. The checkout link arrives as a button in a message.',
  'f.pay.successNext': 'Where to go after a successful payment',

  'f.foreach.loopBack': 'Create a jump back to the loop',
  'f.counter.max.hint':
    'The “limit reached” branch only works with a threshold: set one, otherwise the counter just writes its value into a variable.',

  'vars.sys.payLink': 'checkout link (after payment_link)',
  'vars.sys.payOrder': 'order id (after payment_link)',
  'vars.sys.pollAnswer': 'the poll answer text',
  'vars.sys.pollOptions': 'indexes of the chosen poll options (comma-separated)',
  'vars.sys.userName': 'user display name',
  'vars.sys.userUsername': 'user username',
  'vars.sys.userId': 'numeric user id',
  'vars.sys.userTags': 'user tags (comma-separated)',
  'vars.sys.userSubscription': 'has subscription (1/0)',
  'vars.sys.userPaidTotal': 'total paid (in minimal currency units)',
  'vars.sys.userRefCount': 'how many people the user invited',
  'vars.sys.userFirstSeen': 'when the user first messaged the bot',
  // set 2026-10: language and geo from the update (language / location blocks).
  'vars.sys.userLang': 'Telegram client language code (ru, en, …)',
  'vars.sys.userLat': 'latitude of the shared location',
  'vars.sys.userLon': 'longitude of the shared location',
};
