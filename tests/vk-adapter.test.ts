// VK-адаптер (worker/src/vk.ts): перевод исходящих Telegram-подобных payload
// в вызовы VK API и входящих событий VK в Telegram-форму. Чистые функции —
// тестируем без сети.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  translateOutgoing,
  vkKeyboard,
  vkMessageToTelegramUpdate,
  vkEventToTelegramUpdate,
  vkEventAnswerParams,
  vkExtractAttachments,
  vkCall,
  vkUploadDoc,
  vkUploadPhoto,
  vkDownloadMedia,
  VkApiError,
} from '../worker/src/vk';

afterEach(() => vi.unstubAllGlobals());

describe('F3-402: vkCall error-ветки и upload-цепочки', () => {
  it('vkCall: data.error → VkApiError с кодом и сообщением (токен не попадает в текст)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { error_code: 15, error_msg: 'Access denied' } }), { status: 200 })
    ));
    await expect(vkCall('messages.send', { peer_id: 1 }, 'SECRET-TOKEN')).rejects.toThrow('Access denied');
    try {
      await vkCall('wall.post', {}, 'SECRET-TOKEN');
    } catch (e) {
      expect(e).toBeInstanceOf(VkApiError);
      expect((e as VkApiError).code).toBe(15);
      expect(String((e as Error).message)).not.toContain('SECRET-TOKEN');
    }
  });

  it('vkCall: не-JSON ответ → пустой объект, не падение', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>err</html>', { status: 200 })));
    const r = await vkCall('groups.getById', {}, 'tok');
    expect(r).toEqual({});
  });

  it('vkUploadDoc: 901 на getMessagesUploadServer → VkApiError (вызывающий фолбэчит ссылкой)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { error_code: 901, error_msg: 'no docs permission' } }), { status: 200 })
    ));
    await expect(vkUploadDoc(new Uint8Array([1, 2]), 77, 'file.pdf', 'tok')).rejects.toThrow('901');
  });

  it('vkUploadDoc: полная цепочка (upload_url → multipart → docs.save → attachment)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes('docs.getMessagesUploadServer')) {
        return new Response(JSON.stringify({ response: { upload_url: 'https://pu.vk.com/upload' } }), { status: 200 });
      }
      if (u.includes('pu.vk.com/upload')) {
        return new Response(JSON.stringify({ file: 'f123' }), { status: 200 });
      }
      if (u.includes('docs.save')) {
        return new Response(JSON.stringify({ response: [{ owner_id: -500, id: 900, access_key: 'ak' }] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    const r = await vkUploadDoc(new Uint8Array([1, 2, 3]), 77, 'doc.pdf', 'tok');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.attachment).toBe('doc-500_900_ak');
  });

  it('vkUploadPhoto: пустой upload_url → отказ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ response: {} }), { status: 200 })));
    const r = await vkUploadPhoto(new Uint8Array([1]), 123, 'tok');
    expect(r.ok).toBe(false);
  });

  it('vkDownloadMedia (F3-113): blocked host (169.254.169.254) отклонён до fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await vkDownloadMedia('https://169.254.169.254/latest/meta-data/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('blocked host');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('vkDownloadMedia (F3-113): редирект на закрытый адрес не скачивается (redirect:manual)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('', { status: 302, headers: { location: 'https://10.0.0.5/inner' } })
    ));
    const r = await vkDownloadMedia('https://ok.example.com/img.jpg');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('blocked host');
  });

  it('vkDownloadMedia: редирект на публичный адрес работает', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('ok.example.com')) {
        return new Response('', { status: 302, headers: { location: 'https://cdn.example.com/x.jpg' } });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }));
    const r = await vkDownloadMedia('https://ok.example.com/img.jpg');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bytes.byteLength).toBe(4);
      expect(r.type).toBe('image/jpeg');
    }
  });

  it('vkDownloadMedia: http (не https) отклонён', async () => {
    const r = await vkDownloadMedia('http://example.com/a.jpg');
    expect(r.ok).toBe(false);
  });
});

describe('translateOutgoing', () => {
  it('sendMessage → messages.send с peer_id, message, random_id', () => {
    const r = translateOutgoing('sendMessage', { chat_id: 123, text: 'привет' });
    expect(r).not.toBeNull();
    expect(r!.method).toBe('messages.send');
    expect(r!.params.peer_id).toBe(123);
    expect(r!.params.message).toBe('привет');
    expect(typeof r!.params.random_id).toBe('number');
  });

  it('sendMessage с inline-клавиатурой → keyboard JSON с callback-кнопками', () => {
    const r = translateOutgoing('sendMessage', {
      chat_id: 1,
      text: 'x',
      reply_markup: { inline_keyboard: [[{ text: 'ОК', callback_data: 'ok' }, { text: 'Ссылка', url: 'https://vk.com' }]] },
    });
    const kb = JSON.parse(String(r!.params.keyboard));
    expect(kb.inline).toBe(true);
    expect(kb.buttons[0][0].action.type).toBe('callback');
    expect(kb.buttons[0][0].action.payload).toBe('ok');
    expect(kb.buttons[0][1].action.type).toBe('open_link');
    expect(kb.buttons[0][1].action.link).toBe('https://vk.com');
  });

  it('reply-клавиатура → VK text-кнопки (одна строка inline)', () => {
    const r = translateOutgoing('sendMessage', {
      chat_id: 1,
      text: 'x',
      reply_markup: { keyboard: [[{ text: 'Да' }, { text: 'Нет' }]] },
    });
    const kb = JSON.parse(String(r!.params.keyboard));
    expect(kb.buttons[0][0].action).toEqual({ type: 'text', label: 'Да' });
    expect(kb.buttons[0][1].action).toEqual({ type: 'text', label: 'Нет' });
  });

  it('payload callback_data длиннее 255 байт обрезается', () => {
    const long = 'x'.repeat(300);
    const r = translateOutgoing('sendMessage', {
      chat_id: 1,
      text: 'x',
      reply_markup: { inline_keyboard: [[{ text: 'b', callback_data: long }]] },
    });
    const kb = JSON.parse(String(r!.params.keyboard));
    expect(kb.buttons[0][0].action.payload.length).toBeLessThanOrEqual(255);
  });

  it('editMessageText → messages.edit с conversation_message_id', () => {
    const r = translateOutgoing('editMessageText', { chat_id: 5, message_id: 42, text: 'новый' });
    expect(r!.method).toBe('messages.edit');
    expect(r!.params.peer_id).toBe(5);
    expect(r!.params.conversation_message_id).toBe(42);
    expect(r!.params.message).toBe('новый');
  });

  it('editMessageReplyMarkup (без текста) → messages.edit с пустым текстом и клавиатурой', () => {
    const r = translateOutgoing('editMessageReplyMarkup', {
      chat_id: 5,
      message_id: 42,
      reply_markup: { inline_keyboard: [[{ text: 'b', callback_data: 'v' }]] },
    });
    expect(r!.method).toBe('messages.edit');
    expect(r!.params.message).toBe('');
    expect(JSON.parse(String(r!.params.keyboard)).buttons.length).toBe(1);
  });

  it('deleteMessage → messages.delete с delete_for_all', () => {
    const r = translateOutgoing('deleteMessage', { chat_id: 7, message_id: 9 });
    expect(r!.method).toBe('messages.delete');
    expect(r!.params.cmids).toBe('9');
    expect(r!.params.delete_for_all).toBe(1);
  });

  it('sendChatAction → messages.setActivity typing', () => {
    const r = translateOutgoing('sendChatAction', { chat_id: 7 });
    expect(r!.method).toBe('messages.setActivity');
    expect(r!.params.type).toBe('typing');
  });

  it('sendPhoto с caption → текстовый фолбэк messages.send', () => {
    const r = translateOutgoing('sendPhoto', { chat_id: 7, caption: 'подпись' });
    expect(r).not.toBeNull();
    expect(r!.method).toBe('messages.send');
    expect(r!.params.message).toBe('подпись');
  });

  it('sendPhoto без caption → null (ничего не отправляем)', () => {
    expect(translateOutgoing('sendPhoto', { chat_id: 7, photo: 'url' })).toBeNull();
  });

  it('sendPhoto с https-URL (upload не удался — фолбэк ссылкой)', () => {
    const r = translateOutgoing('sendPhoto', { chat_id: 7, photo: 'https://cdn.example.com/img.jpg', caption: 'привет' });
    expect(r!.method).toBe('messages.send');
    expect(r!.params.message).toContain('https://cdn.example.com/img.jpg');
    expect(r!.params.message).toContain('привет');
  });

  it('sendPhoto с не-https URL → только caption, без ссылки', () => {
    const r = translateOutgoing('sendPhoto', { chat_id: 7, photo: 'http://insecure.com/img.jpg', caption: 'текст' });
    expect(r!.params.message).toBe('текст');
  });

  it('forwardMessage → messages.send с forward JSON (peer_id + conversation_message_ids)', () => {
    const r = translateOutgoing('forwardMessage', { chat_id: 100, from_chat_id: 77, message_id: 42 });
    expect(r!.method).toBe('messages.send');
    expect(r!.params.peer_id).toBe(100);
    const fwd = JSON.parse(String(r!.params.forward));
    expect(fwd.peer_id).toBe(77);
    expect(fwd.conversation_message_ids).toEqual([42]);
    expect(typeof r!.params.random_id).toBe('number');
  });

  it('copyMessage → тот же forward-перевод (VK не различает копию и пересылку)', () => {
    const r = translateOutgoing('copyMessage', { chat_id: 100, from_chat_id: 77, message_id: 42 });
    expect(r!.method).toBe('messages.send');
    expect(JSON.parse(String(r!.params.forward)).conversation_message_ids).toEqual([42]);
  });

  it('editMessage (форма движка edit_message: chatId/messageId) → messages.edit с cmid', () => {
    const r = translateOutgoing('editMessage', { chatId: 5, messageId: 42, text: 'новый текст' });
    expect(r!.method).toBe('messages.edit');
    expect(r!.params.peer_id).toBe(5);
    expect(r!.params.cmid).toBe(42);
    expect(r!.params.message).toBe('новый текст');
  });

  it('deleteMessage (форма движка delete_message: chatId/messageId) → cmids из messageId', () => {
    const r = translateOutgoing('deleteMessage', { chatId: 7, messageId: 9 });
    expect(r!.method).toBe('messages.delete');
    expect(r!.params.peer_id).toBe(7);
    expect(r!.params.cmids).toBe('9');
    expect(r!.params.delete_for_all).toBe(1);
  });

  it('sendPoll без текста → null', () => {
    expect(translateOutgoing('sendPoll', { chat_id: 7, question: 'q' })).toBeNull();
  });

  it('каждый messages.send получает уникальный random_id', () => {
    const a = translateOutgoing('sendMessage', { chat_id: 1, text: 'a' });
    const b = translateOutgoing('sendMessage', { chat_id: 1, text: 'a' });
    expect(a!.params.random_id).not.toBe(b!.params.random_id);
  });

  it('vkKeyboard: пустая разметка → undefined', () => {
    expect(vkKeyboard(undefined)).toBeUndefined();
    expect(vkKeyboard({})).toBeUndefined();
  });
});

describe('входящие события VK → Telegram-форма', () => {
  it('message_new: from_id → from.id и chat.id, conversation_message_id → message_id', () => {
    const u = vkMessageToTelegramUpdate({ from_id: 77, peer_id: 77, conversation_message_id: 55, text: 'hi', date: 1700000000 });
    expect(u.message.from.id).toBe(77);
    expect(u.message.chat.id).toBe(77);
    expect(u.message.message_id).toBe(55);
    expect(u.message.text).toBe('hi');
  });

  it('message_new без текста: text = undefined (не пустая строка)', () => {
    const u = vkMessageToTelegramUpdate({ from_id: 1, conversation_message_id: 2 });
    expect(u.message.text).toBeUndefined();
  });

  it('message_new вложенной формы 5.131 (object.message): поля берутся из вложения', () => {
    const u = vkMessageToTelegramUpdate({ message: { from_id: 77, peer_id: 77, conversation_message_id: 55, text: 'hi', date: 1700000000 } });
    expect(u.message.from.id).toBe(77);
    expect(u.message.chat.id).toBe(77);
    expect(u.message.message_id).toBe(55);
    expect(u.message.text).toBe('hi');
  });

  it('message_event: payload → callback_query.data, event_id → id', () => {
    const u = vkEventToTelegramUpdate({ user_id: 9, conversation_message_id: 4, event_id: 'ev1', payload: 'ok' });
    expect(u.callback_query.id).toBe('ev1');
    expect(u.callback_query.from.id).toBe(9);
    expect(u.callback_query.data).toBe('ok');
    expect(u.callback_query.message.chat.id).toBe(9);
    expect(u.callback_query.message.message_id).toBe(4);
  });

  it('message_event с объектным payload сериализуется в строку', () => {
    const u = vkEventToTelegramUpdate({ user_id: 1, event_id: 'e', payload: { cmd: 'go' } });
    expect(u.callback_query.data).toBe(JSON.stringify({ cmd: 'go' }));
  });

  it('vkEventAnswerParams: event_id, user_id и tooltip', () => {
    const p = vkEventAnswerParams('ev9', 5, 'готово');
    expect(p.event_id).toBe('ev9');
    expect(p.user_id).toBe(5);
    expect(p.tooltip_text).toBe('готово');
    expect(p.peer_id).toBe(5);
  });

  it('vkEventAnswerParams без текста — без tooltip', () => {
    const p = vkEventAnswerParams('ev9', 5);
    expect(p.tooltip_text).toBeUndefined();
  });
});

describe('vkExtractAttachments: вложения входящих сообщений', () => {
  it('фото: берётся крупнейший размер (w > z > y > x)', () => {
    const r = vkExtractAttachments({
      attachments: [
        {
          type: 'photo',
          photo: {
            id: 1,
            sizes: [
              { type: 's', url: 'https://cdn/s.jpg' },
              { type: 'z', url: 'https://cdn/z.jpg' },
              { type: 'w', url: 'https://cdn/w.jpg' },
            ],
          },
        },
      ],
    });
    expect(r.photos).toEqual(['https://cdn/w.jpg']);
  });

  it('фото без w/z/y/x — берётся m', () => {
    const r = vkExtractAttachments({
      attachments: [{ type: 'photo', photo: { sizes: [{ type: 'm', url: 'https://cdn/m.jpg' }] } }],
    });
    expect(r.photos).toEqual(['https://cdn/m.jpg']);
  });

  it('geo.coordinates строкой «lat long» → { latitude, longitude }', () => {
    const r = vkExtractAttachments({ geo: { coordinates: '55.7558 37.6173' } });
    expect(r.geo).toEqual({ latitude: 55.7558, longitude: 37.6173 });
  });

  it('geo без координат — не падает', () => {
    const r = vkExtractAttachments({ geo: {} });
    expect(r.geo).toBeUndefined();
    expect(r.photos).toEqual([]);
  });
});
