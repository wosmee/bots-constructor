// Инспектор набора 2026-10: i18n-ключи новых полей существуют в обоих языках,
// системные переменные языка/гео в панели, дефолты блоков имеют ожидаемые ветки.
// Компонент Inspector не импортируем (JSX в корневом vitest не нужен).
import { describe, expect, it } from 'vitest';
import { translate, loadDict } from '../web/src/i18n';
import { BLOCKS2610_RU } from '../web/src/i18n.frag.blocks2610';
import { BLOCKS2610_EN } from '../web/src/i18n.frag.blocks2610.en';
import { defaultBlock } from '../web/src/blocks';
import { SYSTEM_VAR_NAMES } from '../web/src/vars';
import type { BlockType } from '../shared/types';

// Все i18n-ключи, на которые ссылается Inspector для новых блоков.
const INSPECTOR_KEYS_2610 = [
  'f.editm.ref', 'f.editm.ref.hint', 'f.editm.text', 'f.editm.buttons',
  'f.delm.ref',
  'f.quiz.failtext',
  'f.lang.codes', 'f.lang.codes.hint',
  'f.td.at', 'f.td.var', 'f.td.cancel', 'f.td.cancel.hint', 'f.td.text',
  'f.aic.prompt', 'f.aic.input', 'f.aic.input.hint', 'f.aic.labels', 'f.aic.fb', 'f.aic.out',
  'f.loc.prompt', 'f.loc.btn',
  'f.whin.fields', 'f.whin.fields.hint', 'f.whin.url', 'f.whin.url.hint',
] as const;

describe('i18n полей инспектора 2026-10', () => {
  it('все ключи переведены в RU и EN', async () => {
    await loadDict('en');
    for (const key of INSPECTOR_KEYS_2610) {
      const ru = translate('ru', key as never);
      const en = translate('en', key as never);
      expect(ru, `нет RU для ${key}`).not.toBe(key);
      expect(en, `нет EN для ${key}`).not.toBe(key);
      expect(ru.length, key).toBeGreaterThan(1);
      expect(en.length, key).toBeGreaterThan(1);
    }
  });

  it('RU и EN фрагменты блоков 2026-10 совпадают по ключам', () => {
    expect(Object.keys(BLOCKS2610_EN).sort()).toEqual(Object.keys(BLOCKS2610_RU).sort());
  });
});

describe('системные переменные 2026-10', () => {
  it('user.lang, user.lat, user.lon в панели переменных', () => {
    expect(SYSTEM_VAR_NAMES).toContain('user.lang');
    expect(SYSTEM_VAR_NAMES).toContain('user.lat');
    expect(SYSTEM_VAR_NAMES).toContain('user.lon');
  });
});

describe('defaultBlock ветки набора 2026-10', () => {
  const cases: Array<[BlockType, string[]]> = [
    ['edit_message', ['ok', 'too_old', 'not_found']],
    ['quiz', ['passed', 'failed']],
    ['language', ['ru', 'en', 'fallback']],
    ['timer_deadline', ['done', 'expired']],
    ['ai_classify', ['lead', 'question', 'spam', 'other']],
    ['location', ['sent', 'declined']],
  ];
  for (const [type, expected] of cases) {
    it(`${type} имеет ветки ${expected.join(', ')}`, () => {
      const b = defaultBlock(type, 't');
      expect(Object.keys(b.branches ?? {}).sort()).toEqual([...expected].sort());
    });
  }

  it('delete_message и webhook_in без веток (next)', () => {
    expect(defaultBlock('delete_message', 't').branches ?? {}).toEqual({});
    expect(defaultBlock('webhook_in', 't').branches ?? {}).toEqual({});
  });
});
