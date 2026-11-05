// Тесты runtime блока ai_classify: промпт классификатора и разбор ответа.
import { describe, it, expect } from 'vitest';
import { buildClassifyPrompt, parseClassifyAnswer } from '../worker/src/blocks/aiclassify/runtime';

describe('buildClassifyPrompt', () => {
  it('содержит роль, все метки, контекст и вход как есть', () => {
    const p = buildClassifyPrompt(['спам', 'вопрос', 'other'], 'поддержка магазина', 'где мой заказ?');
    expect(p).toContain('классификатор');
    expect(p).toContain('1. спам');
    expect(p).toContain('2. вопрос');
    expect(p).toContain('3. other');
    expect(p).toContain('поддержка магазина');
    expect(p).toContain('где мой заказ?');
    expect(p).toContain('ОДНИМ словом');
  });

  it('пустой контекст не добавляет секцию', () => {
    const p = buildClassifyPrompt(['a'], '', 'текст');
    expect(p).not.toContain('Контекст задачи');
    expect(p).toContain('текст');
  });
});

describe('parseClassifyAnswer', () => {
  const labels = ['спам', 'вопрос', 'other'];

  it('точный ответ', () => {
    expect(parseClassifyAnswer('спам', labels, 'other')).toBe('спам');
  });

  it('ответ в другом регистре → метка как в labels', () => {
    expect(parseClassifyAnswer('СПАМ', labels, 'other')).toBe('спам');
    expect(parseClassifyAnswer('Other', labels, 'other')).toBe('other');
  });

  it('ответ с префиксом «Метка:»', () => {
    expect(parseClassifyAnswer('Метка: спам', labels, 'other')).toBe('спам');
    expect(parseClassifyAnswer('Метка: "вопрос".', labels, 'other')).toBe('вопрос');
  });

  it('лишние слова, но метка одна целиком словом', () => {
    expect(parseClassifyAnswer('это явно спам', labels, 'other')).toBe('спам');
    expect(parseClassifyAnswer('категория: вопрос, думаю', labels, 'other')).toBe('вопрос');
  });

  it('подстрока метки не считается совпадением', () => {
    expect(parseClassifyAnswer('спаммер пишет', labels, 'other')).toBe('other');
  });

  it('неразборчивый ответ → fallback', () => {
    expect(parseClassifyAnswer('не могу решить, сложно', labels, 'other')).toBe('other');
  });

  it('пустой ответ → fallback', () => {
    expect(parseClassifyAnswer('', labels, 'other')).toBe('other');
    expect(parseClassifyAnswer('   ', labels, 'other')).toBe('other');
  });

  it('две метки в ответе → fallback, не угадываем', () => {
    expect(parseClassifyAnswer('спам или вопрос', labels, 'other')).toBe('other');
  });

  it('кавычки и точки вокруг ответа', () => {
    expect(parseClassifyAnswer('"спам".', labels, 'other')).toBe('спам');
  });

  it('свой fallbackLabel уважается', () => {
    expect(parseClassifyAnswer('мусор', labels, 'неясно')).toBe('неясно');
  });

  it('пустой список меток → fallback', () => {
    expect(parseClassifyAnswer('спам', [], 'other')).toBe('other');
  });
});
