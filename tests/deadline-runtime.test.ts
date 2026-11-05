// Дедлайн (набор 2026-10): чистые правила выбора ветки при срабатывании крона.
import { describe, it, expect } from 'vitest';
import { deadlineBranch, isCancelledFlag } from '../worker/src/blocks/deadline/runtime';

describe('isCancelledFlag', () => {
  it('установленные флаги', () => {
    expect(isCancelledFlag('paid')).toBe(true);
    expect(isCancelledFlag('1')).toBe(true);
    expect(isCancelledFlag('true')).toBe(true);
    expect(isCancelledFlag(42)).toBe(true);
  });
  it('не флаги: пусто, 0, false в любом регистре', () => {
    expect(isCancelledFlag('')).toBe(false);
    expect(isCancelledFlag(undefined)).toBe(false);
    expect(isCancelledFlag('0')).toBe(false);
    expect(isCancelledFlag('false')).toBe(false);
    expect(isCancelledFlag('FALSE')).toBe(false);
  });
});

describe('deadlineBranch', () => {
  it('флаг установлен — done', () => {
    expect(deadlineBranch({ paid: 'yes' }, 'paid')).toBe('done');
  });
  it('флага нет или он пустой — expired', () => {
    expect(deadlineBranch({}, 'paid')).toBe('expired');
    expect(deadlineBranch({ paid: '' }, 'paid')).toBe('expired');
    expect(deadlineBranch({ paid: '0' }, 'paid')).toBe('expired');
  });
  it('cancelVar не задан — всегда expired (отменять нечем)', () => {
    expect(deadlineBranch({ paid: 'yes' }, '')).toBe('expired');
  });
});
