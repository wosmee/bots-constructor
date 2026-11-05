// Страница «Оплата»: владелец подключает СВОЕГО платёжного провайдера.
// Принцип платформы (см. docs/CODEBASE.md и RUNBOOK миграции 0018): платформа
// не использует свой платёжный аккаунт, не проксирует деньги и не видит данные
// карт. Секреты принимаются ОДИН раз и наружу не возвращаются — API отдаёт
// только маску {has, keys}, поэтому здесь нигде не рендерится значение секрета.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  paymentWebhookUrl,
  type PaymentCheckProblem,
  type PaymentCheckResult,
  type PaymentConnection,
  type PaymentProviderId,
} from './api';
import { useT, type TKey } from './i18n';
import { useSettings } from './settings';
import { friendlyApiError } from './journey';
import { Toggle } from './Toggle';
import { ArrowLeft, Bot, Copy, Plus, RefreshCw, Trash } from './icons';
import './payments.css';

// Какие поля принимает воркер (sanitizeConfigInput / SECRET_KEYS, worker/src/index.ts).
type ConfigFieldKey = 'shopId' | 'successUrl' | 'failUrl' | 'linkTemplate';
type SecretFieldKey = 'providerToken' | 'secretKey' | 'password1' | 'password2' | 'webhookSecret';

const PROVIDERS: PaymentProviderId[] = ['telegram', 'yookassa', 'robokassa', 'stripe', 'custom'];

interface FieldSpec {
  key: string;
  label: TKey;
  help?: TKey;
  placeholder?: TKey;
}

interface ProviderSpec {
  config: FieldSpec[];
  secrets: FieldSpec[];
  testMode?: boolean;
}

// Форма провайдера: ровно те поля, которые проверяет /check и использует
// движок (worker/src/blocks/payments/providers.ts). Пути в кабинетах — из
// RUNBOOK миграции 0018, сверх него не выдумываем.
const PROVIDER_SPECS: Record<PaymentProviderId, ProviderSpec> = {
  telegram: {
    config: [],
    secrets: [{ key: 'providerToken', label: 'payments.field.providerToken', help: 'payments.help.telegram.providerToken' }],
  },
  yookassa: {
    config: [
      { key: 'shopId', label: 'payments.field.shopId', help: 'payments.help.yookassa.shopId' },
      // WS-02: linkTemplate обязателен — серверная проверка не примет
      // подключение без него (дефолтная quickpay-форма не совместима с
      // вебхуком, оплата не фиксируется). Подсказка объясняет, какую ссылку
      // вставлять и почему quickpay не подходит.
      { key: 'linkTemplate', label: 'payments.field.linkTemplate', help: 'payments.help.yookassa.linkTemplate', placeholder: 'payments.field.linkTemplate.placeholder' },
      { key: 'successUrl', label: 'payments.field.successUrl', help: 'payments.help.successUrl' },
      { key: 'failUrl', label: 'payments.field.failUrl', help: 'payments.help.failUrl' },
    ],
    secrets: [{ key: 'secretKey', label: 'payments.field.secretKey', help: 'payments.help.yookassa.secretKey' }],
  },
  robokassa: {
    config: [{ key: 'shopId', label: 'payments.field.merchantLogin', help: 'payments.help.robokassa.shopId' }],
    secrets: [
      { key: 'password1', label: 'payments.field.password1', help: 'payments.help.robokassa.password1' },
      { key: 'password2', label: 'payments.field.password2', help: 'payments.help.robokassa.password2' },
    ],
    testMode: true,
  },
  stripe: {
    config: [
      { key: 'linkTemplate', label: 'payments.field.linkTemplate', help: 'payments.help.stripe.linkTemplate', placeholder: 'payments.field.linkTemplate.placeholder' },
      { key: 'successUrl', label: 'payments.field.successUrl', help: 'payments.help.successUrl' },
      { key: 'failUrl', label: 'payments.field.failUrl', help: 'payments.help.failUrl' },
    ],
    secrets: [
      { key: 'secretKey', label: 'payments.field.secretKey', help: 'payments.help.stripe.secretKey' },
      { key: 'webhookSecret', label: 'payments.field.webhookSecret', help: 'payments.help.stripe.webhookSecret' },
    ],
  },
  custom: {
    config: [
      { key: 'linkTemplate', label: 'payments.field.linkTemplate', help: 'payments.help.custom.linkTemplate', placeholder: 'payments.field.linkTemplate.placeholder' },
      { key: 'successUrl', label: 'payments.field.successUrl', help: 'payments.help.successUrl' },
      { key: 'failUrl', label: 'payments.field.failUrl', help: 'payments.help.failUrl' },
    ],
    secrets: [{ key: 'webhookSecret', label: 'payments.field.webhookSecret', help: 'payments.help.custom.webhookSecret' }],
  },
};

type Values = Record<string, string>;

// Лейбл поля из PROVIDER_SPECS по ключу (config, затем secrets); null, если
// воркер прислал поле, которого нет в спеке провайдера.
function fieldLabelOf(spec: ProviderSpec, key: string, t: (k: TKey) => string): string | null {
  const f = [...spec.config, ...spec.secrets].find((x) => x.key === key);
  return f ? t(f.label) : null;
}

// Порядок пунктов результата: порядок полей в PROVIDER_SPECS (config, затем
// secrets); замечания без поля или с неизвестным полем — в конце. sort
// стабилен, поэтому «бесполевые» сохраняют исходный порядок воркера.
function sortProblems(problems: PaymentCheckProblem[], spec: ProviderSpec): PaymentCheckProblem[] {
  const order = [...spec.config, ...spec.secrets].map((f) => f.key);
  const idx = (p: PaymentCheckProblem) => {
    const i = p.field ? order.indexOf(p.field) : -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...problems].sort((a, b) => idx(a) - idx(b));
}

// Секретные поля: type=password, значение живёт только в state формы и уходит
// одним PUT/POST. В DOM ничего не сохраняется и не отображается.
// problems — замечания последней проверки подключения: поле с замечанием
// помечается aria-invalid и показывает честное сообщение воркера под инпутом.
function SecretFields({ specs, values, idPrefix, onChange, problems }: { specs: FieldSpec[]; values: Values; idPrefix: string; onChange: (v: Values) => void; problems?: PaymentCheckProblem[] }) {
  const t = useT();
  return (
    <>
      {specs.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const problem = problems?.find((p) => p.field === f.key);
        return (
          <div className="pay-field" key={f.key}>
            <label className="field-label" htmlFor={id}>{t(f.label)}</label>
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-invalid={problem ? true : undefined}
              value={values[f.key] ?? ''}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            />
            {problem && <span className="pay-field-error">{problem.message}</span>}
            {f.help && <span className="pay-help">{t(f.help)}</span>}
          </div>
        );
      })}
    </>
  );
}

function ConfigFields({ specs, values, idPrefix, onChange }: { specs: FieldSpec[]; values: Values; idPrefix: string; onChange: (v: Values) => void }) {
  const t = useT();
  return (
    <>
      {specs.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        return (
          <div className="pay-field" key={f.key}>
            <label className="field-label" htmlFor={id}>{t(f.label)}</label>
            <input
              id={id}
              type="text"
              placeholder={f.placeholder ? t(f.placeholder) : undefined}
              value={values[f.key] ?? ''}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            />
            {f.help && <span className="pay-help">{t(f.help)}</span>}
          </div>
        );
      })}
    </>
  );
}

export function PaymentsPage({
  botId,
  name,
  backTo,
  onBack,
  onOpenGuide,
}: {
  botId: string;
  name: string;
  backTo: 'list' | 'editor';
  onBack: () => void;
  onOpenGuide?: () => void;
}) {
  const t = useT();
  const settings = useSettings();

  const [conns, setConns] = useState<PaymentConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // форма добавления
  const [newOpen, setNewOpen] = useState(false);
  const [newProvider, setNewProvider] = useState<PaymentProviderId | ''>('');
  const [newTitle, setNewTitle] = useState('');
  const [newConfig, setNewConfig] = useState<Values>({});
  const [newSecrets, setNewSecrets] = useState<Values>({});
  const [newTestMode, setNewTestMode] = useState(false);

  // замена секретов существующего подключения
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replaceSecrets, setReplaceSecrets] = useState<Values>({});

  // проверка, удаление, копирование
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<(PaymentCheckResult & { cid: string }) | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmRotateId, setConfirmRotateId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.payments.listConnections(botId);
      setConns(r.connections ?? []);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setLoading(false);
    }
  }, [botId, settings.language]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetNewForm() {
    setNewOpen(false);
    setNewProvider('');
    setNewTitle('');
    setNewConfig({});
    setNewSecrets({});
    setNewTestMode(false);
  }

  async function createConnection() {
    if (!newProvider || busy) return;
    setBusy(true);
    setErr('');
    try {
      const spec = PROVIDER_SPECS[newProvider];
      const config: Record<string, string> = {};
      for (const f of spec.config) {
        const v = (newConfig[f.key] ?? '').trim();
        if (v) config[f.key as ConfigFieldKey] = v;
      }
      if (spec.testMode && newTestMode) config.testMode = '1';
      const secrets: Record<string, string> = {};
      for (const f of spec.secrets) {
        const v = (newSecrets[f.key] ?? '').trim();
        if (v) secrets[f.key as SecretFieldKey] = v;
      }
      const title = newTitle.trim();
      await api.payments.createConnection(botId, {
        provider: newProvider,
        ...(title ? { title } : {}),
        config,
        secrets,
      });
      resetNewForm();
      setNote(t('payments.created'));
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  // Пустое поле = «оставить прежний секрет»: на воркере PUT сливает присланные
  // ключи с сохранёнными, поэтому отправляем только непустые значения.
  async function saveReplacement(cid: string) {
    if (busy) return;
    const c = conns.find((x) => x.id === cid);
    if (!c) return;
    const secrets: Record<string, string> = {};
    for (const f of PROVIDER_SPECS[c.provider].secrets) {
      const v = (replaceSecrets[f.key] ?? '').trim();
      if (v) secrets[f.key as SecretFieldKey] = v;
    }
    if (!Object.keys(secrets).length) {
      setReplacing(null);
      setReplaceSecrets({});
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.payments.updateConnection(botId, cid, { secrets });
      setReplacing(null);
      setReplaceSecrets({});
      setNote(t('payments.updated'));
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  // In-flight guard (WU-04): двойной клик по свитчу отправлял два PUT подряд —
  // второй переворачивал состояние обратно, а UI мигал.
  const togglingId = useRef<string | null>(null);
  async function toggleEnabled(c: PaymentConnection) {
    if (togglingId.current === c.id) return;
    togglingId.current = c.id;
    setErr('');
    try {
      await api.payments.updateConnection(botId, c.id, { enabled: !c.enabled });
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      togglingId.current = null;
    }
  }

  async function check(c: PaymentConnection) {
    setCheckingId(c.id);
    setCheckResult(null);
    setErr('');
    try {
      const r = await api.payments.checkConnection(botId, c.id);
      setCheckResult({ ...r, cid: c.id });
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setCheckingId(null);
    }
  }

  async function remove(c: PaymentConnection) {
    setBusy(true);
    setErr('');
    try {
      await api.payments.deleteConnection(botId, c.id);
      setConfirmingId(null);
      if (checkResult?.cid === c.id) setCheckResult(null);
      if (replacing === c.id) {
        setReplacing(null);
        setReplaceSecrets({});
      }
      setNote(t('payments.deleted'));
      await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  function copyWebhook(c: PaymentConnection) {
    if (!c.webhook_token) return;
    void navigator.clipboard?.writeText(paymentWebhookUrl(c.webhook_token, c.webhookBase)).then(() => {
      setCopiedId(c.id);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 1500);
    });
  }

  // Ротация публичного адреса: два шага — сначала предупреждение о последствиях,
  // затем явное подтверждение. Старый адрес перестаёт работать сразу.
  async function regenerateWebhook(c: PaymentConnection) {
    setBusy(true);
    setErr('');
    try {
      const r = await api.payments.regenerateWebhook(botId, c.id);
      setConfirmRotateId(null);
      setNote(t('payments.webhook.rotated'));
      // Обновляем локально: connection из ответа уже содержит новый токен.
      if (r.connection) setConns((prev) => prev.map((x) => (x.id === r.connection!.id ? r.connection! : x)));
      else await load();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setBusy(false);
    }
  }

  const spec = newProvider ? PROVIDER_SPECS[newProvider] : null;

  return (
    <div className="app">
      <header className="topbar data-topbar">
        <button className="back-control" onClick={onBack} aria-label={backTo === 'editor' ? t('nav.toEditor') : t('nav.toBots')}>
          <ArrowLeft /> {backTo === 'editor' ? t('nav.toEditor') : t('nav.toBots')}
        </button>
        <div className="brand data-brand">
          <span className="logo"><Bot /></span>
          <span>{t('app.brand')}</span>
        </div>
        <span className="who">{name}</span>
        <div className="spacer" />
        <div className="topbar-group" aria-hidden="true" />
      </header>

      <main className="pay-page">
        <h1 className="sr-only">{t('payments.title')}</h1>
        <div className="pay-head">
          <h1>{t('payments.title')}</h1>
        </div>

        <div className="callout pay-principle">{t('payments.principle')}</div>

        {err && <div className="err">{err}</div>}
        {note && <div className="muted">{note}</div>}

        <div className="pay-toolbar">
          <button
            className="primary"
            onClick={() => {
              if (newOpen) setNewOpen(false);
              else {
                resetNewForm();
                setNewOpen(true);
              }
            }}
          >
            <Plus /> {t('payments.new.open')}
          </button>
          <button onClick={() => void load()} disabled={loading} title={t('payments.refresh')} aria-label={t('payments.refresh')}>
            <RefreshCw /> {t('payments.refresh')}
          </button>
        </div>

        {newOpen && (
          <form
            className="pay-form"
            aria-label={t('payments.new.title')}
            onSubmit={(e) => {
              e.preventDefault();
              void createConnection();
            }}
          >
            <h3>{t('payments.new.title')}</h3>
            <div className="pay-fields">
              <div className="pay-field">
                <label className="field-label" htmlFor="pay-new-provider">{t('payments.new.provider')}</label>
                <select
                  id="pay-new-provider"
                  value={newProvider}
                  onChange={(e) => {
                    setNewProvider(e.target.value as PaymentProviderId);
                    setNewConfig({});
                    setNewSecrets({});
                    setNewTestMode(false);
                  }}
                >
                  <option value="" disabled>{t('payments.new.provider')}</option>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>{t(`payments.provider.${p}`)}</option>
                  ))}
                </select>
              </div>
              <div className="pay-field">
                <label className="field-label" htmlFor="pay-new-title">{t('payments.new.name')}</label>
                <input
                  id="pay-new-title"
                  type="text"
                  placeholder={t('payments.new.name.placeholder')}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </div>
              {spec && (
                <>
                  <ConfigFields specs={spec.config} values={newConfig} idPrefix="pay-new" onChange={setNewConfig} />
                  <SecretFields specs={spec.secrets} values={newSecrets} idPrefix="pay-new" onChange={setNewSecrets} />
                  {spec.testMode && (
                    <div className="checkline toggle-line">
                      <span>{t('payments.field.testMode')}</span>
                      <Toggle
                        id="pay-new-testMode"
                        checked={newTestMode}
                        onChange={setNewTestMode}
                        label={t('payments.field.testMode')}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
            {spec?.testMode && <div className="pay-help">{t('payments.help.testMode')}</div>}
            <div className="pay-form-actions">
              <button className="primary" type="submit" disabled={busy || !newProvider}>
                {busy ? t('auth.busy') : t('payments.new.submit')}
              </button>
              <button type="button" onClick={resetNewForm}>{t('payments.cancel')}</button>
            </div>
          </form>
        )}

        {loading && (
          <div className="pay-empty">
            <p className="muted">{t('payments.loading')}</p>
          </div>
        )}

        {!loading && conns.length === 0 && (
          <div className="pay-empty">
            <h3>{t('payments.empty.title')}</h3>
            <p className="muted">{t('payments.empty.text')}</p>
            <div className="pay-toolbar" style={{ justifyContent: 'center' }}>
              <button className="primary" onClick={() => setNewOpen(true)}>
                <Plus /> {t('payments.new.open')}
              </button>
              {onOpenGuide && (
                <button className="ghost" onClick={onOpenGuide}>
                  {t('payments.empty.guide')}
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && conns.map((c) => {
          const providerSpec = PROVIDER_SPECS[c.provider];
          const whUrl = c.webhook_token ? paymentWebhookUrl(c.webhook_token, c.webhookBase) : '';
          const result = checkResult?.cid === c.id ? checkResult : null;
          return (
            <div className="pay-conn" key={c.id}>
              <div className="pay-conn-head">
                <h3>{c.title || t(`payments.provider.${c.provider}`)}</h3>
                <span className="badge neutral">{t(`payments.provider.${c.provider}`)}</span>
                <span className={`badge ${c.enabled ? 'ok' : 'neutral'}`}>
                  {c.enabled ? t('payments.enabled') : t('payments.disabled')}
                </span>
                <span className="spacer" />
                <div className="pay-conn-actions">
                  <Toggle
                    checked={c.enabled}
                    title={c.enabled ? t('payments.toggle.on') : t('payments.toggle.off')}
                    ariaLabel={c.enabled ? t('payments.toggle.on') : t('payments.toggle.off')}
                    onChange={() => void toggleEnabled(c)}
                  />
                  <button type="button" onClick={() => void check(c)} disabled={checkingId === c.id}>
                    {checkingId === c.id ? t('payments.checking') : t('payments.check')}
                  </button>
                  <button
                    type="button"
                    className="ghost icon-btn"
                    title={t('payments.delete')}
                    aria-label={t('payments.delete')}
                    onClick={() => {
                      setConfirmingId(confirmingId === c.id ? null : c.id);
                      setNote('');
                    }}
                  >
                    <Trash />
                  </button>
                </div>
              </div>

              <div className="pay-webhook">
                <span className="field-label">{t('payments.webhook.label')}</span>
                {c.provider === 'telegram' ? (
                  <div className="pay-help">{t('payments.webhook.telegram')}</div>
                ) : (
                  <>
                    <div className="pay-webhook-url">
                      <span>{whUrl}</span>
                      <button
                        type="button"
                        className="ghost icon-btn"
                        title={t('payments.copy')}
                        aria-label={t('payments.copy')}
                        onClick={() => copyWebhook(c)}
                      >
                        {copiedId === c.id ? <span className="pay-copied">{t('payments.copied')}</span> : <Copy />}
                      </button>
                    </div>
                    {/* Адрес вставляется в кабинет провайдера; при ротации его
                        придётся обновить — предупреждение рядом с URL. */}
                    <div className="pay-help">{t('payments.webhook.hint')}</div>
                    <div className="pay-help warn">{t('payments.webhook.cabinetHint')}</div>
                    <div className="pay-toolbar">
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => {
                          setConfirmRotateId(confirmRotateId === c.id ? null : c.id);
                          setNote('');
                        }}
                      >
                        <RefreshCw /> {t('payments.webhook.regenerate')}
                      </button>
                    </div>
                    {confirmRotateId === c.id && (
                      <div className="pay-confirm" role="alertdialog" aria-label={t('payments.webhook.regenerate')}>
                        <p>{t('payments.webhook.regenerateConfirm')}</p>
                        <button className="danger" disabled={busy} onClick={() => void regenerateWebhook(c)}>
                          {t('payments.webhook.regenerateYes')}
                        </button>
                        <button disabled={busy} onClick={() => setConfirmRotateId(null)}>
                          {t('payments.cancel')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="pay-secrets">
                <span className="field-label">{t('payments.secrets')}</span>
                {c.secrets.has ? (
                  <span className="badge ok">{t('payments.secrets.set')}</span>
                ) : (
                  <span className="badge warn">{t('payments.secrets.notSet')}</span>
                )}
                {/* Имена сохранённых ключей из маски — это НЕ значения: API
                    отдаёт только {has, keys}, значение секрета недоступно. */}
                {c.secrets.keys.map((k) => (
                  <span className="badge mono neutral" key={k}>{k}</span>
                ))}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setReplacing(replacing === c.id ? null : c.id);
                    setReplaceSecrets({});
                    setNote('');
                  }}
                >
                  {t('payments.replace')}
                </button>
              </div>

              {replacing === c.id && (
                <form
                  className="pay-form"
                  aria-label={t('payments.replace')}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveReplacement(c.id);
                  }}
                >
                  <div className="muted">{t('payments.replace.hint')}</div>
                  <div className="pay-fields">
                    <SecretFields
                      specs={providerSpec.secrets}
                      values={replaceSecrets}
                      idPrefix={`pay-repl-${c.id}`}
                      onChange={setReplaceSecrets}
                      problems={result?.problems}
                    />
                  </div>
                  <div className="pay-form-actions">
                    <button className="primary" type="submit" disabled={busy}>
                      {busy ? t('auth.busy') : t('payments.replace.save')}
                    </button>
                    <button type="button" onClick={() => { setReplacing(null); setReplaceSecrets({}); }}>
                      {t('payments.cancel')}
                    </button>
                  </div>
                </form>
              )}

              {result && (
                result.ok ? (
                  result.mode === 'live' ? (
                    <div className="callout ok pay-check-result">{t('payments.check.okLive')}</div>
                  ) : (
                    <div className="callout neutral pay-check-result">{t('payments.check.okFormat')}</div>
                  )
                ) : (
                  <div className="err pay-check-result">
                    <div>{t('payments.check.failed')}</div>
                    {/* problems — честные строки с воркера: данные, не UI-строки.
                        Порядок: сначала поля PROVIDER_SPECS (config, затем
                        secrets), замечания без поля/с неизвестным полем — в конце. */}
                    <ul className="pay-check-problems" tabIndex={0}>
                      {sortProblems(result.problems, providerSpec).map((p, i) => {
                        const label = p.field ? fieldLabelOf(providerSpec, p.field, t) : null;
                        return <li key={i}>{label ? `${label}: ${p.message}` : p.message}</li>;
                      })}
                    </ul>
                  </div>
                )
              )}

              {confirmingId === c.id && (
                <div className="pay-confirm" role="alertdialog" aria-label={t('payments.delete.confirm', { title: c.title || t(`payments.provider.${c.provider}`) })}>
                  <p>{t('payments.delete.confirm', { title: c.title || t(`payments.provider.${c.provider}`) })}</p>
                  <button className="danger" disabled={busy} onClick={() => void remove(c)}>
                    {t('payments.delete.yes')}
                  </button>
                  <button disabled={busy} onClick={() => setConfirmingId(null)}>
                    {t('payments.cancel')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}

export default PaymentsPage;
