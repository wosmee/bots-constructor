// Пользовательские тексты для новых кодов валидатора (F5). Коды стали
// блокирующими, значит у каждого должна быть человеческая формулировка — иначе
// в английском интерфейсе человек увидит заглушку «Check this block configuration».
import { describe, expect, it } from 'vitest';
import { validationIssueMessage } from '../web/src/journey';

const NEW_CODES = [
  'btn-branch',
  'cond-then',
  'cond-else',
  'switch-branch',
  'inv-paid',
  'inv-cancelled',
  'data-found',
  'data-notfound',
  'kw-miss',
  'kw-hit',
  // F2/F3: теги и цепочка.
  'tag-name',
  'tag-outvar',
  'cond-tag-op',
  'chain-empty',
  'chain-media',
  'chain-text',
];

describe('сообщения валидатора', () => {
  it('у каждого нового кода есть английская формулировка', () => {
    for (const code of NEW_CODES) {
      const en = validationIssueMessage({ code, message: 'русский текст' }, 'en');
      expect(en, code).not.toBe('Check this block configuration');
      expect(en.length, code).toBeGreaterThan(10);
    }
  });

  it('в русском интерфейсе используется текст самого валидатора', () => {
    for (const code of NEW_CODES) {
      expect(validationIssueMessage({ code, message: 'русский текст' }, 'ru')).toBe('русский текст');
    }
  });
});
