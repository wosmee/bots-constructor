// SPA-рантайм мини-аппов: один vanilla-JS HTML-документ без сборочного шага.
// Воркер отдаёт SPA_HTML как HTML-строку и перед скриптом рантайма вставляет
// бут-данные: <script id="mini-boot" type="application/json">{ botId, slug,
// app: MiniApp, ctx: MiniContext, startParam? }</script>.
//
// Контракт рантайма:
// - Telegram WebApp SDK: ready/expand, тема через --tg-theme-*, BackButton = pop стека;
// - навигация: стек на таб (goto пушит, смена таба сбрасывает), start = startPageId
//   или страница из boot.startParam;
// - холст 390px, transform: scale(innerWidth/390), высота = max(844, низ нижнего элемента);
// - API: POST /m/api/{botId}/{slug}/query и /action с заголовком X-Telegram-Init-Data;
//   401/403 → denied-экран на весь апп;
// - все пользовательские/строчные данные экранируются escapeHtml, URL — safeUrl;
// - фаза D: richtext (HTML, санитизированный сервером, — единственное innerHTML
//   из схемы; присваивание помечено маркером на месте), carousel (лента + лайтбокс),
//   video (только YouTube-embed или <video controls>), пользовательский CSS
//   (style.css → скоуп .el-<id>, page.css → .page-<pageId>, фильтр safeCss,
//   вставка один раз), действие pay (kind: 'pay' → тост «Счёт отправлен в чат»).
//
// Внутри SPA_HTML запрещены обратные кавычки и последовательность dollar-brace
// (это template-literal TypeScript), поэтому рантайм написан на конкатенации
// строк. String.raw сохраняет backslash-последовательности (regex) как есть.
//
// evalVisibleMini продублирована обычным TS-экспортом для unit-тестов
// (tests/miniapp-spa.test.ts); рантайм содержит ту же логику на vanilla JS.

import type { MiniContext, MiniVisibleWhen } from '../../../shared/miniapp';
import type { ConditionOp } from '../../../shared/types';

// ── чистая логика видимости (зеркало рантайма, тестируется напрямую) ────────

// Значение левой части условия по контексту: user.id/user.name/user.username,
// tag:<имя> (факт «есть/нет» как '1'/''), var:<имя> из ctx.vars.
export function miniCondLeft(ref: string, ctx: MiniContext): string {
  const s = String(ref ?? '');
  if (s === 'user.id') return String(ctx.userId ?? '');
  if (s === 'user.name') return ctx.name ?? '';
  if (s === 'user.username') return ctx.username ?? '';
  if (s.startsWith('tag:')) return (ctx.tags ?? []).includes(s.slice(4).trim()) ? '1' : '';
  if (s.startsWith('var:')) {
    const v = (ctx.vars ?? {})[s.slice(4).trim()];
    return v == null ? '' : String(v);
  }
  return '';
}

// Обе стороны — конечные числа (и непустые): тогда сравниваем числово.
function bothNumeric(a: string, b: string): [number, number] | null {
  if (a.trim() === '' || b.trim() === '') return null;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? [na, nb] : null;
}

// Семантика ConditionOp из shared/types.ts (эталон — engine.evalConditionOp),
// отличие: ==/!= тоже числовые, когда обе стороны парсятся числом (user.id = 42).
export function evalMiniOp(leftRaw: string, op: ConditionOp, rightRaw: string): boolean {
  const left = String(leftRaw ?? '');
  const right = String(rightRaw ?? '');
  const nums = bothNumeric(left, right);
  switch (op) {
    case '==':
      return nums ? nums[0] === nums[1] : left === right;
    case '!=':
      return nums ? nums[0] !== nums[1] : left !== right;
    case '>':
      return nums ? nums[0] > nums[1] : left > right;
    case '<':
      return nums ? nums[0] < nums[1] : left < right;
    case '>=':
      return nums ? nums[0] >= nums[1] : left >= right;
    case '<=':
      return nums ? nums[0] <= nums[1] : left <= right;
    case 'contains':
      return left.includes(right);
    case 'in':
    case 'not_in': {
      // Правая часть — список через запятую; регистр и пробелы не важны.
      const list = right.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s !== '');
      const hit = list.includes(left.trim().toLowerCase());
      return op === 'in' ? hit : !hit;
    }
    case 'starts_with':
      return right !== '' && left.startsWith(right);
    case 'ends_with':
      return right !== '' && left.endsWith(right);
    case 'empty':
      // '0' НЕ пусто: ноль — осмысленное значение счётчика (как в движке).
      return left === '';
    case 'not_empty':
      return left !== '';
    case 'regex':
      // Битый регексп — ложь, а не исключение.
      try {
        return new RegExp(right).test(left.slice(0, 1000));
      } catch {
        return false;
      }
  }
  return false;
}

// Условие видимости элемента: null/undefined/без op = видим.
export function evalVisibleMini(cond: MiniVisibleWhen | null | undefined, ctx: MiniContext): boolean {
  if (!cond || !cond.op) return true;
  return evalMiniOp(miniCondLeft(cond.left, ctx), cond.op, String(cond.right ?? ''));
}

// ── HTML-документ рантайма ──────────────────────────────────────────────────

export const SPA_HTML: string = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Mini App</title>
<style>
*{box-sizing:border-box}
[hidden]{display:none !important}
html,body{margin:0;padding:0}
body{background:var(--tg-theme-bg-color,#ffffff);color:var(--tg-theme-text-color,#1d1d1f);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior-y:none}
#root{width:100%}
#viewport{position:relative;width:100%;overflow:hidden}
#canvas{position:absolute;top:0;left:0;width:390px;transform-origin:top left}
.el{position:absolute}
.tx{width:100%;height:100%;display:flex;align-items:center;overflow:hidden;line-height:1.3;white-space:pre-wrap;word-break:break-word}
.btn{width:100%;height:100%;border:0;cursor:pointer;font:inherit;font-weight:600;font-size:15px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:#6d5efc;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.12);padding:0 12px}
.btn:active{opacity:.85}
.inp{width:100%;height:100%;border:1.5px solid #d8dbe2;border-radius:10px;background:#fff;color:#1d1d1f;padding:10px 14px;font:inherit;font-size:14px;resize:none;outline:none}
.img{width:100%;height:100%;object-fit:cover;display:block}
.ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.card{width:100%;height:100%}
.data{width:100%;height:100%;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px}
.skel-wrap{padding:10px;display:flex;flex-direction:column;gap:8px}
.skel{height:34px;border-radius:8px;background:#e8eaef;animation:sk 1.2s ease-in-out infinite}
.chips-skel{height:24px;width:70%;margin:10px}
.stat-skel{height:40px;width:60%;margin:16px}
@keyframes sk{0%,100%{opacity:.45}50%{opacity:.9}}
.dempty{padding:18px 12px;text-align:center;color:#8a8f98;font-size:13px}
.retry{border:1px solid #d8dbe2;background:#fff;border-radius:8px;padding:4px 10px;margin-left:6px;cursor:pointer;font:inherit;font-size:12px;color:#333}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}
.gcard{position:relative;border:1px solid #eef0f4;border-radius:12px;overflow:hidden;background:#fff;cursor:pointer}
.gcard-img{height:90px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#dbe2ef,#c3cfe2);font-size:28px;overflow:hidden}
.gcard-t{padding:6px 8px 2px;font-size:12.5px;font-weight:600;color:#1d1d1f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gcard-p{padding:0 8px 8px;font-size:12.5px;color:#6d5efc;font-weight:700}
.chips{display:flex;gap:6px;padding:8px;overflow-x:auto;white-space:nowrap}
.chip{border:1px solid #d8dbe2;background:#fff;border-radius:999px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer;color:#333;flex:0 0 auto}
.chip.on{background:#6d5efc;border-color:#6d5efc;color:#fff}
.sbtn{background:#eef0f4;color:#333;border-radius:10px;font-size:13px;font-weight:500;box-shadow:none}
.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th{position:sticky;top:0;background:#fafbfc;text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#8a8f98;font-weight:600}
.tbl td{padding:6px 8px;border-bottom:1px solid #eef0f4;color:#333}
.stat{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
.stat-v{font-size:26px;font-weight:800;color:#1d1d1f}
.stat-l{font-size:11.5px;color:#8a8f98;margin-top:2px;text-align:center;padding:0 6px}
.frm{width:100%;height:100%;display:flex;flex-direction:column;gap:8px;overflow:auto}
.frm-l{font-size:12px;color:#666}
.frm-i{height:40px;flex:0 0 auto}
.frm-b{height:44px;flex:0 0 auto}
.frm-s{font-size:12px;color:#8a8f98;min-height:16px;text-align:center}
.prod{position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;padding:10px;gap:6px}
.prod-img{flex:1;min-height:0;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:32px;overflow:hidden}
.prod-t{font-weight:600;font-size:14px;color:#1d1d1f}
.prod-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.prod-p{font-weight:700;font-size:15px;color:#1d1d1f}
.prod-b{width:auto;height:auto;min-height:34px;padding:9px 16px;border-radius:10px;font-size:13px}
.rf{width:100%;height:100%;display:flex;flex-direction:column;gap:8px;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px}
.rf-search{display:flex;gap:6px;flex:0 0 auto}
.rf-go{width:auto;padding:0 14px;height:40px;border-radius:10px;font-size:13px;flex:0 0 auto}
.rf-list{display:flex;flex-direction:column;gap:4px;overflow:auto}
.rf-item{border:1px solid #eef0f4;background:#fafbfc;border-radius:8px;padding:8px 10px;text-align:left;font:inherit;font-size:13px;cursor:pointer;color:#333}
.rf-edit{display:flex;flex-direction:column;gap:8px}
.rf-row{display:flex;gap:6px}
.rf-save{background:#22c55e;color:#fff;height:38px;border-radius:10px;font-size:13px;flex:1}
.rf-del{background:#fff;color:#e05260;border:1px solid #f0c4c9;height:38px;border-radius:10px;font-size:13px;flex:1;box-shadow:none}
.rf-cancel{background:#fff;color:#666;border:1px solid #d8dbe2;height:34px;border-radius:10px;font-size:12.5px;box-shadow:none}
.rf-msg{font-size:12px;color:#8a8f98;text-align:center;min-height:14px}
.uitem{display:flex;gap:10px;align-items:center;padding:8px 10px;border-bottom:1px solid #eef0f4;cursor:pointer}
.uava{width:36px;height:36px;border-radius:50%;background:#6d5efc;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:0 0 auto}
.ucol{min-width:0}
.uname{font-size:13.5px;font-weight:600;color:#1d1d1f}
.uid{font-size:11.5px;color:#8a8f98}
.utags{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}
.tagb{background:#eef0ff;color:#6d5efc;border-radius:6px;padding:1px 6px;font-size:10.5px}
.uinfo{width:100%;height:100%;display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px;overflow:hidden}
.aigen{width:100%;height:100%;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;background:#fff;border:1px dashed #c9cdd6;border-radius:12px;padding:12px;text-align:center;overflow:auto}
.aigen-ph{font-size:30px}
.aigen-t{font-size:12.5px;color:#8a8f98}
.aigen-b{width:auto;height:38px;padding:0 18px;border-radius:10px;background:#6d5efc;color:#fff}
.aigen-b:disabled{opacity:.5;cursor:default}
.aigen-img{max-width:100%;max-height:110px;border-radius:10px;object-fit:cover}
.ai-busy{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;gap:4px;background:#fff;border:1px dashed #c9cdd6;border-radius:12px;padding:12px}
.gall{display:grid;grid-template-columns:1fr 1fr;gap:6px;width:100%;overflow:auto}
.gall img{width:100%;height:84px;object-fit:cover;border-radius:8px;cursor:pointer;display:block}
.rtx{width:100%;height:100%;overflow:auto;word-break:break-word;line-height:1.35}
.crl{width:100%;height:100%;display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
.crl-i{flex:0 0 82%;min-width:0;margin:0;display:flex;flex-direction:column;scroll-snap-align:start}
.crl img{width:100%;flex:1;min-height:0;object-fit:cover;border-radius:10px;display:block;cursor:pointer;background:#e8eaef}
.crl-c{font-size:12px;color:#8a8f98;padding:4px 2px 0;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vid{width:100%;height:100%;border:0;border-radius:10px;background:#000;display:block}
.lb{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center}
.lb-img{max-width:92%;max-height:86%;object-fit:contain;border-radius:8px}
.lb-x{position:absolute;top:14px;right:14px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:17px;cursor:pointer;line-height:1}
.fav-b{position:absolute;top:6px;right:8px;z-index:6;color:#e11d48;font-size:15px;line-height:1;pointer-events:none;text-shadow:0 1px 2px rgba(255,255,255,.85)}
.gcard.fav .gcard-img,.prod.fav .prod-img{outline:2px solid #e11d48;outline-offset:-2px}
.toast{position:fixed;left:50%;bottom:calc(72px + env(safe-area-inset-bottom));transform:translateX(-50%);background:rgba(29,29,31,.92);color:#fff;padding:9px 16px;border-radius:10px;font-size:13px;line-height:1.3;z-index:300;max-width:82%;text-align:center;animation:tst 2.5s ease forwards;pointer-events:none}
@keyframes tst{0%{opacity:0}8%,80%{opacity:1}100%{opacity:0}}
.unk{width:100%;height:100%;border:1px dashed #c9cdd6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#8a8f98;font-size:11px}
.dock{position:fixed;left:0;right:0;bottom:0;display:flex;background:var(--tg-theme-bottom-bar-bg-color,#ffffff);border-top:1px solid rgba(0,0,0,.08);padding-bottom:env(safe-area-inset-bottom);z-index:50}
.dock-tab{flex:1;border:0;background:transparent;padding:8px 4px;display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--tg-theme-text-color,#1d1d1f);opacity:.5;cursor:pointer;font:inherit}
.dock-tab.on{opacity:1}
.dock-ico{font-size:20px;line-height:1.2}
.dock-lbl{font-size:11px}
#denied{position:fixed;inset:0;z-index:100;background:var(--tg-theme-bg-color,#ffffff);display:flex;align-items:center;justify-content:center;padding:24px}
.denied-box{max-width:320px;text-align:center}
.denied-eyebrow{font-size:10px;letter-spacing:1.4px;font-weight:800;color:#6d5efc;margin:0 0 8px}
.denied-box h1{font-size:22px;margin:0 0 10px;color:var(--tg-theme-text-color,#1d1d1f)}
.denied-box p{font-size:13.5px;color:#8a8f98;margin:0}
.fatal{padding:40px 20px;text-align:center;color:#8a8f98;font-size:14px}
</style>
</head>
<body>
<!-- Бут-данные: воркер вставляет на место маркера MINI_BOOT тег script id="mini-boot"
     type="application/json" с объектом { botId, slug }. Схема и ctx подтягиваются
     рантаймом сами через POST /m/api/.../boot с initData (F-035, аудит 18.10):
     в HTML без проверки подписи initData они не кладутся. -->
<!--MINI_BOOT-->
<div id="root"></div>
<div id="denied" hidden>
  <div class="denied-box">
    <p class="denied-eyebrow">MINI APP</p>
    <h1>Доступ запрещён</h1>
    <p>Это приложение открывается только внутри Telegram. Если это вы — перезапустите его кнопкой из бота.</p>
  </div>
</div>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script>
(function () {
  'use strict';

  /* ── утилиты ── */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function num(v, fb) {
    var n = typeof v === 'number' && isFinite(v) ? v : parseFloat(v);
    return isFinite(n) ? n : fb;
  }
  // URL: только http(s), protocol-relative и относительные; javascript: и data: — мимо.
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^(https?:)?\/\//i.test(s)) return s;
    if (s.charAt(0) === '/') return s;
    return '';
  }
  // Цвет/градиент из схемы — только безопасные формы (защита от CSS-инъекций).
  function cssColor(v, fb) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return fb;
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
    if (/^rgba?\([0-9\s.,%]+\)$/.test(s)) return s;
    if (/^[a-zA-Z]+$/.test(s)) return s;
    return fb;
  }
  function cssGrad(v, fb) {
    var s = String(v == null ? '' : v).trim();
    if (/^(linear|radial)-gradient\([^\u0022\u0027;<>]*\)$/.test(s)) return s;
    return fb;
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  /* ── фаза D: пользовательский CSS (style.css → .el-<id>, page.css → .page-<id>) ── */

  var cssInserted = {};   // маркер скоупа -> 1 (жизненный цикл одного render)
  var scopedStyles = [];  // вставленные <style>-узлы текущей страницы

  // id → безопасный суффикс класса скоупа (только [A-Za-z0-9_-]).
  function cssScopeId(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, ''); }

  // Страховочный фильтр поверх серверной санитизации (sanitizeCss,
  // shared/mini-sanitize.ts): из деклараций вырезается всё, что содержит
  // expression / javascript / behavior / @import / url( (кроме data:image)
  // и '</' (попытка закрыть <style> раньше времени).
  function safeCss(s) {
    var parts = String(s == null ? '' : s).split(';');
    for (var i = 0; i < parts.length; i++) {
      var low = parts[i].toLowerCase();
      if (low.indexOf('expression') >= 0 || low.indexOf('javascript') >= 0 || low.indexOf('behavior') >= 0 ||
          low.indexOf('@import') >= 0 || low.indexOf('</') >= 0 ||
          (low.indexOf('url(') >= 0 && low.indexOf('data:image') < 0)) parts[i] = '';
    }
    return parts.join(';');
  }

  // Вставка скоуп-CSS один раз на маркер (page.css не дублируется на элемент).
  // Красим через textContent — не innerHTML.
  function insertScopedCss(marker, selector, css) {
    if (cssInserted[marker]) return;
    cssInserted[marker] = 1;
    var clean = safeCss(css);
    if (!clean) return;
    var st = document.createElement('style');
    st.textContent = selector + '{' + clean + '}';
    document.head.appendChild(st);
    scopedStyles.push(st);
  }

  function clearScopedCss() {
    for (var i = 0; i < scopedStyles.length; i++) {
      if (scopedStyles[i].parentNode) scopedStyles[i].parentNode.removeChild(scopedStyles[i]);
    }
    scopedStyles = [];
    cssInserted = {};
  }

  /* ── бут ── */

  // F-035 (аудит 18.10): воркер вставляет в HTML ТОЛЬКО { botId, slug } —
  // схему и ctx раньше никто не передавал, и каждый мини-апп показывал
  // «нет схемы». Теперь рантайм сам зовёт POST /m/api/.../boot с initData
  // (проверка подписи — на сервере) и стартует по её ответу.
  var boot = null;
  try {
    var bootEl = document.getElementById('mini-boot');
    if (bootEl) boot = JSON.parse(bootEl.textContent || '');
  } catch (e) { boot = null; }

  var root = document.getElementById('root');

  function showFatal(msg) {
    root.innerHTML = '<div class="fatal">' + escapeHtml(msg) + '</div>';
  }
  if (!boot || !boot.botId || !boot.slug) {
    showFatal('Не удалось запустить мини-апп: нет данных подключения');
    return;
  }

  var tg = (window.Telegram && window.Telegram.WebApp) || null;
  if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }
  function initData() { return tg && tg.initData ? tg.initData : ''; }

  var botId = String(boot.botId == null ? '' : boot.botId);
  var slug = String(boot.slug == null ? '' : boot.slug);

  var app = null;
  var ctx = { userId: 0, name: '', username: null, tags: [], vars: {} };

  /* ── состояние навигации (инициализируется в startApp после boot) ── */

  var pages = {};
  var tabbar = null;
  var tabRoots = {};
  var startId = null;
  var activeTab = null;
  var stack = [];

  var currentRow = null;      // строка, переданная тапом по карточке grid
  var toggleState = {};       // elementId -> bool, локальный оверрайд действия toggle
  var inputStore = {};        // elementId / fieldId -> значение (переживает ререндеры)
  var dataStates = {};        // elementId -> { status, rows, total, sum }
  var rfStates = {};          // elementId -> внутреннее состояние record_form
  var tableStates = {};       // table -> { term, searchColumns, sortColumn, sortDir, chips }
  var elNodes = {};           // elementId -> DOM-узел (текущая страница)
  var pageData = [];          // data-элементы текущей страницы
  var viewport = null, canvas = null, dock = null, curH = 844;

  function currentPage() {
    return pages[stack.length ? stack[stack.length - 1] : activeTab] || app.pages[0];
  }
  function findElDef(id) {
    var page = currentPage();
    var els = (page && page.els) || [];
    for (var i = 0; i < els.length; i++) if (els[i] && els[i].id === id) return els[i];
    return null;
  }

  /* ── условия видимости и интерполяция ── */

  function condLeft(ref) {
    var s = String(ref == null ? '' : ref);
    if (s === 'user.id') return String(ctx.userId == null ? '' : ctx.userId);
    if (s === 'user.name') return String(ctx.name == null ? '' : ctx.name);
    if (s === 'user.username') return String(ctx.username == null ? '' : ctx.username);
    if (s.indexOf('tag:') === 0) return (ctx.tags || []).indexOf(s.slice(4).trim()) >= 0 ? '1' : '';
    if (s.indexOf('var:') === 0) {
      var v = (ctx.vars || {})[s.slice(4).trim()];
      return v == null ? '' : String(v);
    }
    // field:<колонка> — для элементов поверх строки (grid → detailPageId)
    if (s.indexOf('field:') === 0 && currentRow && currentRow.data) {
      var f = currentRow.data[s.slice(6).trim()];
      return f == null ? '' : String(f);
    }
    return '';
  }

  function evalOp(leftRaw, op, rightRaw) {
    var left = String(leftRaw == null ? '' : leftRaw);
    var right = String(rightRaw == null ? '' : rightRaw);
    var nums = null;
    if (left.trim() !== '' && right.trim() !== '') {
      var a = Number(left), b = Number(right);
      if (isFinite(a) && isFinite(b)) nums = [a, b];
    }
    switch (op) {
      case '==': return nums ? nums[0] === nums[1] : left === right;
      case '!=': return nums ? nums[0] !== nums[1] : left !== right;
      case '>': return nums ? nums[0] > nums[1] : left > right;
      case '<': return nums ? nums[0] < nums[1] : left < right;
      case '>=': return nums ? nums[0] >= nums[1] : left >= right;
      case '<=': return nums ? nums[0] <= nums[1] : left <= right;
      case 'contains': return left.indexOf(right) >= 0;
      case 'in':
      case 'not_in': {
        var list = right.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(function (s) { return s !== ''; });
        var hit = list.indexOf(left.trim().toLowerCase()) >= 0;
        return op === 'in' ? hit : !hit;
      }
      case 'starts_with': return right !== '' && left.indexOf(right) === 0;
      case 'ends_with': return right !== '' && left.slice(-right.length) === right;
      case 'empty': return left === '';
      case 'not_empty': return left !== '';
      case 'regex':
        try { return new RegExp(right).test(left.slice(0, 1000)); } catch (e) { return false; }
    }
    return false;
  }

  function baseVisible(def) {
    var c = def.visible_when;
    if (!c || !c.op) return true;
    return evalOp(condLeft(c.left), c.op, c.right);
  }
  function visible(def) {
    if (hasOwn(toggleState, def.id)) return !!toggleState[def.id];
    return baseVisible(def);
  }

  function interp(s) {
    return String(s == null ? '' : s).replace(/\{(user|field)\.([A-Za-z0-9_]+)\}/g, function (m, ns, key) {
      if (ns === 'user') {
        if (key === 'name') return String(ctx.name || '');
        if (key === 'id') return String(ctx.userId == null ? '' : ctx.userId);
        if (key === 'username') return String(ctx.username || '');
        return m;
      }
      if (currentRow && currentRow.data && currentRow.data[key] != null) return String(currentRow.data[key]);
      return '';
    });
  }

  /* ── API ── */

  var deniedShown = false;
  function showDenied() {
    if (deniedShown) return;
    deniedShown = true;
    root.style.display = 'none';
    var d = document.getElementById('denied');
    if (d) d.hidden = false;
  }

  function api(kind, body) {
    return fetch('/m/api/' + encodeURIComponent(botId) + '/' + encodeURIComponent(slug) + '/' + kind, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData() },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        showDenied();
        throw new Error('denied');
      }
      if (!res.ok) {
        var err = new Error('api ' + res.status);
        // 429/502/503 отдают { error } с человеческим текстом — он попадёт в тост.
        if (res.status === 429 || res.status === 502 || res.status === 503) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            err.text = j && j.error != null ? String(j.error) : '';
            throw err;
          });
        }
        throw err;
      }
      return res.json();
    });
  }

  function tableState(t) {
    var k = String(t == null ? '' : t);
    if (!tableStates[k]) tableStates[k] = { term: '', searchColumns: [], sortColumn: null, sortDir: 'asc', chips: {} };
    return tableStates[k];
  }

  function buildQuery(table, limit) {
    var stt = tableState(table);
    var q = { kind: 'rows', table: String(table == null ? '' : table), limit: limit || 200 };
    var filters = [];
    for (var col in stt.chips) {
      if (!hasOwn(stt.chips, col)) continue;
      var vals = stt.chips[col];
      if (vals && vals.length) filters.push({ column: col, op: 'in', value: vals.join(',') });
    }
    if (filters.length) q.filters = filters;
    if (stt.term && stt.searchColumns.length) q.search = { columns: stt.searchColumns.slice(), term: stt.term };
    if (stt.sortColumn) q.sort = { column: stt.sortColumn, dir: stt.sortDir };
    return q;
  }

  /* ── действия ── */

  function fieldValue(id) {
    if (id == null) return '';
    var k = String(id);
    if (inputStore[k] != null) return inputStore[k];
    for (var key in inputStore) {
      if (hasOwn(inputStore, key) && key.slice(-(k.length + 1)) === '.' + k) return inputStore[key];
    }
    return '';
  }

  function buildValues(action, elDef) {
    var out = {};
    if (action && action.id === 'data' && Array.isArray(action.values)) {
      for (var i = 0; i < action.values.length; i++) {
        var r = action.values[i] || {};
        if (!r.column) continue;
        if (r.kind === 'literal') out[r.column] = String(r.value == null ? '' : r.value);
        else if (r.kind === 'field') out[r.column] = fieldValue(r.fieldId);
        else if (r.kind === 'user') out[r.column] = condLeft(r.path);
      }
    }
    var p = (elDef && elDef.props) || {};
    if (Array.isArray(p.mapping)) {
      for (var j = 0; j < p.mapping.length; j++) {
        var m = p.mapping[j] || {};
        if (m.column) out[m.column] = fieldValue(m.fieldId);
      }
    }
    return out;
  }

  function flash(node, text) {
    if (!node) return;
    var b = node.tagName === 'BUTTON' ? node : node.querySelector('button');
    if (!b) return;
    var old = b.innerHTML;
    b.innerHTML = escapeHtml(text);
    setTimeout(function () { b.innerHTML = old; }, 1200);
  }

  function toggleById(id) {
    if (!id) return;
    var def = findElDef(id);
    var base = def ? baseVisible(def) : true;
    var cur = hasOwn(toggleState, id) ? !!toggleState[id] : base;
    toggleState[id] = !cur;
    var node = elNodes[id];
    if (node) node.style.display = !cur ? '' : 'none';
    else render();
  }

  /* ── избранное (переменная юзера mini_favs: строка id через запятую) ── */

  function favList() {
    return String((ctx.vars || {}).mini_favs || '').split(',').filter(function (s) { return s !== ''; });
  }
  function setFavList(list) {
    if (!ctx.vars) ctx.vars = {};
    ctx.vars.mini_favs = list.join(',');
  }
  function isFav(id) {
    var s = String(id == null ? '' : id);
    return s !== '' && favList().indexOf(s) >= 0;
  }
  // itemId для действия favorite: явный из схемы (с интерполяцией), иначе id текущей строки.
  function favItemId(a) {
    if (a && a.itemId != null) {
      var v = String(interp(a.itemId));
      if (v) return v;
    }
    return currentRow && currentRow.id != null ? String(currentRow.id) : '';
  }
  // Бейдж ♥: ставим/снимаем класс и рисуем значок внутри узла.
  function paintFav(node, on) {
    if (!node) return;
    if (on) node.classList.add('fav'); else node.classList.remove('fav');
    var b = node.querySelector('.fav-b');
    if (on) {
      if (!b) {
        b = document.createElement('span');
        b.className = 'fav-b';
        b.textContent = '\u2665';
        node.appendChild(b);
      }
    } else if (b) {
      b.parentNode.removeChild(b);
    }
  }
  function favNode(node) {
    if (!node) return null;
    var c = node.querySelector ? node.querySelector('.prod') : null;
    return c || node;
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = String(msg == null ? '' : msg);
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  function runAction(a, elDef, node, done) {
    function fin(ok) { if (done) done(ok); }
    if (!a || !a.id || a.id === 'none') { fin(true); return; }
    if (a.id === 'goto') { gotoPage(a.pageId); fin(true); return; }
    if (a.id === 'link') {
      var u = safeUrl(a.url);
      if (u) {
        if (tg && tg.openLink) { try { tg.openLink(u); } catch (e) { window.open(u, '_blank'); } }
        else window.open(u, '_blank');
      }
      fin(!!u);
      return;
    }
    if (a.id === 'close') {
      if (tg && tg.close) { try { tg.close(); } catch (e) {} }
      fin(true);
      return;
    }
    if (a.id === 'toggle') { toggleById(a.elementId); fin(true); return; }
    if (a.id === 'favorite') {
      var fItemId = favItemId(a);
      if (!fItemId) { toast('Не указан элемент'); fin(false); return; }
      api('action', { kind: 'favorite', itemId: fItemId })
        .then(function (res) {
          var on = !!(res && res.favorite);
          var list = favList();
          var ix = list.indexOf(fItemId);
          if (on && ix < 0) list.push(fItemId);
          if (!on && ix >= 0) list.splice(ix, 1);
          setFavList(list);
          var target = node;
          if (node && node.closest) {
            var prod = node.closest('.prod');
            if (prod) target = prod;
          }
          paintFav(target, on);
          // перерисовать grid-карточки: их ♥ берётся из обновлённого ctx.vars.mini_favs
          for (var gi = 0; gi < pageData.length; gi++) {
            if (pageData[gi].type === 'grid') paintData(pageData[gi]);
          }
          toast(on ? 'Добавлено в избранное \u2665' : 'Убрано из избранного');
          fin(true);
        })
        .catch(function (e) { if (!e || e.message !== 'denied') toast('Ошибка'); fin(false); });
      return;
    }
    if (a.id === 'ai') {
      // действие ai на произвольном элементе (кнопка/карточка): если у элемента
      // есть props.gallery — результат добавится туда, иначе заменит props.src.
      aiGenerate(elDef);
      fin(true);
      return;
    }
    if (a.id === 'pay') {
      // фаза D: счёт в Telegram Stars. product с интерполяцией {user.name},
      // stars — целое из схемы. На время запроса кнопка в состоянии «оплата…».
      var product = interp(String(a.product == null ? '' : a.product));
      var stars = Math.max(1, Math.round(num(a.stars, 1)));
      var pb = node && node.tagName === 'BUTTON' ? node : (node && node.querySelector ? node.querySelector('button') : null);
      var pbLabel = pb ? pb.textContent : '';
      if (pb) { pb.textContent = 'оплата\u2026'; pb.disabled = true; }
      var pbRestore = function () { if (pb) { pb.textContent = pbLabel; pb.disabled = false; } };
      api('action', { kind: 'pay', product: product, stars: stars })
        .then(function () { pbRestore(); toast('Счёт отправлен в чат'); fin(true); })
        .catch(function (e) {
          pbRestore();
          if (!e || e.message !== 'denied') toast(e && e.text ? e.text : 'Ошибка оплаты');
          fin(false);
        });
      return;
    }
    if (a.id === 'data') {
      api('action', { kind: 'insert', table: String(a.table == null ? '' : a.table), values: buildValues(a, elDef) })
        .then(function () { flash(node, '\u2713'); fin(true); refreshTable(a.table); })
        .catch(function (e) { if (!e || e.message !== 'denied') flash(node, 'Ошибка'); fin(false); });
      return;
    }
    if (a.id === 'scenario') {
      var p = (elDef && elDef.props) || {};
      var cmd = String(p.command || a.target || '');
      api('action', { kind: 'scenario', command: cmd, payload: buildValues(a, elDef) })
        .then(function () { flash(node, '\u2713'); fin(true); })
        .catch(function (e) { if (!e || e.message !== 'denied') flash(node, 'Ошибка'); fin(false); });
      return;
    }
    fin(false);
  }

  /* ── data-элементы: загрузка и покраска ── */

  var DATA_TYPES = { grid: 1, chips: 1, stat: 1, table: 1, record_form: 1, user_list: 1 };

  function skelHtml(n) {
    var h = '<div class="skel-wrap">';
    for (var i = 0; i < n; i++) h += '<div class="skel"></div>';
    return h + '</div>';
  }
  function emptyHtml(t) { return '<div class="dempty">' + escapeHtml(t || 'Пока пусто') + '</div>'; }
  function errHtml() { return '<div class="dempty">Не удалось загрузить<button type="button" class="retry">Повторить</button></div>'; }
  function bindRetry(box, elDef) {
    var b = box.querySelector('.retry');
    if (b) b.addEventListener('click', function () { loadEl(elDef, true); });
  }

  function loadEl(elDef, force) {
    var st = dataStates[elDef.id];
    if (!force && st) { paintData(elDef); return; }
    dataStates[elDef.id] = { status: 'loading' };
    paintData(elDef);
    var p = elDef.props || {};
    var pr;
    if (elDef.type === 'user_list') pr = api('query', { kind: 'users' });
    else if (elDef.type === 'chips') pr = api('query', { kind: 'rows', table: String(p.table == null ? '' : p.table), limit: 200 });
    else pr = api('query', buildQuery(p.table, 500));
    pr.then(function (res) {
      var rows = (res && res.rows) || [];
      var out = { status: rows.length ? 'ok' : 'empty', rows: rows, total: res && res.total != null ? res.total : rows.length };
      if (elDef.type === 'stat') {
        out.status = 'ok'; // счётчик 0 — осмысленное значение
        if (p.mode === 'sum') {
          var sum = 0;
          for (var i = 0; i < rows.length; i++) {
            var raw = rows[i] && rows[i].data ? rows[i].data[p.column] : null;
            var n = parseFloat(String(raw == null ? '' : raw).replace(/[^\d.,-]/g, '').replace(',', '.'));
            if (isFinite(n)) sum += n;
          }
          out.sum = sum;
        }
      }
      dataStates[elDef.id] = out;
      paintData(elDef);
    }).catch(function (e) {
      if (!e || e.message !== 'denied') {
        dataStates[elDef.id] = { status: 'error' };
        paintData(elDef);
      }
    });
  }

  function paintData(elDef) {
    var node = elNodes[elDef.id];
    if (!node) return;
    var box = node.querySelector('.data');
    if (!box) return;
    var st = dataStates[elDef.id] || { status: 'loading' };
    if (elDef.type === 'grid') paintGrid(box, elDef, st);
    else if (elDef.type === 'chips') paintChips(box, elDef, st);
    else if (elDef.type === 'stat') paintStat(box, elDef, st);
    else if (elDef.type === 'table') paintTableEl(box, elDef, st);
    else if (elDef.type === 'user_list') paintUserList(box, elDef, st);
  }

  // Рефетч элементов, привязанных к таблице (после insert/update/delete,
  // изменения фильтров/поиска/сортировки). Чипы не трогаем: их список не фильтруется.
  function refreshTable(table, skipId) {
    var t = String(table == null ? '' : table);
    for (var i = 0; i < pageData.length; i++) {
      var elDef = pageData[i];
      if (elDef.id === skipId) continue;
      if (elDef.type === 'chips' || elDef.type === 'record_form') continue;
      if (String((elDef.props || {}).table || '') === t) loadEl(elDef, true);
    }
  }
  function refreshPage() {
    for (var i = 0; i < pageData.length; i++) {
      if (pageData[i].type !== 'record_form') loadEl(pageData[i], true);
    }
  }

  function cellImg(v, p) {
    var u = safeUrl(typeof v === 'string' ? v : (v && v.url) || '');
    if (u) return '<img class="img" alt="" src="' + escapeHtml(u) + '">';
    return '<span>' + escapeHtml((p && p.emoji) || '\uD83D\uDDBC') + '</span>';
  }

  function paintGrid(box, elDef, st) {
    var p = elDef.props || {};
    if (st.status === 'loading') { box.innerHTML = skelHtml(6); return; }
    if (st.status === 'error') { box.innerHTML = errHtml(); bindRetry(box, elDef); return; }
    var rows = st.rows || [];
    if (!rows.length) { box.innerHTML = emptyHtml(p.emptyText); return; }
    var favs = favList();
    var html = '<div class="grid">';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var data = r.data || {};
      var title = data[p.titleColumn] == null ? '' : String(data[p.titleColumn]);
      var onFav = r.id != null && favs.indexOf(String(r.id)) >= 0;
      html += '<div class="gcard' + (onFav ? ' fav' : '') + '" data-i="' + i + '">' +
        '<div class="gcard-img">' + cellImg(p.imageColumn ? data[p.imageColumn] : '', p) + '</div>' +
        '<div class="gcard-t">' + escapeHtml(title) + '</div>' +
        (p.priceColumn ? '<div class="gcard-p">' + escapeHtml(String(data[p.priceColumn] == null ? '' : data[p.priceColumn])) + '</div>' : '') +
        (onFav ? '<span class="fav-b">\u2665</span>' : '') +
        '</div>';
    }
    box.innerHTML = html + '</div>';
    var cards = box.querySelectorAll('.gcard');
    for (var j = 0; j < cards.length; j++) {
      (function (card) {
        card.addEventListener('click', function () {
          var row = rows[parseInt(card.getAttribute('data-i'), 10)];
          if (!row) return;
          currentRow = { id: row.id, data: row.data || {} };
          // favorite-действие на карточке: itemId = id строки; тап не открывает детальную страницу
          if (elDef.action && elDef.action.id === 'favorite') {
            runAction(elDef.action, elDef, card);
            return;
          }
          if (p.detailPageId && pages[p.detailPageId]) gotoPage(p.detailPageId);
          else if (elDef.action && elDef.action.id !== 'none') runAction(elDef.action, elDef, card);
        });
      })(cards[j]);
    }
  }

  function paintChips(box, elDef, st) {
    var p = elDef.props || {};
    if (st.status === 'loading') { box.innerHTML = '<div class="skel chips-skel"></div>'; return; }
    if (st.status === 'error') { box.innerHTML = errHtml(); bindRetry(box, elDef); return; }
    var col = String(p.column == null ? '' : p.column);
    var vals = [], seen = {};
    var rows = st.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i] && rows[i].data ? rows[i].data[col] : null;
      var sv = v == null ? '' : String(v).trim();
      if (sv && !seen[sv]) { seen[sv] = 1; vals.push(sv); }
    }
    var stt = tableState(p.table);
    if (!stt.chips[col]) stt.chips[col] = [];
    var sel = stt.chips[col];
    var html = '<div class="chips"><button type="button" class="chip' + (sel.length ? '' : ' on') + '" data-v="">Все</button>';
    for (var j = 0; j < vals.length; j++) {
      html += '<button type="button" class="chip' + (sel.indexOf(vals[j]) >= 0 ? ' on' : '') + '" data-v="' + escapeHtml(vals[j]) + '">' + escapeHtml(vals[j]) + '</button>';
    }
    box.innerHTML = html + '</div>';
    var btns = box.querySelectorAll('.chip');
    for (var k = 0; k < btns.length; k++) {
      (function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-v');
          var cur = stt.chips[col].slice();
          if (!v) cur = [];
          else {
            var ix = cur.indexOf(v);
            if (ix >= 0) cur.splice(ix, 1); else cur.push(v);
          }
          stt.chips[col] = cur;
          refreshTable(p.table, elDef.id);
          paintChips(box, elDef, st);
        });
      })(btns[k]);
    }
  }

  function paintStat(box, elDef, st) {
    var p = elDef.props || {};
    if (st.status === 'loading') { box.innerHTML = '<div class="skel stat-skel"></div>'; return; }
    if (st.status === 'error') { box.innerHTML = errHtml(); bindRetry(box, elDef); return; }
    var val = p.mode === 'sum' ? Math.round((st.sum || 0) * 100) / 100 : (st.total || 0);
    var lbl = String(p.label || p.title || (p.mode === 'sum' ? (p.column || 'Сумма') : 'Записей'));
    box.innerHTML = '<div class="stat"><div class="stat-v">' + escapeHtml(String(val)) + '</div>' +
      '<div class="stat-l">' + escapeHtml(interp(lbl)) + '</div></div>';
  }

  function paintTableEl(box, elDef, st) {
    var p = elDef.props || {};
    if (st.status === 'loading') { box.innerHTML = skelHtml(5); return; }
    if (st.status === 'error') { box.innerHTML = errHtml(); bindRetry(box, elDef); return; }
    var rows = st.rows || [];
    if (!rows.length) { box.innerHTML = emptyHtml(p.emptyText); return; }
    var cols = Array.isArray(p.columns) ? p.columns.map(String) : [];
    if (!cols.length) cols = Object.keys(rows[0].data || {});
    var html = '<table class="tbl"><thead><tr>';
    for (var c = 0; c < cols.length; c++) html += '<th>' + escapeHtml(cols[c]) + '</th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var data = (rows[i] && rows[i].data) || {};
      html += '<tr>';
      for (var c2 = 0; c2 < cols.length; c2++) html += '<td>' + escapeHtml(String(data[cols[c2]] == null ? '' : data[cols[c2]])) + '</td>';
      html += '</tr>';
    }
    box.innerHTML = html + '</tbody></table>';
  }

  function paintUserList(box, elDef, st) {
    var p = elDef.props || {};
    if (st.status === 'loading') { box.innerHTML = skelHtml(4); return; }
    if (st.status === 'error') { box.innerHTML = errHtml(); bindRetry(box, elDef); return; }
    var rows = st.rows || [];
    if (!rows.length) { box.innerHTML = emptyHtml(p.emptyText); return; }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var data = (rows[i] && rows[i].data) || {};
      var name = String(data.name == null ? '' : data.name) || 'Без имени';
      var tags = Array.isArray(data.tags) ? data.tags : [];
      var tagHtml = '';
      for (var t = 0; t < tags.length; t++) tagHtml += '<span class="tagb">' + escapeHtml(String(tags[t])) + '</span>';
      html += '<div class="uitem" data-i="' + i + '">' +
        '<div class="uava">' + escapeHtml(name.charAt(0).toUpperCase()) + '</div>' +
        '<div class="ucol"><div class="uname">' + escapeHtml(name) + '</div>' +
        '<div class="uid">' + escapeHtml(data.username ? '@' + data.username : '') + (data.username ? ' · ' : '') + 'ID ' + escapeHtml(String(rows[i].id == null ? '' : rows[i].id)) + '</div>' +
        (tagHtml ? '<div class="utags">' + tagHtml + '</div>' : '') +
        '</div></div>';
    }
    box.innerHTML = html;
    var items = box.querySelectorAll('.uitem');
    for (var j = 0; j < items.length; j++) {
      (function (it) {
        it.addEventListener('click', function () {
          var row = rows[parseInt(it.getAttribute('data-i'), 10)];
          if (!row) return;
          currentRow = { id: row.id, data: row.data || {} };
          if (elDef.action && elDef.action.id !== 'none') runAction(elDef.action, elDef, it);
        });
      })(items[j]);
    }
  }

  /* ── рендереры элементов ── */

  function dataShell(d) { d.innerHTML = '<div class="data"></div>'; }

  function textRenderer(d, elDef, big) {
    var s = elDef.style || {}, p = elDef.props || {};
    var align = s.align === 'center' || s.align === 'right' ? s.align : 'left';
    var jc = align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start');
    d.innerHTML = '<div class="tx" style="font-size:' + num(s.size, big ? 24 : 14) + 'px;font-weight:' + (big ? 700 : 400) +
      ';color:' + escapeHtml(cssColor(s.color, 'inherit')) + ';text-align:' + align + ';justify-content:' + jc + ';">' +
      escapeHtml(interp(p.text || (big ? 'Заголовок' : 'Текст'))) + '</div>';
  }

  function buttonRenderer(d, elDef) {
    var s = elDef.style || {}, p = elDef.props || {};
    d.innerHTML = '<button type="button" class="btn" style="background:' + escapeHtml(cssColor(s.bg, '#6d5efc')) +
      ';color:' + escapeHtml(cssColor(s.color, '#ffffff')) + ';border-radius:' + num(s.radius, 12) +
      'px;font-size:' + num(s.size, 15) + 'px;">' + escapeHtml(interp(p.text || p.label || 'Кнопка')) + '</button>';
  }

  function phHtml(emoji, grad, h) {
    return '<div class="ph" style="background:' + escapeHtml(cssGrad(grad, 'linear-gradient(135deg,#dbe2ef,#c3cfe2)')) +
      ';font-size:' + Math.min(num(h, 80) / 2.5, 56) + 'px;">' + escapeHtml(emoji || '\uD83D\uDDBC') + '</div>';
  }

  function imageRenderer(d, elDef) {
    var s = elDef.style || {}, p = elDef.props || {};
    var u = srcUrl(p.src);
    d.style.borderRadius = num(s.radius, 10) + 'px';
    d.style.overflow = 'hidden';
    if (u) {
      d.innerHTML = '<img class="img" alt="" src="' + escapeHtml(u) + '">';
      d.firstChild.onerror = function () { d.innerHTML = phHtml(p.emoji, s.grad || p.grad, elDef.h); };
    } else {
      d.innerHTML = phHtml(p.emoji, s.grad || p.grad, elDef.h);
    }
  }

  // type 'filebase'/'url' — готовый url; 'tg' — заглушка, реальный файл подтянет воркер.
  function srcUrl(src) {
    if (!src || typeof src !== 'object') return '';
    if (src.type === 'filebase' || src.type === 'url') return safeUrl(src.url);
    return '';
  }

  function cardRenderer(d, elDef) {
    var s = elDef.style || {};
    d.innerHTML = '<div class="card" style="background:' + escapeHtml(cssColor(s.bg, '#ffffff')) +
      ';border-radius:' + num(s.radius, 16) + 'px;' +
      (s.shadow ? 'box-shadow:0 8px 30px rgba(0,0,0,.12);' : 'border:1px solid #e5e7eb;') + '"></div>';
  }

  function inputRenderer(d, elDef) {
    var p = elDef.props || {};
    var ph = escapeHtml(interp(p.ph || p.placeholder || 'Введите…'));
    var html = p.multiline
      ? '<textarea class="inp" placeholder="' + ph + '"></textarea>'
      : '<input class="inp" type="text" placeholder="' + ph + '">';
    d.innerHTML = html;
    var node = d.firstChild;
    node.value = inputStore[elDef.id] || '';
    node.addEventListener('input', function () { inputStore[elDef.id] = node.value; });
  }

  function dividerRenderer(d, elDef) {
    var s = elDef.style || {};
    d.innerHTML = '<div style="width:100%;height:100%;background:' + escapeHtml(cssColor(s.bg, '#e5e7eb')) + ';border-radius:2px;"></div>';
  }

  function spacerRenderer(d) { d.innerHTML = ''; }

  function fieldsHtml(elDef, submitLabel, btnClass) {
    var p = elDef.props || {}, s = elDef.style || {};
    var fields = Array.isArray(p.fields) ? p.fields : [];
    var html = '';
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i] || {};
      var fid = String(f.id == null ? i : f.id);
      var key = elDef.id + '.' + fid;
      html += '<label class="frm-l">' + escapeHtml(String(f.label || fid)) + '</label>' +
        '<input class="inp frm-i" type="text" data-key="' + escapeHtml(key) + '" data-fid="' + escapeHtml(fid) +
        '" placeholder="' + escapeHtml(String(f.ph || f.label || '')) + '">';
    }
    html += '<button type="button" class="btn ' + btnClass + '" style="background:' + escapeHtml(cssColor(s.bg, '#6d5efc')) +
      ';color:' + escapeHtml(cssColor(s.color, '#ffffff')) + ';border-radius:' + num(s.radius, 12) + 'px;">' +
      escapeHtml(interp(submitLabel)) + '</button><div class="frm-s"></div>';
    return html;
  }

  function wireFields(d, elDef) {
    var inputs = d.querySelectorAll('.frm-i');
    for (var j = 0; j < inputs.length; j++) {
      (function (inp) {
        var key = inp.getAttribute('data-key'), fid = inp.getAttribute('data-fid');
        var saved = inputStore[key] != null ? inputStore[key] : inputStore[fid];
        inp.value = saved || '';
        inp.addEventListener('input', function () { inputStore[key] = inp.value; inputStore[fid] = inp.value; });
      })(inputs[j]);
    }
  }

  function collectFields(elDef) {
    var p = elDef.props || {};
    var fields = Array.isArray(p.fields) ? p.fields : [];
    var out = {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i] || {};
      var fid = String(f.id == null ? i : f.id);
      var v = inputStore[elDef.id + '.' + fid];
      out[fid] = v == null ? '' : v;
    }
    return out;
  }

  function formRenderer(d, elDef) {
    var p = elDef.props || {};
    var lbl = typeof p.submit === 'string' ? p.submit : ((p.submit && p.submit.label) || p.submitLabel || p.submitText || 'Отправить');
    d.innerHTML = '<div class="frm">' + fieldsHtml(elDef, lbl, 'frm-b') + '</div>';
    wireFields(d, elDef);
    var status = d.querySelector('.frm-s');
    var btn = d.querySelector('.frm-b');
    btn.addEventListener('click', function () {
      var act = (p.submit && typeof p.submit === 'object' && p.submit.id) ? p.submit : elDef.action;
      status.textContent = 'Отправляем…';
      runAction(act, elDef, btn, function (ok) { status.textContent = ok ? 'Отправлено \u2713' : 'Ошибка, попробуйте ещё раз'; });
    });
  }

  function supportRenderer(d, elDef) {
    var p = elDef.props || {};
    var lbl = typeof p.submit === 'string' ? p.submit : 'Отправить';
    d.innerHTML = '<div class="frm">' + fieldsHtml(elDef, lbl, 'frm-b') + '</div>';
    wireFields(d, elDef);
    var status = d.querySelector('.frm-s');
    var btn = d.querySelector('.frm-b');
    btn.addEventListener('click', function () {
      status.textContent = 'Отправляем…';
      function done(ok) { status.textContent = ok ? 'Отправлено \u2713' : 'Ошибка, попробуйте ещё раз'; }
      var a = elDef.action;
      if (a && (a.id === 'data' || a.id === 'scenario')) { runAction(a, elDef, btn, done); return; }
      api('action', { kind: 'support', fields: collectFields(elDef) })
        .then(function () { done(true); })
        .catch(function (e) { if (!e || e.message !== 'denied') done(false); });
    });
  }

  function productRenderer(d, elDef) {
    var s = elDef.style || {}, p = elDef.props || {};
    var u = srcUrl(p.src);
    var grad = cssGrad(s.grad || p.grad, 'linear-gradient(135deg,#dbe2ef,#c3cfe2)');
    var lbl = typeof p.button === 'string' ? p.button : ((p.button && p.button.label) || 'Купить');
    d.innerHTML = '<div class="prod" style="border-radius:' + num(s.radius, 16) + 'px;background:' + escapeHtml(cssColor(s.bg, '#ffffff')) +
      ';' + (s.shadow ? 'box-shadow:0 8px 30px rgba(0,0,0,.12);' : 'border:1px solid #e5e7eb;') + '">' +
      '<div class="prod-img" style="background:' + escapeHtml(grad) + ';">' +
      (u ? '<img class="img" alt="" src="' + escapeHtml(u) + '">' : '<span>' + escapeHtml(p.emoji || '\uD83D\uDDBC') + '</span>') + '</div>' +
      '<div class="prod-t">' + escapeHtml(interp(p.title || 'Товар')) + '</div>' +
      '<div class="prod-row"><span class="prod-p">' + escapeHtml(interp(String(p.price == null ? '' : p.price))) + '</span>' +
      '<button type="button" class="btn prod-b" style="background:' + escapeHtml(cssColor(p.accent, '#6d5efc')) + ';">' +
      escapeHtml(interp(lbl)) + '</button></div></div>';
    var im = d.querySelector('.prod-img img');
    if (im) im.onerror = function () { im.outerHTML = '<span>' + escapeHtml(p.emoji || '\uD83D\uDDBC') + '</span>'; };
    var btn2 = d.querySelector('.prod-b');
    btn2.addEventListener('click', function () {
      var act = (p.button && typeof p.button === 'object' && p.button.id) ? p.button : elDef.action;
      runAction(act, elDef, btn2);
    });
    if (elDef.action && elDef.action.id === 'favorite') {
      var fId = favItemId(elDef.action);
      if (fId && isFav(fId)) paintFav(d.querySelector('.prod'), true);
    }
  }

  function gridRenderer(d, elDef) { dataShell(d); loadEl(elDef, false); }
  function chipsRenderer(d, elDef) { dataShell(d); loadEl(elDef, false); }
  function statRenderer(d, elDef) { dataShell(d); loadEl(elDef, false); }
  function tableRenderer(d, elDef) { dataShell(d); loadEl(elDef, false); }
  function userListRenderer(d, elDef) { dataShell(d); loadEl(elDef, false); }

  function searchRenderer(d, elDef) {
    var p = elDef.props || {};
    var stt = tableState(p.table);
    if (Array.isArray(p.columns) && p.columns.length) stt.searchColumns = p.columns.map(String);
    d.innerHTML = '<input class="inp" type="text" placeholder="' + escapeHtml(interp(p.ph || 'Поиск…')) + '">';
    var inp = d.firstChild;
    inp.value = stt.term;
    var fire = debounce(function () { refreshTable(p.table, elDef.id); }, 300);
    inp.addEventListener('input', function () { stt.term = inp.value; fire(); });
  }

  function sortRenderer(d, elDef) {
    var p = elDef.props || {};
    var stt = tableState(p.table);
    var col = String(p.column == null ? '' : p.column);
    function label() {
      if (stt.sortColumn !== col) return '\u21C5 ' + col;
      return (stt.sortDir === 'asc' ? '\u2191 ' : '\u2193 ') + col;
    }
    d.innerHTML = '<button type="button" class="btn sbtn">' + escapeHtml(label()) + '</button>';
    d.firstChild.addEventListener('click', function () {
      if (stt.sortColumn !== col) { stt.sortColumn = col; stt.sortDir = 'asc'; }
      else if (stt.sortDir === 'asc') { stt.sortDir = 'desc'; }
      else { stt.sortColumn = null; stt.sortDir = 'asc'; }
      d.firstChild.innerHTML = escapeHtml(label());
      refreshTable(p.table, elDef.id);
    });
  }

  function recordFormRenderer(d, elDef) {
    var p = elDef.props || {};
    var state = rfStates[elDef.id] || (rfStates[elDef.id] = { q: '', rows: null, sel: null, msg: '' });
    d.innerHTML = '<div class="rf"></div>';
    var box = d.firstChild;

    function doSearch() {
      state.rows = 'loading';
      state.msg = '';
      paint();
      var body = { kind: 'rows', table: String(p.table == null ? '' : p.table), limit: 50 };
      if (state.q && p.searchColumn) body.search = { columns: [String(p.searchColumn)], term: state.q };
      api('query', body).then(function (res) {
        state.rows = (res && res.rows) || [];
        paint();
      }).catch(function (e) {
        if (!e || e.message !== 'denied') { state.rows = 'error'; paint(); }
      });
    }

    function paintList() {
      var html = '<div class="rf-search"><input class="inp rf-q" type="text" placeholder="' +
        escapeHtml(interp(p.ph || ('Поиск по «' + String(p.searchColumn || 'полю') + '»'))) +
        '"><button type="button" class="btn rf-go">Найти</button></div>';
      if (state.rows === 'loading') html += skelHtml(3);
      else if (state.rows === 'error') html += errHtml();
      else if (state.rows === null) html += '<div class="dempty">Введите запрос и нажмите «Найти»</div>';
      else if (!state.rows.length) html += emptyHtml(p.emptyText);
      else {
        html += '<div class="rf-list">';
        for (var i = 0; i < state.rows.length; i++) {
          var dd = (state.rows[i] && state.rows[i].data) || {};
          var t = dd[p.searchColumn] != null ? String(dd[p.searchColumn]) : ('#' + state.rows[i].id);
          html += '<button type="button" class="rf-item" data-i="' + i + '">' + escapeHtml(t) + '</button>';
        }
        html += '</div>';
      }
      if (state.msg) html += '<div class="rf-msg">' + escapeHtml(state.msg) + '</div>';
      box.innerHTML = html;
      var qi = box.querySelector('.rf-q');
      if (qi) {
        qi.value = state.q;
        qi.addEventListener('input', function () { state.q = qi.value; });
      }
      var go = box.querySelector('.rf-go');
      if (go) go.addEventListener('click', doSearch);
      var rt = box.querySelector('.retry');
      if (rt) rt.addEventListener('click', doSearch);
      var items = box.querySelectorAll('.rf-item');
      for (var j = 0; j < items.length; j++) {
        (function (it) {
          it.addEventListener('click', function () {
            state.sel = state.rows[parseInt(it.getAttribute('data-i'), 10)] || null;
            state.msg = '';
            paint();
          });
        })(items[j]);
      }
    }

    function paintEdit() {
      var cols = Array.isArray(p.editColumns) ? p.editColumns.map(String) : [];
      var dd = (state.sel && state.sel.data) || {};
      var html = '<div class="rf-edit">';
      for (var i = 0; i < cols.length; i++) {
        var v = dd[cols[i]] == null ? '' : String(dd[cols[i]]);
        html += '<label class="frm-l">' + escapeHtml(cols[i]) + '</label>' +
          '<input class="inp rf-col" type="text" data-col="' + escapeHtml(cols[i]) + '" value="' + escapeHtml(v) + '">';
      }
      html += '<div class="rf-row"><button type="button" class="btn rf-save">Сохранить</button>' +
        '<button type="button" class="btn rf-del">Удалить</button></div>' +
        '<button type="button" class="btn rf-cancel">К списку</button>' +
        '<div class="rf-msg">' + escapeHtml(state.msg) + '</div></div>';
      box.innerHTML = html;
      box.querySelector('.rf-save').addEventListener('click', function () {
        var values = {};
        var inps = box.querySelectorAll('.rf-col');
        for (var k = 0; k < inps.length; k++) values[inps[k].getAttribute('data-col')] = inps[k].value;
        state.msg = 'Сохраняем…';
        paint();
        api('action', { kind: 'update', table: String(p.table == null ? '' : p.table), itemId: state.sel.id, values: values })
          .then(function () {
            for (var c in values) if (hasOwn(values, c)) state.sel.data[c] = values[c];
            state.msg = 'Сохранено \u2713';
            paint();
            refreshTable(p.table);
          })
          .catch(function (e) { state.msg = (!e || e.message !== 'denied') ? 'Ошибка' : ''; paint(); });
      });
      box.querySelector('.rf-del').addEventListener('click', function () {
        state.msg = 'Удаляем…';
        paint();
        api('action', { kind: 'delete', table: String(p.table == null ? '' : p.table), itemId: state.sel.id })
          .then(function () {
            state.sel = null;
            state.rows = null;
            state.msg = 'Удалено';
            paint();
            refreshTable(p.table);
          })
          .catch(function (e) { state.msg = (!e || e.message !== 'denied') ? 'Ошибка' : ''; paint(); });
      });
      box.querySelector('.rf-cancel').addEventListener('click', function () {
        state.sel = null;
        state.msg = '';
        paint();
      });
    }

    function paint() { if (state.sel) paintEdit(); else paintList(); }
    paint();
  }

  function userInfoRenderer(d) {
    var tags = ctx.tags || [];
    var tagHtml = '';
    for (var i = 0; i < tags.length; i++) tagHtml += '<span class="tagb">' + escapeHtml(String(tags[i])) + '</span>';
    var name = String(ctx.name || 'Без имени');
    var html = '<div class="uinfo"><div class="uava">' + escapeHtml(name.charAt(0).toUpperCase()) + '</div>' +
      '<div class="ucol"><div class="uname">' + escapeHtml(name) + '</div>' +
      '<div class="uid">ID ' + escapeHtml(String(ctx.userId == null ? '\u2014' : ctx.userId));
    if (ctx.username) html += ' \u00B7 @' + escapeHtml(String(ctx.username));
    html += '</div>';
    if (tagHtml) html += '<div class="utags">' + tagHtml + '</div>';
    html += '</div></div>';
    d.innerHTML = html;
  }

  function refreshRenderer(d, elDef) {
    var p = elDef.props || {};
    d.innerHTML = '<button type="button" class="btn sbtn">' + escapeHtml(interp(p.text || '\u21BB Обновить')) + '</button>';
    d.firstChild.addEventListener('click', function () { refreshPage(); });
  }

  /* ── ai-генерация: запрос, скелетон, галерея, лайтбокс ── */

  var aiBusy = {}; // elementId -> 1, пока идёт генерация (повторный клик игнорим)

  // Перерисовать элемент на месте (после генерации/ошибки вернуть исходный вид).
  function rerenderEl(elDef) {
    var old = elNodes[elDef.id];
    if (!old || !old.parentNode) return;
    var fresh = renderEl(elDef);
    old.parentNode.replaceChild(fresh, old);
  }

  function lightbox(url) {
    var u = safeUrl(url);
    if (!u) return;
    var ov = document.createElement('div');
    ov.className = 'lb';
    ov.innerHTML = '<img class="lb-img" alt="" src="' + escapeHtml(u) + '">' +
      '<button type="button" class="lb-x" aria-label="Закрыть">\u2715</button>';
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
    ov.querySelector('.lb-x').addEventListener('click', close);
    document.body.appendChild(ov);
  }

  // Сетка галереи 2 колонки: элементы — MediaSrc {type,url} или plain-строки url.
  function galleryHtml(gallery) {
    if (!Array.isArray(gallery) || !gallery.length) return '';
    var html = '<div class="gall">';
    for (var i = 0; i < gallery.length; i++) {
      var g = gallery[i];
      var u = typeof g === 'string' ? safeUrl(g) : srcUrl(g);
      if (!u) continue;
      html += '<img data-u="' + escapeHtml(u) + '" alt="" src="' + escapeHtml(u) + '">';
    }
    return html + '</div>';
  }
  function wireGallery(d) {
    var imgs = d.querySelectorAll('.gall img');
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        img.addEventListener('click', function () { lightbox(img.getAttribute('data-u')); });
      })(imgs[i]);
    }
  }

  // Действие ai: prompt из action.prompt (или props.prompt), интерполяция {user.name}.
  // Ответ { ok, url } → в props.gallery (если массив) либо замена props.src локально
  // (в схему НЕ пишем). 429/502/503 — тост с текстом { error } и исходный вид.
  function aiGenerate(elDef, act) {
    if (!elDef || aiBusy[elDef.id]) return;
    var a = act || elDef.action || {};
    var p = elDef.props || {};
    var rawPrompt = p.prompt != null && String(p.prompt) !== '' ? p.prompt : a.prompt;
    var prompt = interp(String(rawPrompt == null ? '' : rawPrompt));
    if (!prompt) { toast('Не задан промпт генерации'); return; }
    aiBusy[elDef.id] = 1;
    var node = elNodes[elDef.id];
    if (node) node.innerHTML = '<div class="ai-busy">' + skelHtml(2) + '</div>';
    api('action', { kind: 'ai', prompt: prompt })
      .then(function (res) {
        delete aiBusy[elDef.id];
        var u = res && res.url != null ? safeUrl(res.url) : '';
        if (!u) { toast('Пустой ответ генерации'); rerenderEl(elDef); return; }
        if (Array.isArray(p.gallery)) p.gallery.push({ type: 'filebase', url: u });
        else p.src = { type: 'filebase', url: u };
        rerenderEl(elDef);
        toast('Готово \u2728');
      })
      .catch(function (e) {
        delete aiBusy[elDef.id];
        rerenderEl(elDef);
        if (!e || e.message !== 'denied') toast(e && e.text ? e.text : 'Ошибка генерации');
      });
  }

  function aiGenRenderer(d, elDef) {
    var p = elDef.props || {};
    var a = elDef.action;
    var can = !!(a && a.id === 'ai') || (p.prompt != null && String(p.prompt) !== '');
    var u0 = srcUrl(p.src);
    var html = '<div class="aigen"><div class="aigen-ph">\uD83C\uDFA8</div>' +
      '<div class="aigen-t">' + escapeHtml(interp(p.placeholder || 'Картинка по промпту')) + '</div>' +
      (u0 ? '<img class="aigen-img" alt="" src="' + escapeHtml(u0) + '">' : '') +
      '<button type="button" class="btn aigen-b"' + (can ? '' : ' disabled') + '>' +
      escapeHtml(interp(p.text || 'Сгенерировать')) + '</button>' + galleryHtml(p.gallery) + '</div>';
    d.innerHTML = html;
    wireGallery(d);
    var btn = d.querySelector('.aigen-b');
    if (btn && can) {
      btn.addEventListener('click', function () {
        aiGenerate(elDef, a && a.id === 'ai' ? a : { id: 'ai', prompt: String(p.prompt || '') });
      });
    }
  }

  /* ── фаза D: richtext / carousel / video ── */

  // Обёртка-маркер для единственного innerHTML с данными схемы. props.html уже
  // санитизирован сервером на публикации (sanitizeRichText, shared/mini-sanitize.ts);
  // рантайм доверяет схеме. Имя функции — в whitelist теста miniapp-spa.test.ts.
  function richTextHtml(html) {
    return String(html == null ? '' : html);
  }

  // ЕДИНСТВЕННОЕ место, где innerHTML получает данные из схемы: props.html уже
  // санитизирован сервером на публикации. Помеченный маркером комментарий стоит
  // ровно на присваивании ниже (тест считает его вхождения).
  function richTextRenderer(d, elDef) {
    var p = elDef.props || {};
    var box = document.createElement('div');
    box.className = 'rtx';
    box.innerHTML = richTextHtml(p.html); // RICHTEXT-SANITIZED-BY-SERVER
    d.appendChild(box);
  }

  // Горизонтальная лента: overflow-x + scroll-snap; тап по картинке — лайтбокс
  // (тот же lightbox(), что у галереи ai_gen). items: [{ src: MediaSrc, caption? }].
  function carouselRenderer(d, elDef) {
    var p = elDef.props || {};
    var items = Array.isArray(p.items) ? p.items : [];
    var html = '<div class="crl">';
    var shown = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var u = srcUrl(it.src);
      if (!u) continue;
      shown++;
      html += '<div class="crl-i"><img alt="" src="' + escapeHtml(u) + '" data-u="' + escapeHtml(u) + '">' +
        '<div class="crl-c">' + escapeHtml(interp(String(it.caption == null ? '' : it.caption))) + '</div></div>';
    }
    html += '</div>';
    if (!shown) { d.innerHTML = phHtml('\uD83D\uDDBC', '', elDef.h); return; }
    d.innerHTML = html;
    var imgs = d.querySelectorAll('.crl img');
    for (var j = 0; j < imgs.length; j++) {
      (function (img) {
        img.addEventListener('click', function () { lightbox(img.getAttribute('data-u')); });
      })(imgs[j]);
    }
  }

  // ID ролика из ссылок youtube.com/watch?v=, /embed/, /shorts/ и youtu.be/.
  function ytId(u) {
    var m = /^(?:https?:)?\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i.exec(String(u == null ? '' : u));
    return m ? m[1] : '';
  }

  // YouTube → iframe https://www.youtube.com/embed/<id> (единственный разрешённый
  // iframe-домен рантайма); прочие http(s)-ссылки → нативный <video controls>.
  // F-042: инспектор пишет props.url (строка), сохранённые схемы могут содержать
  // props.src (MediaSrc) — читаем оба: строку через safeUrl, объект через srcUrl.
  function videoRenderer(d, elDef) {
    var p = elDef.props || {};
    var u = typeof p.url === 'string' ? safeUrl(p.url) : srcUrl(p.url);
    if (!u) u = srcUrl(p.src);
    if (!u) { d.innerHTML = phHtml('\uD83C\uDFA5', '', elDef.h); return; }
    var id = (u.indexOf('youtube.com') >= 0 || u.indexOf('youtu.be') >= 0) ? ytId(u) : '';
    if (id) {
      var ifr = document.createElement('iframe');
      ifr.className = 'vid';
      ifr.src = 'https://www.youtube.com/embed/' + encodeURIComponent(id);
      ifr.setAttribute('allowfullscreen', '');
      ifr.setAttribute('loading', 'lazy');
      ifr.setAttribute('referrer', 'strict-origin-when-cross-origin');
      d.appendChild(ifr);
      return;
    }
    d.innerHTML = '<video class="vid" controls playsinline preload="metadata" src="' + escapeHtml(u) + '"></video>';
  }

  function unknownRenderer(d, elDef) {
    d.innerHTML = '<div class="unk">' + escapeHtml(String(elDef.type)) + '</div>';
  }

  var RENDERERS = {
    text: function (d, elDef) { textRenderer(d, elDef, false); },
    heading: function (d, elDef) { textRenderer(d, elDef, true); },
    button: buttonRenderer,
    image: imageRenderer,
    card: cardRenderer,
    input: inputRenderer,
    divider: dividerRenderer,
    spacer: spacerRenderer,
    form: formRenderer,
    product: productRenderer,
    grid: gridRenderer,
    chips: chipsRenderer,
    search: searchRenderer,
    sort: sortRenderer,
    stat: statRenderer,
    table: tableRenderer,
    record_form: recordFormRenderer,
    user_list: userListRenderer,
    user_info: userInfoRenderer,
    support: supportRenderer,
    refresh: refreshRenderer,
    ai_gen: aiGenRenderer,
    richtext: richTextRenderer,
    carousel: carouselRenderer,
    video: videoRenderer
  };

  // Элементы, у которых клик по всей площади запускает действие.
  var WHOLE_CLICK = { button: 1, image: 1, card: 1, text: 1, heading: 1 };

  function renderEl(elDef) {
    var d = document.createElement('div');
    d.className = 'el el-' + cssScopeId(elDef.id);
    d.setAttribute('data-id', elDef.id);
    d.style.left = num(elDef.x, 0) + 'px';
    d.style.top = num(elDef.y, 0) + 'px';
    d.style.width = num(elDef.w, 100) + 'px';
    d.style.height = num(elDef.h, 40) + 'px';
    elNodes[elDef.id] = d;
    // пользовательский CSS элемента (фаза D): скоуп .el-<id>, вставка один раз
    var elCss = elDef.style && elDef.style.css ? String(elDef.style.css) : '';
    if (elCss) insertScopedCss('el-' + cssScopeId(elDef.id), '.el-' + cssScopeId(elDef.id), elCss);
    var fn = RENDERERS[elDef.type];
    if (fn) fn(d, elDef); else unknownRenderer(d, elDef);
    if (elDef.action && elDef.action.id === 'favorite' && WHOLE_CLICK[elDef.type]) {
      var fId0 = favItemId(elDef.action);
      if (fId0 && isFav(fId0)) paintFav(d, true);
    }
    var a = elDef.action;
    if (a && a.id !== 'none' && WHOLE_CLICK[elDef.type]) {
      d.style.cursor = 'pointer';
      d.addEventListener('click', function () { runAction(a, elDef, d); });
    }
    return d;
  }

  /* ── навигация и рендер страницы ── */

  function gotoPage(pageId) {
    if (!pages[pageId]) return;
    if (tabRoots[pageId]) { activeTab = pageId; stack = []; }
    else stack.push(pageId);
    render();
  }
  function back() {
    if (stack.length) { stack.pop(); render(); }
  }
  function syncBack() {
    if (!tg || !tg.BackButton) return;
    try {
      if (stack.length) tg.BackButton.show(); else tg.BackButton.hide();
    } catch (e) {}
  }
  if (tg && tg.BackButton) {
    try { tg.BackButton.onClick(function () { back(); }); } catch (e) {}
  }

  function renderDock() {
    var d = document.createElement('div');
    d.className = 'dock';
    var tabs = tabbar.tabs || [];
    for (var i = 0; i < tabs.length; i++) {
      (function (t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'dock-tab' + (t.pageId === activeTab ? ' on' : '');
        b.innerHTML = '<span class="dock-ico">' + escapeHtml(t.icon || '\u2022') + '</span>' +
          '<span class="dock-lbl">' + escapeHtml(t.label || '') + '</span>';
        b.addEventListener('click', function () {
          activeTab = t.pageId;
          stack = [];
          render();
        });
        d.appendChild(b);
      })(tabs[i]);
    }
    return d;
  }

  function layout() {
    if (!canvas || !viewport) return;
    var k = window.innerWidth / 390;
    if (!(k > 0)) k = 1;
    canvas.style.transform = 'scale(' + k + ')';
    var dockH = dock ? dock.offsetHeight : 0;
    viewport.style.height = Math.ceil(curH * k + dockH) + 'px';
  }

  function render() {
    var page = currentPage();
    if (!page) { showFatal('В приложении нет страниц'); return; }
    elNodes = {};
    pageData = [];
    clearScopedCss();
    root.innerHTML = '';
    viewport = document.createElement('div');
    viewport.id = 'viewport';
    canvas = document.createElement('div');
    canvas.id = 'canvas';
    // пользовательский CSS страницы (фаза D): скоуп .page-<pageId>, ОДИН раз
    canvas.className = 'page-' + cssScopeId(page.id);
    if (page.css) insertScopedCss('page-' + cssScopeId(page.id), '.page-' + cssScopeId(page.id), page.css);
    var bgc = cssColor(page.bg, '');
    if (bgc) canvas.style.background = bgc;
    else {
      var bgg = cssGrad(page.bg, '');
      if (bgg) canvas.style.background = bgg;
    }
    viewport.appendChild(canvas);
    root.appendChild(viewport);
    dock = null;
    if (tabbar) { dock = renderDock(); root.appendChild(dock); }
    var els = Array.isArray(page.els) ? page.els : [];
    var maxY = 0;
    for (var i = 0; i < els.length; i++) {
      var elDef = els[i];
      if (!elDef || !elDef.id) continue;
      maxY = Math.max(maxY, num(elDef.y, 0) + num(elDef.h, 0));
      if (!visible(elDef)) continue;
      canvas.appendChild(renderEl(elDef));
      if (DATA_TYPES[elDef.type]) pageData.push(elDef);
    }
    curH = Math.max(844, maxY);
    canvas.style.height = curH + 'px';
    layout();
    syncBack();
  }

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 100); });

  // F-035: схема и ctx приходят с сервера через boot (initData проверяется
  // там; в HTML их нет). До ответа — состояние загрузки, при 401/403 —
  // denied-экран (api() уже умеет), при прочей ошибке — fatal.
  function startApp(b) {
    app = b.app;
    if (b.ctx) ctx = b.ctx;
    if (!app || !Array.isArray(app.pages) || !app.pages.length) {
      showFatal('Не удалось запустить мини-апп: нет схемы');
      return;
    }
    for (var pi = 0; pi < app.pages.length; pi++) pages[app.pages[pi].id] = app.pages[pi];
    tabbar = app.tabbar && app.tabbar.enabled ? app.tabbar : null;
    if (tabbar) {
      for (var ti = 0; ti < (tabbar.tabs || []).length; ti++) tabRoots[tabbar.tabs[ti].pageId] = tabbar.tabs[ti];
    }
    startId = app.startPageId;
    if (b.startParam && pages[b.startParam]) startId = b.startParam;
    if (!pages[startId]) startId = app.pages[0].id;
    activeTab = tabRoots[startId] ? startId : (tabbar ? tabbar.tabs[0].pageId : startId);
    stack = startId !== activeTab ? [startId] : [];
    render();
  }

  root.innerHTML = '<div class="fatal">Загрузка…</div>';
  api('boot', {}).then(startApp).catch(function (e) {
    if (e && e.message === 'denied') return; // denied-экран уже показан
    if (!deniedShown) showFatal('Не удалось запустить мини-апп: ' + (e && e.text ? e.text : 'сервис недоступен'));
  });
})();
</script>
</body>
</html>
`;
