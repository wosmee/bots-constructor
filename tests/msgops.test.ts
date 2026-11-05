// msgops (edit_message / delete_message): разбор цели из переменной и
// классификация ошибок Telegram. Форма { chatId, messageId } — та, что кладёт
// воркер в {{__bot_msg}} (rememberBotMsg, worker/src/index.ts).
import { describe, expect, it } from 'vitest';

import { resolveMsgRef, isTooOldError } from '../worker/src/blocks/msgops/runtime';
import { BOT_MSG_VAR } from '../shared/types';

describe('resolveMsgRef', () => {
  it('объект { chatId, messageId } из {{__bot_msg}}', () => {
    const vars = { [BOT_MSG_VAR]: { chatId: 111, messageId: 222 } };
    expect(resolveMsgRef(vars, undefined, 999)).toEqual({ chatId: 111, messageId: 222 });
  });

  it('объект { chat_id, message_id }', () => {
    const vars = { [BOT_MSG_VAR]: { chat_id: 111, message_id: 222 } };
    expect(resolveMsgRef(vars, undefined, null)).toEqual({ chatId: 111, messageId: 222 });
  });

  it('своя переменная (msgRefVar) вместо __bot_msg', () => {
    const vars = { saved: { chatId: 5, messageId: 7 }, [BOT_MSG_VAR]: { chatId: 1, messageId: 2 } };
    expect(resolveMsgRef(vars, 'saved', null)).toEqual({ chatId: 5, messageId: 7 });
  });

  it('число = message_id, chatId из fallback', () => {
    expect(resolveMsgRef({ [BOT_MSG_VAR]: 42 }, undefined, 999)).toEqual({ chatId: 999, messageId: 42 });
    // Числовая строка — то же самое (переменные часто живут строками).
    expect(resolveMsgRef({ [BOT_MSG_VAR]: '42' }, undefined, 999)).toEqual({ chatId: 999, messageId: 42 });
  });

  it('число без fallback → null', () => {
    expect(resolveMsgRef({ [BOT_MSG_VAR]: 42 }, undefined, null)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: 42 }, undefined, undefined)).toBeNull();
  });

  it('JSON-строка объекта', () => {
    const vars = { [BOT_MSG_VAR]: '{"chatId":3,"messageId":8}' };
    expect(resolveMsgRef(vars, undefined, null)).toEqual({ chatId: 3, messageId: 8 });
    const snake = { [BOT_MSG_VAR]: '{"chat_id":"3","message_id":"8"}' };
    expect(resolveMsgRef(snake, undefined, null)).toEqual({ chatId: 3, messageId: 8 });
  });

  it('переменной нет → null', () => {
    expect(resolveMsgRef({}, undefined, 999)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: null }, undefined, 999)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: '' }, undefined, 999)).toBeNull();
  });

  it('мусор → null', () => {
    expect(resolveMsgRef({ [BOT_MSG_VAR]: 'abc' }, undefined, 999)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: '{битый json' }, undefined, 999)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: { chatId: 1 } }, undefined, null)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: { messageId: 1.5, chatId: 2 } }, undefined, null)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: NaN }, undefined, 999)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: true }, undefined, 999)).toBeNull();
    expect(resolveMsgRef({ [BOT_MSG_VAR]: [1, 2] }, undefined, 999)).toBeNull();
  });

  it('дробный fallback-chat → null', () => {
    expect(resolveMsgRef({ [BOT_MSG_VAR]: 42 }, undefined, 1.5)).toBeNull();
  });
});

describe('isTooOldError', () => {
  const texts = [
    "Bad Request: message can't be edited",
    'Bad Request: message to edit not found',
    'Bad Request: message is too old',
  ];

  it('три текста про возраст — форма тела Telegram { ok:false, description }', () => {
    for (const description of texts) {
      expect(isTooOldError({ ok: false, error_code: 400, description })).toBe(true);
    }
  });

  it('те же тексты — форма Error с message', () => {
    for (const t of texts) {
      expect(isTooOldError(new Error(t))).toBe(true);
    }
  });

  it('регистр не важен', () => {
    expect(isTooOldError({ ok: false, error_code: 400, description: 'MESSAGE IS TOO OLD' })).toBe(true);
    expect(isTooOldError(new Error("Message Can't Be Edited"))).toBe(true);
  });

  it('не возраст → false', () => {
    expect(isTooOldError({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' })).toBe(false);
    expect(isTooOldError({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })).toBe(false);
    expect(isTooOldError(new Error('fetch failed'))).toBe(false);
    expect(isTooOldError({ ok: false, description: 'message is not modified' })).toBe(false);
    expect(isTooOldError(null)).toBe(false);
    expect(isTooOldError(undefined)).toBe(false);
    expect(isTooOldError('message is too old')).toBe(false);
    expect(isTooOldError({ ok: true, description: "message can't be edited" })).toBe(false);
  });
});
