// Метаданные блоков: цвет, подпись, подсказка, «что если» и короткое
// резюме для узла на холсте.
//
// Весь видимый текст здесь — ключи словаря (i18n). Значения подставляются
// лениво, в момент чтения, поэтому смена языка в Настройках перерисовывает
// палитру, узлы и инспектор без перезагрузки страницы.
import { Block, BlockType, BlockParams } from '../../shared/types';
import { translate, type Lang, type TKey } from './i18n';
import { getSettings, type SkillLevel } from './settings';

// Текущий язык интерфейса: берём из стора настроек (вне React-компонентов
// это единственный способ — хук useT() доступен только в компонентах).
function lang(): Lang {
  return getSettings().language;
}

function L(key: TKey, vars?: Record<string, string | number>): string {
  return translate(lang(), key, vars);
}

type MetaRaw = { label: TKey; hint: TKey; color: string };

const META_RAW: Record<BlockType, MetaRaw> = {
  start: { label: 'block.start.label', hint: 'block.start.hint', color: '#22c55e' },
  message: { label: 'block.message.label', hint: 'block.message.hint', color: '#3b82f6' },
  buttons: { label: 'block.buttons.label', hint: 'block.buttons.hint', color: '#a855f7' },
  input: { label: 'block.input.label', hint: 'block.input.hint', color: '#eab308' },
  condition: { label: 'block.condition.label', hint: 'block.condition.hint', color: '#f97316' },
  action: { label: 'block.action.label', hint: 'block.action.hint', color: '#ef4444' },
  goto: { label: 'block.goto.label', hint: 'block.goto.hint', color: '#14b8a6' },
  end: { label: 'block.end.label', hint: 'block.end.hint', color: '#64748b' },
  media: { label: 'block.media.label', hint: 'block.media.hint', color: '#06b6d4' },
  subscription: { label: 'block.subscription.label', hint: 'block.subscription.hint', color: '#ec4899' },
  menu: { label: 'block.menu.label', hint: 'block.menu.hint', color: '#8b5cf6' },
  command: { label: 'block.command.label', hint: 'block.command.hint', color: '#16a34a' },
  keyword: { label: 'block.keyword.label', hint: 'block.keyword.hint', color: '#f59e0b' },
  setvar: { label: 'block.setvar.label', hint: 'block.setvar.hint', color: '#0ea5e9' },
  http: { label: 'block.http.label', hint: 'block.http.hint', color: '#7c3aed' },
  ai: { label: 'block.ai.label', hint: 'block.ai.hint', color: '#db2777' },
  random: { label: 'block.random.label', hint: 'block.random.hint', color: '#84cc16' },
  switch: { label: 'block.switch.label', hint: 'block.switch.hint', color: '#ea580c' },
  contact: { label: 'block.contact.label', hint: 'block.contact.hint', color: '#0891b2' },
  note: { label: 'block.note.label', hint: 'block.note.hint', color: '#475569' },
  referral: { label: 'block.referral.label', hint: 'block.referral.hint', color: '#2dd4bf' },
  media_group: { label: 'block.media_group.label', hint: 'block.media_group.hint', color: '#0d9488' },
  invoice: { label: 'block.invoice.label', hint: 'block.invoice.hint', color: '#be185d' },
  data: { label: 'block.data.label', hint: 'block.data.hint', color: '#b45309' },
  // Тег — та же семья, что «Данные»: и там, и там что-то запоминается о
  // человеке. Оттенок отличается, чтобы блоки не сливались в палитре.
  tag: { label: 'block.tag.label', hint: 'block.tag.hint', color: '#7e22ce' },
  // Цепочка — рядом с альбомом по смыслу, но цвет свой: это не альбом.
  chain: { label: 'block.chain.label', hint: 'block.chain.hint', color: '#0369a1' },
  // Реферальная система — одно семейство: оттенки одного сектора круга, чтобы
  // группа читалась как родственная, но блоки не сливались в палитре.
  referral_track: { label: 'block.referral_track.label', hint: 'block.referral_track.hint', color: '#14b8a6' },
  referral_check: { label: 'block.referral_check.label', hint: 'block.referral_check.hint', color: '#0ea5a5' },
  referral_bonus: { label: 'block.referral_bonus.label', hint: 'block.referral_bonus.hint', color: '#22c1a0' },
  referral_stats: { label: 'block.referral_stats.label', hint: 'block.referral_stats.hint', color: '#0d9488' },
  referral_leaderboard: { label: 'block.referral_leaderboard.label', hint: 'block.referral_leaderboard.hint', color: '#0f766e' },
  referral_hierarchy: { label: 'block.referral_hierarchy.label', hint: 'block.referral_hierarchy.hint', color: '#10b981' },
  referral_tournament: { label: 'block.referral_tournament.label', hint: 'block.referral_tournament.hint', color: '#34d399' },
  referral_verification: { label: 'block.referral_verification.label', hint: 'block.referral_verification.hint', color: '#059669' },
  antifraud: { label: 'block.antifraud.label', hint: 'block.antifraud.hint', color: '#475569' },
  // --- набор 2026-09: цвета закреплены, Prompt 2 их не меняет ---
  poll: { label: 'block.poll.label', hint: 'block.poll.hint', color: '#6d28d9' }, // TODO(prompt-2): full UI
  forward: { label: 'block.forward.label', hint: 'block.forward.hint', color: '#0891b2' }, // TODO(prompt-2): full UI
  chat_action: { label: 'block.chat_action.label', hint: 'block.chat_action.hint', color: '#0e7490' }, // TODO(prompt-2): full UI
  wait: { label: 'block.wait.label', hint: 'block.wait.hint', color: '#ca8a04' }, // TODO(prompt-2): full UI
  channel_check: { label: 'block.channel_check.label', hint: 'block.channel_check.hint', color: '#1d4ed8' }, // TODO(prompt-2): full UI
  segment_broadcast: { label: 'block.segment_broadcast.label', hint: 'block.segment_broadcast.hint', color: '#4338ca' }, // TODO(prompt-2): full UI
  user_stats: { label: 'block.user_stats.label', hint: 'block.user_stats.hint', color: '#1e40af' }, // TODO(prompt-2): full UI
  payment_link: { label: 'block.payment_link.label', hint: 'block.payment_link.hint', color: '#9d174d' }, // TODO(prompt-2): full UI
  payment_check: { label: 'block.payment_check.label', hint: 'block.payment_check.hint', color: '#831843' }, // TODO(prompt-2): full UI
  foreach: { label: 'block.foreach.label', hint: 'block.foreach.hint', color: '#65a30d' }, // TODO(prompt-2): full UI
  random_text: { label: 'block.random_text.label', hint: 'block.random_text.hint', color: '#4d7c0f' }, // TODO(prompt-2): full UI
  assert: { label: 'block.assert.label', hint: 'block.assert.hint', color: '#b45309' }, // TODO(prompt-2): full UI
  counter: { label: 'block.counter.label', hint: 'block.counter.hint', color: '#a16207' }, // TODO(prompt-2): full UI
  // Mini App: сообщение с кнопкой, открывающей веб-приложение Telegram.
  web_app: { label: 'block.web_app.label', hint: 'block.web_app.hint', color: '#2563eb' },
  // Расписание: янтарный «часовой» оттенок, не занят другими блоками.
  schedule: { label: 'block.schedule.label', hint: 'block.schedule.hint', color: '#d97706' },
  // --- подсценарии (библиотека фрагментов): тёмно-коричневые, «дверь» в фрагмент ---
  subflow: { label: 'block.subflow.label', hint: 'block.subflow.hint', color: '#7c2d12' },
  subflow_return: { label: 'block.subflow_return.label', hint: 'block.subflow_return.hint', color: '#78350f' },
  // --- набор 2026-10: управление сообщениями, время, входные события, ИИ ---
  edit_message: { label: 'block.edit_message.label', hint: 'block.edit_message.hint', color: '#38bdf8' },
  delete_message: { label: 'block.delete_message.label', hint: 'block.delete_message.hint', color: '#94a3b8' },
  quiz: { label: 'block.quiz.label', hint: 'block.quiz.hint', color: '#c026d3' },
  language: { label: 'block.language.label', hint: 'block.language.hint', color: '#0d9488' },
  timer_deadline: { label: 'block.timer_deadline.label', hint: 'block.timer_deadline.hint', color: '#92400e' },
  ai_classify: { label: 'block.ai_classify.label', hint: 'block.ai_classify.hint', color: '#be123c' },
  webhook_in: { label: 'block.webhook_in.label', hint: 'block.webhook_in.hint', color: '#334155' },
  location: { label: 'block.location.label', hint: 'block.location.hint', color: '#22d3ee' },
};

// Геттеры, а не поля: строка читается в момент обращения, а не при импорте —
// иначе смена языка не подхватывалась бы без перезагрузки.
// ВАЖНО: геттеры определяем через defineProperty на самом объекте.
// Object.fromEntries / spread прочитали бы их один раз при импорте — и смена
// языка перестала бы работать до перезагрузки страницы.
export const BLOCK_META: Record<BlockType, { label: string; hint: string; color: string }> = (() => {
  const out = {} as Record<BlockType, { label: string; hint: string; color: string }>;
  for (const entry of Object.entries(META_RAW) as [BlockType, MetaRaw][]) {
    const [type, m] = entry;
    const meta = { color: m.color } as { label: string; hint: string; color: string };
    Object.defineProperty(meta, 'label', { enumerable: true, get: () => L(m.label) });
    Object.defineProperty(meta, 'hint', { enumerable: true, get: () => L(m.hint) });
    out[type] = meta;
  }
  return out;
})();

// «Что если»: короткое предсказание, которое показывается, когда пользователь
// начинает тянуть связь от блока. Фраза зависит от типа исходного блока.
export const WHAT_IF: Record<BlockType, TKey> = {
  start: 'whatif.start',
  message: 'whatif.message',
  buttons: 'whatif.buttons',
  input: 'whatif.input',
  condition: 'whatif.condition',
  action: 'whatif.action',
  goto: 'whatif.goto',
  end: 'whatif.end',
  media: 'whatif.media',
  subscription: 'whatif.subscription',
  menu: 'whatif.menu',
  command: 'whatif.command',
  keyword: 'whatif.keyword',
  setvar: 'whatif.setvar',
  http: 'whatif.http',
  ai: 'whatif.ai',
  random: 'whatif.random',
  switch: 'whatif.switch',
  contact: 'whatif.contact',
  note: 'whatif.note',
  referral: 'whatif.referral',
  media_group: 'whatif.media_group',
  invoice: 'whatif.invoice',
  data: 'whatif.data',
  tag: 'whatif.tag',
  chain: 'whatif.chain',
  referral_track: 'whatif.referral_track',
  referral_check: 'whatif.referral_check',
  referral_bonus: 'whatif.referral_bonus',
  referral_stats: 'whatif.referral_stats',
  referral_leaderboard: 'whatif.referral_leaderboard',
  referral_hierarchy: 'whatif.referral_hierarchy',
  referral_tournament: 'whatif.referral_tournament',
  referral_verification: 'whatif.referral_verification',
  antifraud: 'whatif.antifraud',
  // --- набор 2026-09 ---
  poll: 'whatif.poll', // TODO(prompt-2): full UI
  forward: 'whatif.forward', // TODO(prompt-2): full UI
  chat_action: 'whatif.chat_action', // TODO(prompt-2): full UI
  wait: 'whatif.wait', // TODO(prompt-2): full UI
  channel_check: 'whatif.channel_check', // TODO(prompt-2): full UI
  segment_broadcast: 'whatif.segment_broadcast', // TODO(prompt-2): full UI
  user_stats: 'whatif.user_stats', // TODO(prompt-2): full UI
  payment_link: 'whatif.payment_link', // TODO(prompt-2): full UI
  payment_check: 'whatif.payment_check', // TODO(prompt-2): full UI
  foreach: 'whatif.foreach', // TODO(prompt-2): full UI
  random_text: 'whatif.random_text', // TODO(prompt-2): full UI
  assert: 'whatif.assert', // TODO(prompt-2): full UI
  counter: 'whatif.counter', // TODO(prompt-2): full UI
  web_app: 'whatif.web_app',
  schedule: 'whatif.schedule',
  subflow: 'whatif.subflow',
  subflow_return: 'whatif.subflow_return',
  // --- набор 2026-10 ---
  edit_message: 'whatif.edit_message',
  delete_message: 'whatif.delete_message',
  quiz: 'whatif.quiz',
  language: 'whatif.language',
  timer_deadline: 'whatif.timer_deadline',
  ai_classify: 'whatif.ai_classify',
  webhook_in: 'whatif.webhook_in',
  location: 'whatif.location',
};

// Группы палитры. У каждой — стабильный машинный id: он идёт в React-ключи и в
// localStorage, поэтому переведённый заголовок идентификатором быть не может
// (смена языка ломала бы сохранённое состояние).
export type PaletteGroupId =
  | 'content'
  | 'keyboards'
  | 'input'
  | 'logic'
  | 'data'
  | 'time'
  | 'audience'
  | 'payments'
  | 'ai'
  | 'integrations'
  | 'referral'
  | 'flow'
  | 'advanced';

export interface PaletteGroup {
  id: PaletteGroupId;
  title: TKey;
  items: BlockType[];
}

// Состав групп — контракт (Промпт 2 набора 2026-09): каждый блок лежит ровно в
// одной «основной» группе; 'advanced' — дополнительный взгляд на те же блоки
// (http/ai/setvar/foreach), который новичок открывает отдельным тумблером.
export const PALETTE_GROUPS: PaletteGroup[] = [
  // Набор 2026-10: правка/удаление сообщений и викторина живут рядом с
  // отправкой; гео — рядом с другими видами ввода; «Время» и «ИИ» — отдельные
  // семьи («когда» и «генерация»), а не хвосты «Потока» и «Интеграций».
  { id: 'content', title: 'palette.content', items: ['message', 'media', 'media_group', 'chain', 'poll', 'quiz', 'forward', 'edit_message', 'delete_message'] },
  { id: 'keyboards', title: 'palette.keyboards', items: ['buttons', 'menu', 'chat_action', 'web_app'] },
  { id: 'input', title: 'palette.input', items: ['input', 'contact', 'location'] },
  { id: 'logic', title: 'palette.logic', items: ['condition', 'switch', 'random', 'foreach', 'setvar', 'keyword', 'assert', 'language'] },
  { id: 'data', title: 'palette.data', items: ['data', 'counter'] },
  { id: 'time', title: 'palette.time', items: ['schedule', 'wait', 'timer_deadline'] },
  { id: 'audience', title: 'palette.audience', items: ['channel_check', 'subscription', 'user_stats', 'segment_broadcast', 'tag'] },
  { id: 'payments', title: 'palette.payments', items: ['invoice', 'payment_link', 'payment_check'] },
  { id: 'ai', title: 'palette.ai', items: ['ai', 'ai_classify', 'random_text'] },
  { id: 'integrations', title: 'palette.integrations', items: ['http', 'action'] },
  // Реферальная система — своя группа: блоков стало много (ссылка, учёт,
  // бонусы, статистика, турниры, антифрод), в «Интеграциях» они тонули.
  {
    id: 'referral',
    title: 'palette.referral',
    items: [
      'referral',
      'referral_track',
      'referral_check',
      'referral_bonus',
      'referral_hierarchy',
      'referral_verification',
      'referral_stats',
      'referral_leaderboard',
      'referral_tournament',
      'antifraud',
    ],
  },
  { id: 'flow', title: 'palette.flow', items: ['start', 'command', 'goto', 'end', 'webhook_in', 'subflow', 'subflow_return', 'note'] },
  { id: 'advanced', title: 'palette.advanced', items: ['http', 'ai', 'setvar', 'foreach'] },
];

// Группа «Продвинутые»: у skill_level 'low' она скрыта, пока пользователь явно
// не включит её тумблером (настройка advanced_blocks живёт на сервере).
// У medium/high не скрывается никогда.
export function isAdvancedGroup(id: PaletteGroupId): boolean {
  return id === 'advanced';
}

export function visiblePaletteGroups(
  groups: PaletteGroup[],
  opts: { skillLevel: SkillLevel | ''; advancedEnabled: boolean }
): PaletteGroup[] {
  if (opts.skillLevel === 'low' && !opts.advancedEnabled) {
    return groups.filter((g) => !isAdvancedGroup(g.id));
  }
  return groups;
}

// Режим раскрытия групп палитры: «аккордеон» (открыта максимум одна) или
// «свободно» (открыто сколько угодно). Это пользовательская настройка.
export type PaletteMode = 'accordion' | 'free';

export function isPaletteMode(v: unknown): v is PaletteMode {
  return v === 'accordion' || v === 'free';
}

// Какие группы открыты после клика по заголовку. Чистая функция — её поведение
// зафиксировано тестами, компонент только рисует результат.
export function nextOpenGroups(
  mode: PaletteMode,
  open: PaletteGroupId[],
  id: PaletteGroupId
): PaletteGroupId[] {
  const isOpen = open.includes(id);
  if (mode === 'accordion') {
    // Аккордеон: клик по открытой группе закрывает её (пустая палитра — норма),
    // клик по другой закрывает предыдущую.
    return isOpen ? [] : [id];
  }
  return isOpen ? open.filter((x) => x !== id) : [...open, id];
}

// Группа по умолчанию: у нового пользователя раскрыто «Содержимое».
export const DEFAULT_OPEN_GROUPS: PaletteGroupId[] = ['content'];

// ВНИМАНИЕ: это отдельный список от PALETTE_GROUPS — раньше они могли разойтись
// (тип обновляли в одном месте, ids — в другом), и сохранённое состояние групп
// молча отваливалось. Тест tests/registry.test.ts сверяет оба списка, поэтому
// добавление группы обязано тронуть и PALETTE_GROUPS, и этот массив.
export const PALETTE_GROUP_IDS: PaletteGroupId[] = [
  'content',
  'keyboards',
  'input',
  'logic',
  'data',
  'time',
  'audience',
  'payments',
  'ai',
  'integrations',
  'referral',
  'flow',
  'advanced',
];

// Старые id групп из localStorage. Значение переживает в браузере перезапуск
// приложения и смену версии палитры: у пользователя, открывшего «Сообщения»
// месяц назад, в 'palette.openGroups' лежит 'messages'. Без этой карты его
// палитра открылась бы пустой. 'messages' → 'content', остальные прежние id
// совпадают с новыми; неизвестные id просто отбрасываются.
export const LEGACY_GROUP_IDS: Record<string, PaletteGroupId> = {
  messages: 'content',
  input: 'input',
  logic: 'logic',
  integrations: 'integrations',
  referral: 'referral',
  data: 'data',
  flow: 'flow',
};

// Разбор того, что лежит в localStorage. Битый JSON, чужие значения и повторы
// не должны ломать палитру — в худшем случае вернём значение по умолчанию.
export function parseOpenGroups(raw: string | null): PaletteGroupId[] {
  if (!raw) return [...DEFAULT_OPEN_GROUPS];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_OPEN_GROUPS];
    const out: PaletteGroupId[] = [];
    for (const v of parsed) {
      if (typeof v !== 'string') continue;
      const id = (PALETTE_GROUP_IDS as string[]).includes(v)
        ? (v as PaletteGroupId)
        : LEGACY_GROUP_IDS[v];
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  } catch {
    return [...DEFAULT_OPEN_GROUPS];
  }
}

// ------------------------------------------------------------------ поиск

// Нормализация для поиска: регистр, лишние пробелы и ё/е не должны мешать
// («счёт» и «счет» — одно и то же слово для человека).
export function normalizeSearch(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
}

export interface PaletteMatch {
  groupId: PaletteGroupId;
  blocks: BlockType[];
}

// Поиск по палитре. Ищем ТОЛЬКО по именам: подпись блока, его машинный тип и
// заголовок группы. Описания не трогаем — иначе поиск совпадает со половиной
// палитры на любое слово. Если совпал заголовок группы — показываем её целиком.
export function matchPalette(
  query: string,
  groups: PaletteGroup[],
  labelOf: (type: BlockType) => string,
  titleOf: (key: TKey) => string
): PaletteMatch[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const out: PaletteMatch[] = [];
  for (const g of groups) {
    const title = normalizeSearch(titleOf(g.title));
    if (title.includes(q)) {
      out.push({ groupId: g.id, blocks: [...g.items] });
      continue;
    }
    const blocks = g.items.filter(
      (type) => normalizeSearch(labelOf(type)).includes(q) || normalizeSearch(type).includes(q)
    );
    if (blocks.length) out.push({ groupId: g.id, blocks });
  }
  return out;
}

export function defaultBlock(type: BlockType, id: string): Block {
  const base: Block = { id, type, params: {} as BlockParams };
  switch (type) {
    case 'start':
      return { ...base, params: { command: '/start' }, next: '' };
    case 'message':
      return { ...base, params: { text: 'Привет, {{name}}!' }, next: '' };
    case 'buttons':
      return {
        ...base,
        params: {
          prompt: 'Выбери:',
          layout: 'inline',
          buttons: [
            { id: 'b1', label: 'Да', value: 'yes' },
            { id: 'b2', label: 'Нет', value: 'no' },
          ],
        },
        branches: { yes: '', no: '' },
      };
    case 'input':
      return { ...base, params: { var: 'name', kind: 'text', prompt: 'Как тебя зовут?' }, next: '' };
    case 'condition':
      return { ...base, params: { condVar: 'name', op: '==', condValue: '' }, branches: { then: '', else: '' } };
    case 'action':
      return { ...base, params: { actionKind: 'webhook', url: '', method: 'POST' }, next: '' };
    case 'goto':
      return { ...base, params: { target: '' } };
    case 'media':
      return { ...base, params: { mediaType: 'photo', mediaUrl: '', caption: '' }, next: '' };
    case 'subscription':
      return { ...base, params: { subAction: 'subscribe' }, next: '' };
    case 'menu':
      return {
        ...base,
        params: { menuPrompt: 'Меню:', buttons: [{ label: 'Пункт 1', value: 'm1' }, { label: 'Пункт 2', value: 'm2' }] },
        branches: { m1: '', m2: '' },
      };
    case 'command':
      return { ...base, params: { command: '/help', prompt: 'Помощь:' }, next: '' };
    case 'keyword':
      return { ...base, params: { keywords: 'цена, сколько стоит', matchMode: 'contains' }, branches: { hit: '', miss: '' } };
    case 'setvar':
      return { ...base, params: { assignVar: 'count', expr: '{{count}} + 1' }, next: '' };
    case 'http':
      return {
        ...base,
        params: { url: 'https://api.example.com/price', method: 'GET', outVar: 'api', jsonPath: '' },
        next: '',
      };
    case 'ai':
      return {
        ...base,
        params: { aiPrompt: 'Ответь вежливо на вопрос: {{last_input}}', aiVar: 'ai', aiReply: true },
        next: '',
      };
    case 'random':
      return {
        ...base,
        params: { options: [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }] },
        branches: { a: '', b: '' },
      };
    case 'switch':
      return {
        ...base,
        params: { switchVar: 'city', cases: [{ value: 'Москва' }, { value: 'СПб' }] },
        branches: { c0: '', c1: '', default: '' },
      };
    case 'contact':
      return { ...base, params: { request: 'contact', var: 'phone', prompt: 'Отправьте номер кнопкой ниже' }, next: '' };
    case 'note':
      return { ...base, params: { note: 'Пояснение для себя' }, next: '' };
    case 'referral':
      return { ...base, params: { refVar: 'ref.link', refPayload: '' }, next: '' };
    case 'referral_track':
      return { ...base, params: {}, branches: { ok: '', already_tracked: '', self_referral_blocked: '' } };
    case 'referral_check':
      return { ...base, params: {}, branches: { yes: '', no: '' } };
    case 'referral_bonus':
      return {
        ...base,
        params: { refTrigger: 'nth_referral', refTriggerN: 5, refBonusKind: 'send_message', refBonusText: '' },
        branches: { granted: '', skipped: '', failed: '' },
      };
    case 'referral_hierarchy':
      return {
        ...base,
        params: { refTrigger: 'first_payment', refDepth: 2, refShares: [0.1, 0.05], refBonusText: '' },
        branches: { granted: '', skipped: '', failed: '' },
      };
    case 'referral_stats':
      return { ...base, params: { refText: '', refLimit: 5 }, next: '' };
    case 'referral_leaderboard':
      return {
        ...base,
        params: { refText: '', refSort: 'count', refPeriod: 'all_time', refLimit: 10 },
        next: '',
      };
    case 'referral_tournament':
      return {
        ...base,
        params: { refTournamentName: '', refStartsAt: '', refEndsAt: '', refMetric: 'count', refPrizePool: '', refPrizeSplit: '50/30/20' },
        branches: { joined: '', already_in: '', tournament_not_running: '' },
      };
    case 'referral_verification':
      return { ...base, params: { refGate: 'subscribed', refMinAmount: 0, refGoalVar: '' }, next: '' };
    case 'antifraud':
      return {
        ...base,
        params: { refOnePerUser: true, refBlockSelf: true, refCooldownSec: 0, refMinAgeDays: 0 },
        next: '',
      };
    case 'media_group':
      // Два фото по умолчанию — минимум, который Telegram примет как альбом.
      return {
        ...base,
        params: {
          mediaItems: [
            { id: 'm1', type: 'photo', url: '', fileId: '', caption: '' },
            { id: 'm2', type: 'photo', url: '', fileId: '', caption: '' },
          ],
        },
        next: '',
      };
    case 'invoice':
      return {
        ...base,
        params: {
          invoice: {
            title: 'Пакет дизайнов',
            description: 'Доступ к каталогу на 30 дней',
            amount: 99000, // 990 RUB в копейках
            currency: 'RUB',
            label: 'Подписка',
            payload: 'sub_30d',
            providerToken: '',
          },
        },
        branches: { paid: '', cancelled: '' },
      };
    case 'data':
      return {
        ...base,
        params: { dataOp: 'add', collectionId: '', dataFields: {}, dataWhere: {}, outVar: '', dataLimit: 10 },
        branches: { found: '', not_found: '' },
      };
    case 'tag':
      return { ...base, params: { tagOp: 'add', tagName: '', tagVar: 'tags' }, next: '' };
    case 'chain':
      // Текст + фото по умолчанию: сразу видно, что каждое сообщение отдельное.
      return {
        ...base,
        params: {
          chainItems: [
            { id: 'c1', kind: 'text', text: 'Привет!' },
            { id: 'c2', kind: 'photo', url: '', fileId: '', caption: '' },
          ],
        },
        next: '',
      };
    case 'end':
      return { ...base };
    // --- набор 2026-09: дефолты по контракту движка и валидатора ---
    case 'poll':
      // Сразу викторина: два варианта, первый помечен правильным — автор
      // видит оба поля (correctOptionId/explanation) и может их убрать.
      return {
        ...base,
        params: {
          question: '',
          pollOptions: [{ id: 'o1', text: '' }, { id: 'o2', text: '' }],
          correctOptionId: 'o1',
          anonymous: true,
          multiple: false,
        },
        branches: { answered: '', skipped: '' },
      };
    case 'forward':
      return { ...base, params: { forwardMode: 'forward', toChatId: '' }, branches: { ok: '', failed: '' } };
    case 'chat_action':
      return { ...base, params: { chatAction: 'typing' }, next: '' };
    case 'wait':
      return {
        ...base,
        params: { seconds: 60, prompt: '', reminderText: 'Вы ещё тут?' },
        branches: { reply: '', timeout: '' },
      };
    case 'channel_check':
      return {
        ...base,
        params: { channelId: '', requireMembership: true, cacheMinutes: 10 },
        branches: { member: '', not_member: '', error: '' },
      };
    case 'segment_broadcast':
      return {
        ...base,
        params: { segmentTag: '', segmentText: '', chunkSize: 20, delayMs: 1000 },
        branches: { queued: '', empty: '' },
      };
    case 'user_stats':
      return { ...base, params: { outPrefix: 'user', template: '' }, next: '' };
    case 'payment_link':
      return {
        ...base,
        params: { connectionId: '', amount: '', currency: 'RUB', linkVar: 'pay.link', description: '' },
        branches: { created: '', failed: '' },
      };
    case 'payment_check':
      return { ...base, params: { connectionId: '', orderIdVar: 'pay.order' }, branches: { paid: '', pending: '', failed: '' } };
    case 'foreach':
      return { ...base, params: { listVar: '', itemVar: 'item', indexVar: 'i', maxIterations: 100 }, branches: { each: '', done: '' } };
    case 'random_text':
      return { ...base, params: { variants: [{ id: 'v1', text: '', weight: 1 }, { id: 'v2', text: '', weight: 1 }], send: true }, next: '' };
    case 'assert':
      return { ...base, params: { condVar: '', op: '==', condValue: '', failMessage: '' }, branches: { pass: '', fail: '' } };
    case 'counter':
      return {
        ...base,
        params: { counterName: '', counterScope: 'user', counterOp: 'inc', amount: 1, outVar: 'counter' },
        branches: { ok: '', limit_reached: '' },
      };
    case 'web_app':
      // Ссылка вставляется пустой: полный https://t.me/<bot>/<slug> подставляет
      // конструктор при публикации, автор задаёт только slug в настройках бота.
      return { ...base, params: { text: '', button: 'Открыть', url: '' }, next: '' };
    case 'schedule':
      // Регистрационный блок: ветвей нет, поток за next запускается по
      // расписанию (cron-тик воркера). Дефолты — из shared/limits.ts.
      return {
        ...base,
        params: {
          scheduleKind: 'daily',
          atTime: '10:00',
          weekdays: [1],
          everyMinutes: 60,
          cronExpr: '',
          scheduleAudience: 'all',
          audienceTag: '',
          timezone: 'Europe/Moscow',
        },
        next: '',
      };
    // --- подсценарии ---
    case 'subflow':
      // Группа палитры — 'flow' (решение: не плодить группу 'library' из двух
      // блоков; i18n-заголовок группы уже есть). Вызов вставляется пустым —
      // фрагмент выбирается в инспекторе.
      return { ...base, params: { scope: 'isolated' }, branches: { done: '', failed: '' } };
    case 'subflow_return':
      // Терминал фрагмента: без next и без веток. Вставляется только при
      // редактировании фрагмента (Constructor фильтрует палитру).
      return { ...base, params: {} };
    // --- набор 2026-10: дефолты по контракту движка и валидатора ---
    case 'edit_message':
      // Пустой msgRefVar = {{__bot_msg}}: самый частый сценарий — правка
      // последнего сообщения бота, автор не обязан знать переменную.
      return {
        ...base,
        params: { msgRefVar: '', editText: '' },
        branches: { ok: '', too_old: '', not_found: '' },
      };
    case 'delete_message':
      return { ...base, params: { msgRefVar: '' }, next: '' };
    case 'quiz':
      // Как poll: сразу два варианта и правильный помечен — поля викторины
      // видны автору с первого клика.
      return {
        ...base,
        params: {
          question: '',
          pollOptions: [{ id: 'o1', text: '' }, { id: 'o2', text: '' }],
          correctOptionId: 'o1',
          anonymous: true,
          quizFailText: '',
        },
        branches: { passed: '', failed: '' },
      };
    case 'language':
      return { ...base, params: { langCodes: ['ru', 'en'] }, branches: { ru: '', en: '', fallback: '' } };
    case 'timer_deadline':
      return {
        ...base,
        params: { deadlineAt: '', deadlineVar: '', cancelVar: '', deadlineText: '' },
        branches: { done: '', expired: '' },
      };
    case 'ai_classify':
      return {
        ...base,
        params: {
          classifyPrompt: '',
          classifyInput: '',
          classifyLabels: ['lead', 'question', 'spam'],
          classifyFallbackLabel: 'other',
          classifyOutVar: 'ai.label',
        },
        branches: { lead: '', question: '', spam: '', other: '' },
      };
    case 'webhook_in':
      // Триггер: как schedule, поток обязателен; токен создаётся при публикации.
      return { ...base, params: { webhookFields: [] }, next: '' };
    case 'location':
      return {
        ...base,
        params: { locationPrompt: '', locationButtonLabel: '' },
        branches: { sent: '', declined: '' },
      };
  }
}

// Ключ текста гайда для блока: справочник в Guide генерируется из BLOCK_META
// плюс этот ключ — руками по блокам он не поддерживается, поэтому новый тип
// автоматически появляется в гайде (а registry-тест не даёт забыть перевод).
export function guideTextKey(type: BlockType): TKey {
  return `block.${type}.example` as TKey;
}

// Короткая подпись под заголовком узла. Переводимые куски идут через словарь;
// значения из params — это данные пользователя, их не трогаем.
export function summary(b: Block, ln?: Lang): string {
  const p = b.params;
  const T = (key: TKey, vars?: Record<string, string | number>) => translate(ln ?? lang(), key, vars);
  // Маркеры набора 2026-09, общие для нескольких типов: разметка, правка
  // сообщения на месте и удаления. Они короче основного текста — если подпись
  // не влезет в 30 символов узла, маркер отрется первым.
  const marks = (base: string): string => {
    const extra: string[] = [];
    if (p.parseMode && p.parseMode !== 'none') extra.push(p.parseMode);
    if (p.updateMode === 'edit') extra.push(T('node.editMsg'));
    if (p.deleteUserMessage || p.deleteBotMessage) extra.push(T('node.deleteMsg'));
    return extra.length ? `${base} · ${extra.join(' · ')}` : base;
  };
  switch (b.type) {
    case 'message':
      return marks((p.text || '').slice(0, 48));
    case 'buttons':
      return marks((p.buttons || []).map((x) => x.label).join(' | '));
    case 'input':
      return marks(`→ ${p.var}${p.kind && p.kind !== 'text' ? ` (${p.kind})` : ''}`);
    case 'condition':
      return (p.conditions?.length ?? 0) > 1
        ? T('node.conditions', { n: p.conditions!.length })
        : `${p.condVar} ${p.op} ${p.condValue}`;
    case 'action':
      return p.actionKind || '';
    case 'goto':
      return `→ ${p.target}`;
    case 'media':
      return marks(`${p.mediaType || 'photo'}: ${(p.mediaUrl || p.fileId || '').slice(0, 32)}`);
    case 'subscription':
      return T('node.subscription', { value: p.subAction || '' });
    case 'menu':
      return marks(T('node.menu', { value: (p.buttons || []).map((x) => x.label).join(' | ') }));
    case 'start':
      return p.command || '/start';
    case 'command':
      return marks(p.command || '/help');
    case 'keyword':
      return (p.keywords || '').slice(0, 40);
    case 'setvar':
      return `${p.assignVar} = ${p.expr ?? ''}`;
    case 'http': {
      const base = `${p.method || 'GET'} → ${p.outVar || 'var'}`;
      const retries = Number(p.retries) || 0;
      return retries > 0 ? `${base} · ${T('node.retries', { n: retries })}` : base;
    }
    case 'ai':
      return marks(p.aiReply ? T('node.aiReply') : T('node.aiVar', { var: p.aiVar || 'var' }));
    case 'random':
      return (p.options || []).map((o) => `${o.key}:${o.weight}`).join(' ');
    case 'switch':
      return T('node.branches', { var: p.switchVar || '?', n: (p.cases || []).length });
    case 'contact':
      return marks(p.request === 'location' ? T('node.location') : T('node.phone', { var: p.var || 'var' }));
    case 'note':
      return (p.note || '').slice(0, 48);
    case 'referral':
      return p.refPayload ? `→ {{${p.refVar || 'ref.link'}}} · ${p.refPayload}` : `→ {{${p.refVar || 'ref.link'}}}`;
    case 'referral_track':
      return T('node.referral_track');
    case 'referral_check':
      return T('node.referral_check');
    case 'referral_bonus': {
      const trig = p.refTrigger || 'nth_referral';
      const label = T(`f.ref.trigger.${trig}` as TKey);
      return trig === 'nth_referral' ? `${label}: ${p.refTriggerN ?? 5}` : label;
    }
    case 'referral_hierarchy':
      return `${T('node.referral_hierarchy')}: ${(p.refShares || []).map((s) => `${Math.round((Number(s) || 0) * 100)}%`).join(' / ') || '—'}`;
    case 'referral_stats':
      return (p.refText || T('node.referral_stats')).slice(0, 48);
    case 'referral_leaderboard':
      return `${T(`f.ref.sort.${p.refSort || 'count'}` as TKey)} · ${T(`f.ref.period.${p.refPeriod || 'all_time'}` as TKey)}`;
    case 'referral_tournament':
      return p.refTournamentName ? String(p.refTournamentName).slice(0, 40) : T('node.referral_tournament');
    case 'referral_verification':
      return T(`f.ref.gate.${p.refGate || 'subscribed'}` as TKey);
    case 'antifraud': {
      const bits: string[] = [];
      if (p.refOnePerUser !== false) bits.push(T('f.ref.af.onePerUser.short'));
      if (p.refBlockSelf !== false) bits.push(T('f.ref.af.blockSelf.short'));
      if (Number(p.refCooldownSec) > 0) bits.push(`${T('f.ref.af.cooldown.short')}: ${p.refCooldownSec}с`);
      return bits.join(' · ') || T('node.antifraud');
    }
    case 'media_group':
      return marks(`${(p.mediaItems || []).length} × media`);
    case 'invoice':
      return marks(`${p.invoice?.label || p.invoice?.title || 'invoice'}: ${p.invoice?.amount ?? ''} ${p.invoice?.currency || 'RUB'}`);
    case 'data': {
      const op = p.dataOp || 'add';
      const label =
        op === 'add'
          ? T('f.data.op.add')
          : op === 'find'
          ? T('f.data.op.find')
          : op === 'update'
          ? T('f.data.op.update')
          : T('f.data.op.remove');
      return p.outVar ? `${label} → ${p.outVar}` : label;
    }
    case 'tag': {
      // Для «списка» полезнее переменная результата, для остальных — имя тега.
      const op = p.tagOp || 'add';
      const label = T(`f.tag.op.${op}` as TKey);
      if (op === 'clear') return label;
      return op === 'list' ? `${label} → {{${p.tagVar || 'tags'}}}` : `${label}: ${p.tagName || '…'}`;
    }
    case 'chain':
      return marks(T('node.chain', { n: (p.chainItems || []).length }));
    // --- набор 2026-09: подпись читается в ~30 символах узла ---
    case 'poll': {
      const n = (p.pollOptions || []).length;
      const quiz = p.correctOptionId ? T('node.poll.quiz') : '';
      const base = p.question ? (p.question as string).slice(0, 32) : T('node.poll');
      return quiz ? `${base} · ${quiz}` : n > 0 ? `${base} · ${T('node.poll.options', { n })}` : base;
    }
    case 'forward':
      return T(`node.forward.${p.forwardMode || 'forward'}` as TKey) + ` → ${(p.toChatId || '…').slice(0, 20)}`;
    case 'chat_action':
      return T(`f.chatAction.${p.chatAction || 'typing'}` as TKey);
    case 'wait':
      return T('node.wait', { s: p.seconds ?? 60 });
    case 'channel_check':
      return (p.channelId || '').slice(0, 40) || T('node.channel_check.empty');
    case 'segment_broadcast':
      return p.segmentTag
        ? T('node.segment.tag', { tag: String(p.segmentTag).slice(0, 24) })
        : (p.segmentText || '').slice(0, 32) || T('node.segment.empty');
    case 'user_stats':
      return `{{${p.outPrefix || 'user'}.*}}`;
    case 'payment_link':
      return T('node.payment', { amount: p.amount ?? '…', currency: p.currency || 'RUB' });
    case 'payment_check':
      return T('node.payment_check', { var: p.orderIdVar || 'pay.order' });
    case 'foreach':
      return T('node.foreach', { list: p.listVar || '…' });
    case 'random_text':
      return T('node.random_text', { n: (p.variants || []).length });
    case 'assert': {
      if ((p.conditions?.length ?? 0) > 1) return T('node.conditions', { n: p.conditions!.length });
      const expr = `${p.condVar} ${p.op ?? '=='} ${p.condValue ?? ''}`.trim();
      return expr || T('node.assert.empty');
    }
    case 'counter': {
      const op = p.counterOp || 'inc';
      const name = p.counterName || '…';
      return p.counterMax
        ? T('node.counter.limit', { name, max: p.counterMax })
        : T(`node.counter.${op}` as TKey, { name });
    }
    case 'web_app':
      return marks(p.button ? `${p.button}` : T('node.web_app.empty'));
    case 'schedule': {
      // Сводка расписания: вид + время/период + аудитория. Укладывается в
      // ~30 символов узла; cron-выражение усекаем.
      const kind = p.scheduleKind || 'daily';
      const time = String(p.atTime || '10:00');
      let base: string;
      if (kind === 'weekly') base = T('node.schedule.weekly', { time, n: (p.weekdays || []).length });
      else if (kind === 'interval') base = T('node.schedule.interval', { n: p.everyMinutes ?? 60 });
      else if (kind === 'cron') base = T('node.schedule.cron', { expr: String(p.cronExpr || '…').slice(0, 14) });
      else base = T('node.schedule.daily', { time });
      const aud =
        p.scheduleAudience === 'tag'
          ? p.audienceTag
            ? String(p.audienceTag).slice(0, 12)
            : T('node.schedule.aud.tag')
          : p.scheduleAudience === 'single'
            ? T('node.schedule.aud.single')
            : T('node.schedule.aud.all');
      return `⏰ ${base} · ${aud}`;
    }
    case 'subflow': {
      // Подпись вызова: → <фрагмент> (rev N) — укладывается в ~30 символов узла.
      const name = String(p.alias || p.subflowId || '').slice(0, 18);
      return p.subflowRevision != null
        ? T('node.subflow.rev', { name: name || '…', rev: p.subflowRevision })
        : T('node.subflow', { name: name || '…' });
    }
    case 'subflow_return': {
      const n = Object.keys(p.outputs || {}).length;
      return n ? T('node.subflow_return.outputs', { n }) : T('node.subflow_return');
    }
    // --- набор 2026-10: подпись читается в ~30 символах узла ---
    case 'edit_message':
      return T('node.edit_message', { ref: p.msgRefVar ? String(p.msgRefVar).slice(0, 16) : T('node.edit_message.last') });
    case 'delete_message':
      return T('node.delete_message', { ref: p.msgRefVar ? String(p.msgRefVar).slice(0, 16) : T('node.edit_message.last') });
    case 'quiz': {
      const n = (p.pollOptions || []).length;
      return p.question ? (p.question as string).slice(0, 32) : T('node.quiz', { n });
    }
    case 'language':
      return T('node.language', { codes: (p.langCodes || []).join('/') || '…' });
    case 'timer_deadline':
      return T('node.timer_deadline', { when: String(p.deadlineAt || p.deadlineVar || '…').slice(0, 20) });
    case 'ai_classify':
      return T('node.ai_classify', { n: (p.classifyLabels || []).length });
    case 'webhook_in':
      return T('node.webhook_in');
    case 'location':
      return (p.locationPrompt || '').slice(0, 32) || T('node.location');
    case 'end':
      return '';
  }
  return '';
}

// Human-readable label for a node, used in branch selectors and previews.
export function nodeLabel(b: Block, ln?: Lang): string {
  // Неизвестный тип (сценарий из будущего/битый JSON) не должен ронять фронт:
  // метаданных нет — показываем машинное имя типа как есть.
  const meta = BLOCK_META[b.type];
  if (!meta) return String(b.type ?? '?');
  const s = summary(b, ln);
  const base = s ? `${meta.label}: ${s}` : meta.label;
  return base.length > 30 ? base.slice(0, 29) + '…' : base;
}
