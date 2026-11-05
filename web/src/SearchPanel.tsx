// Поиск по блокам сценария (Ctrl+F). Ищет по типу, подписи и всем текстам
// параметров — на схемах в 50+ блоков это быстрее, чем искать глазами.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { searchBlocks } from './graph';
import { nodeLabel } from './blocks';
import { useT } from './i18n';
import { useSettings } from './settings';
import { X } from './icons';

export function SearchPanel({
  nodes,
  onPick,
  onClose,
}: {
  nodes: Node[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { language } = useSettings();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hits = useMemo(() => searchBlocks(nodes, q, (b) => nodeLabel(b, language)), [nodes, q, language]);

  return (
    <div className="search-panel" onClick={(e) => e.stopPropagation()}>
      <div className="search-row">
        <input
          ref={inputRef}
          placeholder={t('search.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        <button className="ghost icon-btn" onClick={onClose} title={t('search.close')} aria-label={t('search.close')}>
          <X />
        </button>
      </div>
      {q.trim() && (
        <div className="search-results">
          {hits.length === 0 && <div className="muted">{t('search.empty')}</div>}
          {hits.map((h) => (
            <button key={h.id} className="search-hit" onClick={() => onPick(h.id)}>
              {h.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
