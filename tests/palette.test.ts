// Логика палитры: группы (Промпт 2), раскрытие (F1) и поиск (F4) — чистые
// функции, поэтому проверяются здесь, а не через UI.
import { describe, expect, it } from 'vitest';
import {
  matchPalette,
  nextOpenGroups,
  parseOpenGroups,
  normalizeSearch,
  visiblePaletteGroups,
  LEGACY_GROUP_IDS,
  PALETTE_GROUPS,
  PALETTE_GROUP_IDS,
  DEFAULT_OPEN_GROUPS,
  type PaletteGroupId,
} from '../web/src/blocks';
import { blockSupportedOn } from '../shared/platform';

describe('PALETTE_GROUPS (контракт Промпта 2)', () => {
  it('PaletteGroupId и PALETTE_GROUP_IDS — один и тот же список', () => {
    // ДВЕ отдельные сущности в blocks.ts: тип и массив. Тест — страховка от
    // расхождения: ids группы из PALETTE_GROUPS обязаны совпасть с массивом
    // (в том же порядке), иначе сохранённое состояние групп молча отвалится.
    expect(PALETTE_GROUP_IDS).toEqual(PALETTE_GROUPS.map((g) => g.id));
  });

  it('каждый основной блок лежит ровно в одной группе (advanced — дубль)', () => {
    const ADVANCED = new Set(PALETTE_GROUPS.find((g) => g.id === 'advanced')!.items);
    const seen = new Map<string, PaletteGroupId>();
    for (const g of PALETTE_GROUPS) {
      if (g.id === 'advanced') continue;
      for (const type of g.items) {
        expect(seen.has(type), `блок ${type} встречается дважды`).toBe(false);
        seen.set(type, g.id);
      }
    }
    // Продвинутая группа не вводит новых блоков — только повторяет основные.
    for (const type of ADVANCED) expect(seen.has(type)).toBe(true);
  });

  it('состав групп — ровно контракт', () => {
    const items = (id: PaletteGroupId) => PALETTE_GROUPS.find((g) => g.id === id)!.items;
    // Набор 2026-10: правка/удаление/викторина — к отправке, гео — к вводу,
    // «Время» (schedule/wait/timer_deadline) и «ИИ» (ai/ai_classify/random_text)
    // — отдельные семьи; language — к логике (ветвление), webhook_in — к потоку.
    expect(items('content')).toEqual(['message', 'media', 'media_group', 'chain', 'poll', 'quiz', 'forward', 'edit_message', 'delete_message']);
    expect(items('keyboards')).toEqual(['buttons', 'menu', 'chat_action', 'web_app']);
    expect(items('input')).toEqual(['input', 'contact', 'location']);
    expect(items('logic')).toEqual(['condition', 'switch', 'random', 'foreach', 'setvar', 'keyword', 'assert', 'language']);
    expect(items('data')).toEqual(['data', 'counter']);
    expect(items('time')).toEqual(['schedule', 'wait', 'timer_deadline']);
    expect(items('audience')).toEqual(['channel_check', 'subscription', 'user_stats', 'segment_broadcast', 'tag']);
    expect(items('payments')).toEqual(['invoice', 'payment_link', 'payment_check']);
    expect(items('ai')).toEqual(['ai', 'ai_classify', 'random_text']);
    expect(items('integrations')).toEqual(['http', 'action']);
    // F3-301: реферальная группа — контракт состава (была вне теста).
    expect(items('referral')).toEqual([
      'referral',
      'referral_track',
      'referral_check',
      'referral_bonus',
      'referral_hierarchy',
      'referral_verification',
      'referral_stats',
      'referral_leaderboard',
      'referral_tournament',
      'antifraud',
    ]);
    expect(items('flow')).toEqual(['start', 'command', 'goto', 'end', 'webhook_in', 'subflow', 'subflow_return', 'note']);
    expect(items('advanced')).toEqual(['http', 'ai', 'setvar', 'foreach']);
  });

  it('F3-301: platform-гард — каждый блок палитры проверяется blockSupportedOn', () => {
    // Палитра VK-бота фильтрует по blockSupportedOn (Constructor.tsx); этот
    // тест страхует матрицу платформ: тип из палитры обязан быть в ней.
    for (const g of PALETTE_GROUPS) {
      for (const type of g.items) {
        const tg = blockSupportedOn(type, 'telegram');
        const vk = blockSupportedOn(type, 'vk');
        expect(tg || vk, `блок ${type} не поддержан ни на одной платформе`).toBe(true);
      }
    }
  });

  it('по умолчанию раскрыто «Содержимое»', () => {
    expect(DEFAULT_OPEN_GROUPS).toEqual(['content']);
  });
});

describe('LEGACY_GROUP_IDS (устаревшие id в localStorage)', () => {
  it('старые id отображаются в новые, «messages» → «content»', () => {
    expect(LEGACY_GROUP_IDS['messages']).toBe('content');
    expect(parseOpenGroups('["messages"]')).toEqual(['content']);
    expect(parseOpenGroups('["messages","logic","flow"]')).toEqual(['content', 'logic', 'flow']);
  });

  it('каждый legacy id ведёт в существующую группу', () => {
    for (const mapped of Object.values(LEGACY_GROUP_IDS)) {
      expect(PALETTE_GROUP_IDS).toContain(mapped);
    }
  });

  it('неизвестные id отбрасываются', () => {
    expect(parseOpenGroups('["messages","nope","keyboards"]')).toEqual(['content', 'keyboards']);
  });
});

describe('nextOpenGroups', () => {
  it('в режиме аккордеона открывает только одну группу', () => {
    expect(nextOpenGroups('accordion', [], 'content')).toEqual(['content']);
    expect(nextOpenGroups('accordion', ['content'], 'logic')).toEqual(['logic']);
  });

  it('в аккордеоне клик по открытой группе закрывает её — пустая палитра нормальна', () => {
    expect(nextOpenGroups('accordion', ['content'], 'content')).toEqual([]);
  });

  it('в свободном режиме группы открываются и закрываются независимо', () => {
    expect(nextOpenGroups('free', ['content'], 'logic')).toEqual(['content', 'logic']);
    expect(nextOpenGroups('free', ['content', 'logic'], 'content')).toEqual(['logic']);
  });

  it('новые id групп ведут себя как прежние', () => {
    expect(nextOpenGroups('accordion', ['payments'], 'audience')).toEqual(['audience']);
    expect(nextOpenGroups('free', ['keyboards'], 'advanced')).toEqual(['keyboards', 'advanced']);
    expect(nextOpenGroups('accordion', ['advanced'], 'advanced')).toEqual([]);
  });
});

describe('parseOpenGroups', () => {
  it('при отсутствии записи открывает «Содержимое» — состояние по умолчанию', () => {
    expect(parseOpenGroups(null)).toEqual(['content']);
  });

  it('битый JSON не роняет палитру', () => {
    expect(parseOpenGroups('{not json')).toEqual(['content']);
    expect(parseOpenGroups('"строка"')).toEqual(['content']);
  });

  it('отбрасывает неизвестные id и повторы', () => {
    expect(parseOpenGroups('["content","content","nope","free"]')).toEqual(['content']);
  });

  it('принимает валидный список', () => {
    expect(parseOpenGroups('["logic","flow"]')).toEqual(['logic', 'flow']);
  });
});

describe('visiblePaletteGroups (уровень и advanced)', () => {
  it('новичку группа «Продвинутые» скрыта, пока тумблер выключен', () => {
    const ids = visiblePaletteGroups(PALETTE_GROUPS, { skillLevel: 'low', advancedEnabled: false }).map((g) => g.id);
    expect(ids).not.toContain('advanced');
  });

  it('новичок включил тумблер — группа видна', () => {
    const ids = visiblePaletteGroups(PALETTE_GROUPS, { skillLevel: 'low', advancedEnabled: true }).map((g) => g.id);
    expect(ids).toContain('advanced');
  });

  it('medium и high видят advanced всегда', () => {
    for (const lv of ['medium', 'high', ''] as const) {
      const ids = visiblePaletteGroups(PALETTE_GROUPS, { skillLevel: lv, advancedEnabled: false }).map((g) => g.id);
      expect(ids).toContain('advanced');
    }
  });
});

describe('matchPalette', () => {
  const labelOf = (type: string) => ({ invoice: 'Счёт', message: 'Сообщение', buttons: 'Кнопки' }[type] ?? type);
  const titleOf = (key: string) =>
    ({
      'palette.content': 'Содержимое',
      'palette.keyboards': 'Кнопки и меню',
      'palette.logic': 'Логика',
      'palette.integrations': 'Интеграции',
      'palette.input': 'Ввод данных',
      'palette.data': 'Данные',
      'palette.audience': 'Аудитория',
      'palette.payments': 'Платежи',
      'palette.flow': 'Поток',
      'palette.advanced': 'Продвинутое',
    }[key] ?? key);

  const run = (q: string) =>
    matchPalette(q, PALETTE_GROUPS, labelOf as never, titleOf as never).map((m) => ({
      groupId: m.groupId,
      blocks: m.blocks as string[],
    }));

  it('пустой запрос ничего не фильтрует', () => {
    expect(matchPalette('   ', PALETTE_GROUPS, labelOf as never, titleOf as never)).toEqual([]);
  });

  it('находит блок по русскому названию', () => {
    const res = run('счёт');
    expect(res).toHaveLength(1);
    expect(res[0].groupId).toBe('payments');
    expect(res[0].blocks).toEqual(['invoice']);
  });

  it('находит тот же блок по машинному типу в латинице', () => {
    const res = run('invoice');
    expect(res[0].blocks).toEqual(['invoice']);
  });

  it('не различает ё и е, регистр и лишние пробелы', () => {
    expect(run('СЧЕТ')).toEqual(run('  счёт  '));
    expect(normalizeSearch(' Счёт ')).toBe('счет');
  });

  it('совпадение по названию группы показывает её целиком', () => {
    const res = run('логика');
    expect(res).toHaveLength(1);
    const logic = PALETTE_GROUPS.find((g) => g.id === 'logic');
    expect(res[0].blocks).toEqual(logic?.items as unknown as string[]);
  });

  it('нечего найти — пустой список, а не вся палитра', () => {
    expect(run('щщщ')).toEqual([]);
  });

  it('ищет только по именам: описание блока не подтягивает лишние группы', () => {
    // «подставляет» есть в подсказке блока «Сообщение», но не в его названии.
    expect(run('подставляет')).toEqual([]);
  });

  it('идёт по всем группам и возвращает несколько совпадений', () => {
    const ids = matchPalette('сообщ', PALETTE_GROUPS, labelOf as never, titleOf as never).map((m) => m.groupId);
    expect(ids).toContain('content');
  });

  it('группа входит в результат один раз', () => {
    const ids = matchPalette('е', PALETTE_GROUPS, labelOf as never, titleOf as never).map((m) => m.groupId);
    expect(new Set(ids as PaletteGroupId[]).size).toBe(ids.length);
  });

  it('новый блок находится по машинному типу', () => {
    expect(run('payment_link')[0].groupId).toBe('payments');
    expect(run('foreach')[0].groupId).toBe('logic');
    expect(run('poll')[0].groupId).toBe('content');
  });
});
