// Экран выбора уровня подготовки. Показывается один раз после регистрации
// или первого входа, пока на бэке skill_level пуст. Закрыть «в никуда» нельзя:
// уровень определяет плотность интерфейса, а сменить его можно в Настройках.
import { useState } from 'react';
import { useT } from './i18n';
import { useModalA11y } from './useModalA11y';
import type { SkillLevel } from './settings';
import type { TKey } from './i18n';

const OPTIONS: { value: SkillLevel; title: TKey; desc: TKey }[] = [
  { value: 'high', title: 'skill.high', desc: 'skill.high.desc' },
  { value: 'medium', title: 'skill.medium', desc: 'skill.medium.desc' },
  { value: 'low', title: 'skill.low', desc: 'skill.low.desc' },
];

export function SkillLevelModal({ onPick }: { onPick: (level: SkillLevel) => void }) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  // Только фокус-треп (WU-05): окно принципиально не закрывается — уровень
  // обязан быть выбран, поэтому Esc-обработчика нет.
  const modalRef = useModalA11y<HTMLDivElement>(null);

  async function pick(level: SkillLevel) {
    if (saving) return;
    setSaving(true);
    onPick(level);
  }

  return (
    <div className="modal-backdrop skill-backdrop">
      <div ref={modalRef} className="modal skill-modal" role="dialog" aria-modal="true" aria-label={t('skill.title')}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('skill.title')}</h2>
          </div>
        </header>
        <div className="modal-body">
          <section className="modal-section">
            <p className="muted">{t('skill.subtitle')}</p>
            <div className="skill-options">
              {OPTIONS.map((o) => (
                <button key={o.value} className="skill-option" disabled={saving} onClick={() => void pick(o.value)}>
                  <span className="skill-option-title">{t(o.title)}</span>
                  <span className="muted">{t(o.desc)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
