// Превью: кнопки, меню и полоса переменных (сессия 22.10.2026).
// Багу «нажал кнопку — превью пишет букву и залипает» причина была на стороне
// воркера (сырой value вместо callback:) — её ловит tests/simulate.test.ts.
// Здесь — фронт превью: быстрые кнопки меню из __menu, скрытие служебных
// переменных и разделитель секций дашборда. Проверка source-level: компонент
// тянет api/settings/i18n, без React-рендера это единственный способ.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { translate, loadDict, type TKey } from '../web/src/i18n';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const previewSrc = read('../web/src/preview.tsx');
const appSrc = read('../web/src/App.tsx');
const styles = read('../web/src/styles.css');

describe('превью: меню бота', () => {
  it('кнопки меню берутся из vars.__menu и отправляются текстом подписи', () => {
    expect(previewSrc).toContain("vars['__menu']");
    expect(previewSrc).toContain('menuButtons');
    // Нажатие приходит тем же вводом, что в бою: текстом label.
    expect(previewSrc).toMatch(/onClick=\{\(\) => submit\(b\.label\)\}/);
  });

  it('у ряда меню своя подпись из словаря', async () => {
    expect(previewSrc).toContain("t('preview.menu.title')");
    await loadDict('en');
    for (const key of ['preview.menu.title', 'preview.noButtons'] as TKey[]) {
      expect(translate('ru', key), `нет RU для ${key}`).not.toBe(key);
      expect(translate('en', key), `нет EN для ${key}`).not.toBe(key);
    }
  });
});

describe('превью: служебные переменные не показываются', () => {
  it('полоса переменных фильтрует внутренние __*', () => {
    expect(previewSrc).toContain("!k.startsWith('__')");
  });
});

describe('дашборд: секции и разделитель', () => {
  it('обе секции обёрнуты в .dashboard-section с заголовком и полоской', () => {
    expect((appSrc.match(/dashboard-section-head/g) ?? []).length).toBe(2);
    expect((appSrc.match(/dashboard-section-rule/g) ?? []).length).toBe(2);
    expect(appSrc).toContain("t('dash.bots.title')");
    expect(appSrc).toContain("t('mini.dashboard.title')");
  });

  it('заголовок «Мои боты» есть в обоих словарях', async () => {
    await loadDict('en');
    expect(translate('ru', 'dash.bots.title' as TKey)).toBe('Мои боты');
    expect(translate('en', 'dash.bots.title' as TKey)).toBe('My bots');
  });

  it('полоска-разделитель описана в CSS и использует токены линий', () => {
    expect(styles).toContain('.dashboard-section-rule');
    const ruleStart = styles.indexOf('.dashboard-section-rule');
    const ruleBody = styles.slice(ruleStart, styles.indexOf('}', ruleStart));
    expect(ruleBody).toContain('linear-gradient');
    expect(ruleBody).toContain('var(--line');
    // Разделитель — ровно 1px, не «брутальная» полоса.
    expect(ruleBody).toContain('height: 1px');
  });

  it('минимальный отступ между секциями задан токеном ритма', () => {
    expect(styles).toContain('.dashboard-section + .dashboard-section');
    expect(styles).toMatch(/\.dashboard-section \+ \.dashboard-section \{[^}]*margin-top: var\(--sp-6\)/);
  });
});
