// Чистые тесты данных инспектора новых блоков (Промпт 2, TASK INSPECTOR).
// Компонент Inspector здесь НЕ импортируем (JSX/React в корневом vitest не
// нужны): проверяем то, что он потребляет — список системных переменных,
// i18n-фрагмент инспектора и словарь.
import { describe, expect, it } from 'vitest';
import { SYSTEM_VARS, SYSTEM_VAR_NAMES, isSystemVar } from '../web/src/vars';
import { PUBLIC_SYSTEM_VARS } from '../shared/types';
import { INSP_RU } from '../web/src/i18n.frag.insp';
import { INSP_EN } from '../web/src/i18n.frag.insp.en';
import { translate, loadDict } from '../web/src/i18n';

describe('SYSTEM_VARS: публичные переменные набора 2026-09', () => {
  it('покрывает PUBLIC_SYSTEM_VARS из shared/types один-в-один', () => {
    // Один источник правды: чипсы инспектора не должны расходиться со
    // списком, который платформа обещает автору (shared/types).
    expect([...SYSTEM_VAR_NAMES].sort()).toEqual([...PUBLIC_SYSTEM_VARS].sort());
  });

  it('содержит платёжные, опросные и пользовательские переменные', () => {
    for (const name of [
      'pay.link',
      'pay.order',
      'poll.answer',
      'poll.options',
      'user.name',
      'user.username',
      'user.id',
      'user.tags',
      'user.subscription',
      'user.paid_total',
      'user.ref_count',
      'user.first_seen',
    ]) {
      expect(isSystemVar(name), name).toBe(true);
    }
  });

  it('не содержит внутренних переменных "__*" — их автору показывать нельзя', () => {
    for (const v of SYSTEM_VARS) {
      expect(v.name.startsWith('__'), v.name).toBe(false);
    }
  });

  it('каждая переменная имеет ключ описания, и он переведён в обоих языках', async () => {
    await loadDict('en');
    for (const v of SYSTEM_VARS) {
      const ru = translate('ru', v.key as never);
      const en = translate('en', v.key as never);
      expect(ru, `нет RU-описания для ${v.name}`).not.toBe(v.key);
      expect(en, `нет EN-описания для ${v.name}`).not.toBe(v.key);
      expect(ru.length, v.name).toBeGreaterThan(3);
      expect(en.length, v.name).toBeGreaterThan(3);
    }
  });
});

describe('i18n-фрагмент инспектора (INSP_RU / INSP_EN)', () => {
  it('EN-фрагмент повторяет RU-фрагмент по ключам', () => {
    // Тип Record<keyof typeof INSP_RU, string> это уже гарантирует, но
    // runtime-проверка ловит ручные правки одного файла без другого.
    expect(Object.keys(INSP_EN).sort()).toEqual(Object.keys(INSP_RU).sort());
  });

  it('значения непустые и не совпадают с ключом', () => {
    for (const [k, v] of Object.entries({ ...INSP_RU, ...INSP_EN })) {
      expect(v, k).toBeTruthy();
      expect(String(v).trim().length, k).toBeGreaterThan(1);
      expect(v, k).not.toBe(k);
    }
  });

  it('новые ключи отдаются translate() в обоих языках', async () => {
    await loadDict('en');
    for (const key of [
      'insp.section.formatting',
      'f.wait.timeoutCallout',
      'f.channel.adminCallout',
      'f.kind.attachmentHint',
      'f.conditions.mode.single',
      'f.conditions.mode.list',
      'f.pay.empty',
      'f.pay.openPayments',
      'f.foreach.loopBack',
      'f.counter.max.hint',
      'vars.sys.payLink',
      'vars.sys.userFirstSeen',
    ] as const) {
      expect(translate('ru', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
  });

  it('счётчик вариантов опроса подставляет {n}', () => {
    expect(translate('ru', 'f.poll.count', { n: 7 })).toBe('7/10');
  });
});
