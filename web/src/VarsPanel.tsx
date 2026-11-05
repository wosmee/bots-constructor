// Панель переменных сценария: где пишутся, где читаются и где опечатались.
// Опечатка в {{var}} — самая частая причина «бот молчит», и раньше её можно
// было найти только глазами по каждому блоку.
import { useMemo } from 'react';
import type { Node } from '@xyflow/react';
import { collectVars } from './graph';
import { nodeLabel } from './blocks';
import { useT } from './i18n';
import { useSettings } from './settings';
import { useModalA11y } from './useModalA11y';
import { X } from './icons';

export function VarsPanel({
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
  // Esc + фокус-треп (WU-05/UX-02).
  const modalRef = useModalA11y<HTMLDivElement>(onClose);
  const vars = useMemo(() => collectVars(nodes, (b) => nodeLabel(b, language)), [nodes, language]);
  const known = new Set(vars.filter((v) => v.definedIn.length).map((v) => v.name));
  const system = new Set(['last_input', 'ref.link', 'ref.inviter', 'ref.count']);
  const orphans = vars.filter((v) => !v.definedIn.length && !system.has(v.name));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('vars.title')}</h2>
          </div>
          <button
            className="ghost icon-btn"
            onClick={onClose}
            aria-label={t('common.close.title')}
            title={t('common.close.title')}
          >
            <X />
          </button>
        </header>
        <div className="modal-body">
          {orphans.length > 0 && (
            <section className="modal-section">
              <div className="vars-warn">
                {t('vars.notDefined')}{' '}
                {orphans.map((v) => (
                  <span key={v.name} className="mono">
                    {v.name}
                  </span>
                ))}
              </div>
            </section>
          )}
          <section className="modal-section">
            {vars.length === 0 && <p className="muted">{t('vars.empty')}</p>}
            {vars.map((v) => (
              <div className="var-row" key={v.name}>
                <div className="var-name mono">{v.name}</div>
                <div className="var-meta">
                  <div>
                    <span className="muted">{t('vars.written')}</span>
                    {v.definedIn.length ? (
                      v.definedIn.map((d) => (
                        <button key={d.id} className="link" onClick={() => onPick(d.id)}>
                          {d.label}
                        </button>
                      ))
                    ) : system.has(v.name) ? (
                      <span className="muted">{t('vars.system')}</span>
                    ) : (
                      <span className="muted">{t('vars.dash')}</span>
                    )}
                  </div>
                  <div>
                    <span className="muted">{t('vars.read')}</span>
                    {v.usedIn.length ? (
                      v.usedIn.slice(0, 6).map((d, i) => (
                        <button key={`${d.id}-${i}`} className="link" onClick={() => onPick(d.id)}>
                          {d.label}
                        </button>
                      ))
                    ) : (
                      <span className="muted">{t('vars.notUsed')}</span>
                    )}
                    {v.usedIn.length > 6 && <span className="muted">{t('vars.andMore', { n: v.usedIn.length - 6 })}</span>}
                  </div>
                </div>
              </div>
            ))}
          </section>
          {known.size > 0 && (
            <section className="modal-section">
              <p className="muted vars-foot">{t('vars.foot')}</p>
            </section>
          )}
        </div>
        <footer className="modal-foot">
          <button className="ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
