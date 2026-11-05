// F2: единая нормализация тега. Ею пользуются движок, валидатор и интерфейс —
// если бы каждый чистил по-своему, условие по тегу молча расходилось бы с тем,
// что лежит в базе.
import { describe, expect, it } from 'vitest';
import { normalizeTag, TAG_MAX_LENGTH } from '../shared/types';

describe('normalizeTag', () => {
  it('приводит к нижнему регистру и убирает пробелы по краям', () => {
    expect(normalizeTag('  VIP ')).toBe('vip');
  });

  it('схлопывает внутренние пробелы', () => {
    expect(normalizeTag('из   рассылки   X')).toBe('из рассылки x');
  });

  it('пустое значение остаётся пустым', () => {
    expect(normalizeTag('')).toBe('');
    expect(normalizeTag('   ')).toBe('');
    expect(normalizeTag(null)).toBe('');
    expect(normalizeTag(undefined)).toBe('');
  });

  it('обрезает слишком длинное имя до предела', () => {
    expect(normalizeTag('a'.repeat(100))).toHaveLength(TAG_MAX_LENGTH);
  });

  it('«VIP» и «vip» — один и тот же тег', () => {
    expect(normalizeTag('VIP')).toBe(normalizeTag('vip'));
  });
});
