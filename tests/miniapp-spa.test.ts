// Тесты SPA-рантайма мини-аппов: целостность HTML-строки, синтаксис встроенного
// скрипта, статические гарантии против XSS-паттернов и unit-тест чистой логики
// visible_when (evalVisibleMini) на всех операторах ConditionOp.
import { describe, it, expect } from 'vitest';
import { SPA_HTML, evalVisibleMini, evalMiniOp, miniCondLeft } from '../worker/src/miniapp/spa';
import type { MiniContext, MiniVisibleWhen } from '../shared/miniapp';
import type { ConditionOp } from '../shared/types';

// Единственный инлайн-скрипт рантайма внутри SPA_HTML (SDK подключается внешним
// скриптом с src, бут-JSON вставляет воркер — их тут нет).
function runtimeScript(): string {
  const m = SPA_HTML.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('в SPA_HTML нет инлайн-скрипта рантайма');
  return m[1];
}

const CTX: MiniContext = {
  userId: 42,
  name: 'Илья',
  username: 'ilya_dev',
  tags: ['vip', 'tester'],
  vars: { city: 'Москва', balance: '100', note: '' },
};

function cond(left: string, op: ConditionOp, right: string): MiniVisibleWhen {
  return { left, op, right };
}

describe('SPA_HTML: документ', () => {
  it('это строка, начинающаяся с <!doctype html>', () => {
    expect(typeof SPA_HTML).toBe('string');
    expect(SPA_HTML.startsWith('<!doctype html>')).toBe(true);
  });

  it('подключает Telegram WebApp SDK', () => {
    expect(SPA_HTML).toContain('https://telegram.org/js/telegram-web-app.js');
  });

  it('читает бут-данные из #mini-boot', () => {
    expect(SPA_HTML).toContain('mini-boot');
    expect(SPA_HTML).toContain('getElementById(\'mini-boot\')');
  });

  it('ходит в /m/api с заголовком X-Telegram-Init-Data', () => {
    expect(SPA_HTML).toContain('/m/api/');
    expect(SPA_HTML).toContain('X-Telegram-Init-Data');
  });

  it('не использует eval', () => {
    expect(SPA_HTML).not.toContain('eval(');
  });
});

describe('SPA_HTML: синтаксис рантайма', () => {
  it('скрипт компилируется new Function без выполнения', () => {
    const code = runtimeScript();
    expect(() => new Function(code)).not.toThrow();
  });
});

describe('SPA_HTML: статические гарантии экранирования', () => {
  const code = runtimeScript();

  it('определена функция escapeHtml', () => {
    expect(code).toContain('function escapeHtml');
  });

  it('рантайм не содержит template-интерполяции (обратные кавычки)', () => {
    expect(code).not.toContain('`');
  });

  it('рантайм не содержит ${ — схема не вставляется в строки напрямую', () => {
    expect(code).not.toContain('${');
    expect(code.split('${').length - 1).toBe(0);
  });

  it('все вставки в innerHTML идут через escapeHtml или безопасные обёртки', () => {
    // Статически, на уровне каждого присваивания .innerHTML:
    // 1) правая часть не содержит «сырых» обращений к данным (.data[, ctx.,
    //    .rows, row., .username, initData) — данные попадают в разметку только
    //    через escapeHtml(...) или накопители, которые строятся из escapeHtml;
    // 2) правая часть — либо чистый строковый литерал, либо содержит вызов
    //    escapeHtml/skelHtml/emptyHtml/errHtml/fieldsHtml/phHtml, либо является
    //    одним из накопителей (html, tagHtml, ph, old), собранным из escapeHtml.
    const SAFE_CALLS = ['escapeHtml(', 'skelHtml(', 'emptyHtml(', 'errHtml(', 'fieldsHtml(', 'phHtml(', 'richTextHtml('];
    const SAFE_VARS = ['html', 'tagHtml', 'ph', 'old'];
    const RAW_SMELLS = ['.data[', 'ctx.', '.rows', 'row.', '.username', 'initData'];
    // Помеченное richtext-место (фаза D): единственное innerHTML, куда попадает
    // HTML из схемы — текст уже санитизирован сервером (sanitizeRichText),
    // строка помечена комментарием RICHTEXT-SANITIZED-BY-SERVER (отдельный тест).
    const MARKED_RICHTEXT = /^String\(p\.html == null \? '' : p\.html\)$/;
    // Сканер: ; встречаются внутри строк стилей, поэтому правую часть берём
    // посимвольно, пропуская строковые литералы.
    function innerHtmlAssignments(src: string): string[] {
      const out: string[] = [];
      let from = 0;
      for (;;) {
        const at = src.indexOf('.innerHTML', from);
        if (at < 0) break;
        const eq = src.indexOf('=', at + 10);
        from = at + 10;
        if (eq < 0) break;
        let i = eq + 1;
        let quote = '';
        const start = i;
        for (; i < src.length; i++) {
          const ch = src[i];
          if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = '';
          } else if (ch === "'" || ch === '"') quote = ch;
          else if (ch === ';') break;
        }
        out.push(src.slice(start, i));
        from = i;
      }
      return out;
    }
    const assigns = innerHtmlAssignments(code);
    expect(assigns.length).toBeGreaterThan(0);
    for (const raw of assigns) {
      const rhs = raw.trim();
      if (MARKED_RICHTEXT.test(rhs)) continue;
      for (const bad of RAW_SMELLS) {
        expect(rhs.includes(bad), 'innerHTML с сырыми данными (' + bad + '): ' + rhs.slice(0, 80)).toBe(false);
      }
      const literalOnly = /^'[^']*'$/.test(rhs) || /^"[^"]*"$/.test(rhs);
      const hasSafeCall = SAFE_CALLS.some((c) => rhs.includes(c));
      const isSafeVar = SAFE_VARS.some((v) => new RegExp('^' + v + '(\\s*\\+[\\s\\S]*)?$').test(rhs));
      expect(literalOnly || hasSafeCall || isSafeVar, 'innerHTML без escapeHtml: ' + rhs.slice(0, 80)).toBe(true);
    }
  });

  it('нет document.write и eval-подобных конструкций', () => {
    expect(code).not.toContain('document.write');
    expect(code).not.toMatch(/\beval\b/);
    expect(code).not.toContain('new Function');
  });
});

describe('SPA_HTML: фаза C — действия favorite и ai', () => {
  const code = runtimeScript();

  it('шлёт действие favorite: kind: \'favorite\' с itemId', () => {
    expect(code).toContain("kind: 'favorite'");
    expect(code).toMatch(/kind:\s*'favorite',\s*itemId:/);
  });

  it('шлёт действие ai: kind: \'ai\' с prompt (интерполяция через interp)', () => {
    expect(code).toContain("kind: 'ai'");
    expect(code).toMatch(/kind:\s*'ai',\s*prompt:/);
    expect(code).toMatch(/var prompt = interp\(/);
  });

  it('ответ favorite → класс fav и бейдж .fav-b', () => {
    expect(code).toContain("node.classList.add('fav')");
    expect(code).toContain("b.className = 'fav-b'");
  });

  it('бейдж избранного присутствует в CSS с цветом #e11d48', () => {
    expect(SPA_HTML).toContain('.fav-b{');
    expect(SPA_HTML).toContain('#e11d48');
  });

  it('состояние избранного при рендере читается из ctx.vars.mini_favs', () => {
    expect(code).toContain('mini_favs');
    expect(code).toMatch(/\(ctx\.vars \|\| \{\}\)\.mini_favs/);
    // grid-карточка с id из списка рисуется с ♥ сразу
    expect(code).toMatch(/class="gcard' \+ \(onFav \? ' fav' : ''\)/);
    expect(code).toContain('<span class="fav-b">\\u2665</span>');
  });

  it('ответ ai { ok, url } → gallery (props.gallery) или замена props.src на filebase', () => {
    expect(code).toContain('Array.isArray(p.gallery)');
    expect(code).toMatch(/p\.gallery\.push\(\{ type: 'filebase', url: u \}\)/);
    expect(code).toMatch(/p\.src = \{ type: 'filebase', url: u \}/);
  });

  it('ошибки ai 429/502/503 → тост с текстом из { error } и возврат элемента', () => {
    expect(code).toMatch(/res\.status === 429 \|\| res\.status === 502 \|\| res\.status === 503/);
    expect(code).toContain('err.text');
    expect(code).toContain('function toast(');
    expect(code).toContain('rerenderEl(elDef)');
  });

  it('галерея ai_gen: сетка 2 колонки + лайтбокс с крестиком', () => {
    expect(SPA_HTML).toContain('.gall{display:grid;grid-template-columns:1fr 1fr');
    expect(SPA_HTML).toContain('.lb{position:fixed');
    expect(SPA_HTML).toContain('.lb-x{');
    expect(code).toContain('function lightbox(');
    expect(code).toContain('function galleryHtml(');
  });

  it('startParam читается из ответа boot-запроса (не query-строка) — F-035', () => {
    // Бут переехал: схема/ctx/startParam приходят с сервера через api('boot').
    expect(code).toContain("api('boot', {}).then(startApp)");
    expect(code).toMatch(/if \(b\.startParam && pages\[b\.startParam\]\) startId = b\.startParam;/);
  });

  it('прежние гарантии фазы C не сломаны: нет обратных кавычек и ${ в рантайме', () => {
    expect(code).not.toContain('`');
    expect(code).not.toContain('${');
  });
});

describe('SPA_HTML: фаза D — richtext, carousel, video, CSS, pay', () => {
  const code = runtimeScript();

  it('richtext: единственный помеченный innerHTML из схемы (p.html, санитизирован сервером)', () => {
    expect(code).toContain('function richTextRenderer');
    expect(code).toContain('richtext: richTextRenderer');
    // ровно одно присваивание innerHTML с данными из схемы — помеченное маркером
    expect(code.split('box.innerHTML = richTextHtml(p.html); // RICHTEXT-SANITIZED-BY-SERVER').length - 1).toBe(1);
    // данные проходят через обёртку richTextHtml (в whitelist SAFE_CALLS сканера)
    expect(code.split('function richTextHtml(').length - 1).toBe(1);
    expect(code.split('return String(html == null ?').length - 1).toBe(1);
  });

  it('carousel: лента overflow-x + scroll-snap, тап — лайтбокс галереи ai_gen', () => {
    expect(code).toContain('function carouselRenderer');
    expect(code).toContain('carousel: carouselRenderer');
    expect(SPA_HTML).toContain('.crl{width:100%;height:100%;display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory');
    expect(code).toMatch(/img\.addEventListener\('click', function \(\) \{ lightbox\(img\.getAttribute\('data-u'\)\); \}\)/);
  });

  it('video: youtube.com/youtu.be → iframe youtube.com/embed (единственный iframe-домен), иначе <video controls>', () => {
    expect(code).toContain('function videoRenderer');
    expect(code).toContain('video: videoRenderer');
    expect(code).toContain('https://www.youtube.com/embed/');
    expect(code).toMatch(/u\.indexOf\('youtube\.com'\) >= 0 \|\| u\.indexOf\('youtu\.be'\) >= 0/);
    expect(code).toContain('<video class="vid" controls playsinline');
    // iframe создаётся ровно один раз и его src — только youtube embed
    expect(code.split("createElement('iframe')").length - 1).toBe(1);
    expect(code.split("ifr.src = 'https://www.youtube.com/embed/'").length - 1).toBe(1);
  });

  it('F-042: video читает props.url (строка инспектора) с фолбэком на props.src (старые схемы)', () => {
    // props.url проходит через safeUrl (javascript:/data: — мимо), объект — через srcUrl
    expect(code).toMatch(/typeof p\.url === 'string' \? safeUrl\(p\.url\) : srcUrl\(p\.url\)/);
    expect(code).toContain('if (!u) u = srcUrl(p.src);');
  });

  it('style.css → скоуп .el-<id>: класс el- на узле элемента', () => {
    expect(code).toContain("d.className = 'el el-' + cssScopeId(elDef.id)");
    expect(code).toMatch(/insertScopedCss\('el-' \+ cssScopeId\(elDef\.id\), '\.el-' \+ cssScopeId\(elDef\.id\), elCss\)/);
  });

  it('page.css → скоуп .page-<pageId>, вставка ОДИН раз (маркер cssInserted)', () => {
    expect(code).toContain("canvas.className = 'page-' + cssScopeId(page.id)");
    expect(code).toMatch(/if \(page\.css\) insertScopedCss\('page-' \+ cssScopeId\(page\.id\), '\.page-' \+ cssScopeId\(page\.id\), page\.css\)/);
    expect(code).toContain('if (cssInserted[marker]) return;');
    // стили вставляются в render один раз на страницу, а не на каждый элемент
    expect(code.split('if (page.css) insertScopedCss').length - 1).toBe(1);
  });

  it('фильтр css: expression/javascript встречаются только в фильтре-запрете safeCss, не в применении', () => {
    const start = code.indexOf('function safeCss(');
    const end = code.indexOf('function insertScopedCss(', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const safeCssBody = code.slice(start, end);
    // считаем строковые литералы (аргументы indexOf): слово javascript без
    // кавычек встречается ещё в комментарии safeUrl про протоколы.
    for (const word of ["'expression'", "'javascript'", "'behavior'", "'@import'"]) {
      const total = code.split(word).length - 1;
      const inFilter = safeCssBody.split(word).length - 1;
      expect(inFilter, word + ' в safeCss').toBeGreaterThanOrEqual(1);
      expect(total, word + ' вне фильтра').toBe(inFilter);
    }
    // url( разрешён только с data:image
    expect(safeCssBody).toContain("low.indexOf('url(') >= 0 && low.indexOf('data:image') < 0");
  });

  it('действие pay: kind: \'pay\' с product (interp) и stars, состояние «оплата…», тосты ok/err.text', () => {
    expect(code).toContain("if (a.id === 'pay')");
    expect(code).toMatch(/kind: 'pay', product: product, stars: stars/);
    expect(code).toMatch(/var product = interp\(String\(a\.product/);
    expect(code).toContain("'оплата\\u2026'");
    expect(code).toContain("toast('Счёт отправлен в чат')");
    expect(code).toMatch(/toast\(e && e\.text \? e\.text : 'Ошибка оплаты'\)/);
  });

  it('прежние гарантии целы: нет обратных кавычек и ${ в рантайме', () => {
    expect(code).not.toContain('`');
    expect(code).not.toContain('${');
  });
});

describe('miniCondLeft: ссылки на контекст', () => {
  it('user.id / user.name / user.username', () => {
    expect(miniCondLeft('user.id', CTX)).toBe('42');
    expect(miniCondLeft('user.name', CTX)).toBe('Илья');
    expect(miniCondLeft('user.username', CTX)).toBe('ilya_dev');
  });

  it('tag:<имя> — факт наличия как 1/\'\'', () => {
    expect(miniCondLeft('tag:vip', CTX)).toBe('1');
    expect(miniCondLeft('tag:admin', CTX)).toBe('');
  });

  it('var:<имя> — из ctx.vars, отсутствующая = \'\'', () => {
    expect(miniCondLeft('var:city', CTX)).toBe('Москва');
    expect(miniCondLeft('var:nope', CTX)).toBe('');
  });
});

describe('evalMiniOp: все операторы ConditionOp', () => {
  it('== / != строковые и числовые', () => {
    expect(evalMiniOp('Илья', '==', 'Илья')).toBe(true);
    expect(evalMiniOp('Илья', '==', 'Иль я')).toBe(false);
    expect(evalMiniOp('a', '!=', 'b')).toBe(true);
    // числа сравниваются числово: '42' == '42.0'
    expect(evalMiniOp('42', '==', '42.0')).toBe(true);
    expect(evalMiniOp('42', '!=', '43')).toBe(true);
    expect(evalMiniOp('42', '!=', '42')).toBe(false);
  });

  it('> / < / >= / <= числовые', () => {
    expect(evalMiniOp('100', '>', '50')).toBe(true);
    expect(evalMiniOp('9', '>', '10')).toBe(false); // не лексикографически
    expect(evalMiniOp('3', '<', '4')).toBe(true);
    expect(evalMiniOp('5', '>=', '5')).toBe(true);
    expect(evalMiniOp('4', '>=', '5')).toBe(false);
    expect(evalMiniOp('5', '<=', '5')).toBe(true);
  });

  it('> / < строковые, когда стороны не числа', () => {
    expect(evalMiniOp('b', '>', 'a')).toBe(true);
    expect(evalMiniOp('a', '<', 'b')).toBe(true);
  });

  it('contains', () => {
    expect(evalMiniOp('Москва', 'contains', 'оск')).toBe(true);
    expect(evalMiniOp('Москва', 'contains', 'Питер')).toBe(false);
  });

  it('in / not_in: список через запятую, регистр и пробелы не важны', () => {
    expect(evalMiniOp('москва', 'in', 'Москва, СПБ')).toBe(true);
    expect(evalMiniOp('Казань', 'in', 'Москва, СПБ')).toBe(false);
    expect(evalMiniOp('Казань', 'not_in', 'Москва, СПБ')).toBe(true);
    expect(evalMiniOp('Москва', 'not_in', 'Москва, СПБ')).toBe(false);
  });

  it('starts_with / ends_with (пустая правая часть = ложь)', () => {
    expect(evalMiniOp('ilya_dev', 'starts_with', 'ilya')).toBe(true);
    expect(evalMiniOp('ilya_dev', 'starts_with', 'dev')).toBe(false);
    expect(evalMiniOp('ilya_dev', 'ends_with', 'dev')).toBe(true);
    expect(evalMiniOp('ilya_dev', 'starts_with', '')).toBe(false);
    expect(evalMiniOp('ilya_dev', 'ends_with', '')).toBe(false);
  });

  it("empty / not_empty ('0' не пусто)", () => {
    expect(evalMiniOp('', 'empty', '')).toBe(true);
    expect(evalMiniOp('0', 'empty', '')).toBe(false);
    expect(evalMiniOp('x', 'not_empty', '')).toBe(true);
    expect(evalMiniOp('', 'not_empty', '')).toBe(false);
  });

  it('regex: совпадение и битый паттерн = ложь', () => {
    expect(evalMiniOp('ilya_dev', 'regex', '^ilya_')).toBe(true);
    expect(evalMiniOp('ilya_dev', 'regex', '^admin')).toBe(false);
    expect(evalMiniOp('x', 'regex', '([a-z')).toBe(false);
  });

  it('неизвестный оператор = ложь', () => {
    expect(evalMiniOp('a', 'wat' as ConditionOp, 'a')).toBe(false);
  });
});

describe('evalVisibleMini', () => {
  it('null/undefined/без op = видим', () => {
    expect(evalVisibleMini(null, CTX)).toBe(true);
    expect(evalVisibleMini(undefined, CTX)).toBe(true);
  });

  it('user.*: ==, contains, starts_with', () => {
    expect(evalVisibleMini(cond('user.name', '==', 'Илья'), CTX)).toBe(true);
    expect(evalVisibleMini(cond('user.name', '!=', 'Илья'), CTX)).toBe(false);
    expect(evalVisibleMini(cond('user.username', 'contains', 'dev'), CTX)).toBe(true);
    expect(evalVisibleMini(cond('user.username', 'starts_with', 'ilya'), CTX)).toBe(true);
    // id числовой: '42' == '42' и '42' > '7'
    expect(evalVisibleMini(cond('user.id', '==', '42'), CTX)).toBe(true);
    expect(evalVisibleMini(cond('user.id', '>', '7'), CTX)).toBe(true);
  });

  it('tag:<имя>: == 1 / empty / not_empty', () => {
    expect(evalVisibleMini(cond('tag:vip', '==', '1'), CTX)).toBe(true);
    expect(evalVisibleMini(cond('tag:admin', '==', '1'), CTX)).toBe(false);
    expect(evalVisibleMini(cond('tag:admin', 'empty', ''), CTX)).toBe(true);
    expect(evalVisibleMini(cond('tag:vip', 'not_empty', ''), CTX)).toBe(true);
  });

  it('var:<имя>: in, not_in, regex, числовые >= / <=', () => {
    expect(evalVisibleMini(cond('var:city', 'in', 'Москва, СПБ'), CTX)).toBe(true);
    expect(evalVisibleMini(cond('var:city', 'not_in', 'Казань'), CTX)).toBe(true);
    expect(evalVisibleMini(cond('var:city', 'regex', 'Москв'), CTX)).toBe(true);
    expect(evalVisibleMini(cond('var:balance', '>=', '100'), CTX)).toBe(true);
    expect(evalVisibleMini(cond('var:balance', '<=', '99'), CTX)).toBe(false);
    expect(evalVisibleMini(cond('var:note', 'empty', ''), CTX)).toBe(true);
    expect(evalVisibleMini(cond('var:city', 'ends_with', 'ква'), CTX)).toBe(true);
  });

  it('username = null приводится к \'\' (empty = true)', () => {
    const noUser: MiniContext = { ...CTX, username: null };
    expect(evalVisibleMini(cond('user.username', 'empty', ''), noUser)).toBe(true);
    expect(evalVisibleMini(cond('user.username', 'not_empty', ''), noUser)).toBe(false);
  });
});
