// Режим «объясни»: человекочитаемое описание ветки.
// Тексты НЕ генерируются ИИ — это заготовленные шаблоны по типу блока
// с подстановкой его настроек (RU/EN).
import { Scenario, Block, usesBranches } from '../../shared/types';
import type { Lang } from './i18n';

const L = (ru: string, en: string, lang: Lang) => (lang === 'en' ? en : ru);

function q(s: string | undefined, fallback: string): string {
  const v = (s ?? '').trim();
  return v || fallback;
}

export function describeBlock(b: Block, lang: Lang): string {
  const p = b.params;
  switch (b.type) {
    case 'start':
      return L(
        `Точка входа: пользователь попадает сюда по команде ${q(p.command, '/start')}.`,
        `Entry point: the user lands here via ${q(p.command, '/start')}.`,
        lang
      );
    case 'command':
      return L(
        `Реагирует на команду ${q(p.command, '/help')}${p.description ? ` (${p.description})` : ''}.`,
        `Handles the ${q(p.command, '/help')} command${p.description ? ` (${p.description})` : ''}.`,
        lang
      );
    case 'message':
      return L(
        `Отправляет пользователю сообщение: «${q(p.text, '')}».`,
        `Sends the user a message: “${q(p.text, '')}”.`,
        lang
      );
    case 'media': {
      const kind = p.mediaType === 'video' ? L('видео', 'a video', lang) : p.mediaType === 'document' ? L('документ', 'a document', lang) : L('фото', 'a photo', lang);
      return L(
        `Отправляет ${kind}${p.caption ? ` с подписью «${p.caption}»` : ''}.`,
        `Sends ${kind}${p.caption ? ` captioned “${p.caption}”` : ''}.`,
        lang
      );
    }
    case 'buttons': {
      const labels = (p.buttons || []).map((x) => x.label).join(', ');
      return L(
        `Показывает ${(p.buttons || []).length} кнопок (${labels}) и ждёт выбор.`,
        `Shows ${(p.buttons || []).length} buttons (${labels}) and waits for a choice.`,
        lang
      );
    }
    case 'input':
      return L(
        `Спрашивает «${q(p.prompt, '')}» и сохраняет ответ в переменную ${q(p.var, 'var')}.`,
        `Asks “${q(p.prompt, '')}” and stores the answer in ${q(p.var, 'var')}.`,
        lang
      );
    case 'contact':
      return L(
        `Просит ${p.request === 'location' ? 'геолокацию' : 'номер телефона'} и сохраняет в ${q(p.var, 'var')}.`,
        `Asks for the ${p.request === 'location' ? 'location' : 'phone number'} and stores it in ${q(p.var, 'var')}.`,
        lang
      );
    case 'condition':
      // Условие умеет смотреть и на тег: тогда сравнивать значение не с чем,
      // важно только, стоит метка или нет (F2).
      if (p.condSource === 'tag')
        return L(
          `Проверяет тег «${q(p.condVar, '?')}»: если он есть — одна ветка, иначе другая.`,
          `Checks the “${q(p.condVar, '?')}” tag: present takes one branch, absent the other.`,
          lang
        );
      return L(
        `Проверяет: ${q(p.condVar, '?')} ${p.op ?? '=='} ${p.condValue ?? ''}. Если правда — одна ветка, иначе другая.`,
        `Checks: ${q(p.condVar, '?')} ${p.op ?? '=='} ${p.condValue ?? ''}. True takes one branch, false the other.`,
        lang
      );
    case 'switch':
      return L(
        `Смотрит на переменную ${q(p.switchVar, '?')} и выбирает один из ${(p.cases || []).length} вариантов.`,
        `Looks at ${q(p.switchVar, '?')} and picks one of ${(p.cases || []).length} cases.`,
        lang
      );
    case 'keyword':
      return L(
        `Ищет в тексте пользователя слова: ${q(p.keywords, '')}.`,
        `Looks for these words in the user's text: ${q(p.keywords, '')}.`,
        lang
      );
    case 'random':
      return L(
        `Случайно выбирает одну из ${(p.options || []).length} ветвей.`,
        `Randomly picks one of ${(p.options || []).length} branches.`,
        lang
      );
    case 'setvar':
      return L(
        `Записывает в переменную ${q(p.assignVar, '?')} значение: ${p.expr ?? ''}.`,
        `Assigns ${p.expr ?? ''} to ${q(p.assignVar, '?')}.`,
        lang
      );
    case 'http':
      return L(
        `Отправляет ${p.method || 'GET'}-запрос на ${q(p.url, '?')} и кладёт ответ в ${q(p.outVar, 'переменную')}.`,
        `Sends a ${p.method || 'GET'} request to ${q(p.url, '?')} and stores the response in ${q(p.outVar, 'a variable')}.`,
        lang
      );
    case 'ai':
      return L(
        p.aiReply
          ? `Спрашивает ИИ и отправляет ответ пользователю.`
          : `Спрашивает ИИ и сохраняет ответ в ${q(p.aiVar, 'переменную')}.`,
        p.aiReply
          ? `Asks the AI and replies to the user with the answer.`
          : `Asks the AI and stores the answer in ${q(p.aiVar, 'a variable')}.`,
        lang
      );
    case 'action': {
      if (p.actionKind === 'delay')
        return L(`Делает паузу ${p.seconds ?? 0} сек.`, `Pauses for ${p.seconds ?? 0} seconds.`, lang);
      if (p.actionKind === 'webhook')
        return L(`Отправляет данные на ${q(p.url, '?')}.`, `Posts data to ${q(p.url, '?')}.`, lang);
      if (p.actionKind === 'notify')
        return L(`Отправляет уведомление админу: ${q(p.notifyText, '')}.`, `Notifies the admin: ${q(p.notifyText, '')}.`, lang);
      return L(`Рассылает сообщение подписчикам: ${q(p.broadcastText, '')}.`, `Broadcasts to subscribers: ${q(p.broadcastText, '')}.`, lang);
    }
    case 'subscription':
      return L(
        `${p.subAction === 'unsubscribe' ? 'Отписывает' : 'Подписывает'} пользователя от рассылки.`,
        `${p.subAction === 'unsubscribe' ? 'Unsubscribes' : 'Subscribes'} the user.`,
        lang
      );
    case 'menu': {
      const labels = (p.buttons || []).map((x) => x.label).join(', ');
      return L(
        `Показывает постоянное меню: ${labels}. Оно висит под всеми сообщениями дальше.`,
        `Shows a persistent menu: ${labels}. It stays under every later message.`,
        lang
      );
    }
    case 'goto':
      return L(`Перебрасывает поток на блок ${q(p.target, '?')}.`, `Jumps the flow to block ${q(p.target, '?')}.`, lang);
    case 'end':
      return L(`Завершает сценарий.`, `Ends the scenario.`, lang);
    case 'note':
      return L(`Комментарий на холсте: ${q(p.note, '')}.`, `Canvas comment: ${q(p.note, '')}.`, lang);
    case 'tag': {
      const op = p.tagOp || 'add';
      if (op === 'clear') return L('Снимает все теги с этого человека.', 'Removes every tag from this person.', lang);
      if (op === 'list')
        return L(
          `Кладёт список тегов человека в {{${q(p.tagVar, 'tags')}}}.`,
          `Puts the person’s tags into {{${q(p.tagVar, 'tags')}}}.`,
          lang
        );
      return op === 'remove'
        ? L(`Снимает тег «${q(p.tagName, '?')}».`, `Removes the tag “${q(p.tagName, '?')}”.`, lang)
        : L(`Ставит тег «${q(p.tagName, '?')}».`, `Adds the tag “${q(p.tagName, '?')}”.`, lang);
    }
    case 'chain':
      return L(
        `Отправляет ${(p.chainItems || []).length} сообщений подряд, каждое своим сообщением.`,
        `Sends ${(p.chainItems || []).length} messages in a row, each as its own message.`,
        lang
      );
    case 'referral':
      return L(
        `Кладёт в переменную {{${q(p.refVar, 'ref.link')}}} персональную ссылку приглашения${p.refPayload ? ` с меткой источника «${q(p.refPayload, '')}»` : ''}.`,
        `Puts a personal invite link into {{${q(p.refVar, 'ref.link')}}}${p.refPayload ? ` with the source tag “${q(p.refPayload, '')}”` : ''}.`,
        lang
      );
    case 'referral_track':
      return L(
        'Записывает, кто пригласил этого пользователя: ветка «засчитан» — новый реферал, «уже засчитан» — связь была раньше, «сам себя пригласил» — накрутка.',
        'Records who invited this user: “tracked” is a new referral, “already tracked” means the link existed before, “self-invite blocked” is gaming.',
        lang
      );
    case 'referral_check':
      return L(
        'Проверяет, пришёл ли человек по чужой реферальной ссылке: «да» — пригласивший известен, «нет» — органика.',
        'Checks whether the person arrived via someone’s referral link: “yes” — the referrer is known, “no” — organic.',
        lang
      );
    case 'referral_bonus': {
      const kind =
        p.refBonusKind === 'increment_variable'
          ? L(`прибавит ${p.refBonusAmount ?? 0} к переменной {{${q(p.refBonusVar, 'var')}}}`, `adds ${p.refBonusAmount ?? 0} to {{${q(p.refBonusVar, 'var')}}}`, lang)
          : p.refBonusKind === 'grant_subscription_days'
          ? L(`даст ${p.refBonusDays ?? 0} дн. подписки`, `grants ${p.refBonusDays ?? 0} subscription days`, lang)
          : L(`отправит пригласившему сообщение «${q(p.refBonusText, '…')}»`, `sends the referrer “${q(p.refBonusText, '…')}”`, lang);
      const trigger =
        p.refTrigger === 'first_payment'
          ? L('после первой оплаты приглашённого', 'after the referee’s first payment', lang)
          : p.refTrigger === 'subscription_started'
          ? L('после оформления подписки', 'once a subscription starts', lang)
          : p.refTrigger === 'custom_event'
          ? L(`когда {{ref.event}} станет «${q(p.refEventName, '?')}»`, `when {{ref.event}} equals “${q(p.refEventName, '?')}”`, lang)
          : L(`когда приглашённых станет ${p.refTriggerN ?? 5}`, `when the referral count reaches ${p.refTriggerN ?? 5}`, lang);
      return L(`Награждает пригласившего ${trigger}: ${kind}.`, `Rewards the referrer ${trigger}: ${kind}.`, lang);
    }
    case 'referral_hierarchy': {
      const shares = (p.refShares || []).map((s) => `${Math.round((Number(s) || 0) * 100)}%`).join(' / ');
      return L(
        `Делит оплату приглашённого по цепочке из ${p.refDepth ?? 2} уровней: ${shares || '—'}. Уровень 1 — прямой пригласивший.`,
        `Splits the referee’s payment along a ${p.refDepth ?? 2}-level chain: ${shares || '—'}. Level 1 is the direct referrer.`,
        lang
      );
    }
    case 'referral_stats':
      return L(
        'Отправляет пользователю его счёт: {{ref.count}} приглашений, {{ref.earnings}} заработка и список приглашённых.',
        'Sends the user their numbers: {{ref.count}} invites, {{ref.earnings}} earned, and the referred list.',
        lang
      );
    case 'referral_leaderboard':
      return L(
        `Показывает топ пригласивших (${p.refSort === 'revenue' ? 'по доходу' : 'по числу приглашений'}, ${p.refPeriod === 'week' ? 'за неделю' : p.refPeriod === 'month' ? 'за месяц' : p.refPeriod === 'custom' ? 'за свой период' : 'за всё время'}) в {{ref.leaderboard}}.`,
        `Shows the referrer top (${p.refSort === 'revenue' ? 'by revenue' : 'by invite count'}, ${p.refPeriod === 'week' ? 'week' : p.refPeriod === 'month' ? 'month' : p.refPeriod === 'custom' ? 'custom period' : 'all time'}) via {{ref.leaderboard}}.`,
        lang
      );
    case 'referral_tournament': {
      const from = (p.refStartsAt || '').slice(0, 10);
      const to = (p.refEndsAt || '').slice(0, 10);
      return L(
        `Турнир «${q(p.refTournamentName, 'без названия')}» (${from || '?'} — ${to || '?'}) по ${p.refMetric === 'revenue' ? 'доходу' : 'приглашениям'}. Призовой фонд: ${q(p.refPrizePool, 'не указан')}, деление ${q(p.refPrizeSplit, '50/30/20')}.`,
        `Tournament “${q(p.refTournamentName, 'untitled')}” (${from || '?'} — ${to || '?'}) by ${p.refMetric === 'revenue' ? 'revenue' : 'invites'}. Prize pool: ${q(p.refPrizePool, 'none')}, split ${q(p.refPrizeSplit, '50/30/20')}.`,
        lang
      );
    }
    case 'referral_verification': {
      const gate =
        p.refGate === 'paid_once'
          ? L('любой оплаты', 'any payment', lang)
          : p.refGate === 'paid_min_amount'
          ? L(`оплаты от ${p.refMinAmount ?? 0}`, `a payment over ${p.refMinAmount ?? 0}`, lang)
          : p.refGate === 'custom_goal'
          ? L(`достижения цели {{${q(p.refGoalVar, 'goal')}}}`, `reaching the goal {{${q(p.refGoalVar, 'goal')}}}`, lang)
          : L('подписки', 'a subscription', lang);
      return L(
        `Засчитывает реферала только после ${gate}. Результат — {{ref.verified}} (1/0); неподтверждённые не дают бонусов.`,
        `Counts the referee only after ${gate}. The result is {{ref.verified}} (1/0); unverified ones grant no bonuses.`,
        lang
      );
    }
    case 'antifraud': {
      const bits: string[] = [];
      if (p.refOnePerUser !== false) bits.push(L('один бонус на приглашённого', 'one bonus per referee', lang));
      if (p.refBlockSelf !== false) bits.push(L('без самоприглашения', 'no self-invites', lang));
      if (Number(p.refCooldownSec) > 0) bits.push(L(`пауза ${p.refCooldownSec}с между бонусами`, `${p.refCooldownSec}s cooldown between bonuses`, lang));
      if (Number(p.refMinAgeDays) > 0) bits.push(L(`аккаунт не младше ${p.refMinAgeDays} дн.`, `account at least ${p.refMinAgeDays} days old`, lang));
      return L(
        `Правила выдачи бонусов этого бота: ${bits.join('; ') || 'ограничений нет'}. Применяются ко всем блокам наград.`,
        `Bonus rules of this bot: ${bits.join('; ') || 'no limits'}. Applied to every reward block.`,
        lang
      );
    }
    // --- набор 2026-09 ---
    // TODO(prompt-2): full UI
    case 'poll': // TODO(prompt-2): full UI
      return L(
        `Показывает опрос «${q(p.question, '?')}» и ждёт ответа: ветка «ответил» продолжает сценарий, «пропустил» — нет. Ответ попадает в {{poll.answer}}.`,
        `Shows the poll “${q(p.question, '?')}” and waits for an answer: “answered” continues the flow, “skipped” does not. The answer lands in {{poll.answer}}.`,
        lang
      );
    case 'forward': { // TODO(prompt-2): full UI
      const mode = p.forwardMode || 'forward';
      const ru = mode === 'copy' ? 'Копирует' : mode === 'text' ? 'Отправляет своим текстом' : 'Пересылает';
      const en = mode === 'copy' ? 'Copies' : mode === 'text' ? 'Sends as own text' : 'Forwards';
      return L(
        `${ru} сообщение в ${q(p.toChatId, 'чат пользователя')}: «переслано» / «не удалось».`,
        `${en} the message to ${q(p.toChatId, 'the user’s chat')}: “forwarded” / “failed”.`,
        lang
      );
    }
    case 'chat_action': // TODO(prompt-2): full UI
      return L(
        `Показывает «печатает…» (индикатор ${q(p.chatAction, 'typing')}) и сразу идёт дальше — ничего не ждёт.`,
        `Shows a “typing…” indicator (${q(p.chatAction, 'typing')}) and continues right away — waits for nothing.`,
        lang
      );
    case 'web_app':
      return L(
        `Отправляет сообщение «${q(p.text, '')}» с кнопкой «${q(p.button, 'Открыть')}», которая открывает Mini App по ссылке ${q(p.url, 'https://t.me/<bot>/<slug>')}.`,
        `Sends the message “${q(p.text, '')}” with a “${q(p.button, 'Open')}” button that launches the Mini App at ${q(p.url, 'https://t.me/<bot>/<slug>')}.`,
        lang
      );
    case 'wait': // TODO(prompt-2): full UI
      return L(
        `Ждёт ответ пользователя ${p.seconds ?? 60} сек: ответит — ветка «ответил», промолчит — «таймаут».`,
        `Waits ${p.seconds ?? 60}s for the user’s reply: a reply takes “replied”, silence takes “timeout”.`,
        lang
      );
    case 'channel_check': // TODO(prompt-2): full UI
      return L(
        `Проверяет подписку на ${q(p.channelId, 'канал')}: «состоит», «не состоит» или «ошибка» (бот не админ канала).`,
        `Checks membership in ${q(p.channelId, 'the channel')}: “member”, “not a member”, or “error” (bot is not a channel admin).`,
        lang
      );
    case 'segment_broadcast': // TODO(prompt-2): full UI
      return L(
        `Ставит в очередь рассылку сегменту${p.segmentTag ? ` с тегом «${p.segmentTag}»` : ''}: «в очереди» или «пусто».`,
        `Queues a broadcast to a segment${p.segmentTag ? ` tagged “${p.segmentTag}”` : ''}: “queued” or “empty”.`,
        lang
      );
    case 'user_stats': // TODO(prompt-2): full UI
      return L(
        `Выставляет данные пользователя переменными {{${q(p.outPrefix, 'user')}.*}}${p.template ? ' и отправляет сообщение по шаблону' : ''}, затем идёт дальше.`,
        `Exposes the user’s data as {{${q(p.outPrefix, 'user')}.*}} variables${p.template ? ' and sends a templated message' : ''}, then continues.`,
        lang
      );
    case 'payment_link': // TODO(prompt-2): full UI
      return L(
        `Создаёт заказ на ${p.amount ?? '?'} ${q(p.currency, 'RUB')} и кладёт ссылку в {{${q(p.linkVar, 'pay.link')}}}: «создано» / «не удалось».`,
        `Creates an order for ${p.amount ?? '?'} ${q(p.currency, 'RUB')} and puts the link into {{${q(p.linkVar, 'pay.link')}}}: “created” / “failed”.`,
        lang
      );
    case 'payment_check': // TODO(prompt-2): full UI
      return L(
        `Проверяет оплату заказа {{${q(p.orderIdVar, 'pay.order')}}}: «оплачено», «ждём оплату» или «не удалось».`,
        `Checks the payment of order {{${q(p.orderIdVar, 'pay.order')}}}: “paid”, “awaiting payment”, or “failed”.`,
        lang
      );
    case 'foreach': // TODO(prompt-2): full UI
      return L(
        `Перебирает список из {{${q(p.listVar, '?')}}}: каждый элемент кладёт в {{${q(p.itemVar, 'item')}}} и идёт по ветке «итерация»; когда элементы кончились — «список закончился».`,
        `Iterates the list from {{${q(p.listVar, '?')}}}: puts each item into {{${q(p.itemVar, 'item')}}} and takes the “each item” branch; when the list ends — “list finished”.`,
        lang
      );
    case 'random_text': // TODO(prompt-2): full UI
      return L(
        `Выбирает один из ${(p.variants || []).length} вариантов текста по весам и ${p.send === false ? `кладёт его в {{${q(p.outVar, 'переменную')}}}` : 'отправляет пользователю'}.`,
        `Picks one of ${(p.variants || []).length} weighted text variants and ${p.send === false ? `stores it in {{${q(p.outVar, 'a variable')}}}` : 'sends it to the user'}.`,
        lang
      );
    case 'assert': // TODO(prompt-2): full UI
      return L(
        `Проверяет условие (${q(p.condVar, '?')} ${p.op ?? '=='} ${p.condValue ?? ''}): «прошло» / «не прошло»; при провале отправляет «${q(p.failMessage, 'сообщение по умолчанию')}».`,
        `Checks the condition (${q(p.condVar, '?')} ${p.op ?? '=='} ${p.condValue ?? ''}): “passed” / “failed”; on failure sends “${q(p.failMessage, 'the default message')}”.`,
        lang
      );
    case 'counter': { // TODO(prompt-2): full UI
      const global = p.counterScope === 'bot';
      const ruVerb = p.counterOp === 'dec' ? 'Уменьшает' : p.counterOp === 'reset' ? 'Сбрасывает' : p.counterOp === 'get' ? 'Читает' : 'Увеличивает';
      const enVerb = p.counterOp === 'dec' ? 'Decrements' : p.counterOp === 'reset' ? 'Resets' : p.counterOp === 'get' ? 'Reads' : 'Increments';
      return L(
        `${ruVerb} счётчик «${q(p.counterName, '?')}» (${global ? 'общий' : 'на пользователя'}), значение кладёт в {{${q(p.outVar, 'counter')}}}${p.counterMax ? `; достигнет ${p.counterMax} — ветка «лимит достигнут»` : ''}.`,
        `${enVerb} the counter “${q(p.counterName, '?')}” (${global ? 'global' : 'per user'}), stores the value in {{${q(p.outVar, 'counter')}}}${p.counterMax ? `; at ${p.counterMax} it takes the “limit reached” branch` : ''}.`,
        lang
      );
    }
    case 'subflow':
      return L(
        `Вызывает подсценарий «${q(p.alias || p.subflowId, '?')}»${p.subflowRevision != null ? ` (ревизия ${p.subflowRevision})` : ''}: фрагмент целиком выполняется здесь, затем ветка «выполнен»; сбой раскрытия — ветка «сбой». При публикации фрагмент разворачивается в обычные блоки.`,
        `Calls the subflow “${q(p.alias || p.subflowId, '?')}”${p.subflowRevision != null ? ` (revision ${p.subflowRevision})` : ''}: the whole fragment runs here, then the “done” branch; an expansion failure takes “failed”. At publish time the fragment is compiled into plain blocks.`,
        lang
      );
    case 'subflow_return':
      return L(
        `Возврат из фрагмента: управление уходит обратно в вызывающий бот (ветка «выполнен» блока подсценария).${Object.keys(p.outputs || {}).length ? ` Выходы копируются в переменные бота.` : ''}`,
        `Return from the fragment: control goes back to the calling bot (the “done” branch of the subflow block).${Object.keys(p.outputs || {}).length ? ` Outputs are copied into the bot’s variables.` : ''}`,
        lang
      );
    // --- набор 2026-10 ---
    case 'edit_message':
      return L(
        `Правит ${q(p.msgRefVar, '{{__bot_msg}}')} на месте: новый текст «${q(p.editText, '')}»${(p.editButtons || []).length ? ' и новая клавиатура' : ''}. Ветки: «исправлено», «слишком старое» (старше ~48 часов), «не найдено».`,
        `Edits ${q(p.msgRefVar, '{{__bot_msg}}')} in place: new text “${q(p.editText, '')}”${(p.editButtons || []).length ? ' and a new keyboard' : ''}. Branches: “edited”, “too old” (older than ~48 hours), “not found”.`,
        lang
      );
    case 'delete_message':
      return L(
        `Удаляет сообщение ${q(p.msgRefVar, '{{__bot_msg}}')} и идёт дальше без веток: ошибки глотаются — удаление косметика, не логика.`,
        `Deletes the message ${q(p.msgRefVar, '{{__bot_msg}}')} and continues with no branches: errors are swallowed — deletion is cosmetic, not logic.`,
        lang
      );
    case 'quiz':
      return L(
        `Задаёт вопрос «${q(p.question, '?')}» с ${(p.pollOptions || []).length} вариантами и одним правильным: ответивший верно идёт в ветку «сдал», остальные — в «не сдал»${p.quizFailText ? ' с пояснением' : ''}.`,
        `Asks “${q(p.question, '?')}” with ${(p.pollOptions || []).length} options and one correct answer: a correct reply takes the “passed” branch, the rest take “failed”${p.quizFailText ? ' with an explanation' : ''}.`,
        lang
      );
    case 'language': {
      const codes = (p.langCodes || []).join(', ') || '—';
      return L(
        `Разводит сценарий по языку клиента: ветки ${codes}, всё остальное — в «остальные». Код языка лежит в {{user.lang}}.`,
        `Splits the flow by the client’s language: branches ${codes}, everything else takes “others”. The language code is in {{user.lang}}.`,
        lang
      );
    }
    case 'timer_deadline':
      return L(
        `Ставит срок ${p.deadlineVar ? `{{${p.deadlineVar}}}` : q(p.deadlineAt, '?')}: наступил — ветка «срок вышла»${p.deadlineText ? ` с текстом «${p.deadlineText}»` : ''}, а ${q(p.cancelVar, 'переменная отмены')} раньше срока гасит дедлайн в «успел». Работает фоном, даже когда пользователь молчит.`,
        `Sets a deadline ${p.deadlineVar ? `{{${p.deadlineVar}}}` : q(p.deadlineAt, '?')}: when it passes, the “expired” branch fires${p.deadlineText ? ` with the text “${p.deadlineText}”` : ''}; setting ${q(p.cancelVar, 'the cancel variable')} earlier cancels it into “in time”. Runs in the background even when the user is silent.`,
        lang
      );
    case 'ai_classify': {
      const labels = (p.classifyLabels || []).join(', ') || '—';
      return L(
        `ИИ выбирает одну метку из ${labels} для ${q(p.classifyInput, 'последнего сообщения пользователя')} и ведёт поток по её ветке; неразобранный ответ — в «${q(p.classifyFallbackLabel, 'other')}». Метка кладётся в {{${q(p.classifyOutVar, 'ai.label')}}}.`,
        `The AI picks one of the labels ${labels} for ${q(p.classifyInput, 'the user’s last message')} and routes the flow by its branch; an unparsed answer goes to “${q(p.classifyFallbackLabel, 'other')}”. The label lands in {{${q(p.classifyOutVar, 'ai.label')}}}.`,
        lang
      );
    }
    case 'webhook_in':
      return L(
        `Регистрирует входящий вебхук: публикация создаёт адрес, по которому внешняя система шлёт события${(p.webhookFields || []).length ? `; поля ${(p.webhookFields || []).join(', ')} ложатся в wh.<имя>` : '; всё тело ложится в {{wh.body}}'}. С каждого события сценарий стартует по потоку запуска от этого блока.`,
        `Registers an incoming webhook: publishing creates a URL the external system posts events to${(p.webhookFields || []).length ? `; fields ${(p.webhookFields || []).join(', ')} land in wh.<name>` : '; the whole body lands in {{wh.body}}'}. Every event starts the scenario via the launch flow from this block.`,
        lang
      );
    case 'location':
      return L(
        `Просит геопозицию кнопкой «${q(p.locationButtonLabel, 'Отправить местоположение')}»${p.locationPrompt ? ` с текстом «${p.locationPrompt}»` : ''}: координаты ложатся в {{user.lat}} и {{user.lon}}, ветка «прислал гео»; отказ — ветка «отказался».`,
        `Asks for geolocation with a “${q(p.locationButtonLabel, 'Share location')}” button${p.locationPrompt ? ` and the text “${p.locationPrompt}”` : ''}: coordinates land in {{user.lat}} and {{user.lon}}, “sent location” branch; a refusal takes “declined”.`,
        lang
      );
    default:
      return '';
  }
}

// Цепочка описаний от блока по связям вперёд.
export function explainBranch(sc: Scenario, startId: string, lang: Lang): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let id: string | null = startId;
  let guard = 0;

  while (id && guard++ < 40) {
    if (seen.has(id)) {
      out.push(L('…и дальше по кругу (цикл).', '…and then it loops back.', lang));
      break;
    }
    seen.add(id);
    const b: Block | undefined = sc.blocks[id];
    if (!b) break;
    const text = describeBlock(b, lang);
    if (text) out.push(text);
    if (b.type === 'end') break;

    const branchTargets = Object.values(b.branches ?? {}).filter(Boolean) as string[];
    if (usesBranches(b.type) && branchTargets.length) {
      if (branchTargets.length > 1) {
        out.push(
          L(
            `Дальше развилка: ещё ${branchTargets.length - 1} ветв(и/ей) помимо первой.`,
            `Then it splits: ${branchTargets.length - 1} more branch(es) besides the first one.`,
            lang
          )
        );
      }
      id = branchTargets[0];
      continue;
    }
    id = b.type === 'goto' ? b.params.target || null : b.next || null;
  }

  if (!out.length) out.push(L('У блока нет продолжения.', 'This block has no continuation.', lang));
  return out;
}
