// Редактор мини-аппа: свободный холст. Палитра слева, телефон по центру,
// инспектор справа. Механика портирована из кликабельного макета
// (tmp/miniapp-mockup/mockup1.html): drag из палитры, перемещение, ресайз за
// угол, snap-линии, выделение, inline-правка текста, Del, undo/redo, превью.
// Черновик живёт на сервере (автосохранение debounce), публикация — ревизией.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { friendlyApiError } from './journey';
import { useT } from './i18n';
import { useSettings } from './settings';
import { ArrowLeft, Undo, Redo, Play, Rocket, Save, HelpCircle, MoreHorizontal, BookOpen } from './icons';
import {
  MINI_PALETTE_GROUPS,
  MINI_ELEMENT_DEFAULTS,
  MINI_CANVAS_W,
  MINI_CANVAS_H,
  miniElement,
  validateMiniAppShape,
  type MiniApp,
  type MiniElement,
} from '../../shared/miniapp';
import { MINI_ELEMENT_META, isAdvancedMiniGroup } from './miniMeta';
import { renderMiniElement, snapPosition, pushUndo } from './miniRender';
import { MiniInspector } from './MiniInspector';

const newId = () => `e${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

export function MiniAppEditor({ miniId, botId, onBack, onOpenGuide }: { miniId: string; botId: string; onBack: () => void; onOpenGuide?: () => void }) {
  const t = useT();
  const settings = useSettings();
  const [app, setApp] = useState<MiniApp | null>(null);
  const [appName, setAppName] = useState('');
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [menuButton, setMenuButton] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [snap, setSnap] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  // ghost — полупрозрачная копия того, что тащим, следует за курсором (баг №3:
  // раньше не было видно ни сам перенос, ни точку приземления).
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // поповеры обвязки топбара (как в конструкторе ботов): «?» помощь и «…» ещё
  const [showHelp, setShowHelp] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  // состояние сохранения — как в конструкторе ботов: полоса панели показывает
  // «сохранение… / есть изменения / сохранено», явная кнопка «Сохранить» ждёт его.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const [, forceTick] = useState(0);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | { id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; moved: boolean; snapBefore: string }>(null);
  const paletteDragRef = useRef<null | string>(null);
  const dragFrame = useRef<number | null>(null);
  const pendingPointer = useRef<PointerEvent | null>(null);
  const saveTimer = useRef<any>(null);
  // Последний несохранённый черновик: flush на уходе со страницы (S3-02)
  // читает ref, а не state — слушатель не переподписывается на каждую правку.
  const pendingDraft = useRef<MiniApp | null>(null);

  const level = settings.skill_level || 'medium';
  const advancedOn = settings.advanced_blocks;

  useEffect(() => {
    let dead = false;
    api.getMiniApp(miniId).then((d) => {
      if (dead) return;
      setAppName(d.name);
      setApp(d.draft as MiniApp);
    }).catch((e) => setErr(friendlyApiError(e, settings.language)));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miniId]);

  const page = app?.pages[pageIdx] ?? null;

  const setAppWithUndo = useCallback((next: MiniApp) => {
    setApp((cur) => {
      if (cur) {
        undoRef.current = pushUndo(undoRef.current, cur);
        redoRef.current = [];
      }
      return next;
    });
    forceTick((x) => x + 1);
    scheduleSave(next);
  }, []);

  function scheduleSave(next: MiniApp) {
    setDirty(true);
    pendingDraft.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(next), 800);
  }

  // S3-02: последний шанс перед уходом — вкладку закрывают или сворачивают
  // до таймера (800 мс). Паттерн — как в конструкторе ботов (Constructor.tsx):
  // beforeunload + visibilitychange + keepalive в запросе, иначе браузер
  // оборвёт его вместе с вкладкой. Ошибку молчим: черновик ≠ версия, явная
  // кнопка «Сохранить» покажет ошибку.
  useEffect(() => {
    const flushDraft = () => {
      const next = pendingDraft.current;
      if (!next) return;
      void api.saveMiniAppDraft(miniId, next, undefined, true).catch(() => {});
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flushDraft);
    window.addEventListener('beforeunload', flushDraft);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flushDraft);
      window.removeEventListener('beforeunload', flushDraft);
    };
  }, [miniId]);

  // Автосейв и явная кнопка «Сохранить» идут одним путём: валидация, затем
  // черновик на сервер. saving/dirty кормят строку состояния панели — как в
  // конструкторе ботов автор всегда видит, сохранён ли апп.
  async function flushSave(next: MiniApp) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!validateMiniAppShape(next)) { setErr(t('error.validation')); return; }
    setErr('');
    setSaving(true);
    try {
      await api.saveMiniAppDraft(miniId, next);
      // Доехало — flush на уходе больше не нужен.
      if (pendingDraft.current === next) pendingDraft.current = null;
      setDirty(false);
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    } finally {
      setSaving(false);
    }
  }

  function saveNow() {
    if (!app) return;
    void flushSave(app);
  }

  function undo() {
    setApp((cur) => {
      const prev = undoRef.current.pop();
      if (!prev || !cur) return cur;
      redoRef.current.push(JSON.stringify(cur));
      forceTick((x) => x + 1);
      const parsed = JSON.parse(prev) as MiniApp;
      scheduleSave(parsed);
      return parsed;
    });
  }
  function redo() {
    setApp((cur) => {
      const next = redoRef.current.pop();
      if (!next || !cur) return cur;
      undoRef.current = pushUndo(undoRef.current, cur);
      forceTick((x) => x + 1);
      const parsed = JSON.parse(next) as MiniApp;
      scheduleSave(parsed);
      return parsed;
    });
  }

  // клавиатура: Del, Ctrl+Z/Y. ev.code, а не ev.key — иначе на русской
  // раскладке Ctrl+Z даёт 'я' и undo молча не срабатывает (баг приёмки).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || (ev.target as HTMLElement)?.isContentEditable) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ') { ev.preventDefault(); undo(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyY') { ev.preventDefault(); redo(); }
      if (ev.key === 'Delete' && selId && app && !preview) {
        const next = { ...app, pages: app.pages.map((p, i) => (i === pageIdx ? { ...p, els: p.els.filter((e) => e.id !== selId) } : p)) };
        setSelId(null);
        setAppWithUndo(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // F3-304-orig: поповеры «?»/«…» закрываются кликом-вне и по Escape —
  // как ctx-меню и explain в Конструкторе.
  useEffect(() => {
    if (!showHelp && !showMore) return;
    const closeBoth = () => { setShowHelp(false); setShowMore(false); };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeBoth();
    };
    window.addEventListener('click', closeBoth);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', closeBoth);
      window.removeEventListener('keydown', onKey);
    };
  }, [showHelp, showMore]);

  const groups = useMemo(
    () => MINI_PALETTE_GROUPS.filter((g) => !(isAdvancedMiniGroup(g.id) && level === 'low' && !advancedOn)),
    [level, advancedOn]
  );

  // ---- drag из палитры ----
  function onPaletteDown(type: string, ev: React.PointerEvent) {
    if (preview) return;
    ev.preventDefault();
    paletteDragRef.current = type;
    setGhost({ x: ev.clientX, y: ev.clientY, label: t(MINI_ELEMENT_META[type as keyof typeof MINI_ELEMENT_META].label as any) });
    const moveFrame = () => {
      dragFrame.current = null;
      const e = pendingPointer.current;
      if (!e) return;
      setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g));
      const scr = screenRef.current;
      if (!scr) return;
      const r = scr.getBoundingClientRect();
      const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      scr.dataset.over = over ? '1' : '';
    };
    const move = (e: PointerEvent) => {
      pendingPointer.current = e;
      if (dragFrame.current == null) dragFrame.current = requestAnimationFrame(moveFrame);
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragFrame.current != null) cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
      pendingPointer.current = null;
      setGhost(null);
      const scr = screenRef.current;
      if (scr) delete scr.dataset.over;
      const type2 = paletteDragRef.current;
      paletteDragRef.current = null;
      if (!type2 || !app || !scr) return;
      const r = scr.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const scale = r.width / MINI_CANVAS_W;
      const def = MINI_ELEMENT_DEFAULTS[type2 as keyof typeof MINI_ELEMENT_DEFAULTS];
      const x = (e.clientX - r.left) / scale - def.w / 2;
      const y = (e.clientY - r.top) / scale - def.h / 2;
      const el = miniElement(type2 as any, newId(), Math.max(0, Math.min(MINI_CANVAS_W - 20, x)), Math.max(0, Math.min(MINI_CANVAS_H - 10, y)));
      const next = { ...app, pages: app.pages.map((p, i) => (i === pageIdx ? { ...p, els: [...p.els, el] } : p)) };
      setSelId(el.id);
      setAppWithUndo(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---- перемещение / ресайз на холсте ----
  function onElDown(el: MiniElement, ev: React.PointerEvent) {
    if (preview) return;
    ev.preventDefault();
    ev.stopPropagation();
    setSelId(el.id);
    const scr = screenRef.current;
    if (!scr) return;
    const scale = scr.getBoundingClientRect().width / MINI_CANVAS_W;
    const isResize = (ev.target as HTMLElement).dataset.rz === '1';
    // Снапшот ДО движения: undo обязан отменять перемещение, а не фиксировать его.
    dragRef.current = { id: el.id, mode: isResize ? 'resize' : 'move', sx: ev.clientX, sy: ev.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h, moved: false, snapBefore: JSON.stringify(app) };
    setDraggingId(el.id);
    const moveFrame = () => {
      dragFrame.current = null;
      const e = pendingPointer.current;
      if (!e) return;
      const d = dragRef.current;
      if (!d || !app) return;
      const dx = (e.clientX - d.sx) / scale;
      const dy = (e.clientY - d.sy) / scale;
      d.moved = d.moved || Math.abs(dx) + Math.abs(dy) > 3;
      setApp((cur) => {
        if (!cur) return cur;
        const pg = cur.pages[pageIdx];
        const target = pg.els.find((x) => x.id === d.id);
        if (!target) return cur;
        let nx = target.x, ny = target.y, nw = target.w, nh = target.h;
        if (d.mode === 'resize') {
          nw = Math.max(20, d.ow + dx);
          nh = Math.max(target.type === 'divider' ? 2 : 16, d.oh + dy);
        } else {
          const snapped = snapPosition(d.ox + dx, d.oy + dy, target.w, target.h);
          nx = Math.max(0, Math.min(MINI_CANVAS_W - 10, snapped.x));
          ny = Math.max(0, Math.min(MINI_CANVAS_H - 10, snapped.y));
          setSnap({ x: snapped.snapX, y: snapped.snapY });
        }
        return { ...cur, pages: cur.pages.map((p, i) => (i === pageIdx ? { ...p, els: p.els.map((x) => (x.id === d.id ? { ...x, x: nx, y: ny, w: nw, h: nh } : x)) } : p)) };
      });
    };
    const move = (e: PointerEvent) => {
      pendingPointer.current = e;
      if (dragFrame.current == null) dragFrame.current = requestAnimationFrame(moveFrame);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragFrame.current != null) cancelAnimationFrame(dragFrame.current);
      if (pendingPointer.current) moveFrame();
      pendingPointer.current = null;
      dragFrame.current = null;
      setSnap({ x: null, y: null });
      setDraggingId(null);
      const d = dragRef.current;
      dragRef.current = null;
      setApp((cur) => {
        if (cur && d?.moved) {
          undoRef.current = pushUndo(undoRef.current, JSON.parse(d.snapBefore));
          redoRef.current = [];
          forceTick((x) => x + 1);
          scheduleSave(cur);
        }
        return cur;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---- inline-правка текста ----
  function onDblClick(el: MiniElement, ev: React.MouseEvent) {
    if (preview) return;
    if (!['text', 'heading', 'button'].includes(el.type)) return;
    const node = (ev.currentTarget as HTMLElement).firstElementChild as HTMLElement | null;
    if (!node) return;
    node.contentEditable = 'true';
    node.focus();
    document.getSelection()?.selectAllChildren(node);
    const done = () => {
      node.contentEditable = 'false';
      node.onblur = null;
      if (!app) return;
      const text = node.textContent || '';
      const next = { ...app, pages: app.pages.map((p, i) => (i === pageIdx ? { ...p, els: p.els.map((x) => (x.id === el.id ? { ...x, props: { ...x.props, text } } : x)) } : p)) };
      setAppWithUndo(next);
    };
    node.onblur = done;
    node.onkeydown = (k) => { if (k.key === 'Enter') { k.preventDefault(); node.blur(); } };
  }

  // ---- превью: клики работают ----
  function onPreviewClick(el: MiniElement) {
    if (!preview || !app) return;
    const a = el.action;
    if (a.id === 'goto') {
      const idx = app.pages.findIndex((p) => p.id === a.pageId);
      if (idx >= 0) setPageIdx(idx);
    } else if (a.id === 'close') {
      setNote(t('mini.note.close'));
    } else if (a.id === 'data') {
      setNote(t('mini.note.data', { table: (a as any).table || '…' }));
    } else if (a.id === 'scenario') {
      setNote(t('mini.note.scenario', { target: (a as any).target || t('mini.note.block') }));
    } else if (a.id === 'link') {
      setNote(t('mini.note.link', { url: (a as any).url || '…' }));
    } else if (a.id === 'pay') {
      setNote(t('mini.note.pay', { stars: (a as any).stars ?? '…' }));
    }
  }

  async function publish(menuButton: boolean) {
    if (!app) return;
    if (!validateMiniAppShape(app)) { setErr(t('error.validation')); return; }
    setErr('');
    try {
      const r = await api.publishMiniApp(miniId, app, menuButton);
      setPublishedUrl(r.bot_username ? `https://t.me/${r.bot_username}/${r.slug}` : null);
      // menu_warning — честная русская строка с воркера (данные, не UI-строка).
      setNote(r.menu_warning ? t('mini.note.publishedWarn', { rev: r.revision, warn: r.menu_warning }) : t('mini.note.published', { rev: r.revision }));
    } catch (e: any) {
      setErr(friendlyApiError(e, settings.language));
    }
  }

  if (err && !app) return <div className="app"><header className="topbar data-topbar"><button className="back-control" onClick={onBack}>←</button></header><main className="dashboard"><div className="err">{err}</div></main></div>;
  if (!app || !page) return <div className="app"><header className="topbar data-topbar"><button className="back-control" onClick={onBack}>←</button></header><main className="dashboard"><p className="muted">{t('dash.loading')}</p></main></div>;

  // Панель — копия панели конструктора ботов: строка 1 (выход, имя, состояние
  // сохранения) + строка 2 (действия слева, обвязка «?» и «…» справа). Классы
  // constructor-top/bar-strip/bar-row — те же, что у ботов, чтобы темы и
  // мобильные правила работали без отдельных копий.
  const stripState = saving ? t('save.saving') : dirty ? t('save.dirty') : t('save.saved');

  return (
    <div className="app mini-editor">
      <header className="constructor-top bar open always">
        <div className="bar-strip">
          <button className="back-control" onClick={onBack} aria-label={t('nav.toBots')}>
            <ArrowLeft />
            {t('nav.toBots')}
          </button>
          <span className="bot-name">{appName || t('dash.loading')}</span>
          <span className={`save-state${dirty ? ' dirty' : ''}`} title={t('save.title')}>
            {stripState}
          </span>
        </div>

        <div className="bar-row">
          {/* Зона 1 — действия сценария, как у ботов: превью, сохранить, опубликовать */}
          <div className="topbar-group" role="group" aria-label={t('editor.group.run')}>
            <button className="secondary" onClick={() => setPreview((p) => !p)} title={preview ? t('editor.edit') : t('editor.preview')}>
              {!preview && <Play />}
              {preview ? t('editor.edit') : t('editor.preview')}
            </button>
            <button className="secondary" onClick={() => void saveNow()} disabled={saving || !app} title={t('editor.save')}>
              <Save size={15} />
              {t('editor.save')}
            </button>
            <button className="primary" disabled={!app} onClick={() => void publish(menuButton)} title={t('editor.publish')}>
              <Rocket size={15} />
              {t('editor.publish')}
            </button>
          </div>

          <span className="spacer" />

          {/* Зона 2 — обвязка: «?» помощь и «…» ещё, как у ботов */}
          <div className="topbar-group topbar-chrome">
            <div className="pill-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                className="ghost more-btn"
                title={t('bar.help')}
                aria-label={t('bar.help')}
                aria-haspopup="menu"
                aria-expanded={showHelp}
                onClick={() => { setShowMore(false); setShowHelp((v) => !v); }}
              >
                <HelpCircle />
              </button>
              {showHelp && (
                <div className="conflict-pop more-pop" role="menu" aria-label={t('bar.help.title')} onClick={(e) => e.stopPropagation()}>
                  <div className="conflict-pop-head">{t('bar.help.title')}</div>
                  <div className="more-row" role="none">
                    <button className="conflict-item" role="menuitem" onClick={() => { setShowHelp(false); onOpenGuide?.(); }}>
                      <BookOpen />
                      {t('bar.guide')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="pill-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                className="ghost more-btn"
                title={t('bar.more')}
                aria-label={t('bar.more')}
                aria-haspopup="menu"
                aria-expanded={showMore}
                onClick={() => { setShowHelp(false); setShowMore((v) => !v); }}
              >
                <MoreHorizontal />
              </button>
              {showMore && (
                <div className="conflict-pop more-pop" role="menu" aria-label={t('bar.more.title')} onClick={(e) => e.stopPropagation()}>
                  <div className="more-row" role="none">
                    <button className="conflict-item" role="menuitem" disabled={!undoRef.current.length} onClick={() => { setShowMore(false); undo(); }}>
                      <Undo />
                      {t('editor.undo')}
                    </button>
                    <button className="conflict-item" role="menuitem" disabled={!redoRef.current.length} onClick={() => { setShowMore(false); redo(); }}>
                      <Redo />
                      {t('editor.redo')}
                    </button>
                    {!preview && (
                      <label className="conflict-item mini-pop-check">
                        <input type="checkbox" checked={menuButton} onChange={(e) => setMenuButton(e.target.checked)} />
                        {t('miniInsp.menuButton')}
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mini-editor-body">
        {!preview && (
          <aside className="mini-left">
            <div className="mini-pal-title">{t('miniInsp.pages')}</div>
            {app.pages.map((p, i) => (
              <button key={p.id} className={'mini-page-row' + (i === pageIdx ? ' on' : '')} onClick={() => { setPageIdx(i); setSelId(null); }}>
                📄 {p.name} <span className="muted">{p.els.length}</span>
              </button>
            ))}
            <button
              className="ghost"
              onClick={() => {
                const id = `p${Math.random().toString(36).slice(2, 7)}`;
                const next = { ...app, pages: [...app.pages, { id, name: `${t('miniInsp.page')} ${app.pages.length + 1}`, bg: '#ffffff', els: [] }] };
                setPageIdx(next.pages.length - 1);
                setAppWithUndo(next);
              }}
            >
              {t('miniInsp.addPage')}
            </button>
            <div className="mini-pal-title">{t('miniInsp.tabbar')}</div>
            <label className="mini-check">
              <input
                type="checkbox"
                checked={app.tabbar.enabled}
                onChange={(e) => setAppWithUndo({ ...app, tabbar: { ...app.tabbar, enabled: e.target.checked } })}
              />
              {t('miniInsp.tabbar.on')}
            </label>
            {app.tabbar.enabled &&
              app.tabbar.tabs.map((tb, i) => (
                <div key={i} className="mini-page-row">
                  {tb.icon} {tb.label || app.pages.find((p) => p.id === tb.pageId)?.name}
                </div>
              ))}
            <div className="mini-pal-title">{t('mini.palette.elements')}</div>
            {groups.map((g) => (
              <div key={g.id} className="mini-group">
                <div className="mini-group-title">{t(g.title as any)}</div>
                <div className="mini-pal">
                  {g.items.map((type) => (
                    <div key={type} className="mini-pal-item" onPointerDown={(e) => onPaletteDown(type, e)} title={t(MINI_ELEMENT_META[type].hint as any)}>
                      <span className="dot" style={{ background: MINI_ELEMENT_META[type].color }} />
                      {t(MINI_ELEMENT_META[type].label as any)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </aside>
        )}

        <main className="mini-center">
          {err && <div className="err">{err}</div>}
          {note && <div className="muted">{note}</div>}
          {publishedUrl && <a href={publishedUrl} target="_blank" rel="noreferrer">{t('mini.dashboard.openLink')}</a>}
          <div className={'mini-phone' + (preview ? ' preview' : '')}>
            <div className="mini-notch" />
            <div
              className="mini-screen"
              ref={screenRef}
              data-over=""
              onPointerDown={(e) => { if (!preview && !(e.target as HTMLElement).closest('.mini-el')) setSelId(null); }}
              style={{ background: page.bg }}
            >
              {snap.x != null && <div className="mini-snap-v" style={{ left: snap.x }} />}
              {snap.y != null && <div className="mini-snap-h" style={{ top: snap.y }} />}
              {page.els.map((el) => (
                <div
                  key={el.id}
                  className={'mini-el' + (el.id === selId && !preview ? ' sel' : '') + (el.id === draggingId ? ' dragging' : '')}
                  style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
                  onPointerDown={(e) => onElDown(el, e)}
                  onDoubleClick={(e) => onDblClick(el, e)}
                  onClick={() => onPreviewClick(el)}
                >
                  {renderMiniElement(el)}
                  {el.id === selId && !preview && (
                    <>
                      <span className="mini-el-hint">{t(MINI_ELEMENT_META[el.type].label as any)}</span>
                      <span className="mini-el-rh" data-rz="1" />
                    </>
                  )}
                </div>
              ))}
            </div>
            {app.tabbar.enabled && !preview && (
              <div className="mini-tabbar-mock">
                {app.tabbar.tabs.map((tb, i) => (
                  <span key={i}>{tb.icon} {tb.label}</span>
                ))}
              </div>
            )}
          </div>
        </main>

        {!preview && (
          <aside className="mini-right">
            <MiniInspector
              app={app}
              pageIdx={pageIdx}
              selId={selId}
              botId={botId}
              onChange={setAppWithUndo}
              onPreview={() => setPreview((p) => !p)}
              onPublish={(mb) => void publish(mb)}
            />
          </aside>
        )}
      </div>

      {/* ghost: полупрозрачная копия того, что тащим из палитры; следует за
          курсором, точка приземления видна по подсветке телефона (data-over) */}
      {ghost && (
        <div className="mini-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
          {ghost.label}
        </div>
      )}
    </div>
  );
}
