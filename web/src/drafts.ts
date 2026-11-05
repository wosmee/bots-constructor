// Решение о черновике: показать его автору, выбросить или не заметить.
//
// Логика вынесена из компонента в чистую функцию намеренно: от неё зависит,
// потеряет ли автор свою работу. Ошибка здесь — это либо молча затёртый
// сценарий, либо вечное предложение «восстановить» то, что уже сохранено.
import { jsonContentHash } from '../../shared/graph';

export type DraftVerdict =
  // Черновика нет вовсе.
  | { kind: 'none' }
  // Черновик совпадает с сохранённым сценарием — он больше не нужен.
  | { kind: 'same' }
  // Черновик отличается: есть незавершённые правки, спрашиваем автора.
  | { kind: 'differs'; updatedAt: number };

export function decideDraft(savedJson: string, draft: { flow_json: string; updated_at: number } | null): DraftVerdict {
  const draftJson = draft?.flow_json ?? '';
  if (!draftJson) return { kind: 'none' };
  // Сравниваем по содержимому, а не строками: порядок ключей и пробелы в JSON
  // не должны выдавать ложное «есть незавершённые правки».
  if (jsonContentHash(draftJson) === jsonContentHash(savedJson)) return { kind: 'same' };
  return { kind: 'differs', updatedAt: Number(draft?.updated_at) || 0 };
}

// Нужно ли вообще отправлять черновик на сервер. Пустая и повторная отправка —
// лишний трафик на каждое движение блока по холсту.
export function shouldFlushDraft(currentJson: string, savedJson: string, lastFlushedJson: string): boolean {
  if (!currentJson) return false;
  return currentJson !== savedJson && currentJson !== lastFlushedJson;
}
