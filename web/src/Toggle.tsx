// Единый переключатель-«свитч» (овал с бегунком): одна форма на весь продукт.
// Раньше SettingsModal и PaymentsPage рендерили каждый свой button с
// role="switch", и мобильный оверрайд button{min-height:44px} растягивал их
// в квадрат. Теперь разметка живёт ровно в одном месте.
export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  title,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      className={`switch ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}
