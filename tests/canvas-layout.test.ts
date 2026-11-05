// Анти-дрейф раскладки конструктора (A4): «серая страница» возникает, когда
// флекс-цепочка .constructor → .workspace → .canvas теряет высоту или
// min-height: 0. Тест читает styles.css как текст и фиксирует ключевые
// правила. Сам CSS править нельзя — при расхождении чиним компонент, не тест.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../web/src/styles.css', import.meta.url), 'utf8');

// Текст первого правила, начинающегося ровно с селектора (`.canvas {`, но не
// `.canvas .react-flow` и не `.empty-canvas`).
function ruleBody(selector: string): string {
  const re = new RegExp(`(^|[\\s,}])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const m = re.exec(css);
  expect(m, `правило ${selector} не найдено в styles.css`).not.toBeNull();
  return m![2];
}

// Содержимое @media-блока по стартовому индексу (баланс скобок).
function mediaBlock(header: string): string {
  const start = css.indexOf(header);
  expect(start, `${header} не найден`).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  return css.slice(open);
}

describe('раскладка конструктора', () => {
  it('.constructor держит высоту окна и не переполняется', () => {
    const body = ruleBody('.constructor');
    expect(body).toContain('height: 100vh');
    expect(body).toContain('min-height: 0');
  });

  it('.workspace схлопывается вместе с окном (min-height: 0)', () => {
    expect(ruleBody('.workspace')).toContain('min-height: 0');
  });

  it('.canvas не переполняет строку (min-height: 0)', () => {
    expect(ruleBody('.canvas')).toContain('min-height: 0');
  });

  it('в мобильном media-запросе .constructor переходит на 100dvh', () => {
    const block = mediaBlock('@media (max-width: 760px)');
    expect(block).toMatch(/\.constructor\s*\{[^}]*height:\s*100dvh[^}]*\}/);
  });
});
