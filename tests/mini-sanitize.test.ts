// Санитайзеры мини-аппов (фаза D): богатый текст и пользовательский CSS.
import { describe, expect, it } from 'vitest';
import { sanitizeRichText, sanitizeCss } from '../shared/mini-sanitize';

describe('sanitizeRichText', () => {
  it('сохраняет разрешённые теги', () => {
    expect(sanitizeRichText('<b>жирный</b> и <i>курсив</i>')).toBe('<b>жирный</b> и <i>курсив</i>');
  });
  it('вырезает script со содержимым', () => {
    expect(sanitizeRichText('до<script>alert(1)</script>после')).toBe('допосле');
  });
  it('вырезает style со содержимым', () => {
    expect(sanitizeRichText('а<style>.x{}</style>б')).toBe('аб');
  });
  it('неразрешённый тег убирается, содержимое остаётся', () => {
    expect(sanitizeRichText('<div onclick="x()">текст</div>')).toBe('текст');
  });
  it('a сохраняет только безопасный href', () => {
    expect(sanitizeRichText('<a href="https://x.y">ссылка</a>')).toBe('<a href="https://x.y" rel="noopener noreferrer">ссылка</a>');
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });
  it('br нормализуется', () => {
    expect(sanitizeRichText('a<br/>b')).toBe('a<br>b');
  });
  it('экранирует угловые скобки вне тегов', () => {
    expect(sanitizeRichText('1 < 2')).toBe('1 &lt; 2');
  });
});

// F-037/S2-03: регрессия на обходы строково-regex версии (аудит 18.10.2026).
describe('sanitizeRichText — обходы regex-версии (S2-03)', () => {
  it('вектор 1: «<» внутри кавычек атрибута не ломает разбор тега', () => {
    const out = sanitizeRichText('<img src="<" onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
    expect(out).toBe('');
  });
  it('вектор 2: slash-форма «<b/onclick=…>» — атрибуты выбрасываются, тег остаётся чистым', () => {
    expect(sanitizeRichText('<b/onclick=alert(1)>жирный</b>')).toBe('<b>жирный</b>');
  });
  it('вектор 3: «<a/href=javascript:…>» — href отклоняется', () => {
    const out = sanitizeRichText('<a/href=javascript:alert(1)>ссылка</a>');
    expect(out).not.toContain('javascript');
    expect(out).toBe('<a>ссылка</a>');
  });
  it('незакрытая кавычка атрибута: тег до EOF — экранированный текст', () => {
    const out = sanitizeRichText('<a href="https://ok.ru>текст');
    expect(out).not.toContain('<a');
    expect(out).toContain('&lt;');
    expect(out).toBe('&lt;a href="https://ok.ru&gt;текст');
  });
  it('регистр тега/атрибута/схемы не важен', () => {
    expect(sanitizeRichText('<A HREF="HTTPS://ok.ru">ссылка</A>')).toBe(
      '<a href="HTTPS://ok.ru" rel="noopener noreferrer">ссылка</a>',
    );
  });
  it('вложенность разрешённых тегов сохраняется', () => {
    expect(sanitizeRichText('<b><i>x</i></b>')).toBe('<b><i>x</i></b>');
  });
  it('«<» в тексте без тега экранируется', () => {
    expect(sanitizeRichText('a < b и 5 > 4')).toBe('a &lt; b и 5 &gt; 4');
    expect(sanitizeRichText('x << y')).toBe('x &lt;&lt; y');
  });
  it('незакрытый script до EOF вырезается вместе с остатком', () => {
    expect(sanitizeRichText('до<script>alert(1)')).toBe('до');
    expect(sanitizeRichText('до<script src=x>alert(1)')).toBe('до');
  });
  it('data:/vbscript: в href отклоняются', () => {
    expect(sanitizeRichText('<a href="data:text/html,<script>alert(1)</script>">x</a>')).toBe('<a>x</a>');
    expect(sanitizeRichText('<a href="vbscript:msgbox(1)">x</a>')).toBe('<a>x</a>');
  });
  it('гарантия: «<» в выходе встречается только в эмитированных whitelist-тегах', () => {
    const nasty = [
      '<img src="<" onerror=alert(1)>',
      '<b/onclick=alert(1)>жирный</b>',
      '<a/href=javascript:alert(1)>ссылка</a>',
      '<<script>alert(1)</script>>',
      '<a href="https://ok.ru" onclick="x()">ok</a>',
      '<b <i>x</i>',
      '<svg/onload=alert(1)>',
      'a<b/ onclick=alert(1)>c</b>',
      '<a href = "https://x.y" >z</a>',
      '</ a>< /b>',
      '<style>*{}</style><u>u</u>',
    ];
    for (const src of nasty) {
      const out = sanitizeRichText(src);
      const stripped = out.replace(/<\/?(?:b|i|u|s|br)\s*>/g, '').replace(/<\/?a(?:\s[^>]*)?>/g, '');
      // никаких «<» вне whitelist-тегов (src в сообщении — чтобы падение показывало вектор)
      expect(stripped, src).not.toContain('<');
    }
  });
  it('идемпотентность: повторная санитизация не меняет результат', () => {
    const once = sanitizeRichText('<a href="https://x.y?a=1&b=2">ссылка</a> и <b>жирный &amp;</b>');
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe('sanitizeCss', () => {
  it('сохраняет безопасные декларации', () => {
    expect(sanitizeCss('color: red; border-radius: 12px')).toBe('color: red; border-radius: 12px');
  });
  it('вырезает expression/javascript/behavior', () => {
    expect(sanitizeCss('width: expression(alert(1)); color: blue')).toBe('color: blue');
    expect(sanitizeCss('background: javascript:alert(1)')).toBe('');
  });
  it('вырезает @import и внешние url()', () => {
    expect(sanitizeCss('@import url(evil.css); color: red')).toBe('color: red');
    expect(sanitizeCss('background-image: url(https://evil/x.png)')).toBe('');
  });
  it('data:image разрешён', () => {
    expect(sanitizeCss('background-image: url(data:image/png;base64,AAA)')).toBe('background-image: url(data:image/png;base64,AAA)');
  });
  it('неразрешённые свойства вырезаются', () => {
    expect(sanitizeCss('position: fixed; z-index: 999; color: red')).toBe('color: red');
  });
  it('режет фигурные скобки и комментарии', () => {
    expect(sanitizeCss('.x { color: red } /* c */ font-size: 14px')).toBe('color: red; font-size: 14px');
  });
  it('обрезает по лимиту', () => {
    expect(sanitizeCss('color: red; '.repeat(500)).length).toBeLessThanOrEqual(2000);
  });
});
