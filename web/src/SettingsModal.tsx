import { useState } from 'react';
import { useSettings, useRole, updateSettings, type Settings, type SkillLevel, type PaletteMode } from './settings';
import { getTopbarMode, setTopbarMode, subscribeTopbarMode, type TopbarMode } from './topbar';
import { useSyncExternalStore } from 'react';
import { useT, type TKey } from './i18n';
import { api, setAdminKey, setSessionToken } from './api';
import { friendlyApiError } from './journey';
import { useModalA11y } from './useModalA11y';
import { Toggle } from './Toggle';
import { X } from './icons';

const SKILL_OPTIONS: Record<SkillLevel, TKey> = {
  high: 'skill.high',
  medium: 'skill.medium',
  low: 'skill.low',
};

const SKILL_HINT: Record<SkillLevel, TKey> = {
  high: 'skill.high.desc',
  medium: 'skill.medium.desc',
  low: 'skill.low.desc',
};

// Строка настройки: каркас (.set-row/.set-row-text) местный, а сам свитч —
// общий компонент Toggle из './Toggle' (одна форма на весь продукт).
function SettingRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="set-row">
      <div className="set-row-text">
        <span>{label}</span>
        {hint && <span className="muted">{hint}</span>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </label>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'seg active' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Пароль и сессии живут не в настройках профиля, а в отдельной секции:
// это действия с побочными эффектами (смена пароля гасит все входы).
function SecuritySection({ onAuthReset, onAccountDeleted }: { onAuthReset?: () => void; onAccountDeleted?: () => void }) {
  const t = useT();
  const { language } = useSettings();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  const changePassword = async () => {
    setBusy(true);
    setErr('');
    setNote('');
    try {
      const r = await api.changePassword(oldPassword, newPassword);
      // Старые сессии погашены сервером — подкладываем свежий токен, чтобы
      // эта вкладка не вылетела на экран входа.
      setSessionToken(r.token);
      // Паттерн «один вход гасит другой» (WU-08): смена пароля — вход под
      // аккаунтом, поэтому платформенный ключ из sessionStorage убираем.
      // Иначе resolveIdentity на воркере уходит в админ-ветку первой, и
      // аккаунт с ролью admin молча теряет свои боты.
      setAdminKey('');
      setOldPassword('');
      setNewPassword('');
      setNote(t('settings.password.done', { n: r.sessionsClosed }));
    } catch (e: any) {
      setErr(friendlyApiError(e, language));
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async () => {
    if (!confirm(t('settings.logoutAll.confirm'))) return;
    setBusy(true);
    setErr('');
    setNote('');
    try {
      const r = await api.logoutAll();
      setNote(t('settings.logoutAll.done', { n: r.sessionsClosed }));
      // Все токены недействительны — возвращаемся на экран входа.
      setTimeout(() => onAuthReset?.(), 600);
    } catch (e: any) {
      setErr(friendlyApiError(e, language));
    } finally {
      setBusy(false);
    }
  };

  const requestAccountDeletion = () => {
    setErr('');
    setNote('');
    setDeleteConfirming(true);
  };

  const cancelAccountDeletion = () => {
    setDeletePassword('');
    setDeleteConfirming(false);
  };

  const deleteAccount = async () => {
    setBusy(true);
    setErr('');
    setNote('');
    try {
      await api.deleteAccount(deletePassword);
      setDeletePassword('');
      onAccountDeleted?.();
      if (onAuthReset) {
        onAuthReset();
      } else {
        window.location.assign('/');
      }
    } catch (e: any) {
      // 401 wrong_password (code или русская строка сервера) — неверный пароль;
      // точное сравнение со старым литералом «Пароль не правильный» убрано:
      // сервер теперь отвечает «Пароль не верный» + code.
      const body = e?.body as { error?: unknown; code?: unknown } | undefined;
      const wrongPassword =
        e?.status === 401 && (body?.code === 'wrong_password' || /пароль не верн/i.test(String(body?.error ?? '')));
      setErr(wrongPassword ? t('settings.delete.passwordError') : friendlyApiError(e, language));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="set-group">
      <div className="set-label">{t('settings.security')}</div>

      <div className="set-subgroup">
        <div className="set-label">{t('settings.password.title')}</div>
        <div className="muted">{t('settings.password.hint')}</div>
        <input
          type="password"
          value={oldPassword}
          placeholder={t('settings.password.old')}
          autoComplete="current-password"
          onChange={(e) => setOldPassword(e.target.value)}
        />
        <input
          type="password"
          value={newPassword}
          placeholder={t('settings.password.new')}
          autoComplete="new-password"
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <button
          className="primary"
          disabled={busy || !oldPassword || newPassword.length < 6}
          onClick={() => void changePassword()}
        >
          {busy ? t('auth.busy') : t('settings.password.submit')}
        </button>
      </div>

      <div className="set-subgroup">
        <div className="set-label">{t('settings.sessions.title')}</div>
        <div className="muted">{t('settings.logoutAll.hint')}</div>
        <button className="ghost" disabled={busy} onClick={() => void logoutAll()}>
          {t('settings.logoutAll')}
        </button>
      </div>

      <div className="set-subgroup danger-zone">
        <div className="set-label">{t('settings.delete.title')}</div>
        <div className="muted">{t('settings.delete.hint')}</div>
        {!deleteConfirming ? (
          <>
            <input
              type="password"
              value={deletePassword}
              placeholder={t('settings.delete.password')}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
            />
            <button className="danger-action" disabled={busy || !deletePassword} onClick={requestAccountDeletion}>
              {t('settings.delete.start')}
            </button>
          </>
        ) : (
          <>
            <div className="delete-account-warning">{t('settings.delete.confirmHint')}</div>
            <div className="row-actions">
              <button className="danger-action" disabled={busy} onClick={() => void deleteAccount()}>
                {busy ? t('auth.busy') : t('settings.delete.confirm')}
              </button>
              <button disabled={busy} onClick={cancelAccountDeletion}>
                {t('settings.delete.cancel')}
              </button>
            </div>
          </>
        )}
      </div>

      {err && <div className="err">{err}</div>}
      {note && <div className="muted">{note}</div>}
    </div>
  );
}

export function SettingsModal({ onClose, onAuthReset, onAccountDeleted }: { onClose: () => void; onAuthReset?: () => void; onAccountDeleted?: () => void }) {
  const s = useSettings();
  const role = useRole();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // Режим верхней панели читается из того же стора, что и в конструкторе:
  // переключение здесь применяется в редакторе сразу, без перезагрузки.
  const barMode = useSyncExternalStore(subscribeTopbarMode, getTopbarMode, getTopbarMode);
  // Esc + фокус-треп (WU-05/UX-02).
  const modalRef = useModalA11y<HTMLDivElement>(onClose);

  const patch = async (p: Partial<Settings>) => {
    setSaving(true);
    setErr('');
    try {
      await updateSettings(p);
    } catch (e) {
      setErr(friendlyApiError(e, s.language));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal settings" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title">{t('settings.title')}</h2>
            <p className="modal-subtitle muted">{t('settings.subtitle')}</p>
          </div>
          <button
            className="ghost icon-btn"
            onClick={onClose}
            title={t('settings.close')}
            aria-label={t('settings.close')}
          >
            <X />
          </button>
        </header>

        <div className="modal-body">
          <div className="set-group">
            <div className="set-label">{t('settings.theme')}</div>
            <Segmented
              value={s.theme}
              options={[
                { value: 'dark', label: t('settings.theme.dark') },
                { value: 'light', label: t('settings.theme.light') },
              ]}
              onChange={(theme) => patch({ theme })}
            />
          </div>

          <div className="set-group">
            <div className="set-label">{t('settings.language')}</div>
            <Segmented
              value={s.language}
              options={[
                { value: 'ru', label: 'RU' },
                { value: 'en', label: 'EN' },
              ]}
              onChange={(language) => patch({ language })}
            />
          </div>

          <div className="set-group">
            <SettingRow
              checked={s.hints_enabled}
              onChange={(hints_enabled) => patch({ hints_enabled })}
              label={t('settings.hints')}
              hint={t('settings.hints.hint')}
            />
            <SettingRow
              checked={s.feature_whatif}
              onChange={(feature_whatif) => patch({ feature_whatif })}
              label={t('settings.whatif')}
              hint={t('settings.whatif.hint')}
            />
            <SettingRow
              checked={s.feature_conflicts}
              onChange={(feature_conflicts) => patch({ feature_conflicts })}
              label={t('settings.conflicts')}
              hint={t('settings.conflicts.hint')}
            />
            <SettingRow
              checked={s.feature_sleep}
              onChange={(feature_sleep) => patch({ feature_sleep })}
              label={t('settings.sleep')}
              hint={t('settings.sleep.hint')}
            />
            {/* Продвинутые блоки палитры: новичок включает их тумблером внизу
                палитры, а здесь можно выключить обратно. Один флаг на сервере
                (advanced_blocks), второго локального нет. */}
            <SettingRow
              checked={s.advanced_blocks}
              onChange={(advanced_blocks) => patch({ advanced_blocks })}
              label={t('settings.advanced')}
              hint={t('settings.advanced.hint')}
            />
          </div>

          <div className="set-group">
            <div className="set-label">{t('settings.skill')}</div>
            <Segmented
              value={s.skill_level}
              options={(Object.keys(SKILL_OPTIONS) as SkillLevel[]).map((v) => ({
                value: v,
                label: t(SKILL_OPTIONS[v]),
              }))}
              onChange={(skill_level) => patch({ skill_level })}
            />
            {s.skill_level && <div className="muted">{t(SKILL_HINT[s.skill_level])}</div>}
          </div>

          <div className="set-group">
            <div className="set-label">{t('settings.paletteMode')}</div>
            {/* Аккордеон — по умолчанию: у новичка палитра не должна быть
                простынёй из 24 блоков. «Свободно» — для тех, кто держит
                открытыми несколько разделов сразу. */}
            <Segmented<PaletteMode>
              value={s.palette_mode}
              options={[
                { value: 'accordion', label: t('settings.paletteMode.accordion') },
                { value: 'free', label: t('settings.paletteMode.free') },
              ]}
              onChange={(palette_mode) => patch({ palette_mode })}
            />
            <div className="muted">{t('settings.paletteMode.hint')}</div>
          </div>

          {/* Поведение панели стоит рядом с раскрытием палитры: обе настройки
              про то, как ведёт себя поверхность, а не про данные. Раньше это
              жило шестерёнкой в самой панели — два входа в настройки вместо
              одного, и один из них занимал место в строке постоянно. */}
          <div className="set-group">
            <div className="set-label">{t('settings.barMode')}</div>
            <Segmented<TopbarMode>
              value={barMode}
              options={[
                { value: 'slide', label: t('bar.mode.slide') },
                { value: 'always', label: t('bar.mode.always') },
              ]}
              onChange={(mode) => setTopbarMode(mode)}
            />
            <div className="muted">
              {t(barMode === 'slide' ? 'bar.mode.slide.hint' : 'bar.mode.always.hint')} {t('bar.mode.hint')}
            </div>
          </div>

          <div className="set-group">
            <div className="set-label">{t('settings.role')}</div>
            <div className="muted">
              <span className="mono">{role}</span>
            </div>
          </div>

          <SecuritySection onAuthReset={onAuthReset} onAccountDeleted={onAccountDeleted} />

          {err && <div className="err">{err}</div>}
          {saving && <div className="muted">{t('settings.saving')}</div>}
        </div>

        <footer className="modal-foot">
          {/* Настройки применяются сразу, «сохранить» нечего: единственная
              кнопка подвала — закрытие, значит primary здесь быть не может. */}
          <button className="ghost" onClick={onClose}>
            {t('settings.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
