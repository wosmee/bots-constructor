// Смоук-тесты валидатора сценария: та же чистая функция, что стопит публикацию
// в воркере и подсвечивает проблемы в редакторе.
import { describe, it, expect } from 'vitest';
import { validateScenario, countIssues, scenarioCommands } from '../shared/validate';
import type { Scenario } from '../shared/types';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

function scenarioOf(blocks: Scenario['blocks'], start = 's'): Scenario {
  return { version: 1, start, blocks };
}

describe('validateScenario', () => {
  it('accepts the minimal starter scenario used for a new bot', () => {
    const issues = validateScenario({
      version: 1,
      start: 'start',
      blocks: {
        start: { id: 'start', type: 'start', params: { command: '/start' }, next: '' },
      },
    });
    expect(countIssues(issues).errors).toBe(0);
  });

  it('пустой сценарий — ошибка «empty»', () => {
    const issues = validateScenario(scenarioOf({}, ''));
    expect(codes(issues)).toContain('empty');
    expect(countIssues(issues).errors).toBeGreaterThan(0);
  });

  it('корректный сценарий проходит без ошибок', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'привет' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    expect(countIssues(issues).errors).toBe(0);
  });

  it('ссылка на удалённый блок — ошибка', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'ghost' },
    });
    expect(codes(validateScenario(sc))).toContain('link-next');
  });

  it('кнопка без перехода — ошибка: пользователь нажмёт и бот замолчит', () => {
    // F5: раньше это было предупреждением, и «полурабочий» сценарий публиковался.
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'b' },
      b: {
        id: 'b',
        type: 'buttons',
        params: { prompt: 'выбери', buttons: [{ label: 'да', value: 'yes' }] },
      },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('btn-branch');
    expect(issues.find((i) => i.code === 'btn-branch')?.level).toBe('error');
  });

  it('проведённая ветка кнопки снимает ошибку', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'b' },
      b: {
        id: 'b',
        type: 'buttons',
        params: { prompt: 'выбери', buttons: [{ label: 'да', value: 'yes' }] },
        branches: { yes: 'e' },
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(codes(validateScenario(sc))).not.toContain('btn-branch');
  });

  it('условие требует обе ветки', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'c' },
      c: {
        id: 'c',
        type: 'condition',
        params: { condVar: 'age', op: '==', condValue: '18' },
        branches: { then: 'e' },
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('cond-else');
    expect(issues.find((i) => i.code === 'cond-else')?.level).toBe('error');
  });

  it('ключевые слова: пустая ветка — предупреждение, молчание законно', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'k' },
      k: {
        id: 'k',
        type: 'keyword',
        params: { keywords: 'цена', matchMode: 'contains' },
        branches: { hit: 'e' },
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    expect(issues.find((i) => i.code === 'kw-miss')?.level).toBe('warn');
    expect(countIssues(issues).errors).toBe(0);
  });

  it('оплата: обе незаполненные ветки — ошибки', () => {
    // F5: путь «отменил» тоже обязателен — иначе отказ от оплаты никуда не ведёт.
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'inv' },
      inv: {
        id: 'inv',
        type: 'invoice',
        params: {
          invoice: { title: 'Запись', description: 'оплата', amount: 150000, currency: 'RUB', providerToken: 'tok' },
        },
      },
    });
    const issues = validateScenario(sc);
    expect(issues.find((i) => i.code === 'inv-paid')?.level).toBe('error');
    expect(issues.find((i) => i.code === 'inv-cancelled')?.level).toBe('error');
  });

  it('данные: у поиска обе ветки обязательны, у записи — не требуются', () => {
    const find = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'd' },
      d: { id: 'd', type: 'data', params: { collectionId: 'c1', dataOp: 'find', outVar: 'order' } },
    });
    const findIssues = validateScenario(find);
    expect(findIssues.find((i) => i.code === 'data-found')?.level).toBe('error');
    expect(findIssues.find((i) => i.code === 'data-notfound')?.level).toBe('error');

    const add = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'd' },
      d: { id: 'd', type: 'data', params: { collectionId: 'c1', dataOp: 'add', dataFields: { name: 'x' } } },
    });
    const addCodes = codes(validateScenario(add));
    expect(addCodes).not.toContain('data-found');
    expect(addCodes).not.toContain('data-notfound');
  });

  it('замороженный блок не ломает публикацию', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: '', disabled: true }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    // Пустой текст — ошибка, но заморозка её гасит: движок блок пропустит.
    expect(codes(issues)).toContain('frozen');
    expect(countIssues(issues).errors).toBe(0);
  });

  it('цикл через ожидание ввода не считается бесконечным', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'i' },
      i: { id: 'i', type: 'input', params: { var: 'name', prompt: 'имя?' }, next: 'g' },
      g: { id: 'g', type: 'goto', params: { target: 'i' } },
    });
    expect(codes(validateScenario(sc))).not.toContain('tight-loop');
  });

  it('цикл через счёт (invoice) не считается бесконечным', () => {
    // Раньше WAIT_TYPES расходились между валидатором и инспектором конфликтов:
    // в одном списке invoice был, в другом нет — и корректный платёжный цикл
    // помечался «бесконечным». Теперь список один на всех (shared/graph.ts).
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'inv' },
      inv: {
        id: 'inv',
        type: 'invoice',
        params: { invoice: { title: 'Запись', description: 'оплата', amount: 150000, currency: 'RUB', providerToken: 'tok' } },
        branches: { paid: 'ok', cancelled: 'g' },
      },
      ok: { id: 'ok', type: 'message', params: { text: 'оплачено' } },
      g: { id: 'g', type: 'goto', params: { target: 'inv' } },
    });
    expect(codes(validateScenario(sc))).not.toContain('tight-loop');
  });

  it('цикл без ожидания — ОШИБКА tight-loop (F-020, публикуется не должен)', () => {
    // Раньше это было предупреждением: сценарий с self-loop из message-блоков
    // публиковался и слал до ~100 сообщений за апдейт (рантайм-guard
    // LOOP_VISIT_GUARD обрывает поток не мгновенно). Решение владельца по
    // аудиту 18.10.2026 — блокировать публикацию: warn → error.
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'm' },
      m: { id: 'm', type: 'message', params: { text: 'опять' }, next: 'g' },
      g: { id: 'g', type: 'goto', params: { target: 'm' } },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('tight-loop');
    expect(issues.find((i) => i.code === 'tight-loop')?.level).toBe('error');
    expect(countIssues(issues).errors).toBeGreaterThan(0);
  });

  it('цикл через quiz/location (набор 2026-10) — диалоговый, не tight-loop', () => {
    // quiz ждёт poll_answer, location ждёт апдейт с гео (engine.ts): такие
    // блоки паркуют сессию, цикл через них легален — ошибки быть не должно.
    for (const type of ['quiz', 'location'] as const) {
      const sc = scenarioOf({
        s: { id: 's', type: 'start', params: { command: '/start' }, next: 'q' },
        q: {
          id: 'q',
          type,
          params:
            type === 'quiz'
              ? { question: '2+2?', pollOptions: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }], correctOptionId: 'b' }
              : { locationPrompt: 'где вы?' },
          branches: type === 'quiz' ? { passed: 'g', failed: 'g' } : { sent: 'g', declined: 'g' },
        },
        g: { id: 'g', type: 'goto', params: { target: 'q' } },
      });
      expect(codes(validateScenario(sc)), `цикл через ${type}`).not.toContain('tight-loop');
    }
  });

  it('команды для BotFather собираются по блокам command', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'c' },
      c: { id: 'c', type: 'command', params: { command: '/help', description: 'Помощь' } },
    });
    const cmds = scenarioCommands(sc);
    // BotFather ждёт команды без слэша — валидатор отдаёт их уже очищенными.
    expect(cmds.some((c) => c.command === 'start')).toBe(true);
    expect(cmds.some((c) => c.command === 'help' && c.description === 'Помощь')).toBe(true);
  });
});

// F2: теги. Валидатор должен ловить пустое имя тега и не мешать «очистить».
describe('validateScenario: теги', () => {
  it('тег без имени — ошибка', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'add', tagName: '   ' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('tag-name');
    expect(issues.find((i) => i.code === 'tag-name')?.level).toBe('error');
  });

  it('тег из одних пробелов считается пустым', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'remove', tagName: '\t \n' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(codes(validateScenario(sc))).toContain('tag-name');
  });

  it('«очистить» параметров не требует', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'clear' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(codes(validateScenario(sc))).not.toContain('tag-name');
  });

  it('«список» без переменной — предупреждение, не ошибка', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 't' },
      t: { id: 't', type: 'tag', params: { tagOp: 'list' }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('tag-outvar');
    expect(issues.find((i) => i.code === 'tag-outvar')?.level).toBe('warn');
  });

  it('условие по тегу не жалуется на отсутствие переменной', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'c' },
      c: {
        id: 'c',
        type: 'condition',
        params: { condSource: 'tag', condVar: 'vip', op: '==' },
        branches: { then: 'e', else: 'e' },
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(codes(validateScenario(sc))).not.toContain('cond-var');
  });

  it('условие по тегу без имени тега — ошибка', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'c' },
      c: {
        id: 'c',
        type: 'condition',
        params: { condSource: 'tag', op: '==' },
        branches: { then: 'e', else: 'e' },
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(codes(validateScenario(sc))).toContain('cond-var');
  });

  it('«больше» для тега — предупреждение: оператор бессмыслен', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'c' },
      c: {
        id: 'c',
        type: 'condition',
        params: { condSource: 'tag', condVar: 'vip', op: '>' },
        branches: { then: 'e', else: 'e' },
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('cond-tag-op');
    expect(issues.find((i) => i.code === 'cond-tag-op')?.level).toBe('warn');
  });
});

// F3: цепочка сообщений.
describe('validateScenario: цепочка', () => {
  it('пустая цепочка — ошибка', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'ch' },
      ch: { id: 'ch', type: 'chain', params: { chainItems: [] }, next: 'e' },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('chain-empty');
    expect(issues.find((i) => i.code === 'chain-empty')?.level).toBe('error');
  });

  it('цепочка из пустых элементов считается пустой', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: { chainItems: [{ kind: 'text', text: '  ' }, { kind: 'photo' }] },
        next: 'e',
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(codes(validateScenario(sc))).toContain('chain-empty');
  });

  it('медиа без url и file_id — ошибка', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: { chainItems: [{ kind: 'text', text: 'ок' }, { kind: 'video' }] },
        next: 'e',
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    expect(codes(validateScenario(sc))).toContain('chain-media');
  });

  it('пустой текст — предупреждение, а не ошибка', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: { chainItems: [{ kind: 'text', text: 'Полезное' }, { kind: 'text', text: '' }] },
        next: 'e',
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = validateScenario(sc);
    expect(codes(issues)).toContain('chain-text');
    expect(issues.find((i) => i.code === 'chain-text')?.level).toBe('warn');
  });

  it('рабочая цепочка проходит без замечаний по коду', () => {
    const sc = scenarioOf({
      s: { id: 's', type: 'start', params: { command: '/start' }, next: 'ch' },
      ch: {
        id: 'ch',
        type: 'chain',
        params: {
          chainItems: [
            { kind: 'text', text: 'Первое' },
            { kind: 'photo', url: 'https://example.com/a.jpg', caption: 'Фото' },
          ],
        },
        next: 'e',
      },
      e: { id: 'e', type: 'end', params: {} },
    });
    const issues = codes(validateScenario(sc));
    expect(issues).not.toContain('chain-empty');
    expect(issues).not.toContain('chain-media');
    expect(issues).not.toContain('chain-text');
  });
});
