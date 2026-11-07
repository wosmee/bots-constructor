// Smoke-тесты движка: runEngine — чистая функция, её дешевле всего покрыть.
// Сценарии собираются вручную, сеть и D1 не нужны.
// runEngine асинхронный с тех пор, как появился блок «Данные» (ходит в таблицы).
import { describe, it, expect, vi } from 'vitest';
import { runEngine, type SessionState, type DataOps, type TagOps } from '../worker/src/engine';
import { Scenario } from '../shared/types';

const msg = (text: string) => ({ message: { chat: { id: 1 }, from: { id: 1 }, text } });

async function run(scenario: Scenario, update: any, session: SessionState = { currentBlock: null, vars: {} }, data?: DataOps) {
  return runEngine({ scenario, update, session, ...(data ? { data } : {}) });
}

function scenarioOf(blocks: Scenario['blocks'], start = 's'): Scenario {
  return { version: 1, start, blocks };
}

describe('runEngine', () => {
  it('/start запускает сценарий и отправляет сообщение', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'привет' } },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs.length).toBe(1);
    expect(r.outs[0].method).toBe('sendMessage');
    expect(r.outs[0].payload.text).toBe('привет');
    expect(r.currentBlock).toBeNull();
  });

  it('подставляет переменные в текст сообщения', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'i' },
      i: { id: 'i', type: 'input', params: { prompt: 'имя?', var: 'name' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'привет, {{name}}' } },
    });
    // первый проход: блок input ждёт ответа
    const first = await run(sc, msg('/start'));
    expect(first.currentBlock).toBe('i');

    const second = await run(sc, msg('Иван'), { currentBlock: 'i', vars: first.vars });
    expect(second.outs.some((o) => o.payload.text === 'привет, Иван')).toBe(true);
  });

  it('кнопка уводит по своей ветке', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'b' },
      b: {
        id: 'b',
        type: 'buttons',
        params: { prompt: 'выбери', buttons: [{ label: 'да', value: 'yes' }, { label: 'нет', value: 'no' }] },
        branches: { yes: 'y', no: 'n' },
      },
      y: { id: 'y', type: 'message', params: { text: 'ок' } },
      n: { id: 'n', type: 'message', params: { text: 'нет' } },
    });
    const first = await run(sc, msg('/start'));
    expect(first.currentBlock).toBe('b');

    const cb = { callback_query: { id: '1', from: { id: 1 }, data: 'yes', message: { chat: { id: 1 } } } };
    const second = await run(sc, cb, { currentBlock: 'b', vars: first.vars });
    expect(second.outs.some((o) => o.payload.text === 'ок')).toBe(true);
  });

  it('условие выбирает then/else по значению переменной', async () => {
    // /start стирает vars (кроме ref.*), поэтому age задаём блоком setvar
    // с литералом — так тест честно проходит весь путь start → setvar → condition.
    const withAge = (expr: string) =>
      scenarioOf({
        s: { id: 's', type: 'start', params: {}, next: 'sv' },
        sv: { id: 'sv', type: 'setvar', params: { assignVar: 'age', expr }, next: 'c' },
        c: {
          id: 'c',
          type: 'condition',
          params: { condVar: 'age', op: '>', condValue: '18' },
          branches: { then: 'a', else: 'b' },
        },
        a: { id: 'a', type: 'message', params: { text: 'взрослый' } },
        b: { id: 'b', type: 'message', params: { text: 'несовершеннолетний' } },
      });

    const adult = await run(withAge('25'), msg('/start'));
    expect(adult.outs.some((o) => o.payload.text === 'взрослый')).toBe(true);

    const kid = await run(withAge('12'), msg('/start'));
    expect(kid.outs.some((o) => o.payload.text === 'несовершеннолетний')).toBe(true);
  });

  it('альбом из двух медиа уходит одним sendMediaGroup', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'g' },
      g: {
        id: 'g',
        type: 'media_group',
        params: { mediaItems: [{ type: 'photo', url: 'a.jpg' }, { type: 'photo', url: 'b.jpg' }] },
      },
    });
    const r = await run(sc, msg('/start'));
    const album = r.outs.find((o) => o.method === 'sendMediaGroup');
    expect(album).toBeTruthy();
    expect((album!.payload.media as unknown[]).length).toBe(2);
  });

  it('счёт выставляется и уходит в ветку «оплачено»', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'inv' },
      inv: {
        id: 'inv',
        type: 'invoice',
        params: { invoice: { title: 'Маникюр', description: 'запись', amount: 150000, currency: 'RUB', providerToken: 'tok' } },
        branches: { paid: 'ok', cancelled: 'no' },
      },
      ok: { id: 'ok', type: 'message', params: { text: 'оплачено' } },
      no: { id: 'no', type: 'message', params: { text: 'отменено' } },
    });
    const first = await run(sc, msg('/start'));
    expect(first.outs.some((o) => o.method === 'sendInvoice')).toBe(true);
    expect(first.currentBlock).toBe('inv');

    const paid = await run(sc, {
      message: { chat: { id: 1 }, from: { id: 1 }, successful_payment: { currency: 'RUB', total_amount: 150000 } },
    }, { currentBlock: 'inv', vars: first.vars });
    expect(paid.outs.some((o) => o.payload.text === 'оплачено')).toBe(true);
  });

  it('без provider_token счёт не выставляется: уходим в «отменено»', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'inv' },
      inv: {
        id: 'inv',
        type: 'invoice',
        params: { invoice: { title: 'x', description: 'y', amount: 100, currency: 'RUB' } },
        branches: { paid: 'ok', cancelled: 'no' },
      },
      ok: { id: 'ok', type: 'message', params: { text: 'оплачено' } },
      no: { id: 'no', type: 'message', params: { text: 'отменено' } },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs.some((o) => o.method === 'sendInvoice')).toBe(false);
    expect(r.outs.some((o) => o.payload.text === 'отменено')).toBe(true);
  });

  it('выключенный блок пропускается', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'off' },
      off: { id: 'off', type: 'message', params: { text: 'скрыто', disabled: true }, next: 'on' },
      on: { id: 'on', type: 'message', params: { text: 'видно' } },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs.some((o) => o.payload.text === 'скрыто')).toBe(false);
    expect(r.outs.some((o) => o.payload.text === 'видно')).toBe(true);
  });
});

// Валидация ответа на «Ввод»: kind number/email и regex. Проверяем переспрос
// (бот остаётся на блоке, переменная не пишется) и приём валидного значения.
describe('runEngine: валидация ответа блока «Ввод»', () => {
  function inputScenario(params: Record<string, unknown>): Scenario {
    return scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'i' },
      i: { id: 'i', type: 'input', params: { var: 'v', ...params }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'got {{v}}' } },
    });
  }

  it('number: NaN → переспрос, переменная не пишется', async () => {
    const sc = inputScenario({ kind: 'number' });
    const r = await run(sc, msg('abc'), { currentBlock: 'i', vars: {} });
    expect(r.currentBlock).toBe('i');
    expect(r.vars.v).toBeUndefined();
    expect(r.outs.some((o) => o.payload.text === 'Нужно число. Попробуйте ещё раз.')).toBe(true);
    expect(r.outs.some((o) => o.payload.text === 'got {{v}}' || o.payload.text === 'got abc')).toBe(false);
  });

  it('number: валидное число пишется как число', async () => {
    const sc = inputScenario({ kind: 'number' });
    const r = await run(sc, msg('42'), { currentBlock: 'i', vars: {} });
    expect(r.vars.v).toBe(42);
    expect(r.outs.some((o) => o.payload.text === 'got 42')).toBe(true);
    expect(r.currentBlock).toBeNull();
  });

  it('email: «не e-mail» → переспрос', async () => {
    const sc = inputScenario({ kind: 'email' });
    const r = await run(sc, msg('vasya собака gmail'), { currentBlock: 'i', vars: {} });
    expect(r.currentBlock).toBe('i');
    expect(r.vars.v).toBeUndefined();
    expect(r.outs.some((o) => o.payload.text === 'Похоже, это не e-mail. Попробуйте ещё раз.')).toBe(true);
  });

  it('email: валидный адрес принимается', async () => {
    const sc = inputScenario({ kind: 'email' });
    const r = await run(sc, msg('vasya@gmail.com'), { currentBlock: 'i', vars: {} });
    expect(r.vars.v).toBe('vasya@gmail.com');
    expect(r.outs.some((o) => o.payload.text === 'got vasya@gmail.com')).toBe(true);
  });

  it('email: errorText автора подменяет стандартный текст переспроса', async () => {
    const sc = inputScenario({ kind: 'email', errorText: 'Нужен настоящий e-mail!' });
    const r = await run(sc, msg('нет'), { currentBlock: 'i', vars: {} });
    expect(r.outs.some((o) => o.payload.text === 'Нужен настоящий e-mail!')).toBe(true);
    expect(r.currentBlock).toBe('i');
  });

  it('text без regex принимает что угодно (поведение не изменилось)', async () => {
    const sc = inputScenario({ kind: 'text' });
    const r = await run(sc, msg('любой текст'), { currentBlock: 'i', vars: {} });
    expect(r.vars.v).toBe('любой текст');
    expect(r.currentBlock).toBeNull();
  });

  it('regex: несовпадение → переспрос, совпадение → приём', async () => {
    const sc = inputScenario({ regex: '^\\d{4}$' });
    const bad = await run(sc, msg('12'), { currentBlock: 'i', vars: {} });
    expect(bad.currentBlock).toBe('i');
    expect(bad.outs.some((o) => o.payload.text === 'Не похоже на правильный формат. Попробуйте ещё раз.')).toBe(true);

    const good = await run(sc, msg('1234'), { currentBlock: 'i', vars: {} });
    expect(good.vars.v).toBe('1234');
    expect(good.currentBlock).toBeNull();
  });
});

// Блок «Данные»: таблицы бота. Проверяем на заглушке вместо D1 — важно, что
// движок сам не ходит в базу, а получает операции снаружи.
describe('runEngine: блок «Данные»', () => {
  function fakeOps(store: Record<string, unknown>[] = []): DataOps & { store: Record<string, unknown>[] } {
    const ops = {
      store,
      async add(_c: string, fields: Record<string, unknown>) {
        store.push({ ...fields });
        return 'id-1';
      },
      async find(_c: string, where: Record<string, unknown>) {
        return store.filter((row) =>
          Object.entries(where).every(([k, v]) => String(row[k] ?? '') === String(v ?? ''))
        );
      },
      async update(_c: string, where: Record<string, unknown>, patch: Record<string, unknown>) {
        let n = 0;
        for (const row of store) {
          if (Object.entries(where).every(([k, v]) => String(row[k] ?? '') === String(v ?? ''))) {
            Object.assign(row, patch);
            n++;
          }
        }
        return n;
      },
      async remove(_c: string, where: Record<string, unknown>) {
        const keep = store.filter(
          (row) => !Object.entries(where).every(([k, v]) => String(row[k] ?? '') === String(v ?? ''))
        );
        const n = store.length - keep.length;
        store.length = 0;
        store.push(...keep);
        return n;
      },
    };
    return ops;
  }

  it('add пишет запись и подставляет {{var}} в значения полей', async () => {
    const ops = fakeOps();
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'sv' },
      sv: { id: 'sv', type: 'setvar', params: { assignVar: 'name', expr: 'Анна' }, next: 'd' },
      d: {
        id: 'd',
        type: 'data',
        params: { collectionId: 'c1', dataOp: 'add', dataFields: { name: '{{name}}', city: 'Москва' } },
      },
    });
    await run(sc, msg('/start'), { currentBlock: null, vars: {} }, ops);
    expect(ops.store).toEqual([{ name: 'Анна', city: 'Москва' }]);
  });

  it('find уходит в «найдено» и кладёт поля в переменные', async () => {
    const ops = fakeOps([{ name: 'Анна', city: 'Москва' }]);
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'd' },
      d: {
        id: 'd',
        type: 'data',
        params: { collectionId: 'c1', dataOp: 'find', outVar: 'order', dataWhere: { city: 'Москва' } },
        branches: { found: 'y', not_found: 'n' },
      },
      y: { id: 'y', type: 'message', params: { text: 'нашли {{order.name}} ({{order_count}})' } },
      n: { id: 'n', type: 'message', params: { text: 'ничего' } },
    });
    const r = await run(sc, msg('/start'), { currentBlock: null, vars: {} }, ops);
    expect(r.outs.some((o) => o.payload.text === 'нашли Анна (1)')).toBe(true);
  });

  it('find по пустой таблице уходит в «не найдено»', async () => {
    const ops = fakeOps([]);
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'd' },
      d: {
        id: 'd',
        type: 'data',
        params: { collectionId: 'c1', dataOp: 'find', outVar: 'order', dataWhere: { city: 'Москва' } },
        branches: { found: 'y', not_found: 'n' },
      },
      y: { id: 'y', type: 'message', params: { text: 'нашли' } },
      n: { id: 'n', type: 'message', params: { text: 'ничего' } },
    });
    const r = await run(sc, msg('/start'), { currentBlock: null, vars: {} }, ops);
    expect(r.outs.some((o) => o.payload.text === 'ничего')).toBe(true);
  });

  it('без переданных ops блок не роняет сценарий', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'd' },
      d: {
        id: 'd',
        type: 'data',
        params: { collectionId: 'c1', dataOp: 'add', dataFields: { a: '1' } },
        next: 'm',
      },
      m: { id: 'm', type: 'message', params: { text: 'дальше' } },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs.some((o) => o.payload.text === 'дальше')).toBe(true);
  });

  it('remove удаляет по условию и считает затронутые строки', async () => {
    const ops = fakeOps([
      { name: 'Анна', city: 'Москва' },
      { name: 'Пётр', city: 'Москва' },
      { name: 'Иван', city: 'Казань' },
    ]);
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'd' },
      d: {
        id: 'd',
        type: 'data',
        params: { collectionId: 'c1', dataOp: 'remove', outVar: 'gone', dataWhere: { city: 'Москва' } },
        next: 'm',
      },
      m: { id: 'm', type: 'message', params: { text: 'удалено {{gone_count}}' } },
    });
    const r = await run(sc, msg('/start'), { currentBlock: null, vars: {} }, ops);
    expect(ops.store).toEqual([{ name: 'Иван', city: 'Казань' }]);
    expect(r.outs.some((o) => o.payload.text === 'удалено 2')).toBe(true);
  });
});

// Блок «Тег» (F2): метки человека. Как и «Данные», проверяем на заглушке —
// движок не должен знать про D1.
describe('runEngine: блок «Тег»', () => {
  function fakeTags(initial: string[] = []): TagOps & { store: Set<string> } {
    const store = new Set(initial);
    return {
      store,
      async add(tag) {
        store.add(tag);
      },
      async remove(tag) {
        store.delete(tag);
      },
      async clear() {
        store.clear();
      },
      async list() {
        return [...store].sort();
      },
      async has(tag) {
        return store.has(tag);
      },
    };
  }

  const runWithTags = (
    scenario: Scenario,
    tags: TagOps,
    session: SessionState = { currentBlock: null, vars: {} }
  ) => runEngine({ scenario, update: msg('/start'), session, tags });

  it('ставит тег и дальше идёт по next', async () => {
    const tags = fakeTags();
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'add', tagName: 'VIP' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'готово' } },
    });
    const r = await runWithTags(sc, tags);
    // Имя тега хранится нормализованным: «VIP» и «vip» — один и тот же тег.
    expect([...tags.store]).toEqual(['vip']);
    expect(r.outs.some((o) => o.payload.text === 'готово')).toBe(true);
  });

  it('снимает один тег и очищает все', async () => {
    const tags = fakeTags(['vip', 'купил']);
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'r' },
      r: { id: 'r', type: 'tag', params: { tagOp: 'remove', tagName: 'vip' }, next: 'c' },
      c: { id: 'c', type: 'tag', params: { tagOp: 'clear' } },
    });
    await runWithTags(sc, tags);
    expect([...tags.store]).toEqual([]);
  });

  it('список кладёт теги и их количество в переменные', async () => {
    const tags = fakeTags(['a', 'b', 'vip']);
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'list', tagVar: 'tags' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: '{{tags}} ({{tags_count}})' } },
    });
    const r = await runWithTags(sc, tags);
    expect(r.outs.some((o) => o.payload.text === 'a, b, vip (3)')).toBe(true);
  });

  it('условие по тегу уводит в «да», если тег есть, и в «нет», если его нет', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'c' },
      c: {
        id: 'c',
        type: 'condition',
        params: { condSource: 'tag', condVar: 'vip', op: '==' },
        branches: { then: 'y', else: 'n' },
      },
      y: { id: 'y', type: 'message', params: { text: 'свой' } },
      n: { id: 'n', type: 'message', params: { text: 'чужой' } },
    });
    const withTag = await runWithTags(sc, fakeTags(['vip']));
    expect(withTag.outs.some((o) => o.payload.text === 'свой')).toBe(true);

    const withoutTag = await runWithTags(sc, fakeTags());
    expect(withoutTag.outs.some((o) => o.payload.text === 'чужой')).toBe(true);
  });

  it('«не равно» по тегу — обратный случай', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'c' },
      c: {
        id: 'c',
        type: 'condition',
        params: { condSource: 'tag', condVar: 'vip', op: '!=' },
        branches: { then: 'y', else: 'n' },
      },
      y: { id: 'y', type: 'message', params: { text: 'нет метки' } },
      n: { id: 'n', type: 'message', params: { text: 'есть метка' } },
    });
    const withoutTag = await runWithTags(sc, fakeTags());
    expect(withoutTag.outs.some((o) => o.payload.text === 'нет метки')).toBe(true);
  });

  it('имя тега поддерживает {{var}}', async () => {
    const tags = fakeTags();
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'sv' },
      sv: { id: 'sv', type: 'setvar', params: { assignVar: 'segment', expr: 'Из рассылки' }, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'add', tagName: '{{segment}}' } },
    });
    await runWithTags(sc, tags);
    expect([...tags.store]).toEqual(['из рассылки']);
  });

  it('без TagOps сценарий не рвётся, а идёт дальше', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'add', tagName: 'vip' }, next: 'c' },
      c: {
        id: 'c',
        type: 'condition',
        params: { condSource: 'tag', condVar: 'vip', op: '==' },
        branches: { then: 'm', else: 'm' },
      },
      m: { id: 'm', type: 'message', params: { text: 'дальше' } },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs.some((o) => o.payload.text === 'дальше')).toBe(true);
  });

  it('падение базы тегов не роняет сценарий', async () => {
    const broken: TagOps = {
      add: async () => {
        throw new Error('db down');
      },
      remove: async () => {
        throw new Error('db down');
      },
      clear: async () => {
        throw new Error('db down');
      },
      list: async () => {
        throw new Error('db down');
      },
      has: async () => {
        throw new Error('db down');
      },
    };
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'add', tagName: 'vip' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'всё равно дальше' } },
    });
    const r = await runWithTags(sc, broken);
    expect(r.outs.some((o) => o.payload.text === 'всё равно дальше')).toBe(true);
  });
});

// Блок «Цепочка» (F3): несколько сообщений подряд, каждое своим вызовом.
describe('runEngine: блок «Цепочка»', () => {
  it('текст → фото → документ уходят тремя отдельными сообщениями по порядку', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: {
          chainItems: [
            { kind: 'text', text: 'Первое' },
            { kind: 'photo', url: 'a.jpg', caption: 'Фото' },
            { kind: 'document', url: 'd.pdf' },
          ],
        },
      },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs.map((o) => o.method)).toEqual(['sendMessage', 'sendPhoto', 'sendDocument']);
    expect(r.outs[1].payload.caption).toBe('Фото');
  });

  it('file_id имеет приоритет над url, как в блоке «Медиа»', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: { chainItems: [{ kind: 'photo', url: 'https://example.com/a.jpg', fileId: 'FILE' }] },
      },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs[0].payload.photo).toBe('FILE');
  });

  it('аудио уходит sendAudio — альбом такого не умеет', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: { chainItems: [{ kind: 'audio', url: 't.mp3' }] },
      },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs[0].method).toBe('sendAudio');
  });

  it('{{var}} подставляется в текст и подпись', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'sv' },
      sv: { id: 'sv', type: 'setvar', params: { assignVar: 'name', expr: 'Анна' }, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: {
          chainItems: [
            { kind: 'text', text: 'Привет, {{name}}' },
            { kind: 'photo', url: 'a.jpg', caption: '{{name}}, смотри' },
          ],
        },
      },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs[0].payload.text).toBe('Привет, Анна');
    expect(r.outs[1].payload.caption).toBe('Анна, смотри');
  });

  it('элементы без текста и без файла молча пропускаются', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: {
          chainItems: [
            { kind: 'text', text: '   ' },
            { kind: 'photo' },
            { kind: 'text', text: 'Полезное' },
          ],
        },
      },
    });
    const r = await run(sc, msg('/start'));
    expect(r.outs).toHaveLength(1);
    expect(r.outs[0].payload.text).toBe('Полезное');
  });
});

// Граница движка и подсценариев (TASK 3 промпта субфлоу): блоки subflow и
// subflow_return — АВТОРСКИЕ. Публикация раскрывает их в плоский сценарий
// (shared/subflow.ts), и до runEngine они доходить не должны никогда. Если
// такой блок всё же здесь (баг или устаревший закэшированный артефакт) —
// безопасный тупик: одна строка лога, currentBlock = null, без исключений.
// Движок НЕ получает семантику подсценариев.
describe('движок и подсценарии: безопасный тупик', () => {
  it('блок subflow, дошедший до движка: тупик, лог, не бросает', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'sf' },
      sf: { id: 'sf', type: 'subflow' as any, params: { subflowId: 'menu' }, branches: { done: 'm', failed: '' } },
      m: { id: 'm', type: 'message', params: { text: 'не должно отправиться' } },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await run(sc, msg('/start'));
    expect(r.outs).toEqual([]);
    expect(r.currentBlock).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('subflow');
    warn.mockRestore();
  });

  it('блок subflow_return, дошедший до движка: тот же тупик', async () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: {}, next: 'r' },
      r: { id: 'r', type: 'subflow_return' as any, params: {} },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await run(sc, msg('/start'));
    expect(r.outs).toEqual([]);
    expect(r.currentBlock).toBeNull();
    warn.mockRestore();
  });

  it('engine.ts не импортирует shared/subflow.ts (движок чист от подсценариев)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../worker/src/engine.ts', import.meta.url), 'utf8');
    // Ни import из subflow, ни обращения к D1: движок остаётся чистой
    // функцией, внешнее приходит через ops-интерфейсы.
    expect(/^import .*subflow/m.test(src)).toBe(false);
    expect(/^import .*['"]\.\/db['"]/m.test(src)).toBe(false);
    expect(src.includes('D1Database')).toBe(false);
  });
});
