// Контракт платформенной матрицы (shared/platform.ts): состав TG-only блоков
// и поведение blockSupportedOn. Изменение списка — осознанная правка контракта:
// тест фиксирует текущий состав, чтобы расширение VK не разъехалось молча
// между воркером (validate/publish) и вебом (палитра).
import { describe, it, expect } from 'vitest';
import { TELEGRAM_ONLY_BLOCKS, blockSupportedOn, VK_UNSUPPORTED_MEDIA_TYPES, isPlatform, DEFAULT_PLATFORM } from '../shared/platform';
import { BLOCK_TYPES } from '../shared/validate';

describe('shared/platform: матрица платформ', () => {
  it('TELEGRAM_ONLY_BLOCKS — только известные типы блоков', () => {
    for (const t of TELEGRAM_ONLY_BLOCKS) {
      expect(BLOCK_TYPES, `TG-only тип ${t} отсутствует в BLOCK_TYPES`).toContain(t);
    }
  });

  it('весь TG-only список уникален', () => {
    expect(TELEGRAM_ONLY_BLOCKS.size).toBe([...TELEGRAM_ONLY_BLOCKS].length);
  });

  it('кроссплатформенное ядро не пустое: старт/сообщение/кнопки/ввод/условия доступны VK', () => {
    for (const t of ['start', 'message', 'buttons', 'input', 'condition', 'command', 'data', 'tag', 'wait', 'schedule', 'http', 'ai'] as const) {
      expect(blockSupportedOn(t, 'vk'), `${t} обязан работать на VK`).toBe(true);
    }
  });

  it('платёжные и Telegram-специфичные блоки недоступны VK', () => {
    for (const t of ['invoice', 'web_app', 'poll', 'quiz', 'location', 'contact', 'channel_check', 'referral', 'language'] as const) {
      expect(blockSupportedOn(t, 'vk'), `${t} не должен работать на VK`).toBe(false);
    }
  });

  it('медиа/forward/edit/delete/платёжные ссылки — доступны VK (итерация 2026-10-30)', () => {
    for (const t of ['media', 'media_group', 'forward', 'edit_message', 'delete_message', 'payment_link', 'payment_check'] as const) {
      expect(blockSupportedOn(t, 'vk'), `${t} обязан работать на VK`).toBe(true);
    }
  });

  it('VK_UNSUPPORTED_MEDIA_TYPES: видео недоступно, фото/документы доступны', () => {
    expect(VK_UNSUPPORTED_MEDIA_TYPES.has('video')).toBe(true);
    expect(VK_UNSUPPORTED_MEDIA_TYPES.has('photo')).toBe(false);
    expect(VK_UNSUPPORTED_MEDIA_TYPES.has('document')).toBe(false);
  });

  it('Telegram поддерживает всё', () => {
    for (const t of BLOCK_TYPES) {
      expect(blockSupportedOn(t, 'telegram'), `${t} обязан работать на Telegram`).toBe(true);
    }
  });

  it('isPlatform распознаёт платформы и отклоняет мусор', () => {
    expect(isPlatform('telegram')).toBe(true);
    expect(isPlatform('vk')).toBe(true);
    expect(isPlatform('whatsapp')).toBe(false);
    expect(isPlatform(undefined)).toBe(false);
    expect(isPlatform('')).toBe(false);
  });

  it('дефолтная платформа — telegram', () => {
    expect(DEFAULT_PLATFORM).toBe('telegram');
  });
});
