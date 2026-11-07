// Серверный рантайм мини-аппов: initData-валидация по алгоритму Telegram,
// контекст юзера из БД, access-правила, видимость элементов и интерполяция.
//
// Покрытие:
//  - parseAndValidateInitData: корректная подпись проходит (hash считаем
//    независимо через crypto.subtle, как в payments.test.ts), битый hash /
//    чужой токен / auth_date старше суток / мусор вместо пар — отклоняются;
//  - buildContext: теги и переменные из существующих функций db.ts
//    (listUserTags/getClient) на фейковом D1, фолбэк имени на профиль сессии;
//  - checkAccess: все три вида правил + неизвестное правило = доступ закрыт;
//  - evalVisible: ==, !=, contains, empty/not_empty, in, >= на числах-строках;
//    источники user.*, tag:, var:, field: (с row и без); неизвестный префикс;
//  - interpolate: подстановка {user.*}, отсутствие username -> '',
//    неизвестный {ключ} остаётся как есть (зафиксированное поведение);
//  - filterVisibleElements: элементы без условия видимы всегда.
import { describe, it, expect } from 'vitest';
import {
  parseAndValidateInitData,
  buildContext,
  checkAccess,
  evalVisible,
  filterVisibleElements,
  interpolate,
  resolveRef,
} from '../worker/src/miniapp/runtime';
import type { MiniContext, MiniElement } from '../shared/miniapp';
import { miniElement } from '../shared/miniapp';

// ------------------------------------------------------------------ initData

const BOT_TOKEN = '123456789:AAF-test-token-miniapp';
const enc = new TextEncoder();

// Независимая реализация HMAC-SHA256 через WebCrypto — для known-answer.
async function hmacHex(secretBytes: Uint8Array | string, data: string): Promise<string> {
  const raw = typeof secretBytes === 'string' ? enc.encode(secretBytes) : secretBytes;
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Собирает initData по алгоритму Telegram: data_check_string из ДЕКОДИРОВАННЫХ
// пар, сортировка по ключу, склейка "\n"; в query-строку значения уходят
// encodeURIComponent-ом.
async function makeInitData(
  fields: Record<string, string>,
  token = BOT_TOKEN
): Promise<string> {
  const entries = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await (async () => {
    const k = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(token)));
  })();
  const hash = await hmacHex(secret, dataCheckString);
  const qs = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${qs}&hash=${hash}`;
}

const USER_JSON = JSON.stringify({ id: 424242, first_name: 'Иван', last_name: 'В', username: 'ivan_v' });

function freshAuthDate(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('parseAndValidateInitData', () => {
  it('корректная подпись проходит: userId, имя (first+last), username', async () => {
    const initData = await makeInitData({
      query_id: 'AAH-test',
      user: USER_JSON,
      auth_date: freshAuthDate(),
    });
    const res = await parseAndValidateInitData(initData, BOT_TOKEN);
    expect(res).toEqual({ userId: 424242, name: 'Иван В', username: 'ivan_v' });
  });

  it('без username — null, имя из first_name', async () => {
    const initData = await makeInitData({
      user: JSON.stringify({ id: 7, first_name: 'Настя' }),
      auth_date: freshAuthDate(),
    });
    const res = await parseAndValidateInitData(initData, BOT_TOKEN);
    expect(res).toEqual({ userId: 7, name: 'Настя', username: null });
  });

  it('битый hash отклоняется', async () => {
    const initData = await makeInitData({ user: USER_JSON, auth_date: freshAuthDate() });
    const broken = initData.replace(/hash=[0-9a-f]+$/, 'hash=' + '0'.repeat(64));
    expect(await parseAndValidateInitData(broken, BOT_TOKEN)).toBeNull();
  });

  it('подпись под чужим токеном отклоняется', async () => {
    const initData = await makeInitData({ user: USER_JSON, auth_date: freshAuthDate() }, '999:wrong-token');
    expect(await parseAndValidateInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it('auth_date старше 24 часов отклоняется даже с верной подписью', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 25 * 3600);
    const initData = await makeInitData({ user: USER_JSON, auth_date: old });
    expect(await parseAndValidateInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it('ровно на границе суток — ещё проходит', async () => {
    const authDate = Math.floor(Date.now() / 1000) - 23 * 3600;
    const initData = await makeInitData({ user: USER_JSON, auth_date: String(authDate) });
    // now фиксируем: без этого тест зависел бы от момента вызова Date.now().
    expect(await parseAndValidateInitData(initData, BOT_TOKEN, authDate * 1000 + 23 * 3600 * 1000)).toBeTruthy();
  });

  it('мусор вместо пар отклоняется', async () => {
    expect(await parseAndValidateInitData('!!!не-init-data&&&', BOT_TOKEN)).toBeNull();
    expect(await parseAndValidateInitData('', BOT_TOKEN)).toBeNull();
    // Подпись есть, но посчитана для других полей — подмена пары не проходит.
    const initData = await makeInitData({ user: USER_JSON, auth_date: freshAuthDate() });
    const tampered = initData.replace(/user=[^&]+/, `user=${encodeURIComponent(JSON.stringify({ id: 1, first_name: 'хакер' }))}`);
    expect(await parseAndValidateInitData(tampered, BOT_TOKEN)).toBeNull();
  });

  it('верная подпись без поля user — null (анонимный initData)', async () => {
    const initData = await makeInitData({ auth_date: freshAuthDate() });
    expect(await parseAndValidateInitData(initData, BOT_TOKEN)).toBeNull();
  });
});

// ------------------------------------------------------------------ контекст

// Фейковый D1 в стиле admin-user-lookup.test.ts: только то, что читают
// listUserTags (SELECT tag FROM user_tags) и getClient (FROM sessions).
const TAG_ROWS = [{ tag: 'vip' }, { tag: 'рассылка' }];
const CLIENT_ROW = {
  user_id: 424242,
  first_name: 'Иван',
  username: 'ivan_v',
  first_seen: 1,
  updated_at: 2,
  current_block: null,
  vars_json: JSON.stringify({ город: 'Москва', баланс: 100, пусто: null }),
};

function makeDb() {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async all<T>() {
              if (sql.includes('FROM user_tags')) return { results: TAG_ROWS } as { results: T[] };
              return { results: [] } as { results: T[] };
            },
            async first<T>() {
              if (sql.includes('FROM sessions')) return CLIENT_ROW as T;
              return null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('buildContext', () => {
  it('теги и переменные берутся из БД, значения приводятся к строке', async () => {
    const ctx = await buildContext(makeDb(), 'bot-1', 424242, 'Иван В', 'ivan_v');
    expect(ctx).toEqual({
      userId: 424242,
      name: 'Иван В',
      username: 'ivan_v',
      tags: ['vip', 'рассылка'],
      vars: { город: 'Москва', баланс: '100', пусто: '' },
    });
  });

  it('пустое имя из initData — фолбэк на профиль сессии', async () => {
    const ctx = await buildContext(makeDb(), 'bot-1', 424242, '', null);
    expect(ctx.name).toBe('Иван');
    expect(ctx.username).toBe('ivan_v');
  });
});

// ------------------------------------------------------------------ доступ

const CTX: MiniContext = {
  userId: 424242,
  name: 'Иван',
  username: 'ivan_v',
  tags: ['vip', 'рассылка'],
  vars: { город: 'Москва', заказов: '12' },
};

describe('checkAccess', () => {
  it('all — пускает всех', () => {
    expect(checkAccess({ kind: 'all' }, CTX)).toBe(true);
  });

  it('tag — по наличию тега, регистр не важен', () => {
    expect(checkAccess({ kind: 'tag', tag: 'vip' }, CTX)).toBe(true);
    expect(checkAccess({ kind: 'tag', tag: '  VIP ' }, CTX)).toBe(true);
    expect(checkAccess({ kind: 'tag', tag: 'нет-такого' }, CTX)).toBe(false);
    expect(checkAccess({ kind: 'tag', tag: '' }, CTX)).toBe(false);
  });

  it('users — по вхождению userId', () => {
    expect(checkAccess({ kind: 'users', ids: [1, 424242] }, CTX)).toBe(true);
    expect(checkAccess({ kind: 'users', ids: [1, 2] }, CTX)).toBe(false);
    expect(checkAccess({ kind: 'users', ids: [] }, CTX)).toBe(false);
  });

  it('неизвестное правило — доступ закрыт', () => {
    expect(checkAccess({ kind: 'magic' } as any, CTX)).toBe(false);
  });
});

// ------------------------------------------------------------------ видимость

const when = (left: string, op: any, right: string) => ({ left, op, right });

describe('evalVisible', () => {
  it('null/undefined условие — элемент видим', () => {
    expect(evalVisible(null, CTX)).toBe(true);
    expect(evalVisible(undefined, CTX)).toBe(true);
  });

  it('== и != по литералу', () => {
    expect(evalVisible(when('var:город', '==', 'Москва'), CTX)).toBe(true);
    expect(evalVisible(when('var:город', '==', 'Питер'), CTX)).toBe(false);
    expect(evalVisible(when('var:город', '!=', 'Питер'), CTX)).toBe(true);
  });

  it('contains по переменной юзера', () => {
    expect(evalVisible(when('var:город', 'contains', 'оск'), CTX)).toBe(true);
    expect(evalVisible(when('var:город', 'contains', 'твер'), CTX)).toBe(false);
  });

  it('empty / not_empty: тег есть -> "1", нет -> ""', () => {
    expect(evalVisible(when('tag:vip', 'not_empty', ''), CTX)).toBe(true);
    expect(evalVisible(when('tag:vip', 'empty', ''), CTX)).toBe(false);
    expect(evalVisible(when('tag:нет-такого', 'empty', ''), CTX)).toBe(true);
    expect(evalVisible(when('tag:нет-такого', 'not_empty', ''), CTX)).toBe(false);
    expect(evalVisible(when('tag:vip', '==', '1'), CTX)).toBe(true);
  });

  it('in — список через запятую, регистр и пробелы не важны', () => {
    expect(evalVisible(when('var:город', 'in', 'Питер, москва , Казань'), CTX)).toBe(true);
    expect(evalVisible(when('var:город', 'in', 'Питер, Казань'), CTX)).toBe(false);
    expect(evalVisible(when('var:город', 'not_in', 'Питер, Казань'), CTX)).toBe(true);
  });

  it('>= на числах-строках: «12» >= «9» числовым сравнением', () => {
    expect(evalVisible(when('var:заказов', '>=', '9'), CTX)).toBe(true);
    expect(evalVisible(when('var:заказов', '>=', '13'), CTX)).toBe(false);
  });

  it('user.* источники', () => {
    expect(evalVisible(when('user.id', '==', '424242'), CTX)).toBe(true);
    expect(evalVisible(when('user.name', '==', 'Иван'), CTX)).toBe(true);
    expect(evalVisible(when('user.username', 'starts_with', 'ivan'), CTX)).toBe(true);
    // username === null резолвится в '' — пустой, а не «null».
    const noUser = { ...CTX, username: null };
    expect(evalVisible(when('user.username', 'empty', ''), noUser)).toBe(true);
  });

  it('field: — из строки/карточки; без row пустой', () => {
    const row = { цена: '1500', название: 'Маникюр' };
    expect(evalVisible(when('field:цена', '>=', '1000'), CTX, row)).toBe(true);
    expect(evalVisible(when('field:название', 'contains', 'Мани'), CTX, row)).toBe(true);
    expect(evalVisible(when('field:цена', 'not_empty', ''), CTX, row)).toBe(true);
    // Без row поле пусто — не исключение.
    expect(evalVisible(when('field:цена', 'empty', ''), CTX)).toBe(true);
  });

  it('неизвестный префикс — пустая строка', () => {
    expect(resolveRef('nope:что-то', CTX)).toBe('');
    expect(evalVisible(when('nope:x', 'empty', ''), CTX)).toBe(true);
    // user.с-неизвестным-полем тоже пусто.
    expect(resolveRef('user.несуществует', CTX)).toBe('');
  });

  it('правая часть может быть ссылкой: field vs var', () => {
    const row = { город: 'Москва' };
    expect(evalVisible(when('field:город', '==', 'var:город'), CTX, row)).toBe(true);
    expect(evalVisible(when('field:город', '==', 'user.name'), CTX, row)).toBe(false);
  });
});

describe('filterVisibleElements', () => {
  const el = (id: string, visibleWhen?: any): MiniElement => {
    const e = miniElement('text', id);
    return { ...e, visible_when: visibleWhen ?? null };
  };

  it('оставляет видимые, режет скрытые, без условия — всегда видим', () => {
    const els = [
      el('plain'),
      el('vip-only', when('tag:vip', 'not_empty', '')),
      el('guests', when('tag:vip', 'empty', '')),
      el('msk', when('var:город', '==', 'Москва')),
      el('spb', when('var:город', '==', 'Питер')),
    ];
    expect(filterVisibleElements(els, CTX).map((e) => e.id)).toEqual(['plain', 'vip-only', 'msk']);
  });
});

// ------------------------------------------------------------------ интерполяция

describe('interpolate', () => {
  it('подставляет {user.name}, {user.id}, {user.username}', () => {
    expect(interpolate('Привет, {user.name}! Твой id: {user.id}, ник: @{user.username}', CTX)).toBe(
      'Привет, Иван! Твой id: 424242, ник: @ivan_v'
    );
  });

  it('username === null подставляет пустую строку', () => {
    expect(interpolate('ник: @{user.username}', { ...CTX, username: null })).toBe('ник: @');
  });

  it('неизвестный {ключ} остаётся как есть — зафиксированное поведение', () => {
    expect(interpolate('Привет, {user.город} и {name}!', CTX)).toBe('Привет, {user.город} и {name}!');
  });

  it('пустой и undefined-текст — пустая строка', () => {
    expect(interpolate('', CTX)).toBe('');
    expect(interpolate(undefined as any, CTX)).toBe('');
  });

  it('теги и переменные НЕ подставляются: только user.*', () => {
    expect(interpolate('{tag:vip} {var:город}', CTX)).toBe('{tag:vip} {var:город}');
  });
});
