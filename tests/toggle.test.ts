// Анти-дрейф: переключатель-«свитч» (A2/A3). Овал с круглым бегунком обязан
// остаться овалом — глобальные правила button{min-height} и мобильный оверрайд
// 44px растягивали его в квадрат. Плюс: свитч в продукте один (общий Toggle),
// а «Тестовый режим» на странице оплаты — больше не нативный чекбокс.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const styles = read('../web/src/styles.css');
const toggleTsx = read('../web/src/Toggle.tsx');
const settingsTsx = read('../web/src/SettingsModal.tsx');
const paymentsTsx = read('../web/src/PaymentsPage.tsx');
const payRu = read('../web/src/i18n.frag.pay.ts');
const payEn = read('../web/src/i18n.frag.pay.en.ts');

// Наивный разбор CSS: правила одноуровневые, @media даёт контекст.
interface Rule { selector: string; body: string; at: string[] }

function parseCss(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const at: string[] = [];
  let buf = '';
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '{') {
      const head = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (head.startsWith('@')) {
        at.push(head);
        i++;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth++;
        else if (clean[j] === '}') depth--;
        j++;
      }
      rules.push({ selector: head, body: clean.slice(i + 1, j - 1), at: [...at] });
      i = j;
      continue;
    }
    if (ch === '}') {
      at.pop();
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  return rules;
}

// Части селектора (через запятую), начинающиеся с указанного класса.
function partsStartingWith(rule: Rule, cls: string): string[] {
  return rule.selector
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(cls));
}

const cssRules = parseCss(styles);

describe('.switch в styles.css', () => {
  it('базовое правило — овал, не растянутый минимальной высотой кнопки', () => {
    const base = cssRules.find((r) => r.selector === '.switch' && r.at.length === 0);
    expect(base, 'нет базового правила .switch вне @media').toBeTruthy();
    expect(base!.body).toContain('border-radius: 999px');
    expect(base!.body).toContain('min-height: 0');
    expect(base!.body).toContain('width: 40px');
    expect(base!.body).toContain('height: 22px');
  });

  it('бегунок центрирован по вертикали, а не прибит к top: 2px', () => {
    const knob = cssRules.find((r) => r.selector === '.switch .switch-knob' && r.at.length === 0);
    expect(knob, 'нет базового правила .switch .switch-knob').toBeTruthy();
    expect(knob!.body).toContain('top: 50%');
    expect(knob!.body).toContain('translateY(-50%)');
    expect(knob!.body).toContain('border-radius: 999px');
  });

  it('состояние on сдвигает бегунок вместе с вертикальной центровкой', () => {
    const on = cssRules.find((r) => r.selector === '.switch.on .switch-knob' && r.at.length === 0);
    expect(on, 'нет базового правила .switch.on .switch-knob').toBeTruthy();
    expect(on!.body).toContain('translate(18px, -50%)');
  });

  it('мобильный оверрайд увеличивает тач-зону без растягивания овала', () => {
    const media = cssRules.filter((r) => r.at.some((a) => a.includes('max-width: 760px')));
    const sw = media.find((r) => r.selector === '.switch');
    expect(sw, 'нет .switch внутри @media (max-width: 760px)').toBeTruthy();
    expect(sw!.body).toContain('min-height: 0');
    expect(sw!.body).toContain('height: 26px');
    const after = media.find((r) => r.selector === '.switch::after');
    expect(after, 'нет .switch::after внутри @media (max-width: 760px)').toBeTruthy();
    expect(after!.body).toContain('inset: -9px');
  });

  it('других .switch-правил в файле нет', () => {
    const allowed = new Set([
      '.switch',
      '.switch .switch-knob',
      '.switch.on',
      '.switch.on .switch-knob',
      '.switch:focus-visible',
      '.switch::after',
    ]);
    const seen = new Set<string>();
    for (const r of cssRules) {
      for (const part of partsStartingWith(r, '.switch')) {
        seen.add(part);
        expect(allowed.has(part), `неожиданный селектор свитча: ${part}`).toBe(true);
      }
    }
    expect(seen.has('.switch')).toBe(true);
  });
});

describe('общий компонент Toggle', () => {
  it('декларирует себя как switch для скринридера', () => {
    expect(toggleTsx).toContain('role="switch"');
    expect(toggleTsx).toContain('aria-checked');
    expect(toggleTsx).toContain('switch-knob');
  });

  it('SettingsModal и PaymentsPage берут свитч из общего модуля', () => {
    expect(settingsTsx).toContain("from './Toggle'");
    expect(paymentsTsx).toContain("from './Toggle'");
  });

  it('страницы не рендерят собственный switch-каркас', () => {
    for (const [name, src] of [['SettingsModal', settingsTsx], ['PaymentsPage', paymentsTsx]] as const) {
      expect(src, `${name} всё ещё рисует switch-knob сам`).not.toContain('switch-knob');
    }
  });
});

describe('«Тестовый режим» на странице оплаты', () => {
  it('больше не нативный чекбокс', () => {
    expect(paymentsTsx).not.toContain('type="checkbox"');
    expect(paymentsTsx).toContain('toggle-line');
    expect(paymentsTsx).toContain("t('payments.field.testMode')");
    // Формат хранения не меняется: testMode по-прежнему уходит строкой '1'.
    expect(paymentsTsx).toContain("config.testMode = '1'");
  });

  it('правило чекбокса .checkline сохранено — им пользуются другие страницы', () => {
    expect(styles).toContain('.checkline input[type="checkbox"]');
  });
});

describe('ключи результата проверки подключения', () => {
  it('нечестный payments.check.ok удалён из обоих языков', () => {
    expect(payRu).not.toMatch(/'payments\.check\.ok'\s*:/);
    expect(payEn).not.toMatch(/'payments\.check\.ok'\s*:/);
    expect(paymentsTsx).not.toMatch(/['"]payments\.check\.ok['"]/);
  });

  it('три исхода описаны в RU и EN', () => {
    for (const dict of [payRu, payEn]) {
      expect(dict).toContain('payments.check.okLive');
      expect(dict).toContain('payments.check.okFormat');
      expect(dict).toContain('payments.check.failed');
    }
  });

  it('форматный исход не обещает «проверено»', () => {
    const line = payRu.split('\n').find((l) => l.includes("'payments.check.okFormat'"));
    expect(line).toBeTruthy();
    expect(line!.toLowerCase()).not.toContain('проверено');
  });
});
