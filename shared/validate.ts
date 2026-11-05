// Валидация сценария перед保存/публикацией.
// Один и тот же код работает и на фронте (мгновенная проверка в редакторе),
// и в воркере (жёсткий стоп перед тем, как трогать Telegram).
import { Scenario, Block, BlockParams, BlockType, ConditionDef, usesBranches, normalizeTag, staticInterpolate, hasDangerousRepetition } from './types';
import { reachableFrom, findCycles, breaksInstantLoop, foreachBodySize } from './graph';
import { scheduleToCron, parseCronExpr } from './cron';
import {
  HARD_LOOP_CAP,
  foreachPassCapacity,
  MAX_SCHEDULES_PER_BOT,
  MIN_SCHEDULE_INTERVAL_MIN,
} from './limits';
import { htmlTagProblem } from './markup';
import { unknownFunctionNames, hasMalformedCall } from './expr';
import { expandSubflows, type SubflowLibrary } from './subflow';
import { DEFAULT_PLATFORM, blockSupportedOn, VK_UNSUPPORTED_MEDIA_TYPES, type Platform } from './platform';
import {
  TG_CALLBACK_DATA_BYTES,
  TG_INVOICE_TITLE_MAX,
  TG_INVOICE_DESC_MAX,
  TG_CB_TOAST_MAX,
  TG_POLL_QUESTION_MAX,
  TG_POLL_OPTION_MAX,
  MAX_POLL_OPTIONS,
  MAX_MEDIA_ITEMS,
  TG_MESSAGE_TEXT_MAX,
  TG_CAPTION_MAX,
  utf8Length,
} from './limits';

export type IssueLevel = 'error' | 'warn';

// Все известные типы блоков (зеркало union BlockType из types.ts; типизация
// BlockType[] не даст списку разойтись опечаткой). Проверка ловит сценарий,
// собранный более новой версией платформы или повреждённый JSON: без неё
// switch в checkBlock и в движке молча пропускает блок.
export const BLOCK_TYPES: BlockType[] = [
  'start', 'message', 'buttons', 'input', 'condition', 'action', 'goto', 'end',
  'media', 'subscription', 'menu', 'command', 'keyword', 'setvar', 'http', 'ai',
  'random', 'switch', 'contact', 'note', 'referral', 'media_group', 'invoice',
  'data', 'tag', 'chain', 'referral_track', 'referral_check', 'referral_bonus',
  'referral_stats', 'referral_leaderboard', 'referral_hierarchy',
  'referral_tournament', 'referral_verification', 'antifraud', 'poll', 'forward',
  'chat_action', 'wait', 'channel_check', 'segment_broadcast', 'user_stats',
  'payment_link', 'payment_check', 'foreach', 'random_text', 'assert', 'counter',
  'web_app', 'schedule', 'subflow', 'subflow_return',
  'edit_message', 'delete_message', 'quiz', 'language', 'timer_deadline',
  'ai_classify', 'webhook_in', 'location',
];

// Типы блоков, которые паркуют сессию до следующего апдейта пользователя, но
// которых пока нет в WAIT_TYPES (shared/graph.ts). Движок (engine.ts) после них
// возвращает управление и ждёт poll_answer (quiz) или сообщение с гео
// (location) — цикл через такой блок диалоговый, а не мгновенный. F-020:
// tight-loop стал ошибкой, поэтому список «ждущих» блоков обязан быть полным.
const PARK_UNTIL_UPDATE_TYPES: BlockType[] = ['quiz', 'location'];

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  hint?: string;
  blockId?: string;
  // Вторичный указатель на блок внутри фрагмента (проблемы раскрытия
  // подсценариев): UI может предложить «открыть фрагмент на этом блоке».
  fragmentBlockId?: string;
}

// Необязательный контекст валидации:
// - subflows: библиотека подсценариев ВЛАДЕЛЬЦА (воркер грузит только свои —
//   чужая ссылка тогда автоматически становится subflow-missing);
// - isFragment: валидируется сам фрагмент библиотеки (subflow_return легален).
export interface ValidateOptions {
  subflows?: SubflowLibrary;
  isFragment?: boolean;
  // Платформа бота: Telegram (по умолчанию) поддерживает все блоки; для VK
  // Telegram-only блоки становятся ошибкой — publish обязан их не пропускать.
  platform?: Platform;
}

// Поля-шаблоны, к которым применяется parseMode: их текст уходит в Telegram
// как разметка. Список явный — так новая проверка не «поймает» случайное поле.
const MARKUP_TEXT_FIELDS: (keyof BlockParams)[] = [
  'text',
  'prompt',
  'caption',
  'menuPrompt',
  'question',
  'explanation',
  'template',
  'forwardText',
  'segmentText',
  'notifyText',
  'broadcastText',
  'refText',
  'refBonusText',
  'failMessage',
  'errorText',
];

// Проверка разметки: parseMode 'none'/отсутствие — ничего не проверяем (текст
// уйдёт как plain). Для HTML предупреждаем о несбалансированных тегах, для
// MarkdownV2 — только о «треугольных» символах, которые ломают отправку.
function checkMarkup(
  p: BlockParams,
  type: string,
  add: (level: IssueLevel, code: string, message: string, hint?: string) => void
): void {
  const mode = p.parseMode;
  if (!mode || mode === 'none') return;
  for (const field of MARKUP_TEXT_FIELDS) {
    const raw = p[field];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (mode === 'HTML') {
      const problem = htmlTagProblem(raw);
      if (problem) {
        add(
          'warn',
          'markup-tags',
          `Разметка HTML: ${problem}`,
          `Telegram отклонит сообщение блока «${type}» целиком. Проверьте теги в поле ${String(field)}.`
        );
      }
    }
  }
}

// F-026 (аудит 18.10.2026): длина СТАТИЧЕСКОГО текста Telegram. Литерал без
// {{…}} длиннее лимита — гарантированный 400 на отправке: сообщение теряется
// целиком, а сценарий идёт дальше как ни в чём не бывало. Динамические значения
// (с интерполяцией) статически не проверяем: итоговая длина зависит от данных,
// а 400 от Telegram по длине движок логирует с причиной (engine/index: send.error).
function checkStaticLength(
  raw: unknown,
  limit: number,
  what: string,
  code: string,
  add: (level: IssueLevel, code: string, message: string, hint?: string) => void
): void {
  if (typeof raw !== 'string' || !raw) return;
  if (raw.includes('{{')) return; // динамический шаблон — длину заранее не узнать
  if (raw.length <= limit) return;
  add(
    'error',
    code,
    `${what} длиннее ${limit} символов (${raw.length})`,
    `Telegram отклонит сообщение целиком, и пользователь ничего не получит. Сократите текст до ${limit} символов или разбейте на несколько блоков.`
  );
}

// Проверка выражений: неизвестная функция или битый вызов — ошибка до публикации.
// Раньше опечатка молча уходила в Telegram как обычный текст, и автор искал
// причину «бот присылает странное».
function checkExpressions(
  p: BlockParams,
  add: (level: IssueLevel, code: string, message: string, hint?: string) => void
): void {
  const fields: (keyof BlockParams)[] = ['expr', 'assignVar'];
  for (const field of fields) {
    const raw = p[field];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (field === 'assignVar') continue; // имя переменной — не выражение
    const unknown = unknownFunctionNames(raw);
    if (unknown.length) {
      add(
        'error',
        'expr-unknown-fn',
        `Неизвестная функция: ${unknown.join(', ')}`,
        EXPR_HINT
      );
    }
    if (hasMalformedCall(raw)) {
      add('error', 'expr-malformed', 'В выражении не закрыта скобка вызова функции', 'Проверьте скобки в поле «Выражение».');
    }
  }
}

// Проверка текста уведомления кнопки (cbToast/cbAlert → answerCallbackQuery):
// общие параметры любых блоков, как parseMode. Telegram показывает максимум
// ~200 символов — лишнее молча теряется, поэтому предупреждаем до публикации.
function checkCallbackText(
  p: BlockParams,
  add: (level: IssueLevel, code: string, message: string, hint?: string) => void
): void {
  const fields: [keyof BlockParams, string][] = [
    ['cbToast', 'Уведомление (toast)'],
    ['cbAlert', 'Уведомление (alert)'],
  ];
  for (const [field, name] of fields) {
    const raw = p[field];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (utf8Length(staticInterpolate(raw)) > TG_CB_TOAST_MAX) {
      add(
        'warn',
        'cbt-toast-long',
        `${name} длиннее ${TG_CB_TOAST_MAX} символов`,
        `Telegram покажет только первые ~${TG_CB_TOAST_MAX} символов, остальное потеряется.`
      );
    }
  }
}

// Операторы, осмысленные для тега: тег — это факт «есть/нет».
const TAG_FRIENDLY_OPS = ['==', '!=', 'empty', 'not_empty'];

// Текст подсказки про доступные функции — один на все места, чтобы формулировка
// не разъезжалась.
const EXPR_HINT =
  'Доступно: len, upper, lower, trim, substr, replace, concat, default, now, today, format_date, random, round, floor, ceil.';

// Проверка одного условия из списка conditions[]: пустая переменная, отсутствие
// оператора, битый регексп.
function checkConditionDef(
  c: ConditionDef,
  index: number,
  add: (level: IssueLevel, code: string, message: string, hint?: string) => void
): void {
  const label = `Условие ${index + 1}`;
  if (!String(c.var ?? '').trim()) {
    add('error', 'cond-var', `${label}: не указана переменная`, c.source === 'tag' ? 'Например: vip.' : undefined);
  }
  if (!c.op) add('error', 'cond-op', `${label}: не выбран оператор сравнения`);
  if (c.source === 'tag' && c.op && !TAG_FRIENDLY_OPS.includes(c.op)) {
    add('warn', 'cond-tag-op', `${label}: для тега работают только «равно», «не равно», «пусто», «не пусто»`, 'Другие операторы будут считаться ложью.');
  }
  if (c.op === 'regex' && String(c.value ?? '')) {
    try {
      new RegExp(String(c.value));
    } catch {
      add('error', 'cond-regex', `${label}: недопустимое регулярное выражение`, 'Некорректная регулярка всегда считается ложью.');
    }
    // F-023: паттерн с катастрофическим бэктрекингом — ошибка, а не «всегда
    // ложь»: RegExp.test в Workers синхронный и не прерывается, поэтому
    // короткий вход пользователя мог бы заблокировать изолят на минуты.
    if (hasDangerousRepetition(String(c.value)))
      add(
        'error',
        'cond-regex-danger',
        `${label}: регулярное выражение может заблокировать бота`,
        'Паттерн вида (a+)+ или (a|ab)+ приводит к катастрофическому перебору на некоторых ответах пользователя. Упростите выражение.'
      );
  }
}

// Общая проверка параметров условия — одна для condition, assert и фильтра
// сегментной рассылки (segment_broadcast.segmentWhere).
function checkConditionParams(
  p: BlockParams,
  add: (level: IssueLevel, code: string, message: string, hint?: string) => void
): void {
  const list = p.conditions;
  // Явно пустой массив — ошибка, а не «ничего не проверять»: автор удалил все
  // условия и, скорее всего, не заметил, что блок стал всегда-истинным.
  if (Array.isArray(list) && list.length === 0) {
    add('error', 'cond-conditions', 'Список условий пуст', 'Добавьте условие или очистите список целиком, чтобы вернуться к одиночному условию.');
    return;
  }
  if (Array.isArray(list) && list.length) {
    list.forEach((c, i) => checkConditionDef(c, i, add));
    return;
  }
  // Легаси-путь: одиночное условие.
  if (!p.condVar) {
    add(
      'error',
      'cond-var',
      p.condSource === 'tag' ? 'Не указан тег для проверки' : 'Не указана переменная для проверки',
      p.condSource === 'tag' ? 'Например: vip.' : undefined
    );
  }
  if (!p.op) add('error', 'cond-op', 'Не выбран оператор сравнения');
  if (p.condSource === 'tag' && p.op && !TAG_FRIENDLY_OPS.includes(p.op))
    add('warn', 'cond-tag-op', 'Для тега работают только «равно», «не равно», «пусто», «не пусто»', 'Другие операторы будут считаться ложью.');
  if (p.op === 'regex' && String(p.condValue ?? '')) {
    try {
      new RegExp(String(p.condValue));
    } catch {
      add('error', 'cond-regex', 'Недопустимое регулярное выражение', 'Некорректная регулярка всегда считается ложью.');
    }
    if (hasDangerousRepetition(String(p.condValue)))
      add(
        'error',
        'cond-regex-danger',
        'Регулярное выражение может заблокировать бота',
        'Паттерн вида (a+)+ или (a|ab)+ приводит к катастрофическому перебору на некоторых ответах пользователя. Упростите выражение.'
      );
  }
}


function checkBlock(
  b: Block,
  issue: (level: IssueLevel, code: string, message: string, hint?: string) => void,
  sc?: Scenario
) {
  const p = b.params;
  const add = (level: IssueLevel, code: string, message: string, hint?: string) =>
    issue(level, code, message, hint);

  // Разметка и выражения проверяются у ВСЕХ блоков, а не внутри switch: ошибку
  // в шаблоне лучше увидеть до публикации, где бы этот шаблон ни лежал.
  checkMarkup(p, b.type, add);
  checkExpressions(p, add);
  checkCallbackText(p, add);

  switch (b.type) {
    case 'start':
      if (!p.command || !p.command.startsWith('/')) add('error', 'start-cmd', 'У точки входа нет команды', 'Обычно это /start.');
      break;
    case 'message':
      if (!p.text || !p.text.trim()) add('error', 'msg-empty', 'Пустое сообщение', 'Telegram не отправит пустой текст.');
      // F-026: статический текст длиннее лимита Telegram — гарантированный 400
      // на отправке, сообщение теряется целиком (симулятор Telegram не зовёт и
      // автор не видит проблемы до прода).
      checkStaticLength(p.text, TG_MESSAGE_TEXT_MAX, 'Текст сообщения', 'msg-text-long', add);
      break;
    case 'media':
      if (!p.mediaUrl && !p.fileId)
        add('error', 'media-empty', 'Не указан ни URL, ни file_id', 'Медиа нечего отправлять.');
      checkStaticLength(p.caption, TG_CAPTION_MAX, 'Подпись медиа', 'media-caption-long', add);
      break;
    case 'buttons':
    case 'menu': {
      const list = p.buttons || [];
      if (!list.length) add('error', 'btn-none', 'Нет ни одной кнопки');
      list.forEach((btn, i) => {
        if (!btn.label || !btn.label.trim())
          add('error', 'btn-label', `Кнопка ${i + 1} без подписи`, 'Пустая подпись — бот упадёт с ошибкой.');
        if (!btn.url && !btn.value)
          add('error', 'btn-value', `У кнопки «${btn.label || i + 1}» нет значения`, 'Значение — это ключ ветки.');
        // Значение кнопки уходит в callback_data: жёсткие 64 байта Telegram.
        // Превышение — не «обрежется», а отклонённое сообщение целиком, поэтому
        // ошибка. Reply-кнопки и url-кнопки callback_data не используют.
        // Шаблон {{var}} проверяем дважды: как есть и после staticInterpolate.
        if (btn.value && !btn.url && p.layout !== 'reply') {
          const interpolated = staticInterpolate(btn.value);
          if (utf8Length(btn.value) > TG_CALLBACK_DATA_BYTES || utf8Length(interpolated) > TG_CALLBACK_DATA_BYTES)
            add(
              'error',
              'btn-value-long',
              `Кнопка «${btn.label || i + 1}»: значение длиннее ${TG_CALLBACK_DATA_BYTES} байт`,
              'Telegram отклонит сообщение целиком. Сократите значение — оно служит ключом ветки.'
            );
        }
        // Непроведённая ветка кнопки — обрыв сценария: пользователь нажмёт
        // кнопку и бот замолчит. Раньше это было лишь предупреждением.
        if (!btn.url && !b.branches?.[btn.value])
          add(
            'error',
            'btn-branch',
            `У кнопки «${btn.label || i + 1}» нет перехода`,
            'Протяните стрелку от порта кнопки на холсте.'
          );
      });
      break;
    }
    case 'input': {
      if (!p.var) add('error', 'input-var', 'Не указана переменная', 'Куда сохранить ответ пользователя?');
      if (!p.prompt || !p.prompt.trim()) add('warn', 'input-prompt', 'Нет подсказки для пользователя');
      if (p.regex) {
        try {
          new RegExp(p.regex);
        } catch {
          add('error', 'input-regex', 'invalid regular expression', 'Исправьте регулярное выражение в настройках блока.');
        }
        // F-023: катастрофический паттерн — ошибка до публикации (см. cond-regex-danger).
        if (hasDangerousRepetition(String(p.regex)))
          add(
            'error',
            'input-regex-danger',
            'Регулярное выражение может заблокировать бота',
            'Паттерн вида (a+)+ или (a|ab)+ приводит к катастрофическому перебору на некоторых ответах пользователя. Упростите выражение.'
          );
      }
      break;
    }
    case 'contact':
      if (!p.var) add('warn', 'contact-var', 'Не указана переменная', 'По умолчанию подойдёт phone.');
      break;
    case 'condition':
      // Условие умеет смотреть не только на переменную, но и на тег (F2):
      // «стоит ли на человеке метка VIP». Ветки в обоих случаях те же.
      checkConditionParams(p, add);
      // Обе ветки обязательны: без «нет» пользователь, не подошедший под
      // условие, упрётся в тишину.
      if (!b.branches?.then) add('error', 'cond-then', 'Не заполнена ветка «да»', 'Протяните стрелку от порта «да».');
      if (!b.branches?.else) add('error', 'cond-else', 'Не заполнена ветка «нет»', 'Протяните стрелку от порта «нет».');
      break;
    case 'switch':
      if (!p.switchVar) add('error', 'switch-var', 'Не указана переменная');
      if (!(p.cases || []).length) add('warn', 'switch-cases', 'Нет ни одного варианта');
      (p.cases || []).forEach((c, i) => {
        if (!c.value) add('warn', 'switch-case', `Вариант ${i + 1} без значения`);
        if (!b.branches?.[`c${i}`])
          add('error', 'switch-branch', `Вариант «${c.value || i + 1}» никуда не ведёт`, 'Протяните стрелку от его порта.');
      });
      break;
    case 'keyword':
      if (!p.keywords || !p.keywords.trim())
        add('error', 'kw-empty', 'Не перечислены ключевые слова', 'Например: цена, сколько стоит, прайс.');
      // Молчание — законный сценарий: бот может реагировать только на совпадение.
      // Поэтому пустая ветка здесь предупреждение, а не ошибка.
      if (!b.branches?.hit) add('warn', 'kw-hit', 'Не заполнена ветка «есть совпадение»');
      if (!b.branches?.miss)
        add('warn', 'kw-miss', 'Нет ветки «нет совпадения»', 'Бот промолчит на любой другой текст.');
      break;
    case 'random': {
      const opts = p.options || [];
      if (!opts.length) add('error', 'rnd-none', 'Нет ни одной ветки');
      opts.forEach((o) => {
        if (!o.key) add('error', 'rnd-key', 'Ветка без ключа');
        else if (!b.branches?.[o.key]) add('warn', 'rnd-branch', `Ветка «${o.key}» никуда не ведёт`);
      });
      break;
    }
    case 'setvar':
      if (!p.assignVar) add('error', 'setvar-var', 'Не указана переменная');
      if (!p.expr && p.expr !== '0') add('error', 'setvar-expr', 'Пустое выражение');
      break;
    case 'http':
      if (!p.url || !p.url.trim()) add('error', 'http-url', 'Не указан URL запроса');
      else if (!/^https?:\/\//i.test(p.url)) add('warn', 'http-scheme', 'URL должен начинаться с http:// или https://');
      break;
    case 'ai':
      if (!p.aiPrompt || !p.aiPrompt.trim()) add('error', 'ai-prompt', 'Пустой промпт для ИИ');
      if (!p.aiReply && !p.aiVar)
        add('warn', 'ai-out', 'Ответу некуда деваться', 'Включите «ответить пользователю» или укажите переменную.');
      break;
    case 'action':
      if (p.actionKind === 'webhook' && !p.url)
        add('error', 'act-webhook', 'Не указан URL вебхука');
      if (p.actionKind === 'notify' && !p.notifyText)
        add('warn', 'act-notify', 'Пустой текст уведомления');
      if (p.actionKind === 'delay' && !p.seconds)
        add('warn', 'act-delay', 'Пауза длиной 0 секунд');
      if (p.actionKind === 'broadcast' && !p.broadcastText)
        add('error', 'act-broadcast', 'Пустой текст рассылки');
      break;
    case 'goto':
      if (!p.target) add('error', 'goto-target', 'Не выбран блок назначения');
      else if (p.target === b.id) add('warn', 'goto-self', 'Переход сам в себя');
      break;
    case 'command':
      if (!p.command || !p.command.startsWith('/'))
        add('error', 'cmd-name', 'Команда должна начинаться с /', 'Например /help.');
      break;
    case 'subscription':
      if (!p.subAction) add('error', 'sub-action', 'Не выбрано действие');
      break;
    case 'referral': {
      // Ссылка собирается из @username бота и id пользователя. Единственная
      // настройка — необязательный payload в ?start=ref_<id>_<payload>.
      // Telegram принимает там только [A-Za-z0-9_-] и не более 64 символов;
      // шаблоны {{var}} проверяем по литеральным частям.
      const raw = p.refPayload || '';
      if (raw) {
        const literal = raw.replace(/\{\{[\w.]+\}\}/g, 'x');
        if (!/^[A-Za-z0-9_-]*$/.test(literal))
          add('error', 'ref-payload-chars', 'В payload допустимы только латиница, цифры, - и _', 'Telegram отклонит ссылку с другими символами.');
        else if (literal.length > 48)
          add('warn', 'ref-payload-long', 'Payload длиннее 48 символов', 'Вместе с ref_<id> может не уместиться в лимит Telegram (64).');
      }
      break;
    }
    case 'referral_track':
      // Все три ветки обязательны: без «уже засчитан» повторный вход по чужой
      // ссылке упрётся в тишину, а без «сам себя» — в ложное начисление.
      if (!b.branches?.ok) add('error', 'reft-ok', 'Не заполнена ветка «засчитан»', 'Протяните стрелку от порта «засчитан».');
      if (!b.branches?.already_tracked)
        add('error', 'reft-already', 'Не заполнена ветка «уже засчитан»', 'Протяните стрелку от порта «уже засчитан».');
      if (!b.branches?.self_referral_blocked)
        add('error', 'reft-self', 'Не заполнена ветка «сам себя пригласил»', 'Протяните стрелку от порта «сам себя пригласил».');
      break;
    case 'referral_check':
      if (!b.branches?.yes) add('error', 'refc-yes', 'Не заполнена ветка «да»', 'Протяните стрелку от порта «да».');
      if (!b.branches?.no) add('error', 'refc-no', 'Не заполнена ветка «нет»', 'Протяните стрелку от порта «нет».');
      break;
    case 'referral_bonus':
    case 'referral_hierarchy': {
      const isHier = b.type === 'referral_hierarchy';
      const trigger = p.refTrigger || 'nth_referral';
      if (trigger === 'nth_referral') {
        const n = Number(p.refTriggerN);
        if (!Number.isFinite(n) || n < 1)
          add('error', 'refb-n', 'Укажите, какой по счёту реферал запускает бонус', 'Например: 5 — награда за пятого приглашённого.');
      }
      if (trigger === 'custom_event' && !(p.refEventName || '').trim())
        add('error', 'refb-event', 'Не указано имя события', 'Бонус сработает, когда {{ref.event}} совпадёт с этим именем.');
      if (isHier) {
        // Иерархия: глубина 1–5, доли уровней неотрицательны и в сумме ≤ 1.
        const depth = Number(p.refDepth ?? 1);
        if (!Number.isFinite(depth) || depth < 1 || depth > 5)
          add('error', 'refh-depth', 'Глубина должна быть от 1 до 5', 'Больше пяти уровней не выплачиваем.');
        const shares = p.refShares || [];
        if (shares.length !== Math.max(1, Math.min(5, Math.floor(depth))))
          add('error', 'refh-shares', 'Число долей не совпадает с глубиной', `Нужно долей: ${Math.max(1, Math.min(5, Math.floor(depth)))}.`);
        const sum = shares.reduce((s, x) => s + (Number(x) || 0), 0);
        if (shares.some((x) => !(Number(x) >= 0)))
          add('error', 'refh-negative', 'Доля не может быть отрицательной');
        else if (sum > 1.0001)
          add('error', 'refh-sum', 'Сумма долей больше 1', 'Уменьшите доли: сумма не должна превышать 100%.');
      }
      if (!isHier) {
        const kind = p.refBonusKind || 'send_message';
        if (kind === 'send_message' && !(p.refBonusText || '').trim())
          add('error', 'refb-text', 'Пустой текст награды', 'Что получит пригласивший?');
        if (kind === 'increment_variable') {
          if (!(p.refBonusVar || '').trim()) add('error', 'refb-var', 'Не указана переменная', 'Какую переменную прибавляем?');
          if (!(Number(p.refBonusAmount) > 0)) add('error', 'refb-amount', 'Величина должна быть больше 0');
        }
        if (kind === 'grant_subscription_days' && !(Number(p.refBonusDays) > 0))
          add('error', 'refb-days', 'Не указано число дней подписки', 'Например: 7.');
      }
      if (!b.branches?.granted) add('error', 'refb-granted', 'Не заполнена ветка «выдан»', 'Протяните стрелку от порта «выдан».');
      if (!b.branches?.skipped) add('error', 'refb-skipped', 'Не заполнена ветка «пропущен»', 'Протяните стрелку от порта «пропущен».');
      // «Ошибка» — только предупреждение: это редкий путь (сбой базы).
      if (!b.branches?.failed) add('warn', 'refb-failed', 'Не заполнена ветка «ошибка»', 'Без неё сбой базы пройдёт молча.');
      break;
    }
    case 'referral_stats': {
      const limit = Number(p.refLimit ?? 5);
      if (Number.isFinite(limit) && (limit < 1 || limit > 50))
        add('warn', 'refs-limit', 'Список приглашённых ограничен 1–50', 'Больше 50 строк сообщение не читается.');
      break;
    }
    case 'referral_leaderboard': {
      if (p.refPeriod === 'custom') {
        const from = Date.parse(p.refPeriodFrom || '');
        const to = Date.parse(p.refPeriodTo || '');
        if (Number.isNaN(from) || Number.isNaN(to))
          add('error', 'refl-period', 'Не заполнены границы периода', 'Формат даты: ГГГГ-ММ-ДД.');
        else if (from >= to) add('error', 'refl-period-order', 'Начало периода должно быть раньше конца');
      }
      const limit = Number(p.refLimit ?? 10);
      if (Number.isFinite(limit) && (limit < 1 || limit > 100))
        add('warn', 'refl-limit', 'Топ ограничен 1–100 позициями');
      break;
    }
    case 'referral_tournament': {
      if (!(p.refTournamentName || '').trim()) add('error', 'reft-name', 'Не указано название турнира');
      const starts = Date.parse(p.refStartsAt || '');
      const ends = Date.parse(p.refEndsAt || '');
      if (Number.isNaN(starts) || Number.isNaN(ends))
        add('error', 'reft-dates', 'Не заполнены даты начала и конца', 'Формат: ГГГГ-ММ-ДД.');
      else if (starts >= ends) add('error', 'reft-order', 'Начало турнира должно быть раньше конца');
      if (!b.branches?.joined) add('error', 'reft-joined', 'Не заполнена ветка «участвует»', 'Протяните стрелку от порта «участвует».');
      if (!b.branches?.already_in) add('error', 'reft-already', 'Не заполнена ветка «уже участвует»');
      if (!b.branches?.tournament_not_running)
        add('error', 'reft-notrunning', 'Не заполнена ветка «турнир не идёт»');
      const split = (p.refPrizeSplit || '').trim();
      if (split) {
        const parts = split.split('/').map((s) => Number(s.trim()));
        const sum = parts.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
        if (parts.some((x) => !Number.isFinite(x) || x < 0))
          add('error', 'reft-split', 'Распределение призов — доли через «/»', 'Например: 50/30/20.');
        else if (Math.abs(sum - 100) > 0.01) add('warn', 'reft-split-sum', 'Доли призов в сумме дают не 100%');
      }
      break;
    }
    case 'referral_verification': {
      const gate = p.refGate || 'subscribed';
      if (gate === 'paid_min_amount' && !(Number(p.refMinAmount) > 0))
        add('error', 'refv-amount', 'Укажите минимальную сумму', 'В минимальных единицах валюты: для RUB — копейки.');
      if (gate === 'custom_goal' && !(p.refGoalVar || '').trim())
        add('error', 'refv-goal', 'Не указано имя переменной цели', 'Булева переменная сценария: 1/true — цель достигнута.');
      break;
    }
    case 'antifraud': {
      if (Number(p.refCooldownSec) < 0) add('error', 'refa-cooldown', 'Пауза не может быть отрицательной');
      if (Number(p.refMinAgeDays) < 0) add('error', 'refa-age', 'Возраст аккаунта не может быть отрицательным');
      break;
    }
    case 'media_group': {
      const items = p.mediaItems || [];
      if (items.length < 2)
        add('error', 'mg-min', 'Меньше двух элементов', 'Альбом должен содержать хотя бы 2 медиа.');
      else if (items.length > MAX_MEDIA_ITEMS)
        add('error', 'mg-max', `Больше ${MAX_MEDIA_ITEMS} элементов`, `Telegram принимает не больше ${MAX_MEDIA_ITEMS} медиа в альбоме.`);
      items.forEach((it, i) => {
        if (!it.url && !it.fileId)
          add('error', 'mg-empty', `Элемент ${i + 1} без URL или file_id`, 'Нечего отправлять.');
        if (it.type !== 'photo' && it.type !== 'video')
          add('error', 'mg-type', `Элемент ${i + 1}: неизвестный тип`, 'Поддерживаются только photo и video.');
      });
      break;
    }
    case 'invoice': {
      const inv = p.invoice;
      if (!inv || !inv.title || !inv.title.trim())
        add('error', 'inv-title', 'Не указан заголовок счёта');
      if (!inv || !inv.description || !inv.description.trim())
        add('error', 'inv-desc', 'Нет описания позиции');
      // Движок усекает заголовок и описание счёта при отправке (.slice в
      // engine.ts) — публикацию не блокируем, но автор должен знать заранее.
      if (inv?.title && staticInterpolate(inv.title).length > TG_INVOICE_TITLE_MAX)
        add(
          'warn',
          'invoice-title-long',
          `Заголовок счёта длиннее ${TG_INVOICE_TITLE_MAX} символов`,
          `При отправке значение будет обрезано до ${TG_INVOICE_TITLE_MAX} символов.`
        );
      if (inv?.description && staticInterpolate(inv.description).length > TG_INVOICE_DESC_MAX)
        add(
          'warn',
          'invoice-desc-long',
          `Описание счёта длиннее ${TG_INVOICE_DESC_MAX} символов`,
          `При отправке значение будет обрезано до ${TG_INVOICE_DESC_MAX} символов.`
        );
      if (!inv || inv.amount == null || inv.amount === '' || Number(inv.amount) <= 0)
        add('error', 'inv-amount', 'Сумма должна быть больше 0', 'Для RUB — в копейках.');
      // provider_token можно не заполнять, если выбрано платёжное подключение
      // (набор 2026-09): воркер возьмёт токен из секрета подключения.
      const hasToken = !!inv && !!inv.providerToken && !!inv.providerToken.trim();
      const hasConnection = !!(p.connectionId && String(p.connectionId).trim());
      if (!hasToken && !hasConnection)
        add('error', 'inv-token', 'Не указан provider_token', 'Бот получит его в BotFather → Payments. Или выберите платёжное подключение.');
      if (!b.branches?.paid)
        add('error', 'inv-paid', 'Не заполнена ветка «оплатил»', 'Оплативший пользователь никуда не попадёт.');
      if (!b.branches?.cancelled)
        add('error', 'inv-cancelled', 'Не заполнена ветка «отменил»', 'Отказ от оплаты оставит пользователя без ответа.');
      break;
    }
    case 'data': {
      if (!p.collectionId)
        add('error', 'data-collection', 'Не выбрана таблица', 'Создайте таблицу на вкладке «Данные» и вернитесь к блоку.');
      const op = p.dataOp || 'add';
      const fields = Object.keys(p.dataFields || {}).filter((k) => (p.dataFields || {})[k] !== '');
      const where = Object.keys(p.dataWhere || {}).filter((k) => (p.dataWhere || {})[k] !== '');
      if ((op === 'add' || op === 'update') && !fields.length)
        add('error', 'data-fields', 'Не заполнено ни одного поля', 'Что записать в таблицу?');
      if ((op === 'find' || op === 'update' || op === 'remove') && !where.length)
        add('warn', 'data-where', 'Условие поиска пустое', 'Действие затронет все записи таблицы.');
      if (op === 'find' && !p.outVar)
        add('warn', 'data-outvar', 'Не указана переменная для результата', 'Например: order — тогда {{order.name}} и {{order_count}}.');
      // Ветки нужны только там, где движок по ним идёт: find/update/remove.
      // У «добавить запись» ветвей нет — она просто продолжает сценарий.
      if (op === 'find' || op === 'update' || op === 'remove') {
        if (!b.branches?.found)
          add('error', 'data-found', 'Не заполнена ветка «найдено»', 'Протяните стрелку от порта «найдено».');
        if (!b.branches?.not_found)
          add('error', 'data-notfound', 'Не заполнена ветка «не найдено»', 'Протяните стрелку от порта «не найдено».');
      }
      break;
    }
    case 'tag': {
      const op = p.tagOp || 'add';
      // Пустой тег нечем пометить: normalizeTag отбросил бы его молча, и блок
      // выглядел бы рабочим, ничего не делая.
      if ((op === 'add' || op === 'remove') && !normalizeTag(p.tagName))
        add('error', 'tag-name', 'Не указано имя тега', 'Например: vip или купил.');
      // Список без переменной некуда положить — не роняем, но предупреждаем.
      if (op === 'list' && !p.tagVar) add('warn', 'tag-outvar', 'Не указана переменная для списка', 'По умолчанию: tags.');
      // «Очистить» параметров не требует, а про отсутствие ветки скажет общий
      // dead-end ниже — дублировать проверку не нужно.
      break;
    }
    case 'chain': {
      const items = p.chainItems || [];
      const usable = items.filter((it) => {
        if (!it) return false;
        if (it.kind === 'text') return !!String(it.text ?? '').trim();
        return !!(it.url || it.fileId);
      });
      // Цепочка без единого отправляемого элемента — это блок-пустышка:
      // автор думает, что что-то уходит, а бот молчит.
      if (!usable.length) add('error', 'chain-empty', 'В цепочке нет ни одного сообщения', 'Добавьте текст или медиа.');
      items.forEach((it, i) => {
        if (!it) return;
        if (it.kind === 'text') {
          if (!String(it.text ?? '').trim()) add('warn', 'chain-text', `Элемент ${i + 1}: пустой текст`);
        } else if (!it.url && !it.fileId) {
          add('error', 'chain-media', `Элемент ${i + 1} без URL или file_id`, 'Нечего отправлять.');
        }
      });
      break;
    }

    // ------------------------------------------------------------------
    // набор 2026-09
    // ------------------------------------------------------------------

    case 'poll': {
      if (!String(p.question ?? '').trim()) add('error', 'poll-question', 'Не указан вопрос опроса');
      // F-025: лимиты Telegram sendPoll (вопрос ≤300, вариант ≤100). Превышение —
      // отклонённый запрос целиком: сессия паркуется на опросе, который не пришёл.
      checkStaticLength(p.question, TG_POLL_QUESTION_MAX, 'Вопрос опроса', 'poll-question-long', add);
      const opts = p.pollOptions || [];
      if (opts.length < 2) add('error', 'poll-options', 'У опроса меньше двух вариантов', 'Telegram требует минимум 2 варианта.');
      else if (opts.length > MAX_POLL_OPTIONS) add('error', 'poll-options-max', `У опроса больше ${MAX_POLL_OPTIONS} вариантов`, `Telegram принимает не больше ${MAX_POLL_OPTIONS}.`);
      opts.forEach((o, i) => {
        if (!String(o?.text ?? '').trim()) add('error', 'poll-option-text', `Вариант ${i + 1}: пустой текст`, 'Пустой вариант Telegram отклонит.');
        checkStaticLength(o?.text, TG_POLL_OPTION_MAX, `Вариант опроса ${i + 1}`, 'poll-option-long', add);
      });
      // correctOptionId ссылается на id варианта: без существующего варианта
      // опрос отправится викториной без правильного ответа и будет отклонён.
      const correct = String(p.correctOptionId ?? '').trim();
      if (correct && !opts.some((o) => (o?.id || '') === correct)) {
        add('error', 'poll-correct', 'Правильный вариант не найден среди вариантов', 'Выберите вариант из списка или очистите поле.');
      }
      if (!b.branches?.answered) add('error', 'poll-answered', 'Не заполнена ветка «ответил»', 'Протяните стрелку от порта «ответил».');
      if (!b.branches?.skipped) add('warn', 'poll-skipped', 'Не заполнена ветка «пропустил»', 'Без неё любой другой апдейт пройдёт молча.');
      break;
    }

    case 'forward': {
      const mode = p.forwardMode || 'forward';
      if (mode === 'text' && !String(p.forwardText ?? '').trim())
        add('error', 'fwd-text', 'Пустой текст пересылки', 'В режиме «текст» бот отправляет сообщение из этого поля.');
      if (mode !== 'text' && !String(p.toChatId ?? '').trim() && !String(p.fromVar ?? '').trim())
        add('warn', 'fwd-target', 'Не указан получатель', 'По умолчанию пересылаем самому пользователю.');
      if (!b.branches?.ok) add('error', 'fwd-ok', 'Не заполнена ветка «переслано»', 'Протяните стрелку от порта «переслано».');
      if (!b.branches?.failed) add('warn', 'fwd-failed', 'Не заполнена ветка «не удалось»', 'Без неё сбой пересылки пройдёт молча.');
      break;
    }

    case 'chat_action':
      if (!p.chatAction) add('warn', 'chat-action', 'Не выбран тип действия', 'По умолчанию «печатает».');
      break;

    case 'wait': {
      const seconds = Number(p.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0)
        add('error', 'wait-seconds', 'Не указана длительность ожидания', 'Сколько секунд ждать, прежде чем уйти в ветку «таймаут»?');
      const maxMin = Number(p.maxWaitMinutes);
      if (p.maxWaitMinutes != null && (!Number.isFinite(maxMin) || maxMin < 0))
        add('error', 'wait-max', 'Потолок ожидания не может быть отрицательным');
      // Таймаут без ветки = пользователь, не ответивший вовремя, упрётся в тишину.
      if (!b.branches?.timeout) add('error', 'wait-timeout', 'Не заполнена ветка «таймаут»', 'Протяните стрелку от порта «таймаут».');
      if (!b.branches?.reply) add('warn', 'wait-reply', 'Не заполнена ветка «ответил»', 'Без неё ответ пользователя никуда не приведёт.');
      break;
    }

    case 'channel_check': {
      if (!String(p.channelId ?? '').trim()) add('error', 'chk-id', 'Не указан канал или чат', 'Например: @my_channel или -1001234567890.');
      // getChatMember работает только для бота-администратора канала — это
      // самая частая причина «проверка всегда говорит нет».
      add('warn', 'chk-admin', 'Бот должен быть администратором канала', 'Иначе getChatMember не вернёт статус участника.');
      const cache = Number(p.cacheMinutes ?? 10);
      if (Number.isFinite(cache) && cache < 0) add('error', 'chk-cache', 'Кэш проверки не может быть отрицательным');
      if (!b.branches?.member) add('error', 'chk-member', 'Не заполнена ветка «состоит»', 'Протяните стрелку от порта «состоит».');
      if (!b.branches?.not_member) add('error', 'chk-notmember', 'Не заполнена ветка «не состоит»');
      if (!b.branches?.error) add('warn', 'chk-error', 'Не заполнена ветка «ошибка»', 'Понадобится, если Telegram не ответит.');
      break;
    }

    case 'segment_broadcast': {
      const text = String(p.segmentText ?? '').trim();
      if (!text && !String(p.segmentMediaUrl ?? '').trim())
        add('error', 'seg-content', 'Пустая рассылка', 'Укажите текст или ссылку на медиа.');
      const tag = normalizeTag(staticInterpolate(p.segmentTag || ''));
      const where = (p.segmentWhere || []).filter((c) => c && String(c.var ?? '').trim());
      // Сегмент без фильтра — это «всем»: не ошибка, но автор должен понимать.
      if (!tag && !where.length) add('warn', 'seg-segment', 'Сегмент не задан — рассылка уйдёт всем подписчикам');
      where.forEach((c, i) => checkConditionDef(c, i, add));
      const cap = Number(p.dailyCap);
      if (p.dailyCap != null && (!Number.isFinite(cap) || cap < 0)) add('error', 'seg-cap', 'Дневной лимит не может быть отрицательным');
      const chunk = Number(p.chunkSize);
      if (p.chunkSize != null && (!Number.isFinite(chunk) || chunk < 1)) add('error', 'seg-chunk', 'Размер пачки должен быть больше нуля');
      if (!b.branches?.queued) add('error', 'seg-queued', 'Не заполнена ветка «поставлено в очередь»');
      if (!b.branches?.empty) add('warn', 'seg-empty', 'Не заполнена ветка «пусто»', 'Сегмент может оказаться пустым.');
      break;
    }

    case 'user_stats':
      if (!String(p.template ?? '').trim())
        add('warn', 'usr-template', 'Нет шаблона сообщения', 'Блок только выставит переменные и продолжит сценарий.');
      break;

    case 'payment_link': {
      if (!String(p.connectionId ?? '').trim())
        add('error', 'pay-conn', 'Не выбрано платёжное подключение', 'Подключение создаётся в настройках бота: каждый владелец подключает своего провайдера.');
      const amount = Number(p.amount);
      if (p.amount == null || p.amount === '' || !Number.isFinite(amount) || amount <= 0)
        add('error', 'pay-amount', 'Сумма должна быть больше 0', 'Для RUB — в копейках.');
      if (!b.branches?.created) add('error', 'pay-created', 'Не заполнена ветка «ссылка создана»');
      if (!b.branches?.failed) add('warn', 'pay-failed', 'Не заполнена ветка «не удалось»');
      break;
    }

    case 'payment_check': {
      if (!String(p.connectionId ?? '').trim()) add('error', 'payc-conn', 'Не выбрано платёжное подключение');
      if (!p.autoOrderId && !String(p.orderIdVar ?? '').trim())
        add('error', 'payc-order', 'Не указана переменная с номером заказа', 'Или включите авто-номер.');
      if (!b.branches?.paid) add('error', 'payc-paid', 'Не заполнена ветка «оплачено»');
      if (!b.branches?.pending) add('warn', 'payc-pending', 'Не заполнена ветка «ждём оплату»');
      if (!b.branches?.failed) add('warn', 'payc-failed', 'Не заполнена ветка «не оплачено»');
      break;
    }

    case 'foreach': {
      if (!String(p.listVar ?? '').trim())
        add('error', 'fe-list', 'Не указана переменная со списком', 'Например: found — результат блока «Данные».');
      const max = Number(p.maxIterations ?? 100);
      if (!Number.isFinite(max) || max < 1) add('error', 'fe-max', 'Лимит итераций должен быть больше нуля');
      // Потолок привязан к бюджету шагов движка (shared/limits.ts), а подсказка
      // говорит ПРАВДУ о вместимости одного прохода: итерация стоит (тело + 1)
      // шагов, остаток цикла продолжается фоново через resume (состояние
      // __loop.<id> переживает запись сессии), поэтому больше maxIterations
      // итераций не будет никогда — но и недосчитанных «~40 из 500» больше нет.
      else if (max > HARD_LOOP_CAP)
        add('warn', 'fe-max-cap', `Лимит итераций ограничен ${HARD_LOOP_CAP}`, 'Большее значение будет обрезано до предела.');
      else if (sc) {
        const perPass = foreachPassCapacity(foreachBodySize(sc, b.id));
        if (max > perPass)
          add(
            'warn',
            'fe-pass-capacity',
            `За один проход движок сделает ~${perPass} итераций из ${max}`,
            'Остальные итерации продолжатся фоново (по минуту на пачку) — цикл завершится, но не мгновенно. Сократите тело цикла, если нужна скорость.'
          );
      }
      if (!b.branches?.each) add('error', 'fe-each', 'Не заполнена ветка «каждая итерация»', 'Протяните стрелку от порта «итерация».');
      if (!b.branches?.done) add('warn', 'fe-done', 'Не заполнена ветка «список закончился»', 'После цикла сценарий остановится.');
      break;
    }

    case 'random_text': {
      const variants = (p.variants || []).filter((v) => v && String(v.text ?? '').trim() !== '');
      if (!variants.length) add('error', 'rt-empty', 'Нет ни одного варианта текста');
      (p.variants || []).forEach((v, i) => {
        if (v && String(v.text ?? '').trim() === '') add('warn', 'rt-text', `Вариант ${i + 1}: пустой текст`);
      });
      if (p.send === false && !String(p.outVar ?? '').trim())
        add('warn', 'rt-nowhere', 'Текст никуда не идёт', 'Отправка выключена и переменная не указана.');
      break;
    }

    case 'assert': {
      checkConditionParams(p, add);
      if (!String(p.failMessage ?? '').trim())
        add('warn', 'as-msg', 'Нет сообщения при провале', 'Будет отправлен текст по умолчанию.');
      if (!b.branches?.pass) add('error', 'as-pass', 'Не заполнена ветка «прошло»');
      if (!b.branches?.fail) add('error', 'as-fail', 'Не заполнена ветка «не прошло»');
      break;
    }

    case 'counter': {
      if (!String(p.counterName ?? '').trim()) add('error', 'cnt-name', 'Не указано имя счётчика', 'Имя — ключ, под которым значение хранится в базе.');
      const amount = Number(p.amount ?? 1);
      if (p.counterOp !== 'get' && p.counterOp !== 'reset' && (!Number.isFinite(amount) || amount < 1))
        add('error', 'cnt-amount', 'Шаг счётчика должен быть не меньше 1');
      const max = Number(p.counterMax);
      if (p.counterMax != null && (!Number.isFinite(max) || max <= 0))
        add('error', 'cnt-max', 'Порог должен быть больше нуля');
      break;
    }

    case 'web_app': {
      if (!String(p.text ?? '').trim())
        add('error', 'webapp-text', 'Пустое сообщение', 'Telegram не отправит пустой текст.');
      if (!String(p.button ?? '').trim())
        add('error', 'webapp-button', 'Нет подписи кнопки', 'Кнопку без подписи Telegram отклонит.');
      // Ссылка Mini App: только https://t.me/<username>/<slug>. {{var}} допустимы
      // в шаблоне — staticInterpolate подставит 'x' и проверка формата сработает.
      const url = staticInterpolate(p.url || '').trim();
      if (!url.startsWith('https://t.me/')) {
        add('error', 'webapp-url', 'Ссылка должна начинаться с https://t.me/', 'Формат: https://t.me/<username_бота>/<slug>.');
      } else {
        const parts = url.slice('https://t.me/'.length).split('/').filter(Boolean);
        if (parts.length < 2)
          add('error', 'webapp-url-path', 'В ссылке не хватает пути Mini App', 'Нужны обе части: https://t.me/<username_бота>/<slug>.');
      }
      break;
    }

    case 'schedule': {
      // Регистрационный блок (§4): время считает крон (shared/cron.ts), здесь —
      // только авторские ошибки, из-за которых расписание никогда не сработает.
      const kind = String(p.scheduleKind ?? 'daily');
      if (kind === 'cron') {
        const expr = String(p.cronExpr ?? '').trim();
        if (!expr) add('error', 'sch-cron', 'Не указано cron-выражение', 'Формат: минута час день месяц день_недели, например 0 10 * * 1-5.');
        else if (!parseCronExpr(expr))
          add('error', 'sch-cron-bad', 'Cron-выражение не распознано', 'Пять полей: минута час день месяц день_недели. Поддерживаются *, списки, диапазоны и шаги (*/5).');
      } else {
        const gen = scheduleToCron({
          scheduleKind: kind as any,
          atTime: p.atTime,
          weekdays: p.weekdays,
          everyMinutes: p.everyMinutes,
        });
        if (!gen.ok) {
          if (kind === 'interval') {
            const every = Number(p.everyMinutes ?? 0);
            if (!Number.isFinite(every) || every < MIN_SCHEDULE_INTERVAL_MIN)
              add('error', 'sch-interval', `Интервал должен быть не меньше ${MIN_SCHEDULE_INTERVAL_MIN} минуты`);
          } else if (kind === 'weekly') {
            const days = (p.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
            if (!days.length) add('error', 'sch-weekdays', 'Не выбран ни один день недели', 'Отметьте хотя бы один день (1 — понедельник … 7 — воскресенье).');
            else if (!/^\d{1,2}:\d{2}$/.test(String(p.atTime ?? '').trim()))
              add('error', 'sch-time', 'Не указано время в формате ЧЧ:ММ');
          } else {
            add('error', 'sch-time', 'Не указано время в формате ЧЧ:ММ', 'Например: 10:00.');
          }
        }
      }
      const audience = String(p.scheduleAudience ?? 'all');
      if (audience === 'tag' && !normalizeTag(p.audienceTag || ''))
        add('error', 'sch-tag', 'Не указан тег аудитории', 'Расписание по тегу без тега некому запускать.');
      // Поток запуска: next обязателен — иначе срабатывание уйдёт в никуда.
      if (!b.next) add('error', 'sch-next', 'У расписания нет потока запуска', 'Протяните стрелку от блока «Расписание» к первому блоку сценария, который должен выполняться по времени.');
      // Лимит расписаний на бота — предупреждаем уже здесь, чтобы автор не
      // узнал о нём из лога schedule.limit после публикации.
      if (sc) {
        const schedCount = Object.values(sc.blocks ?? {}).filter((x) => x.type === 'schedule' && !x.params?.disabled).length;
        if (schedCount > MAX_SCHEDULES_PER_BOT)
          add('warn', 'sch-bot-limit', `Расписаний больше ${MAX_SCHEDULES_PER_BOT}`, `Лимит на бота — ${MAX_SCHEDULES_PER_BOT}; лишние блоки не зарегистрируются (лог schedule.limit).`);
      }
      break;
    }

    // ------------------------------------------------------------------
    // набор 2026-10: управление сообщениями, время, входные события, ИИ
    // ------------------------------------------------------------------

    case 'edit_message': {
      // message_id обязателен: без него править нечего, а молчаливый пропуск
      // выглядел бы как «блок не работает». Пусто в инспекторе = {{__bot_msg}}.
      if (!String(p.msgRefVar ?? '').trim())
        add('warn', 'editm-idvar', 'Не указана переменная с message_id', 'По умолчанию правится последнее сообщение бота ({{__bot_msg}}).');
      if (!String(p.editText ?? '').trim())
        add('error', 'editm-text', 'Пустой текст правки', 'Новый текст заменит старый на месте.');
      // F-026: editMessageText принимает те же 1–4096 символов, что и sendMessage.
      checkStaticLength(p.editText, TG_MESSAGE_TEXT_MAX, 'Текст правки', 'editm-text-long', add);
      if (!b.branches?.ok) add('error', 'editm-ok', 'Не заполнена ветка «исправлено»', 'Протяните стрелку от порта «исправлено».');
      if (!b.branches?.too_old) add('warn', 'editm-old', 'Не заполнена ветка «слишком старое»', 'Telegram правит сообщения только ~48 часов.');
      if (!b.branches?.not_found) add('warn', 'editm-nf', 'Не заполнена ветка «не найдено»', 'Сообщение могли удалить или id не тот.');
      break;
    }

    case 'delete_message':
      // Пусто = {{__bot_msg}}: самоудаляющиеся уведомления — основной сценарий.
      if (!String(p.msgRefVar ?? '').trim())
        add('warn', 'delm-idvar', 'Не указана переменная с message_id', 'По умолчанию удаляется последнее сообщение бота ({{__bot_msg}}).');
      break;

    case 'quiz': {
      // Викторина переиспользует параметры poll: те же лимиты Telegram.
      if (!String(p.question ?? '').trim()) add('error', 'quiz-question', 'Не указан вопрос викторины');
      // F-025: те же лимиты sendPoll, что и у опроса (вопрос ≤300, вариант ≤100).
      checkStaticLength(p.question, TG_POLL_QUESTION_MAX, 'Вопрос викторины', 'quiz-question-long', add);
      const opts = p.pollOptions || [];
      if (opts.length < 2) add('error', 'quiz-options', 'У викторины меньше двух вариантов', 'Telegram требует минимум 2 варианта.');
      else if (opts.length > MAX_POLL_OPTIONS) add('error', 'quiz-options-max', `У викторины больше ${MAX_POLL_OPTIONS} вариантов`, `Telegram принимает не больше ${MAX_POLL_OPTIONS}.`);
      opts.forEach((o, i) => {
        if (!String(o?.text ?? '').trim()) add('error', 'quiz-option-text', `Вариант ${i + 1}: пустой текст`, 'Пустой вариант Telegram отклонит.');
        checkStaticLength(o?.text, TG_POLL_OPTION_MAX, `Вариант викторины ${i + 1}`, 'quiz-option-long', add);
      });
      // Без правильного ответа викторина не викторина: sendPoll ушёл бы с
      // quiz-типом и отсутствующим correct_option_id — Telegram отклонил бы.
      const correct = String(p.correctOptionId ?? '').trim();
      if (!correct) add('error', 'quiz-correct', 'Не выбран правильный вариант', 'Отметьте вариант, который считаете верным.');
      else if (!opts.some((o) => (o?.id || '') === correct))
        add('error', 'quiz-correct-missing', 'Правильный вариант не найден среди вариантов', 'Выберите вариант из списка.');
      if (!b.branches?.passed) add('error', 'quiz-passed', 'Не заполнена ветка «сдал»', 'Протяните стрелку от порта «сдал».');
      if (!b.branches?.failed) add('warn', 'quiz-failed', 'Не заполнена ветка «не сдал»', 'Без неё неверный ответ никуда не приведёт.');
      break;
    }

    case 'language': {
      const codes = (p.langCodes || []).map((c) => String(c ?? '').trim()).filter(Boolean);
      if (!codes.length) add('error', 'lang-codes', 'Не указан ни один язык', 'Например: ru, en. Ветки создаются по списку.');
      else if (new Set(codes.map((c) => c.toLowerCase())).size !== codes.length)
        add('error', 'lang-dup', 'Коды языков повторяются', 'Один код — одна ветка.');
      if (!b.branches?.fallback) add('warn', 'lang-fallback', 'Не заполнена ветка «остальные»', 'Без неё незнакомый язык уйдёт в next.');
      break;
    }

    case 'timer_deadline': {
      const at = String(p.deadlineAt ?? '').trim();
      const dvar = String(p.deadlineVar ?? '').trim();
      if (at) {
        if (!/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(at))
          add('error', 'td-at', 'Срок не распознан', 'Формат: ГГГГ-ММ-ДД ЧЧ:ММ (или ISO с T).');
      } else if (!dvar) {
        add('error', 'td-when', 'Не указан срок', 'Либо абсолютная дата, либо переменная с датой (например, из блока «Данные»).');
      }
      if (!b.branches?.expired) add('error', 'td-expired', 'Не заполнена ветка «срок вышел»', 'Протяните стрелку от порта «срок вышел».');
      if (!b.branches?.done) add('warn', 'td-done', 'Не заполнена ветка «успел»', 'Без неё своевременное действие никуда не приведёт.');
      break;
    }

    case 'ai_classify': {
      const labels = (p.classifyLabels || []).map((l) => String(l ?? '').trim()).filter(Boolean);
      if (!labels.length) add('error', 'aic-labels', 'Не указано ни одной метки', 'Метки становятся ветками блока.');
      else if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length)
        add('error', 'aic-dup', 'Метки повторяются', 'Одна метка — одна ветка.');
      if (!String(p.classifyInput ?? '').trim())
        add('warn', 'aic-input', 'Не указан вход классификатора', 'По умолчанию классифицируется текст последнего сообщения пользователя.');
      const fb = String(p.classifyFallbackLabel ?? 'other').trim();
      if (labels.some((l) => l.toLowerCase() === fb.toLowerCase()))
        add('error', 'aic-fb-clash', 'Метка совпадает с резервной', 'Резервная ветка ловит только неразобранные ответы.');
      if (!b.branches?.[fb]) add('warn', 'aic-fb', 'Не заполнена резервная ветка', 'Неразобранный ответ модели уйдёт в next.');
      break;
    }

    case 'location':
      if (!b.branches?.sent) add('error', 'loc-sent', 'Не заполнена ветка «прислал гео»', 'Протяните стрелку от порта «прислал гео».');
      if (!b.branches?.declined) add('warn', 'loc-declined', 'Не заполнена ветка «отказался»', 'Пользователь может не делиться геопозицией.');
      break;

    case 'webhook_in': {
      // Регистрационный триггер (как schedule): поток запуска обязателен.
      if (!b.next) add('error', 'whin-next', 'У вебхука нет потока запуска', 'Протяните стрелку от блока к первому блоку сценария, который должен выполняться по событию.');
      const fields = (p.webhookFields || []).map((f) => String(f ?? '').trim()).filter(Boolean);
      if (new Set(fields).size !== fields.length) add('error', 'whin-dup', 'Имена полей повторяются');
      break;
    }

    // ------------------------------------------------------------------
    // подсценарии (библиотека фрагментов)
    // ------------------------------------------------------------------

    case 'subflow': {
      // Ссылка на фрагмент обязательна; dangling/чужие ссылки проверяются
      // здесь же (по библиотеке), когда она передана.
      if (!String(p.subflowId ?? '').trim())
        add('error', 'subflow-id', 'Не выбран фрагмент подсценария', 'Откройте библиотеку и выберите фрагмент.');
      // Обе ветки обязательны: без «сбой» проблема раскрытия уведёт пользователя в тишину.
      if (!b.branches?.done) add('error', 'subflow-branches', 'Не заполнена ветка «выполнен»', 'Протяните стрелку от порта «выполнен».');
      if (!b.branches?.failed) add('error', 'subflow-branches', 'Не заполнена ветка «сбой»', 'Протяните стрелку от порта «сбой».');
      break;
    }

    case 'subflow_return':
      // Терминал фрагмента не имеет ни next, ни веток по определению.
      if (b.next) add('warn', 'subflow-return-next', 'У возврата из фрагмента есть продолжение', 'Возврат завершает фрагмент — стрелка будет проигнорирована.');
      break;
    default:
      break;
  }
}

export function validateScenario(sc: Scenario, options?: ValidateOptions): Issue[] {
  const issues: Issue[] = [];
  const platform = options?.platform ?? DEFAULT_PLATFORM;
  const push = (level: IssueLevel, code: string, message: string, hint?: string, blockId?: string, fragmentBlockId?: string) =>
    issues.push({ level, code, message, hint, blockId, ...(fragmentBlockId ? { fragmentBlockId } : {}) });

  const blocks = sc?.blocks ?? {};
  const ids = Object.keys(blocks);

  if (!ids.length) {
    push('error', 'empty', 'Сценарий пуст', 'Добавьте блоки из палитры слева.');
    return issues;
  }

  // 1. точка входа
    const startBlock = sc.start ? blocks[sc.start] : undefined;
  if (!sc.start || !startBlock) {
    push('error', 'no-start', 'Нет точки входа', 'Поставьте блок Старт и сделайте его точкой входа.', sc.start || undefined);
  } else if (
    !startBlock.next &&
    !usesBranches(startBlock.type) &&
    startBlock.type !== 'goto' &&
    Object.keys(blocks).length > 1
  ) {
    push('error', 'start-exit', 'Точка входа никуда не ведёт', 'Соедините Старт со следующим блоком.', sc.start);
  }
  if (!ids.some((id) => blocks[id].type === 'start')) {
    push('warn', 'no-start-block', 'В сценарии нет блока Старт', 'Без него бот не отреагирует на /start.');
  }

  // 2. битые ссылки. Замороженные (disabled) блоки не проверяем: движок их
  // пропускает, поэтому битая стрелка из такого блока ни на что не влияет.
  for (const id of ids) {
    const b = blocks[id];
    if (b.params?.disabled) continue;
    if (b.next && !blocks[b.next]) push('error', 'link-next', `Ссылка на удалённый блок`, 'Пересоедините стрелку.', id);
    for (const [k, t] of Object.entries(b.branches || {})) {
      if (t && !blocks[t]) push('error', 'link-branch', `Ветка «${k}» ведёт в удалённый блок`, 'Пересоедините ветку.', id);
    }
    if (b.type === 'goto' && b.params.target && !blocks[b.params.target])
      push('error', 'link-goto', 'Переход ведёт в удалённый блок', 'Выберите существующий блок.', id);
  }

  // 3. содержимое блоков
  for (const id of ids) {
    const b = blocks[id];
    // Неизвестный тип (сценарий собран более новой платформой или JSON
    // повреждён): движок и UI молча пропускают такой блок — говорим явно.
    if (!BLOCK_TYPES.includes(b.type)) {
      push('error', 'unknown-type', `Неизвестный тип блока: ${b.type}`, 'Удалите блок или обновите платформу.', id);
      continue;
    }
    // Платформенная матрица: Telegram-only блок на VK-боте — ошибка публикации.
    // Замороженные проверяем ВЫШЕ (как в остальных секциях): disabled-блок
    // на рантайм не влияет, ошибка заморозила бы публикацию честного сценария.
    if (!blockSupportedOn(b.type, platform) && !b.params?.disabled) {
      push(
        'error',
        'platform-unsupported',
        'Блок не поддерживается на этой платформе',
        'Блок доступен только для Telegram-ботов. Удалите его или заморозьте, либо создайте бота для Telegram.',
        id
      );
      continue;
    }
    // VK: видео не загружается ключом сообщества (video.save — user-token
    // only, пробы 29.10). Фото и документы работают: separate-проверка,
    // чтобы автор понимал, что блок рабочий — только тип файла другой.
    if (platform === 'vk' && (b.type === 'media' || b.type === 'media_group') && !b.params?.disabled) {
      const badVideo =
        (b.type === 'media' && VK_UNSUPPORTED_MEDIA_TYPES.has(String(b.params.mediaType || 'photo'))) ||
        (b.type === 'media_group' && (b.params.mediaItems || []).some((it) => VK_UNSUPPORTED_MEDIA_TYPES.has(String(it?.type || 'photo'))));
      if (badVideo) {
        push(
          'error',
          'platform-media-unsupported',
          'Видео на VK не поддерживается',
          'Ключ сообщества не может загружать видео. Замените на фото или документ, либо заморозьте блок.',
          id
        );
        continue;
      }
    }
    if (b.params?.disabled) {
      // Заморозка — это не ошибка, а осознанное решение: блок остаётся на холсте,
      // но движок его пропускает. Публикацию не блокируем, просто напоминаем.
      push('warn', 'frozen', 'Блок заморожен', 'Он не будет выполняться, пока вы его не разморозите.', id);
      continue;
    }
    if (b.type === 'note') continue;
    checkBlock(b, (level, code, message, hint) => push(level, code, message, hint, id), sc);

    // F3-104: VK payload — до 255 БАЙТ (vkKeyboard режет молча, нажатие
    // обрезанной кнопки ведёт в никуда). Предупреждаем ДО публикации.
    if (platform === 'vk' && (b.type === 'buttons' || b.type === 'menu')) {
      const list = b.params.buttons || [];
      list.forEach((btn, i) => {
        if (btn.value && !btn.url && b.params.layout !== 'reply') {
          const interpolated = staticInterpolate(btn.value);
          if (utf8Length(interpolated) > 255)
            push(
              'error',
              'vk-btn-payload-long',
              `Кнопка «${btn.label || i + 1}»: значение длиннее 255 байт`,
              'VK молча обрежет payload кнопки, нажатие поведёт в никуда. Сократите значение.',
              b.id
            );
        }
      });
    }
  }

  // 4. тупики
  for (const id of ids) {
    const b = blocks[id];
    if (b.params?.disabled || b.type === 'note' || b.type === 'end') continue;
    if (usesBranches(b.type)) continue;
    if (b.type === 'goto') continue;
    if (!b.next) push('warn', 'dead-end', 'Блок никуда не ведёт', 'Сценарий на нём закончится.', id);
  }

  // 5. недостижимые блоки
  const roots = ids.filter((id) => blocks[id].type === 'start' || blocks[id].type === 'command');
  if (sc.start) roots.push(sc.start);
  const reach = reachableFrom(sc, roots);
  for (const id of ids) {
    if (reach.has(id)) continue;
    const b = blocks[id];
    if (b.type === 'note' || b.params?.disabled) continue;
    push('warn', 'unreachable', 'До блока нельзя дойти', 'Проверьте стрелки — возможно, блок отрезан от сценария.', id);
  }

  // 6. бесконечные циклы (без ожидания ввода). F-020 (аудит 18.10.2026, решение
  // владельца): уровень ОШИБКА, а не предупреждение. Рантайм-guard движка
  // (LOOP_VISIT_GUARD) не спасает от ущерба: цикл из message-блоков успевает
  // отправить до ~100 сообщений за один апдейт — спам, расход лимитов Telegram
  // и выход за окно вебхука с ретраем. Публикация блокируется только на
  // ошибках, поэтому такой сценарий раньше спокойно публиковался.
  // Циклы через блоки ожидания ввода (wait/poll/quiz/location/input/buttons…)
  // и легальный foreach остаются разрешёнными: они прерывают апдейтом
  // пользователя или конечны по построению (breaksInstantLoop, shared/graph.ts).
  for (const cycle of findCycles(sc)) {
    // breaksInstantLoop включает foreach: цикл «тело → foreach» конечен.
    if (cycle.some((id) => breaksInstantLoop(blocks[id]))) continue;
    // Блоки набора 2026-10, которые паркуют сессию до следующего апдейта
    // пользователя (engine.ts: quiz ждёт poll_answer, location ждёт гео).
    // WAIT_TYPES в shared/graph.ts их пока не знает; цикл через них — такой же
    // легальный диалоговый цикл, как через poll/input.
    if (cycle.some((id) => {
      const t = blocks[id]?.type;
      return !!t && PARK_UNTIL_UPDATE_TYPES.includes(t);
    })) continue;
    push(
      'error',
      'tight-loop',
      'Бесконечный цикл без ожидания ввода',
      'В цикле нет ни одного блока, который ждал бы ответа пользователя (Ввод, Кнопки, Опрос, Ожидание, Геопозиция) или перебирал бы список. Бот слал бы сообщения без остановки. Добавьте такой блок в цикл.',
      cycle[0]
    );
  }

  // 7. подсценарии: subflow_return вне фрагмента — ошибка (терминал некуда
  // возвращать), а при переданной библиотеке — сухое раскрытие: все проблемы
  // (dangling, чужие ссылки, циклы, глубина, входы) сообщаются против id БЛОКА
  // ВЫЗОВА в авторском сценарии.
  if (!options?.isFragment) {
    for (const id of ids) {
      if (blocks[id].type === 'subflow_return') {
        push('error', 'subflow-return-outside', 'Возврат из подсценария в сценарии бота', 'Этот блок работает только внутри фрагмента библиотеки.', id);
      }
    }
  }
  const library = options?.subflows;
  if (library && ids.some((id) => blocks[id].type === 'subflow')) {
    // Дублируем проверки раскрытия (subflow-missing/-cycle/-depth/-input/-revision/
    // -size): validateScenario — ЕДИННАЯ точка, которую зовут фронт и воркер,
    // поэтому ошибки фрагментов обязаны появляться и в мгновенной проверке тоже.
    const { issues: expandIssues } = expandSubflows(sc, library);
    for (const i of expandIssues) {
      if (issues.some((x) => x.code === i.code && x.blockId === i.blockId && x.message === i.message)) continue;
      push(i.level, i.code, i.message, i.hint, i.blockId, i.fragmentBlockId);
    }
  }

  return issues;
}

export function countIssues(issues: Issue[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) (i.level === 'error' ? errors++ : warnings++);
  return { errors, warnings };
}

// Команды для меню бота: точка входа + все блоки «Команда».
export function scenarioCommands(sc: Scenario): { command: string; description: string }[] {
  const out: { command: string; description: string }[] = [];
  const seen = new Set<string>();
  for (const b of Object.values(sc?.blocks ?? {})) {
    if (b.type !== 'start' && b.type !== 'command') continue;
    const cmd = (b.params.command || '').trim();
    if (!cmd.startsWith('/')) continue;
    const name = cmd.replace(/^(\/)?/, '').replace(/@.*$/, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const desc = (b.params.description || '').trim() || (b.type === 'start' ? 'Запустить бота' : `Команда ${name}`);
    out.push({ command: name, description: desc.slice(0, 256) });
  }
  return out.slice(0, 100);
}
