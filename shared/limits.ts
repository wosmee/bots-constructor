// Единый источник правды о вместимости платформы (аудит 30.09.2026).
// Эти константы используют движок (worker/src/engine.ts), база (worker/src/db.ts),
// воркер (worker/src/index.ts), валидатор (shared/validate.ts) и документация
// (docs/CODEBASE.md, README.md). Любое числовое ограничение сначала появляется
// здесь — иначе подсказки валидатора и фактическая вместимость снова разъедутся.

// ---------------- движок: бюджет шагов (§1) ----------------

// Бюджет шагов одного прохода runEngine. Раньше был зашит как `guard > 200`,
// из-за чего цепочка ~250 блоков молча обрывалась, а сессия парковалась.
// Теперь бюджет расходуется честно, а остаток потока воркер уносит в
// scheduled_sends (method 'resume') — поток продолжается фоново, а не рвётся.
export const MAX_ENGINE_STEPS = 1000;

// Абсолютный пол для необязательного аргумента maxSteps (тесты могут урезать
// бюджет, но не ниже 200 — прежний guard остаётся достижимым минимумом).
export const MIN_ENGINE_STEPS = 200;

// Защита от настоящего runaway-цикла: если ОДИН блок за проход посещён больше
// этого числа раз — поток обрывается с логом engine.loop.break.<blockId>.
// Отдельно от бюджета шагов: цикл A→B→A ловится здесь, а не жжёт весь бюджет.
export const LOOP_VISIT_GUARD = 100;

// Потолок maxIterations блока foreach. Привязан к бюджету шагов: одна итерация
// стоит минимум (размер тела + 1) шагов, а недопройденный цикл продолжается
// через resume (состояние __loop.<id> переживает запись сессии), поэтому
// заявленная вместимость и фактическая больше не расходятся.
export const HARD_LOOP_CAP = MAX_ENGINE_STEPS;

// Сколько итераций цикла гарантированно помещается в один проход движка.
// bodySize — размер тела вместе с самим foreach-блоком (shared/graph.ts:
// foreachBodySize): одна итерация стоит ровно bodySize шагов (вход в foreach +
// блоки тела), поэтому вместимость = budget / bodySize.
export function foreachPassCapacity(bodySize: number, maxSteps: number = MAX_ENGINE_STEPS): number {
  const perIteration = Math.max(2, Math.floor(bodySize));
  return Math.max(1, Math.floor(maxSteps / perIteration));
}

// ---------------- коллекции: поиск (§3) ----------------

// SQL-префильтр (search_text LIKE) сужает выборку; грузим не больше
// FIND_SCAN_LIMIT самых новых строк, затем JS-проверка matches() гарантирует
// прежнюю семантику.
export const FIND_SCAN_LIMIT = 5000;

// Жёсткий потолок сканирования: если префильтрованных совпадений больше,
// берутся самые новые FIND_HARD_CAP строк и пишется лог data.scan.capped.<n>,
// чтобы автор знал: поиск был частичным.
export const FIND_HARD_CAP = 5000;

// ---------------- асинхронные цепочки (§6) ----------------

// Глубина рекурсии dispatchOuts → resumeFrom (http/ai блоки). Раньше обрыв
// на depth > 5 молча останавливал поток; теперь на превышении цепочка
// откладывается в scheduled_sends (method 'resume') с логом
// async.chain.deferred.<depth> и продолжается следующим тиком крона.
export const MAX_ASYNC_CHAIN = 25;

// Сколько раз поток может быть продолжен фоново после исчерпания бюджета
// шагов (engine.budget.resume). Предохранитель от бесконечной эстафеты:
// после MAX_BUDGET_RESUMES continuations пишется engine.budget.gaveup.
export const MAX_BUDGET_RESUMES = 20;

// Пачка получателей для планового запуска потока (schedule audience all/tag):
// строка scheduled_sends method 'schedule_run' несёт SCHEDULE_RUN_CHUNK
// пользователей, пачки разносятся по времени на SCHEDULE_RUN_STAGGER_MS —
// движок на каждого получателя тяжелее обычной отправки сообщения.
export const SCHEDULE_RUN_CHUNK = 10;
export const SCHEDULE_RUN_STAGGER_MS = 5000;

// ---------------- ИИ: память диалога (§5) ----------------

// История диалога блока ai: сколько ходов (по умолчанию / максимум).
export const AI_HISTORY_TURNS_DEFAULT = 6;
export const AI_HISTORY_TURNS_MAX = 20;

// Бюджет собранного промпта в байтах: при превышении самые старые ходы
// истории отбрасываются (лог ai.history.truncated.<n>), вызов не падает.
export const AI_PROMPT_BUDGET_BYTES = 8 * 1024;

// ---------------- расписания (§4) ----------------

// Сколько блоков schedule может зарегистрировать один бот.
export const MAX_SCHEDULES_PER_BOT = 20;

// Минимальный интервал повторения, минуты.
export const MIN_SCHEDULE_INTERVAL_MIN = 1;

// Сколько получателей максимум ставится в очередь одним тиком крона на бота.
export const MAX_SCHEDULE_RECIPIENTS_PER_TICK = 2000;

// Часовой пояс расписания по умолчанию.
export const DEFAULT_SCHEDULE_TIMEZONE = 'Europe/Moscow';

// ---------------- лимиты Telegram (§7) ----------------

// callback_data инлайн-кнопки: жёсткие 64 БАЙТА (не символа) — превышение
// ломает бота для реальных пользователей, поэтому валидатор блокирует публикацию.
export const TG_CALLBACK_DATA_BYTES = 64;

// Заголовок и описание счёта (sendInvoice): в рантайме усекаются движком
// (engine.ts, case 'invoice'), поэтому валидатор только предупреждает.
export const TG_INVOICE_TITLE_MAX = 32;
export const TG_INVOICE_DESC_MAX = 255;

// S4-03: остальные лимиты sendInvoice, которые движок режет молча (раньше
// хардкодом в engine.ts). payload — произвольная строка автора (Telegram
// документально не ограничивает её длину, 128 — наш внутренний потолок),
// currency — код валюты вида 'RUB'.
export const TG_INVOICE_PAYLOAD_MAX = 128;
export const TG_INVOICE_CURRENCY_MAX = 8;
// Метка позиции (prices[].label) усекается движком до TG_INVOICE_TITLE_MAX.

// Текст answerCallbackQuery (cbToast/cbAlert): Telegram показывает максимум
// ~200 символов, лишнее теряется — предупреждение.
export const TG_CB_TOAST_MAX = 200;

// Вопрос опроса/викторины (sendPoll question): Telegram принимает 1–300 символов.
// Превышение — отклонённый запрос целиком (сессия паркуются на опросе, который
// не пришёл), поэтому валидатор блокирует публикацию.
export const TG_POLL_QUESTION_MAX = 300;

// Текст варианта опроса (sendPoll option): Telegram принимает 1–100 символов.
export const TG_POLL_OPTION_MAX = 100;

// F3-305: число ОПЦИЙ опроса (и элементов media-группы) — было литералом 10
// в шести местах (инспектор, валидатор). VK media_group разделяет лимит.
export const MAX_POLL_OPTIONS = 10;
export const MAX_MEDIA_ITEMS = 10;

// Текст сообщения (sendMessage text, editMessageText text): 1–4096 символов.
// Превышение — 400 от Telegram, сообщение теряется целиком.
export const TG_MESSAGE_TEXT_MAX = 4096;

// Подпись медиа (sendPhoto/sendVideo/sendDocument caption): 0–1024 символа.
export const TG_CAPTION_MAX = 1024;

// Длина строки в БАЙТАХ (UTF-8): Telegram ограничивает callback_data байтами,
// кириллица занимает 2 байта на символ.
export function utf8Length(s: string): number {
  return typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(s).length
    : unescape(encodeURIComponent(s)).length;
}
