// Порты блока: каждая исходящая ветка становится отдельным источником связи на
// узле. Модель сценария при этом НЕ меняется — `next`, `branches` и
// `goto.params.target` остаются как есть, порты только рисуют их.
//
// Раньше связи рисовались одним правым кружком, а куда ведёт каждая кнопка —
// выбиралось списком в инспекторе: на холсте этого не было видно.
import { Block, usesBranches } from '../../shared/types';
import { translate, type TKey, type Lang } from './i18n';

export type PortKind = 'next' | 'branch';

export interface Port {
  /** id handle'а: 'next' либо 'branch:<ключ ветки>'. */
  id: string;
  /** Подпись рядом с портом (имя кнопки, «да»/«нет», «оплатил»/«отменил»). */
  label: string;
  kind: PortKind;
  /** Ключ ветки для branch-порта; для next — undefined. */
  branchKey?: string;
}

export function handleIdFor(kind: PortKind, branchKey?: string): string {
  return kind === 'next' ? 'next' : `branch:${branchKey ?? ''}`;
}

// Разбор handle'а обратно в адрес записи: нужен onConnect'у, чтобы писать
// `block.next` или `branches[key]`. Позиция порта тут не участвует.
export function parseHandleId(id: string): { kind: PortKind; branchKey?: string } {
  if (id.startsWith('branch:')) return { kind: 'branch', branchKey: id.slice('branch:'.length) };
  return { kind: 'next' };
}

// Подписи веток, у которых нет собственного текста в params: они переводятся.
const BRANCH_LABEL_KEYS: Record<string, TKey> = {
  then: 'port.then',
  else: 'port.else',
  hit: 'port.hit',
  miss: 'port.miss',
  found: 'port.found',
  not_found: 'port.notFound',
  paid: 'port.paid',
  cancelled: 'port.cancelled',
  default: 'port.default',
  // реферальная система
  ok: 'port.ref.ok',
  already_tracked: 'port.ref.alreadyTracked',
  self_referral_blocked: 'port.ref.selfBlocked',
  yes: 'port.ref.yes',
  no: 'port.ref.no',
  granted: 'port.ref.granted',
  skipped: 'port.ref.skipped',
  failed: 'port.ref.failed',
  joined: 'port.ref.joined',
  already_in: 'port.ref.alreadyIn',
  tournament_not_running: 'port.ref.notRunning',
  // Ключи веток набора 2026-09 (answered, reply, timeout, ...) в эту карту НЕ
  // добавлены: у poll/forward/payment свои i18n-ключи портов, потому что часть
  // ключей веток совпадает по имени с реферальными, но отличается по смыслу
  // («skipped» — «пропущен» у бонуса и «пропустил» у опроса). // TODO(prompt-2): full UI
};

function L(key: TKey, lang?: Lang): string {
  return translate(lang ?? 'ru', key);
}

// Порты блока. Порядок соответствует тому, как ветки заданы автором.
export function portsOf(b: Block, lang?: Lang): Port[] {
  if (b.type === 'end' || b.type === 'goto' || b.type === 'subflow_return') return [];
  const params = b.params ?? {};
  const branches = b.branches ?? {};

  if (!usesBranches(b.type)) {
    return [{ id: 'next', label: '', kind: 'next' }];
  }

  const ports: Port[] = [];
  const push = (key: string, label: string) =>
    ports.push({ id: handleIdFor('branch', key), label, kind: 'branch', branchKey: key });

  switch (b.type) {
    case 'buttons':
    case 'menu': {
      // Ключ ветки — значение кнопки, подпись порта — её текст.
      const buttons = params.buttons || [];
      if (buttons.length) {
        for (const btn of buttons) {
          if (!btn.url) push(btn.value, btn.label || btn.value);
        }
      } else {
        for (const key of Object.keys(branches)) push(key, key);
      }
      break;
    }
    case 'condition': {
      for (const key of ['then', 'else']) {
        push(key, BRANCH_LABEL_KEYS[key] ? L(BRANCH_LABEL_KEYS[key], lang) : key);
      }
      break;
    }
    case 'switch': {
      const cases = params.cases || [];
      cases.forEach((c, i) => push(`c${i}`, c.value || `c${i}`));
      push('default', L('port.default', lang));
      break;
    }
    case 'invoice': {
      push('paid', L('port.paid', lang));
      push('cancelled', L('port.cancelled', lang));
      break;
    }
    case 'keyword': {
      push('hit', L('port.hit', lang));
      push('miss', L('port.miss', lang));
      break;
    }
    case 'random': {
      for (const o of params.options || []) push(o.key, `${o.key} · ${o.weight}`);
      break;
    }
    case 'data': {
      push('found', L('port.found', lang));
      push('not_found', L('port.notFound', lang));
      break;
    }
    case 'referral_track': {
      for (const key of ['ok', 'already_tracked', 'self_referral_blocked']) {
        push(key, L(BRANCH_LABEL_KEYS[key], lang));
      }
      break;
    }
    case 'referral_check': {
      for (const key of ['yes', 'no']) {
        push(key, L(BRANCH_LABEL_KEYS[key], lang));
      }
      break;
    }
    case 'referral_bonus':
    case 'referral_hierarchy': {
      for (const key of ['granted', 'skipped', 'failed']) {
        push(key, L(BRANCH_LABEL_KEYS[key], lang));
      }
      break;
    }
    case 'referral_tournament': {
      for (const key of ['joined', 'already_in', 'tournament_not_running']) {
        push(key, L(BRANCH_LABEL_KEYS[key], lang));
      }
      break;
    }
    // --- набор 2026-09: ключи веток сверены с движком (worker/src/engine.ts) ---
    // TODO(prompt-2): full UI
    case 'poll': { // TODO(prompt-2): full UI
      push('answered', L('port.answered', lang));
      push('skipped', L('port.pollSkipped', lang));
      break;
    }
    case 'forward': { // TODO(prompt-2): full UI
      push('ok', L('port.fwdOk', lang));
      push('failed', L('port.fwdFailed', lang));
      break;
    }
    case 'wait': { // TODO(prompt-2): full UI
      push('reply', L('port.reply', lang));
      push('timeout', L('port.timeout', lang));
      break;
    }
    case 'channel_check': { // TODO(prompt-2): full UI
      push('member', L('port.member', lang));
      push('not_member', L('port.notMember', lang));
      push('error', L('port.error', lang));
      break;
    }
    case 'segment_broadcast': { // TODO(prompt-2): full UI
      push('queued', L('port.queued', lang));
      push('empty', L('port.empty', lang));
      break;
    }
    case 'payment_link': { // TODO(prompt-2): full UI
      push('created', L('port.created', lang));
      push('failed', L('port.failed', lang));
      break;
    }
    case 'payment_check': { // TODO(prompt-2): full UI
      push('paid', L('port.paid', lang));
      push('pending', L('port.pending', lang));
      push('failed', L('port.failed', lang));
      break;
    }
    case 'foreach': { // TODO(prompt-2): full UI
      push('each', L('port.each', lang));
      push('done', L('port.done', lang));
      break;
    }
    case 'assert': { // TODO(prompt-2): full UI
      push('pass', L('port.pass', lang));
      push('fail', L('port.fail', lang));
      break;
    }
    case 'counter': { // TODO(prompt-2): full UI
      push('ok', L('port.ok', lang));
      push('limit_reached', L('port.limitReached', lang));
      break;
    }
    case 'subflow': {
      // Вызов фрагмента: «выполнен» (done) и «сбой» (failed).
      push('done', L('port.sfDone', lang));
      push('failed', L('port.sfFailed', lang));
      break;
    }
    // --- набор 2026-10: ключи веток сверены с движком и валидатором ---
    case 'edit_message': {
      push('ok', L('port.editOk', lang));
      push('too_old', L('port.editTooOld', lang));
      push('not_found', L('port.editNotFound', lang));
      break;
    }
    case 'quiz': {
      push('passed', L('port.quizPassed', lang));
      push('failed', L('port.quizFailed', lang));
      break;
    }
    case 'language': {
      // Ветки — коды языков автора: подпись порта = сам код (машинное имя и
      // есть человекочитаемое), плюс резервная.
      for (const code of params.langCodes || []) push(String(code), String(code));
      push('fallback', L('port.langFallback', lang));
      break;
    }
    case 'timer_deadline': {
      push('done', L('port.tdDone', lang));
      push('expired', L('port.tdExpired', lang));
      break;
    }
    case 'ai_classify': {
      // Ветки — метки автора: подпись = сама метка; резервная — своим именем.
      for (const label of params.classifyLabels || []) push(String(label), String(label));
      push(String(params.classifyFallbackLabel || 'other'), String(params.classifyFallbackLabel || 'other'));
      break;
    }
    case 'location': {
      push('sent', L('port.locSent', lang));
      push('declined', L('port.locDeclined', lang));
      break;
    }
    default:
      break;
  }
  // После разветвления некоторые блоки имеют и общий проход «Далее»,
  // независимый от исходов ветвления. Отрисовываем его отдельным handle.
  if (b.next) ports.push({ id: 'next', label: '', kind: 'next' });
  return ports;
}

// Ветки, у которых порта не нашлось: бывает у старых сценариев (кнопку
// переименовали/удалили, а запись в branches осталась). Такие ветки получают
// порт с техническим ключом — иначе React Flow не найдёт источник для готовой
// стрелки и связь пропадёт с холста молча.
export function orphanPorts(b: Block, existing: Port[]): Port[] {
  const taken = new Set(existing.map((p) => p.branchKey));
  const out: Port[] = [];
  for (const key of Object.keys(b.branches ?? {})) {
    if (taken.has(key)) continue;
    out.push({ id: handleIdFor('branch', key), label: key, kind: 'branch', branchKey: key });
  }
  return out;
}

// Порты вместе с осиротевшими ветками — то, что реально рисует узел.
export function portsForNode(b: Block, lang?: Lang): Port[] {
  const ports = portsOf(b, lang);
  // У «Конца», «Перехода» и терминала фрагмента исходящих связей не бывает.
  if (b.type === 'end' || b.type === 'goto' || b.type === 'subflow_return') return ports;
  return [...ports, ...orphanPorts(b, ports)];
}

// Связь считаем «нарисованной» только если она ведёт к живой ветке блока.
// Нужно, чтобы удаление кнопки не оставляло висящую стрелку.
export function hasPort(b: Block, key: string): boolean {
  return portsOf(b).some((p) => p.branchKey === key);
}
