// F8: уровень подготовки спрашивается ровно один раз. Проверяем серверную
// часть — отметку момента выбора: по ней фронт решает, показывать ли экран.
import { describe, expect, it } from 'vitest';
import { _testOnly } from '../worker/src/index';

const { markSkillLevelChosen } = _testOnly;

describe('markSkillLevelChosen', () => {
  it('выбор уровня проставляет дату', () => {
    const patch = markSkillLevelChosen({ skill_level: 'low' });
    expect(patch.skill_level).toBe('low');
    expect(typeof patch.skill_level_set_at).toBe('number');
    expect(patch.skill_level_set_at!).toBeGreaterThan(0);
  });

  it('пустое значение не считается выбором', () => {
    expect(markSkillLevelChosen({ skill_level: '' }).skill_level_set_at).toBeUndefined();
  });

  it('патч без уровня дату не трогает', () => {
    const patch = markSkillLevelChosen({ theme: 'light' });
    expect(patch.skill_level_set_at).toBeUndefined();
  });

  it('остальные поля патча сохраняются', () => {
    const patch = markSkillLevelChosen({ skill_level: 'high', theme: 'light' });
    expect(patch.theme).toBe('light');
  });
});
