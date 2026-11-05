// Чипсы переменных под текстовым полем: клик вставляет {{var}} в позицию
// курсора. Раньше переменные приходилось помнить наизусть и печатать руками —
// опечатка в {{name}} молча превращала сообщение в пустое место.
import { useT } from './i18n';
import type { VarInfo } from './graph';
import { insertAtCaret } from './vars';

export function VarChips({
  vars,
  getField,
  onInsert,
}: {
  vars: VarInfo[];
  /** Поле, в которое вставляем — именно оно держит курсор. */
  getField: () => HTMLInputElement | HTMLTextAreaElement | null;
  /** Дополнить значение в состоянии, если поле не найдено (fallback). */
  onInsert?: (name: string) => void;
}) {
  const t = useT();

  if (!vars.length) {
    return <div className="var-chips-empty muted">{t('chips.empty')}</div>;
  }

  return (
    <div className="var-chips">
      <span className="var-chips-title muted">{t('chips.title')}</span>
      <div className="var-chips-list">
        {vars.map((v) => {
          const origin = v.definedIn[0]?.label;
          return (
            <button
              key={v.name}
              type="button"
              className="var-chip"
              title={t('chips.insert', { var: v.name })}
              onClick={() => {
                const field = getField();
                if (field) insertAtCaret(field, `{{${v.name}}}`);
                else onInsert?.(v.name);
              }}
            >
              {v.name}
              {origin && <em>{t('chips.origin', { block: origin })}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
