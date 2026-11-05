// Платформенная матрица блоков: единый источник для воркера (валидация publish)
// и веба (палитра, инспектор). Telegram — базовая платформа: всё, что не
// помечено TG-only, считается кроссплатформенным и исполняется движком как
// обычно (аутс движка мапятся адаптером платформы на вызовы API).
import type { BlockType } from './types';

export type Platform = 'telegram' | 'vk';

export function isPlatform(v: unknown): v is Platform {
  return v === 'telegram' || v === 'vk';
}

export const DEFAULT_PLATFORM: Platform = 'telegram';

// Блоки, у которых нет VK-эквивалента. Каждый пункт — осознанное
// решение, а не «на всякий случай»:
// - invoice — нативный счёт Telegram Payments. На VK платежи идут через
//   внешних провайдеров: payment_link / payment_check РАЗБЛОКИРОВАНЫ
//   (yookassa/robokassa/stripe/custom — ссылка уходит кнопкой-сообщением).
//   VK Pay нативно недоступен (требует договор с VK и mini-app).
// - web_app, mini-приложения — нет аналога в VK.
// - poll/quiz — sendPoll не имеет аналога messages.send (VK-опросы недоступны ботам).
// - media/media_group — фото и документы загружаются upload-цепочкой VK
//   (пробы 29.10: photos.getMessagesUploadServer работает с ключом
//   сообщества). ВИДЕО ключом сообщества загрузить нельзя (video.save —
//   user-token only) — video-подтип блокируется отдельной проверкой в
//   validate.ts (VK_UNSUPPORTED_MEDIA_TYPES).
// - forward — поддержан: messages.send с параметром forward (JSON).
// - edit_message/delete_message — РАЗБЛОКИРОВАНЫ: messages.edit (cmid) и
//   messages.delete (cmids, delete_for_all) работают для сообщений бота;
//   ветки ошибок (too_old=909, not_found) маппятся в dispatchOuts.
// - location/contact — request_location/request_contact — механика Telegram-клавиатур.
// - channel_check — getChatMember (Telegram-каналы).
// - referral (ссылка) — t.me/<bot>?start=…; VK-ссылки соберём позже (vk.me).
//   Учёт/бонусы/статистика реферальной системы (referral_track и далее) —
//   работают, это D1-логика без Telegram-привязки.
// - language — language_code есть у TG-апдейта; VK не сообщает язык юзера.
export const TELEGRAM_ONLY_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>([
  'invoice',
  'web_app',
  'poll',
  'quiz',
  'location',
  'contact',
  'channel_check',
  'referral',
  'language',
]);

// Подтипы media/media_group, не поддержанные на VK. Валидация ругается
// отдельно от платформенной матрицы, чтобы автору было видно, что блок
// вообще-то работает — только не с этим типом файла.
export const VK_UNSUPPORTED_MEDIA_TYPES: ReadonlySet<string> = new Set(['video']);

// Поддержан ли блок на платформе. Telegram поддерживает всё (это базовая
// платформа конструктора) — функция остаётся единой точкой истины для воркера и веба.
export function blockSupportedOn(type: BlockType, platform: Platform): boolean {
  if (platform === 'telegram') return true;
  return !TELEGRAM_ONLY_BLOCKS.has(type);
}
