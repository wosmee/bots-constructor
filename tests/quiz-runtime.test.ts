// Тесты runtime викторины: ветка passed только при единственном верном ответе.
import { describe, it, expect } from 'vitest';
import { evaluateQuizAnswer, findCorrectIndex } from '../worker/src/blocks/quiz/runtime';

const options = [
  { id: 'a', text: 'Москва' },
  { id: 'b', text: 'Питер' },
  { id: 'c', text: 'Казань' },
];

describe('findCorrectIndex', () => {
  it('находит индекс опции по id', () => {
    expect(findCorrectIndex(options, 'b')).toBe(1);
  });

  it('возвращает -1 для неизвестного id', () => {
    expect(findCorrectIndex(options, 'zz')).toBe(-1);
  });

  it('возвращает -1 на пустом/битом входе', () => {
    expect(findCorrectIndex(undefined as any, 'a')).toBe(-1);
    expect(findCorrectIndex(options, '')).toBe(-1);
  });
});

describe('evaluateQuizAnswer', () => {
  it('passed при единственном верном индексе', () => {
    expect(evaluateQuizAnswer(options, 'b', [1])).toBe('passed');
  });

  it('failed при чужом индексе', () => {
    expect(evaluateQuizAnswer(options, 'b', [0])).toBe('failed');
  });

  it('failed при пустом ответе', () => {
    expect(evaluateQuizAnswer(options, 'b', [])).toBe('failed');
  });

  it('failed при нескольких выбранных (мультивыбор не проходит)', () => {
    expect(evaluateQuizAnswer(options, 'b', [1, 2])).toBe('failed');
  });

  it('failed при неизвестном correctOptionId', () => {
    expect(evaluateQuizAnswer(options, 'nope', [0])).toBe('failed');
    expect(evaluateQuizAnswer(options, 'nope', [])).toBe('failed');
  });

  it('failed на некорректных optionIds', () => {
    expect(evaluateQuizAnswer(options, 'b', undefined as any)).toBe('failed');
    expect(evaluateQuizAnswer(options, 'b', null as any)).toBe('failed');
  });
});
