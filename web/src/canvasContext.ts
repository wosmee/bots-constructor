// Подсказки, которые нужны каждому узлу на холсте (конфликты, режим «сон»).
// Через контекст, а не через node.data: иначе при каждом пересчёте пришлось бы
// пересоздавать массив узлов и сбивать состояние react-flow.
import { createContext, useContext } from 'react';
import type { Conflict } from './conflicts';

export interface CanvasHints {
  conflicts: Map<string, Conflict[]>;
  /** Готовый (уже переведённый) текст проблем по каждому блоку. */
  conflictText: Map<string, string>;
  /** null — режим «сон» выключен; иначе множество «бодрствующих» блоков. */
  sleepActive: Set<string> | null;
  /** Подпись «заморожен» для ❄-бейджа — узлы вне React-дерева переводов. */
  tFrozen?: string;
  onConflictClick?: (blockId: string) => void;
  /** Клик-соединение: от какого порта сейчас тянут связь (или null). */
  connectFrom?: { nodeId: string; handleId: string } | null;
  /** Клик по порту узла — вход в режим соединения. */
  onPortClick?: (nodeId: string, handleId: string) => void;
  /** Подпись «дальше в этот блок» для подсветки кандидатов. */
  connectTargetHint?: string;
  /** Язык интерфейса: подписи портов зависят от него, а узлы живут вне useT. */
  lang?: 'ru' | 'en';
  /** Статусы блоков вызова подсценариев (subflow-check): бейджи на узлах. */
  sfStatus?: Map<string, { status: string; latestRevision?: number }>;
  /** Подписи бейджей подсценариев — узлы вне дерева переводов. */
  sfLabels?: { outdated: string; missing: string; cycle: string };
  /** Двойной клик по узлу: вход в фрагмент подсценария. */
  onNodeDoubleClick?: (nodeId: string) => void;
}

const EMPTY: CanvasHints = { conflicts: new Map(), conflictText: new Map(), sleepActive: null, connectFrom: null };

export const CanvasHintsContext = createContext<CanvasHints>(EMPTY);

export function useCanvasHints(): CanvasHints {
  return useContext(CanvasHintsContext);
}
