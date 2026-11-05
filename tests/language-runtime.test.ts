// Тесты runtime блока language: нормализация кода и выбор ветки.
import { describe, it, expect } from 'vitest';
import { normalizeLangCode, pickLangBranch } from '../worker/src/blocks/lang/runtime';

describe('normalizeLangCode', () => {
  it('регистр и пробелы', () => {
    expect(normalizeLangCode('  RU ')).toBe('ru');
    expect(normalizeLangCode('En-US')).toBe('en');
  });

  it('обрезает до базового подтега', () => {
    expect(normalizeLangCode('ru-RU')).toBe('ru');
    expect(normalizeLangCode('zh-hans-cn')).toBe('zh');
  });

  it('пустое и undefined → пустая строка', () => {
    expect(normalizeLangCode('')).toBe('');
    expect(normalizeLangCode(undefined)).toBe('');
    expect(normalizeLangCode(null)).toBe('');
  });
});

describe('pickLangBranch', () => {
  it('ru-RU при codes [ru, en] → ru (исходное написание из codes)', () => {
    expect(pickLangBranch(['ru', 'en'], 'ru-RU')).toBe('ru');
  });

  it('возвращает код как написал автор, даже в другом регистре', () => {
    expect(pickLangBranch(['RU', 'EN'], 'ru-ru')).toBe('RU');
  });

  it('неперечисленный язык → fallback', () => {
    expect(pickLangBranch(['ru', 'en'], 'de')).toBe('fallback');
  });

  it('codes undefined или пустой → fallback', () => {
    expect(pickLangBranch(undefined, 'ru')).toBe('fallback');
    expect(pickLangBranch([], 'ru')).toBe('fallback');
  });

  it('пустой/битый langCode → fallback', () => {
    expect(pickLangBranch(['ru'], '')).toBe('fallback');
    expect(pickLangBranch(['ru'], undefined)).toBe('fallback');
  });
});
