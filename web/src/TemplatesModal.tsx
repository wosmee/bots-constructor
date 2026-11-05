// Модалка готовых сценариев. Вынесена из Constructor в отдельный чанк:
// тянет за собой весь каталог шаблонов (templates.ts), который на стартовом
// экране не нужен.
import { useState } from 'react';
import { TEMPLATES } from './templates';
import { useT } from './i18n';
import { useModalA11y } from './useModalA11y';
import { X } from './icons';
import { blockSupportedOn, type Platform } from '../../shared/platform';

// F3-310: шаблон, содержащий TG-only блоки, для VK-бота помечается бейджем
// «Telegram-only» — применение не блокируем (валидатор перехватит), но автор
// видит предупреждение до клика, а не после вставки.
function templateSupports(tpl: (typeof TEMPLATES)[number], platform: Platform): boolean {
  return Object.values(tpl.scenario.blocks ?? {}).every((b) => blockSupportedOn(b.type, platform));
}

export type TemplatePickMode = 'replace' | 'append';

export default function TemplatesModal({
  onClose,
  onPick,
  hasBlocks,
  platform = 'telegram',
}: {
  onClose: () => void;
  onPick: (t: (typeof TEMPLATES)[number], mode: TemplatePickMode) => void;
  hasBlocks: boolean;
  platform?: Platform;
}) {
  const t = useT();
  // Esc + фокус-треп (WU-05/UX-02).
  const modalRef = useModalA11y<HTMLDivElement>(onClose);
  // Раньше шаблон просто затирал холст. Теперь, если на холсте что-то есть,
  // спрашиваем: заменить или добавить рядом.
  const [ask, setAsk] = useState<(typeof TEMPLATES)[number] | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<(typeof TEMPLATES)[number] | null>(null);

  function open(tpl: (typeof TEMPLATES)[number]) {
    if (hasBlocks) {
      setAsk(tpl);
      return;
    }
    setSelectedTemplate(tpl);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal guide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('tpl.title')}</h2>
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
          {ask ? (
            <section className="modal-section">
              <div className="tpl-confirm">
                <p>{t('tpl.confirm', { name: ask.name })}</p>
                <div className="row-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      onPick(ask, 'replace');
                      onClose();
                    }}
                  >
                    {t('tpl.replace')}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      onPick(ask, 'append');
                      onClose();
                    }}
                  >
                    {t('tpl.append')}
                  </button>
                  <button className="ghost" onClick={() => setAsk(null)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="modal-section">
                <p className="muted">{t('tpl.intro')}</p>
              </section>
              <section className="modal-section">
                {TEMPLATES.map((tpl) => (
                  <div className={`tpl-card${selectedTemplate?.id === tpl.id ? ' selected' : ''}`} key={tpl.id}>
                    <div className="tpl-card-head">
                      <b>{tpl.name}</b>
                      <span className="tag">{t('tpl.blocks', { n: Object.keys(tpl.scenario.blocks).length })}</span>
                      {platform !== 'telegram' && !templateSupports(tpl, platform) && (
                        <span className="tag tpl-tg-only" title={t('tpl.tgOnly.hint')}>{t('tpl.tgOnly')}</span>
                      )}
                    </div>
                    <div className="muted">{tpl.description}</div>
                    <div className="row-actions">
                      <button
                        className={selectedTemplate?.id === tpl.id ? 'secondary' : ''}
                        onClick={() => open(tpl)}
                      >
                        {selectedTemplate?.id === tpl.id ? t('tpl.selected') : t('tpl.select')}
                      </button>
                      {selectedTemplate?.id === tpl.id && (
                        <button className="primary" onClick={() => { onPick(tpl, 'replace'); onClose(); }}>
                          {t('tpl.apply')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="tpl-card tpl-empty-start">
                  <div className="tpl-card-head"><b>{t('tpl.empty.title')}</b></div>
                  <div className="muted">{t('tpl.empty.text')}</div>
                  <div className="row-actions">
                    <button onClick={() => { onClose(); }}>{t('tpl.empty.action')}</button>
                  </div>
                </div>
              </section>
            </>
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
