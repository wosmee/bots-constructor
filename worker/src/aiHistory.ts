// Память диалога блока ai (§5). Чистые функции: движок и D1 не трогают,
// историю читает/пишет воркер (dispatchOuts). Отсутствие historyVar у блока
// полностью сохраняет прежнее поведение: system + один user-промпт.
import { AI_HISTORY_TURNS_DEFAULT, AI_HISTORY_TURNS_MAX, AI_PROMPT_BUDGET_BYTES } from '../../shared/limits';

export interface AiTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function isAiTurn(x: unknown): x is AiTurn {
  const t = x as AiTurn;
  return !!t && typeof t === 'object' && ['user', 'assistant', 'system'].includes(String(t.role)) && typeof t.content === 'string';
}

// Нормализация истории из переменной сценария: массив {role, content}, битые
// элементы отбрасываются, хвост — не больше turns ходов (ход = пара
// user+assistant, т.е. максимум turns*2 сообщений).
export function normalizeHistory(raw: unknown, turns: number): AiTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isAiTurn).slice(-Math.max(2, turns * 2));
}

export function clampTurns(raw: unknown): number {
  const n = Math.floor(Number(raw) || 0);
  if (n < 1) return AI_HISTORY_TURNS_DEFAULT;
  return Math.min(AI_HISTORY_TURNS_MAX, n);
}

function jsonBytes(messages: Array<{ role: string; content: string }>): number {
  // Оценка сверху без TextEncoder на каждый шаг: содержимое — строки, их
  // суммарная UTF-16 длина не меньше байтовой только для ASCII, поэтому
  // считаем честно в байтах.
  let total = 2; // []
  for (const m of messages) {
    total += typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(m.content).length
      : unescape(encodeURIComponent(m.content)).length;
    total += m.role.length + 30; // служебные символы JSON с запасом
  }
  return total;
}

export interface AssembledMessages {
  messages: Array<{ role: string; content: string }>;
  // Сколько СТАРЕЙШИХ ходов истории отброшено из-за бюджета 8 КБ.
  dropped: number;
  // История, которая помещается в бюджет (её воркер пишет обратно в vars).
  keptHistory: AiTurn[];
}

// messages = [system?, ...history, {role:'user', content: prompt}].
// Бюджет AI_PROMPT_BUDGET_BYTES: при превышении отбрасываем самые старые ходы
// (dropped — для лога ai.history.truncated.<n>); текущий промпт не отбрасывается
// НИКОГДА — вызов не должен падать из-за длинной истории.
export function assembleAiMessages(system: string, prompt: string, history: AiTurn[]): AssembledMessages {
  const sys = system && system.trim() ? [{ role: 'system', content: system }] : [];
  const user = [{ role: 'user', content: prompt }];
  const kept = [...history];
  let dropped = 0;
  let messages = [...sys, ...kept, ...user];
  while (kept.length && jsonBytes(messages) > AI_PROMPT_BUDGET_BYTES) {
    kept.shift();
    dropped++;
    messages = [...sys, ...kept, ...user];
  }
  return { messages, dropped, keptHistory: kept };
}

// Дополнить историю новым обменом. Пустой ответ модели НЕ добавляет пустой
// assistant-ход (§5). Хвост ограничен turns — переменная сценария не растёт
// бесконечно (vars_json пишется в D1 на каждом апдейте).
export function appendTurns(history: AiTurn[], prompt: string, answer: string, turns: number): AiTurn[] {
  const next = [...history, { role: 'user' as const, content: prompt }];
  if (answer && answer.trim()) next.push({ role: 'assistant' as const, content: answer });
  return next.slice(-Math.max(2, turns * 2));
}
