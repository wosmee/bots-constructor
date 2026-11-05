import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { authErrorMessage, canCreateBot, friendlyApiError } from './journey';
import { loadSettings, resetSettings, updateSettings, useRole, useSettings, useSettingsLoaded } from './settings';
import { SupportWidget } from './SupportWidget';
import { useT, type TKey } from './i18n';
import { Bot, LayoutTemplate, Settings } from './icons';
import {
  api,
  setAdminKey,
  hasAdminKey,
  setSessionToken,
  hasSessionToken,
  getSessionToken,
  logoutLocal,
  type SessionUser,
} from './api';

// Конструктор — самый тяжёлый чанк (холст, инспектор, @xyflow/react):
// на логине и дашборде он не нужен, поэтому грузится лениво.
const Constructor = lazy(() => import('./Constructor').then((m) => ({ default: m.Constructor })));
// Каталог шаблонов — отдельный чанк: на дашборде он не нужен.
const TemplatesPage = lazy(() => import('./TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
// Данные бота (клиенты + таблицы) — тоже отдельный чанк.
const DataPage = lazy(() => import('./DataPage').then((m) => ({ default: m.DataPage })));
// Оплата: подключения платёжных провайдеров владельца — отдельный чанк.
const PaymentsPage = lazy(() => import('./PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
// Библиотека подсценариев — уровень аккаунта, отдельный чанк.
const SubflowsPage = lazy(() => import('./SubflowsPage').then((m) => ({ default: m.SubflowsPage })));
const SupportPage = lazy(() => import('./SupportPage').then((m) => ({ default: m.SupportPage })));
// «Пользователи» — staff-страница поиска аккаунтов, отдельный чанк: обычному
// пользователю она недоступна (403 на воркере) и не нужна в бандле.
const AdminPage = lazy(() => import('./AdminPage').then((m) => ({ default: m.AdminPage })));
const MiniAppEditor = lazy(() => import('./MiniAppEditor').then((m) => ({ default: m.MiniAppEditor })));
// Гайд на уровне дашборда: его просит пустое состояние «Библиотеки».
const Guide = lazy(() => import('./Guide').then((m) => ({ default: m.Guide })));
// Модалки открываются по клику (или один раз после входа) — в первый чанк
// им незачем: переводим их в отдельные чанки, чтобы экран входа и дашборд
// отдавались раньше. Виджет поддержки остаётся в главном чанке: он виден
// на дашборде сразу и весит копейки.
const SettingsModal = lazy(() => import('./SettingsModal').then((m) => ({ default: m.SettingsModal })));
const SkillLevelModal = lazy(() => import('./SkillLevelModal').then((m) => ({ default: m.SkillLevelModal })));
const CreateMiniAppModal = lazy(() => import('./CreateMiniAppModal').then((m) => ({ default: m.CreateMiniAppModal })));

interface Bot {
  id: string;
  name: string;
  owner_id: string;
  active: number;
  created_at: number;
  // Логин владельца из accounts; у админских ботов его может не быть.
  owner_login?: string | null;
  // Платформа бота ('telegram' у всех ботов, созданных до миграции 0030).
  platform?: 'telegram' | 'vk';
}

type Mode = 'login' | 'register' | 'admin';

function isKnownPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/index.html';
}

export default function App() {
  const t = useT();
  const settings = useSettings();
  const settingsLoaded = useSettingsLoaded();
  const role = useRole();
  const locale = settings.language === 'en' ? 'en-GB' : 'ru-RU';

  // Доступное начало: новый пользователь сначала выбирает готовый сценарий.
  // Пустой старт остаётся явным выбором внутри каталога/гайда.
  const [view, setView] = useState<'list' | 'editor' | 'templates' | 'data' | 'payments' | 'subflows' | 'support' | 'admin' | 'miniapp'>('list');
  const [showGuide, setShowGuide] = useState(false);
  const [supportOpen, setSupportOpen] = useState(0);
  // Схема, открытая в конструкторе — её публикуем в каталог шаблонов.
  const [catalogScenario, setCatalogScenario] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bots, setBots] = useState<Bot[]>([]);
  const [miniApps, setMiniApps] = useState<{ id: string; bot_id: string; bot_name: string; bot_username: string | null; name: string; slug: string; published: boolean | number; updated_at: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  // Мини-аппы: модалка создания и открытая карточка аппа (редактор — фаза B).
  const [miniCreate, setMiniCreate] = useState(false);
  const [openMini, setOpenMini] = useState<{ id: string; botId: string; name: string; slug: string } | null>(null);

  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  // Платформа нового бота: Telegram (по умолчанию, как раньше) или VK.
  // Выбор виден в форме создания; после создания платформа живёт в боте.
  const [platform, setPlatform] = useState<'telegram' | 'vk'>('telegram');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  const [openBot, setOpenBot] = useState<{ id: string; name: string; platform?: 'telegram' | 'vk' } | null>(null);
  const [dataFrom, setDataFrom] = useState<'list' | 'editor'>('editor');
  const [payFrom, setPayFrom] = useState<'list' | 'editor'>('editor');
  const [statuses, setStatuses] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  // Открытие бота из карточки: платформа нужна редактору (палитра VK-бота
  // прячет Telegram-only блоки), поэтому она едет вместе с id и именем.
  const openBotCard = (b: { id: string; name: string; platform?: 'telegram' | 'vk' }) => {
    setOpenBot({ id: b.id, name: b.name, platform: b.platform });
    setView('editor');
  };

  const [note, setNote] = useState('');
  // Мини-аппы ещё не готовы к показу: обычным пользователям вместо создания
  // показываем заметку «Ещё в разработке». Механика toast: заметка исчезает
  // сама через 4 с; параллельные заметки не затирают друг друга.
  const [wipToast, setWipToast] = useState(0);
  function notifyWip() {
    setWipToast(Date.now());
  }
  useEffect(() => {
    if (!wipToast) return;
    const timer = window.setTimeout(() => setWipToast(0), 4000);
    return () => window.clearTimeout(timer);
  }, [wipToast]);
  // Сессия чисто с ADMIN_KEY (без аккаунта): каталог у неё свой — боты,
  // созданные под платформенным ключом (owner_id = 'admin'). Флаг adminKey
  // приходит всегда и говорит, что чужих ботов здесь не будет; записка про
  // страницу «Пользователи» нужна только когда этот каталог пуст.
  const [adminKeySession, setAdminKeySession] = useState(false);

  // Вход: либо сессия обычного пользователя (Bearer), либо admin-ключ платформы.
  // Оба хранятся только в sessionStorage этой вкладки (см. api.ts) — в бандл не попадают.
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authed, setAuthed] = useState(hasSessionToken() || hasAdminKey());
  const [mode, setMode] = useState<Mode>('login');
  const [pathname, setPathname] = useState(() => window.location.pathname);

  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [keyInput, setKeyInput] = useState('');
  // Отдельный флаг для проверки админ-ключа: двойной клик не должен firing
  // два запроса, а кнопка входа обязана показывать занятость.
  const [adminBusy, setAdminBusy] = useState(false);

  // Экран выбора уровня показывается один раз на аккаунт — за этим следит
  // skill_level_set_at с сервера. Смотреть на пустой skill_level нельзя: пока
  // настройки грузятся, он пуст у всех, и модалка мигала бы даже тем, у кого
  // уровень выбран (F8).
  const [needSkill, setNeedSkill] = useState(false);

  useEffect(() => {
    const syncPathname = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', syncPathname);
    return () => window.removeEventListener('popstate', syncPathname);
  }, []);

  // Редактор — самый тяжёлый экран (Constructor ~270 КБ + @xyflow ~178 КБ).
  // Качаем его чанк заранее, в свободное время после входа: тогда открытие
  // бота не ждёт загрузки полмегабайта, а упирается только в ответ API.
  // import() кешируется модулем: повторные вызовы (наведение на карточку)
  // ничего не докачивают. Файлы контент-хешированные и кешируются на год,
  // поэтому предзагрузка не добавляет трафика на следующих визитах.
  const prefetchEditor = useCallback(() => {
    const load = () => void import('./Constructor');
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(load, { timeout: 3000 });
    else window.setTimeout(load, 1500);
  }, []);

  useEffect(() => {
    if (!authed) return;
    prefetchEditor();
  }, [authed, prefetchEditor]);

  // Протухший admin-ключ или истёкший токен: тихий возврат на экран входа.
  // Никакого «Сессия истекла» — на экране входа это не про что; состояние
  // дашборда чистим, чтобы он не мигнул старыми данными.
  function dropSessionQuietly() {
    logoutLocal();
    setUser(null);
    setAuthed(false);
    setErr('');
    setAdminKeySession(false);
    setBots([]);
    setMiniApps([]);
    setStatuses({});
  }

  useEffect(() => {
    if (!authed) return;
    loadSettings();
    if (hasSessionToken()) {
      api
        .me()
        .then((r) => setUser(r.user))
        .catch(() => {
          dropSessionQuietly();
        });
    }
  }, [authed]);

  // Уровень ещё ни разу не выбирали — спрашиваем. Только для обычных
  // пользователей: у админа платформы нет per-user строки настроек.
  // Ждём загрузки настроек: до неё skill_level_set_at — это дефолт, а не факт.
  useEffect(() => {
    if (!authed || !user) return;
    if (!settingsLoaded) return;
    if (!settings.skill_level_set_at) setNeedSkill(true);
  }, [authed, user, settingsLoaded, settings.skill_level_set_at]);

  async function submitCredentials() {
    if (busy || !loginName.trim() || password.length < 6) return;
    setBusy(true);
    setErr('');
    try {
      const r = mode === 'register' ? await api.register(loginName, password) : await api.login(loginName, password);
      setSessionToken(r.token);
      // Вкладка не должна держать два входа одновременно: оставшийся admin-ключ
      // затеняет аккаунт (resolveIdentity на воркере уходит в админ-ветку первой),
      // и тогда каталог показывает боты платформы, а боты аккаунта — нет.
      setAdminKey('');
      setUser(r.user);
      setPassword('');
      setAuthed(true);
    } catch (e: any) {
      // Экран входа показывает точные тексты («Логин не найден», «Пароль
      // не верный», «Логин занят») — общий friendlyApiError сводил бы любой
      // 401 к «Сессия истекла», чего на форме входа быть не должно.
      setErr(authErrorMessage(e, settings.language) || t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  // Админ-ключ проверяется сервером ДО открытия дашборда: раньше любой текст
  // записывался в sessionStorage и пускал внутрь, а ломалась сессия позже.
  // Никакой путь не должен ставить authed = true без 200 от /api/admin/session.
  async function loginAsAdmin() {
    if (adminBusy) return;
    const candidate = keyInput.trim();
    if (!candidate) {
      setErr(t('auth.error.adminKey'));
      return;
    }
    setAdminBusy(true);
    setErr('');
    try {
      await api.checkAdminKey(candidate);
      setAdminKey(candidate);
      // Симметрично входу по логину: гасим токен аккаунта, чтобы каталог был
      // ровно один — платформенный, без затенения чужой сессией.
      setSessionToken('');
      setUser(null);
      setKeyInput('');
      setAuthed(true);
    } catch (e: any) {
      // 401/429/сеть — остаёмся на экране входа, введённое значение сохраняем
      // (опечатку можно поправить), в sessionStorage ничего не пишем.
      setErr(authErrorMessage(e, settings.language) || t('common.error'));
    } finally {
      setAdminBusy(false);
    }
  }

  async function logout() {
    if (getSessionToken()) {
      await api.logout().catch(() => {});
    }
    logoutLocal();
    setUser(null);
    setLoginName('');
    setKeyInput('');
    setAuthed(false);
    setBots([]);
    setMiniApps([]);
    setView('list');
    setNeedSkill(false);
    resetSettings();
  }

  // Удаление бота: снимает webhook в Telegram и стирает всё, что к боту
  // привязано. Подтверждение обязательно — действие необратимое.
  async function deleteBot(b: Bot) {
    if (!confirm(t('dash.delete.confirm', { name: b.name }))) return;
    setDeleting(b.id);
    setErr('');
    try {
      const r = await api.deleteBot(b.id);
      const failed = (r.steps ?? []).filter((s) => s.status === 'fail');
      if (failed.length) {
        setErr(failed.map((s) => `${s.label}: ${s.detail ?? ''}`).join('; '));
      } else {
        setNote(t('dash.deleted'));
      }
      if (openBot?.id === b.id) {
        setOpenBot(null);
        setView('list');
      }
      await refresh();
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setDeleting(null);
    }
  }

  // Статусы — одним батчем: раньше на каждого бота уходил отдельный запрос,
  // а тот ещё и дёргал Telegram (getWebhookInfo + getMyCommands).
  // deep=true ходит в Telegram и кэширует результат на 30 минут;
  // deep=false отдаёт только состояние из D1 + кэш.
  async function refresh(deep = false) {
    setLoading(true);
    try {
      // Список ботов и список мини-аппов ничем не зависят друг от друга —
      // раньше они шли последовательно и дашборд платил за лишний round-trip.
      const [r, miniResult] = await Promise.all([api.listBots(), api.listOwnedMiniApps()]);
      const list: Bot[] = r.bots ?? [];
      setBots(list);
      setAdminKeySession(!!r.adminKey);
      setMiniApps(miniResult.miniapps ?? []);
      if (!list.length) {
        setStatuses({});
        return;
      }
      const s: any = await api.statuses(
        list.map((b) => b.id),
        deep
      );
      setStatuses(s.statuses ?? {});
    } catch (e: any) {
      // 401 на списке ботов = ключ/токен больше не действительны (ротация
      // ADMIN_KEY, истёкшая сессия): молча возвращаем на экран входа.
      // «Сессия истекла» здесь показывать некому — дашборд уже не наш.
      if (e?.status === 401) {
        dropSessionQuietly();
        return;
      }
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authed) return;
    refresh();
  }, [authed]);

  useEffect(() => {
    if (!authed || role === 'user') return;
    api.support.openCount().then((r) => setSupportOpen(r.open)).catch(() => {});
  }, [authed, role]);

  async function create() {
    const botName = name.trim();
    const botToken = token.trim();
    if (busy || !canCreateBot(name, token)) return;
    setBusy(true);
    setCreateError('');
    setErr('');
    try {
      const r: any = await api.createBot(botName, botToken, platform);
      setCreating(false);
      setName('');
      setToken('');
      await refresh();
      // F3-300: платформа обязательна — без неё конструктор открывает
      // VK-бота в Telegram-режиме (палитра TG-only, publish падает 422).
      setOpenBot({ id: r.id, name: botName, platform });
      setView('editor');
    } catch (e: any) {
      setCreateError(friendlyApiError(e, settings.language) || t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setCreateError('');
    setErr('');
    setCreating((v) => !v);
  }

  if (!isKnownPath(pathname)) {
    return (
      <div className="app not-found-screen">
        <main className="not-found-card">
          <div className="brand">
            <span className="logo"><Bot size={20} /></span>
            <span>{t('app.brand')}</span>
          </div>
          <p className="not-found-code">404</p>
          <h1>{t('notFound.title')}</h1>
          <p className="muted">{t('notFound.hint')}</p>
          <button className="primary" onClick={() => window.location.assign('/')}>
            {t('notFound.back')}
          </button>
        </main>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="app">
        <div className="login-screen">
          <div className="login-card">
            <div className="brand">
              <span className="logo"><Bot size={20} /></span>
              <span>{t('app.brand')}</span>
            </div>
            <div className="tab-row">
              <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>
                {t('auth.tab.login')}
              </button>
              <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>
                {t('auth.tab.register')}
              </button>
              <button className={mode === 'admin' ? 'tab active' : 'tab'} onClick={() => setMode('admin')}>
                {t('auth.tab.admin')}
              </button>
            </div>

            {mode === 'admin' ? (
              <>
                <h1>{t('auth.admin.title')}</h1>
                <p className="muted">{t('auth.admin.hint')}</p>
                <input
                  type="password"
                  placeholder={t('auth.admin.placeholder')}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void loginAsAdmin();
                  }}
                />
                {err && <div className="err">{err}</div>}
                <button className="primary" disabled={adminBusy} onClick={() => void loginAsAdmin()}>
                  {adminBusy ? t('auth.busy') : t('auth.admin.enter')}
                </button>
              </>
            ) : (
              <>
                <h1>{mode === 'login' ? t('auth.login.title') : t('auth.register.title')}</h1>
                <p className="muted">{mode === 'login' ? t('auth.login.hint') : t('auth.register.hint')}</p>
                <input
                  placeholder={t('auth.login.placeholder')}
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  autoComplete="username"
                />
                <input
                  type="password"
                  placeholder={t('auth.password.placeholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCredentials();
                  }}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                {err && <div className="err">{err}</div>}
                <button
                  className="primary"
                  disabled={busy || !loginName || password.length < 6}
                  onClick={submitCredentials}
                >
                  {busy ? t('auth.busy') : mode === 'login' ? t('auth.submit.login') : t('auth.submit.register')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'editor' && openBot) {
    return (
      <Suspense fallback={<p className="muted">{t('dash.loading')}</p>}>
        <Constructor
        botId={openBot.id}
        name={openBot.name}
        platform={openBot.platform ?? 'telegram'}
        onBack={() => {
          setView('list');
          setOpenBot(null);
          refresh();
        }}
        onOpenCatalog={(scenarioJson) => {
          setCatalogScenario(scenarioJson);
          setView('templates');
        }}
        onOpenData={() => {
          setDataFrom('editor');
          setView('data');
        }}
        onOpenPayments={() => {
          setPayFrom('editor');
          setView('payments');
        }}
        />
        <SupportWidget />
      </Suspense>
    );
  }

  // Данные бота: клиенты и таблицы. Открывается из конструктора, поэтому
  // «Назад» возвращает в редактор, а со списка ботов — в список.
  if (view === 'data' && openBot) {
    return (
      <Suspense fallback={null}>
        <DataPage
          botId={openBot.id}
          name={openBot.name}
          backTo={dataFrom}
          onBack={() => {
            setView(dataFrom === 'editor' ? 'editor' : 'list');
            if (dataFrom === 'list') setOpenBot(null);
          }}
        />
        <SupportWidget />
      </Suspense>
    );
  }

  // Оплата: подключения платёжных провайдеров владельца. Как и «Данные»,
  // открывается из списка ботов или из конструктора — «Назад» возвращает туда,
  // откуда пришли.
  if (view === 'payments' && openBot) {
    return (
      <Suspense fallback={null}>
        <PaymentsPage
          botId={openBot.id}
          name={openBot.name}
          backTo={payFrom}
          onBack={() => {
            setView(payFrom === 'editor' ? 'editor' : 'list');
            if (payFrom === 'list') setOpenBot(null);
          }}
        />
        <SupportWidget />
      </Suspense>
    );
  }

  // Библиотека подсценариев: уровень аккаунта, бот не нужен — фрагменты
  // вызываются из любого бота владельца. «Назад» — в список ботов.
  if (view === 'subflows') {
    return (
      <Suspense fallback={null}>
        <SubflowsPage
          onBack={() => setView('list')}
          onOpenGuide={() => setShowGuide(true)}
        />
        {showGuide && (
          <Suspense fallback={null}>
            <Guide onClose={() => setShowGuide(false)} />
          </Suspense>
        )}
        <SupportWidget />
      </Suspense>
    );
  }

  if (view === 'templates') {
    return (
      <Suspense fallback={null}>
        <TemplatesPage
          botId={openBot?.id ?? null}
          botName={openBot?.name ?? null}
          currentScenarioJson={catalogScenario}
          onBack={() => setView(openBot ? 'editor' : 'list')}
          onLoaded={() => {
            setView(openBot ? 'editor' : 'list');
            if (!openBot) refresh();
          }}
        />
      </Suspense>
    );
  }

  if (view === 'support') {
    return (
      <Suspense fallback={null}>
        <SupportPage onBack={() => setView('list')} />
      </Suspense>
    );
  }

  if (view === 'admin') {
    return (
      <Suspense fallback={null}>
        <AdminPage onBack={() => setView('list')} />
      </Suspense>
    );
  }

  if (view === 'miniapp' && openMini) {
    return (
      <Suspense fallback={null}>
        <MiniAppEditor miniId={openMini.id} botId={openMini.botId} onBack={() => { setOpenMini(null); setView('list'); }} onOpenGuide={() => setShowGuide(true)} />
        {/* Гайд обязан рендериться ПОВЕРХ редактора: без оверлея кнопка
            «Гайд» в топбаре мини-редактора молча ничего не открывала. */}
        {showGuide && (
          <Suspense fallback={null}>
            <Guide onClose={() => setShowGuide(false)} />
          </Suspense>
        )}
      </Suspense>
    );
  }

  return (
    <div className="app">
      <header className="topbar dashboard-topbar">
        {/* слева — кто мы и под кем вошли */}
        <div className="brand">
          <span className="logo"><Bot size={20} /></span>
          <span>{t('app.brand')}</span>
        </div>
        {user && <span className="who">{user.login}</span>}

        <div className="spacer" />

        {/* кластер «навигация» */}
        <div className="topbar-group topbar-nav">
          {role !== 'user' && (
            <button onClick={() => setView('support')}>
              {t('support.staff.open')}{supportOpen > 0 && <span className="support-badge">{supportOpen}</span>}
            </button>
          )}
          {/* «Пользователи»: только сотрудникам (admin/moderator) и сессии
              ADMIN_KEY. Роль приходит из /api/settings (useRole), adminKey —
              из ответа /api/bots; второй механизм не изобретаем. */}
          {(role === 'admin' || role === 'moderator' || adminKeySession) && (
            <button onClick={() => setView('admin')}>{t('admin.nav')}</button>
          )}
          <button
            onClick={() => {
              setCatalogScenario(null);
              setView('templates');
            }}
          >
            {t('nav.catalog')}
          </button>
          <button onClick={() => setView('subflows')}>
            {t('subflows.nav')}
          </button>
          <button
            className="ghost icon-btn"
            onClick={() => setShowSettings(true)}
            title={t('dash.settings.title')}
            aria-label={t('dash.settings.title')}
          >
            <Settings />
          </button>
          <button onClick={() => void refresh(true)} disabled={loading} title={t('dash.refresh.title')}>
            {loading ? t('auth.busy') : t('dash.refresh')}
          </button>
        </div>

        <span className="topbar-sep" aria-hidden="true" />

        {/* кластер «действие» */}
        <div className="topbar-group topbar-actions">
          <button className="primary" onClick={openCreate} aria-label={t('dash.createBot')}>
            {t('dash.createBot')}
          </button>
          {/* Мини-аппы ещё дорабатываются: обычным пользователям вход закрыт,
              доступ остаётся только у владельца (сессия ADMIN_KEY). */}
          {adminKeySession ? (
            <button onClick={() => setMiniCreate(true)}>{t('mini.create')}</button>
          ) : (
            <button onClick={notifyWip}>{t('mini.create')}</button>

          )}
          <button className="ghost" onClick={logout} title={t('dash.logout.title')}>
            {t('dash.logout')}
          </button>
        </div>
      </header>

      <main className="dashboard">
        <h1 className="sr-only">{t('app.brand')}</h1>
        {showSettings && (
          <Suspense fallback={null}>
            <SettingsModal
              onClose={() => setShowSettings(false)}
              onAuthReset={() => { setShowSettings(false); void logout(); }}
              onAccountDeleted={() => { void logout(); }}
            />
          </Suspense>
        )}
        {needSkill && (
          <Suspense fallback={null}>
            <SkillLevelModal
              onPick={(level) => {
                setNeedSkill(false);
                void updateSettings({ skill_level: level });
              }}
            />
          </Suspense>
        )}
        {miniCreate && (
          <Suspense fallback={null}>
            <CreateMiniAppModal
              bots={bots.map((b) => ({ id: b.id, name: b.name }))}
              onCreated={(id) => {
                setMiniCreate(false);
                // S3-10: апп создан, но без catch ошибка чтения оставляла тупик
                // без сообщения: модалка закрыта, редактор не открыт.
                void api.getMiniApp(id).then((app) => {
                  setOpenMini({ id: app.id, botId: app.bot_id, name: app.name, slug: app.slug });
                  setView('miniapp');
                }).catch((e) => {
                  setErr(t('mini.openFailed', { msg: friendlyApiError(e, settings.language) }));
                });
              }}
              onClose={() => setMiniCreate(false)}
              onCreateBot={() => {
                setMiniCreate(false);
                openCreate();
              }}
            />
          </Suspense>
        )}

        {creating && (
          <div className="create-card">
            <h2>{t('dash.newBot')}</h2>
            <p className="muted">{t('dash.newBot.hint')}</p>
            {/* Платформа бота: Telegram по умолчанию; VK — ключ сообщества
                вместо токена BotFather. Выбор влияет на подпись поля токена. */}
            <div className="row-actions platform-switch" role="radiogroup" aria-label={t('dash.platform.label')}>
              {(['telegram', 'vk'] as const).map((p) => (
                <button
                  key={p}
                  role="radio"
                  aria-checked={platform === p}
                  className={platform === p ? 'primary' : 'ghost'}
                  onClick={() => setPlatform(p)}
                >
                  {t(`dash.platform.${p}` as TKey)}
                </button>
              ))}
            </div>
            <input placeholder={t('dash.name.placeholder')} value={name} onChange={(e) => setName(e.target.value)} />
            <input
              placeholder={platform === 'vk' ? t('dash.token.vkPlaceholder') : t('dash.token.placeholder')}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            {platform === 'vk' && <p className="muted">{t('dash.token.vkHint')}</p>}
            {createError && <div className="err">{createError}</div>}
            <div className="row-actions">
              <button className="primary" disabled={busy || !name.trim() || !token.trim()} onClick={create}>
                {busy ? t('auth.busy') : t('dash.create')}
              </button>
              <button onClick={() => setCreating(false)}>{t('dash.cancel')}</button>
            </div>
          </div>
        )}

        {err && <div className="err">{err}</div>}
        {note && <div className="muted">{note}</div>}
        {wipToast > 0 && <div className="muted wip-toast" role="status">{t('mini.wip')}</div>}

        {loading ? (
          <p className="muted">{t('dash.loading')}</p>
        ) : adminKeySession && bots.length === 0 ? (
          <div className="empty-dash">
            <p className="muted">{t('dash.adminKey.note')}</p>
            <button className="primary empty-dash-cta" onClick={() => setView('admin')}>
              {t('dash.adminKey.toAdmin')}
            </button>
          </div>
        ) : bots.length === 0 ? (
          <div className="empty-dash">
            <h2>{t('dash.empty.title')}</h2>
            <p className="muted">{t('dash.empty.text')}</p>
            <button className="primary empty-dash-cta" onClick={openCreate}>
              {t('dash.createBot')}
            </button>
          </div>
        ) : (
          <section className="dashboard-section" aria-labelledby="dashboard-bots-title">
            <div className="dashboard-section-head">
              <h2 id="dashboard-bots-title">{t('dash.bots.title')}</h2>
              <span className="dashboard-section-rule" aria-hidden="true" />
            </div>
            <div className="bot-grid">
              {bots.map((b) => {
                const st = statuses[b.id];
                const whErr = st?.webhook?.last_error_message;
                const badge = st?.active
                  ? whErr
                    ? { cls: 'bad', text: t('dash.status.webhookError') }
                    : { cls: 'good', text: t('dash.status.published') }
                  : { cls: 'muted-badge', text: t('dash.status.draft') };
                const unchecked = !!st && !st.checkedAt;
                return (
                  <div
                    key={b.id}
                    className="bot-card"
                    role="button"
                    tabIndex={0}
                    // Наведение/фокус = намерение открыть бота: если idle-предзагрузка
                    // ещё не сработала, чанк редактора уйдёт прямо сейчас.
                    onMouseEnter={prefetchEditor}
                    onFocus={prefetchEditor}
                    onClick={() => {
                      openBotCard(b);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openBotCard(b);
                      }
                    }}
                  >
                    <div className="bot-card-row">
                      <div className="bot-card-name">{b.name}</div>
                      <span className={`status-pill ${badge.cls}`}>{badge.text}</span>
                    </div>
                    <div className="muted">
                      {b.created_at > 0 ? new Date(b.created_at).toLocaleDateString(locale) : '—'}
                      {st?.version ? ` · v${st.version}` : ''}
                      {/* Метка владельца убрана: /api/bots всегда возвращает только
                          боты своего аккаунта, поэтому «владелец» — это вошедший.
                          Ключи dash.owner/dash.owner.admin оставлены в словаре. */}
                    </div>
                    {whErr && <div className="muted wh-err" title={whErr}>{whErr.slice(0, 60)}</div>}
                    {unchecked && !whErr && (
                      <div className="muted wh-err" title={t('dash.webhookUnchecked')}>
                        {t('dash.webhookUnchecked.short')}
                      </div>
                    )}
                    <div className="bot-card-id">
                      <span className="mono">{b.id.slice(0, 8)}</span>
                      <span className="open-arrow">{t('dash.open')}</span>
                    </div>
                    <div className="bot-card-actions">
                      <button
                        className="bot-card-action"
                        data-open
                        title={t('data.title')}
                        onClick={(e) => {
                          e.stopPropagation();
                          openBotCard(b);
                          setDataFrom('list');
                          setView('data');
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {t('nav.data')}
                      </button>
                      <button
                        className="bot-card-action"
                        data-open
                        title={t('payments.title')}
                        onClick={(e) => {
                          e.stopPropagation();
                          openBotCard(b);
                          setPayFrom('list');
                          setView('payments');
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {t('nav.payments')}
                      </button>
                      <button
                        className="bot-card-action danger"
                        title={t('dash.delete.title')}
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteBot(b);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {deleting === b.id ? t('dash.deleting') : t('dash.delete')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {/* Мини-аппы в разработке: секция видна только владельцу (ADMIN_KEY). */}
        {!loading && adminKeySession && miniApps.length > 0 && (
          <section className="dashboard-section" aria-labelledby="dashboard-miniapps-title">
            <div className="dashboard-section-head">
              <h2 id="dashboard-miniapps-title">{t('mini.dashboard.title')}</h2>
              <span className="dashboard-section-rule" aria-hidden="true" />
            </div>
            <div className="bot-grid">
              {miniApps.map((mini) => (
                <article
                  className="bot-card miniapp-card"
                  key={mini.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setOpenMini({ id: mini.id, botId: mini.bot_id, name: mini.name, slug: mini.slug });
                    setView('miniapp');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpenMini({ id: mini.id, botId: mini.bot_id, name: mini.name, slug: mini.slug });
                      setView('miniapp');
                    }
                  }}
                >
                  <div className="bot-card-row">
                    <span className="miniapp-card-title">
                      <span className="miniapp-card-icon" aria-hidden="true">
                        <LayoutTemplate size={14} />
                      </span>
                      <strong className="bot-card-name">{mini.name}</strong>
                    </span>
                    <span className={`status-pill ${mini.published ? 'good' : 'muted-badge'}`}>
                      {mini.published ? t('mini.dashboard.published') : t('mini.dashboard.draft')}
                    </span>
                  </div>
                  <div className="muted">
                    {mini.bot_name} · /{mini.slug}
                  </div>
                  <div className="bot-card-actions">
                    <button
                      className="bot-card-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMini({ id: mini.id, botId: mini.bot_id, name: mini.name, slug: mini.slug });
                        setView('miniapp');
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {t('dash.open')}
                    </button>
                    {/* Ссылку показываем только для опубликованного аппа с
                        известным username бота. !! обязателен: published — число,
                        и `0 && …` отрендерил бы буквальный 0 в карточке. */}
                    {!!mini.published && !!mini.bot_username && (
                      <a
                        className="miniapp-link"
                        href={`https://t.me/${mini.bot_username}/${mini.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {t('mini.dashboard.openLink')}
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
      <SupportWidget />
    </div>
  );
}
