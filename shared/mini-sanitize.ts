// Санитайзеры пользовательского контента мини-аппов (фаза D).
// Оба работают строково, без DOM: shared исполняется и в воркере, и в вебе.
// Принцип: белый список тегов/свойств, всё остальное вырезается целиком.
// Применяются: sanitizeRichText — на публикации схемы и при рендере richtext;
// sanitizeCss — на публикации и при применении style.css/page.css в рантайме.

// ---------------- богатый текст ----------------

// Разрешённые теги: b, i, u, s, br, a (только href http/https). Всё прочее
// (script, style, img, on*-) вырезается с содержимым для script/style и
// без содержимого для остальных.
const ALLOWED_TAGS = new Set(['b', 'i', 'u', 's', 'br', 'a']);
// rawtext-теги: их содержимое — не текст, вырезается вместе с тегом.
const RAWTEXT_TAGS = new Set(['script', 'style']);

interface ParsedTag {
  name: string; // lowercase
  closing: boolean;
  attrs: Array<{ name: string; value: string }>;
  end: number; // индекс сразу за закрывающей '>' (или src.length)
  terminated: boolean; // найдена ли закрывающая '>'
}

const WS = /\s/;

// Символьный токенайзер одного тега (F-037/S2-03: regex-версия обходилась
// через «<» в кавычках атрибута, slash-форму «<b/onclick=…>» и «<a/href=…»).
// Семантика следует HTML5-парсеру браузера:
// — кавычки (одинарные/двойные) учитываются: «<» и «>» внутри значения
//   атрибута НЕ заканчивают тег;
// — «/» не перед «>» — просто разделитель, поэтому «<b/onclick=x>»
//   разбирается как тег b с атрибутом onclick (атрибуты потом выбрасываются);
// — незакрытая кавычка или отсутствие «>» до EOF — тег незакрытый.
function parseTag(src: string, start: number): ParsedTag | null {
  let j = start + 1; // за '<'
  let closing = false;
  if (src[j] === '/') {
    closing = true;
    j++;
  }
  const nameStart = j;
  while (j < src.length && /[a-zA-Z0-9-]/.test(src[j])) j++;
  if (j === nameStart || !/[a-zA-Z]/.test(src[nameStart])) return null; // '<' не начинает тег
  const name = src.slice(nameStart, j).toLowerCase();
  const attrs: Array<{ name: string; value: string }> = [];
  for (;;) {
    while (j < src.length && WS.test(src[j])) j++;
    if (j >= src.length) return { name, closing, attrs, end: src.length, terminated: false };
    const ch = src[j];
    if (ch === '>') return { name, closing, attrs, end: j + 1, terminated: true };
    if (ch === '/') {
      if (src[j + 1] === '>') return { name, closing, attrs, end: j + 2, terminated: true };
      j++; // HTML5: '/' не перед '>' — переход в before-attribute-name
      continue;
    }
    const aStart = j;
    while (j < src.length && !/[\s=/>]/.test(src[j])) j++;
    if (j === aStart) {
      j++; // защита от пустого шага
      continue;
    }
    const aName = src.slice(aStart, j).toLowerCase();
    let k = j;
    let value = '';
    while (k < src.length && WS.test(src[k])) k++;
    if (src[k] === '=') {
      k++;
      while (k < src.length && WS.test(src[k])) k++;
      if (src[k] === '"' || src[k] === "'") {
        const q = src[k];
        const vStart = k + 1;
        k = vStart;
        while (k < src.length && src[k] !== q) k++;
        if (k >= src.length) {
          // кавычка не закрыта до EOF — тег незакрытый
          return { name, closing, attrs, end: src.length, terminated: false };
        }
        value = src.slice(vStart, k);
        k++;
      } else {
        const vStart = k;
        // некавычковое значение: до пробела или '>' ('<' поглощается, как в HTML5)
        while (k < src.length && !WS.test(src[k]) && src[k] !== '>') k++;
        value = src.slice(vStart, k);
      }
    }
    attrs.push({ name: aName, value });
    j = k > j ? k : j;
  }
}

export function sanitizeRichText(input: string): string {
  const src = String(input ?? '');
  let out = '';
  let i = 0; // позиция сканирования
  let text = 0; // начало незафлешенного текста
  while (i < src.length) {
    if (src[i] !== '<') {
      i++;
      continue;
    }
    const tag = parseTag(src, i);
    if (tag === null) {
      // '<' без имени тега — обычный текстовый символ
      out += escapeText(src.slice(text, i)) + '&lt;';
      i++;
      text = i;
      continue;
    }
    out += escapeText(src.slice(text, i));
    if (!tag.terminated) {
      // незакрытый до EOF тег: script/style вырезаются с остатком строки,
      // остальные — экранированный текст
      if (!tag.closing && RAWTEXT_TAGS.has(tag.name)) return out;
      return out + escapeText(src.slice(i));
    }
    i = tag.end;
    text = i;
    if (!tag.closing && RAWTEXT_TAGS.has(tag.name)) {
      // содержимое script/style вырезается до закрывающего тега (или до EOF)
      const p = src.toLowerCase().indexOf(`</${tag.name}`, tag.end);
      if (p === -1) return out;
      const q = src.indexOf('>', p);
      i = q === -1 ? src.length : q + 1;
      text = i;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag.name)) continue; // тег выброшен, содержимое остаётся
    if (tag.name === 'br') {
      out += '<br>';
      continue;
    }
    if (tag.closing) {
      out += `</${tag.name}>`;
      continue;
    }
    if (tag.name === 'a') {
      const href = tag.attrs.find((a) => a.name === 'href');
      const url = href ? href.value.trim() : '';
      // javascript:/data:/vbscript: не проходят: только http(s) после trim
      if (/^https?:\/\//i.test(url)) out += `<a href="${escapeAttr(url)}" rel="noopener noreferrer">`;
      else out += '<a>';
      continue;
    }
    out += `<${tag.name}>`;
  }
  out += escapeText(src.slice(text));
  return out;
}

function escapeText(s: string): string {
  return s
    .replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// «&» с сохранением существующих entity (как в escapeText): инспектор
// санитизирует уже санитизированный props.html на каждое нажатие клавиши,
// поэтому экранирование обязано быть идемпотентным.
function escapeAttr(s: string): string {
  return s
    .replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------- пользовательский CSS ----------------

export const MINI_CSS_MAX = 2000;

// Опасные конструкции вырезаются ДО разбора свойств: javascript:/expression/
// behavior/@import/url(data: и внешние url() в фоне. Остаётся декларативный
// CSS свойств из белого списка; селекторы рантайм добавляет сам (скоуп .el-id).
const DANGEROUS = /expression\s*\(|javascript\s*:|behavior\s*:|@import|@charset|url\s*\(\s*['"]?\s*(?!data:image\/(png|jpe?g|webp|gif))/gi;

const ALLOWED_PROPS = new Set([
  'color', 'background', 'background-color', 'background-image', 'border', 'border-radius',
  'box-shadow', 'font-size', 'font-weight', 'font-style', 'font-family', 'letter-spacing',
  'line-height', 'text-align', 'text-transform', 'text-decoration', 'opacity', 'padding',
  'margin', 'width', 'height', 'min-height', 'max-width', 'display', 'gap', 'align-items',
  'justify-content', 'overflow', 'white-space', 'backdrop-filter', 'filter', 'transform',
]);

// Сплиттер деклараций по ';', но не внутри скобок: url(data:...;base64,...)
// не должен разрезаться на части.
function splitDecls(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of src) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function sanitizeCss(input: string): string {
  let src = String(input ?? '').slice(0, MINI_CSS_MAX);
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  src = src.replace(/[{}]/g, ';');
  const decls = splitDecls(src)
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const idx = d.indexOf(':');
      if (idx < 1) return '';
      const prop = d.slice(0, idx).trim().toLowerCase();
      const val = d.slice(idx + 1).trim();
      if (!ALLOWED_PROPS.has(prop)) return '';
      DANGEROUS.lastIndex = 0; // глобальный regex stateful — сбрасываем перед test
      if (DANGEROUS.test(val)) return '';
      if (!/^[-#a-zA-Z0-9 ,.%()/:;+=_"']+$/.test(val)) return '';
      return `${prop}: ${val}`;
    })
    .filter(Boolean);
  return decls.join('; ');
}
