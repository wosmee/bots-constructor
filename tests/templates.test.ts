// Готовые шаблоны должны проходить собственный валидатор. После F5 часть
// проверок стала строже (незаполненная ветка кнопки — ошибка), поэтому это
// регрессионный тест: шаблон, который нельзя опубликовать, бесполезен.
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../web/src/templates';
import { validateScenario, countIssues } from '../shared/validate';

describe('готовые шаблоны', () => {
  it('каждый шаблон публикуется без ошибок', () => {
    for (const tpl of TEMPLATES) {
      const issues = validateScenario(tpl.scenario);
      const errors = issues.filter((i) => i.level === 'error');
      expect(
        errors,
        `шаблон «${tpl.name}»: ${errors.map((e) => `${e.code} — ${e.message}`).join('; ')}`
      ).toEqual([]);
    }
  });

  it('у каждого ветвящегося блока шаблона ветки заполнены', () => {
    for (const tpl of TEMPLATES) {
      for (const b of Object.values(tpl.scenario.blocks)) {
        if (b.type !== 'buttons' && b.type !== 'menu') continue;
        for (const btn of b.params.buttons ?? []) {
          if (btn.url) continue;
          expect(
            b.branches?.[btn.value],
            `шаблон «${tpl.name}», блок ${b.id}, кнопка «${btn.label}» без ветки`
          ).toBeTruthy();
        }
      }
    }
  });

  it('хотя бы один шаблон вообще существует — тест не проходит вхолостую', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
    expect(countIssues(validateScenario(TEMPLATES[0].scenario)).errors).toBe(0);
  });
});
