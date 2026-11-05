// AI-генерация и избранное мини-аппов (фаза C/D).
import { describe, expect, it, vi, afterEach } from 'vitest';

// mediaPut ходит в S3 через AWS SDK (не fetch) — мокаем модуль целиком.
const mediaPutMock = vi.fn(async () => {});
vi.mock('../worker/src/media', () => ({
  mediaPut: (...a: unknown[]) => mediaPutMock(...a),
  mediaKey: (botId: string, ext: string) => `${botId}/00000000-0000-4000-8000-000000000000.${ext}`,
}));

import { generateMiniImage, toggleFavorite } from '../worker/src/miniapp/ai';

const ENV = {
  TOOKEN_IMAGE_API_KEY: 'k',
  TOOKEN_IMAGE_BASE_URL: 'https://img.example/v1',
  TOOKEN_IMAGE_MODEL: 'gpt-image-2',
  FILEBASE_KEY: 'fk',
  FILEBASE_SECRET: 'fs',
};

// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockImageApi(status = 200, body: unknown = { data: [{ b64_json: PNG_B64 }] }) {
  const fetchSpy = vi.fn(async () => {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
  mediaPutMock.mockClear();
  return { fetchSpy };
}

describe('toggleFavorite', () => {
  it('добавляет новый id в конец', () => {
    expect(toggleFavorite('a,b', 'c')).toBe('a,b,c');
  });
  it('убирает существующий', () => {
    expect(toggleFavorite('a,b,c', 'b')).toBe('a,c');
  });
  it('не плодит дубликаты и чистит мусор', () => {
    // 'a' существует → toggle убирает его, мусор вычищается
    expect(toggleFavorite('a, a ,b,,', 'a')).toBe('b');
    // 'b' новый → добавляется, дубликат 'a' схлопывается
    expect(toggleFavorite('a,a', 'b')).toBe('a,b');
  });
  it('пустой itemId не меняет список', () => {
    expect(toggleFavorite('a,b', '')).toBe('a,b');
    expect(toggleFavorite('a,b', '  ')).toBe('a,b');
  });
  it('детерминированный порядок', () => {
    // toggle('x','y') = 'x,y'; toggle('x,y','x') убирает x → 'y'
    expect(toggleFavorite(toggleFavorite('x', 'y'), 'x')).toBe('y');
    // повторный toggle возвращает обратно
    expect(toggleFavorite(toggleFavorite(toggleFavorite('x', 'y'), 'x'), 'x')).toBe('y,x');
  });
});

describe('generateMiniImage', () => {
  it('лимит срабатывает ДО сети', async () => {
    const { fetchSpy } = mockImageApi();
    const onCount = vi.fn(async () => 21);
    await expect(
      generateMiniImage(ENV as any, { botId: 'b', userId: 1, prompt: 'x', onCount, limit: 20 })
    ).rejects.toThrow('ai limit');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('count === limit не блокирует (порог >)', async () => {
    mockImageApi();
    const onCount = vi.fn(async () => 20);
    const r = await generateMiniImage(ENV as any, { botId: 'b', userId: 1, prompt: 'x', onCount, limit: 20 });
    expect(r.url).toMatch(/^\/m\/img\/b\//);
  });

  it('нет ключей → ошибка без сети', async () => {
    const { fetchSpy } = mockImageApi();
    await expect(
      generateMiniImage({} as any, { botId: 'b', userId: 1, prompt: 'x', onCount: async () => 1, limit: 20 })
    ).rejects.toThrow('ai not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('успешный путь: b64 → Filebase → /m/img/...', async () => {
    const { fetchSpy } = mockImageApi();
    const r = await generateMiniImage(ENV as any, { botId: 'b', userId: 1, prompt: 'кот', onCount: async () => 1, limit: 20 });
    expect(r.url).toMatch(/^\/m\/img\/b\/[a-f0-9-]{36}\.png$/);
    // первый fetch — images/generations с промптом
    const first = fetchSpy.mock.calls[0];
    expect(String(first[0])).toContain('/images/generations');
    expect(JSON.parse((first[1] as any).body).prompt).toBe('кот');
    // байты ушли в mediaPut
    expect(mediaPutMock).toHaveBeenCalledTimes(1);
    const putArgs = mediaPutMock.mock.calls[0] as any[];
    expect(putArgs[1]).toMatch(/^b\/.*\.png$/);
    expect(putArgs[3]).toBe('image/png');
    expect(putArgs[2]).toBeInstanceOf(Uint8Array);
  });

  it('апстрим 500 → ошибка с кодом', async () => {
    mockImageApi(500, { error: 'boom' });
    await expect(
      generateMiniImage(ENV as any, { botId: 'b', userId: 1, prompt: 'x', onCount: async () => 1, limit: 20 })
    ).rejects.toThrow(/ai upstream 500/);
  });

  it('апстрим без b64_json → ошибка', async () => {
    mockImageApi(200, { data: [{}] });
    await expect(
      generateMiniImage(ENV as any, { botId: 'b', userId: 1, prompt: 'x', onCount: async () => 1, limit: 20 })
    ).rejects.toThrow('no image data');
  });
});
