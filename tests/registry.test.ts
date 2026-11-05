// Анти-дрейфовый гейт реестра блоков (Промпт 2, TASK 2): каждый BlockType
// обязан быть представлен ВО ВСЕХ реестрах — мета (label/hint), WHAT_IF,
// defaultBlock, summary, порты веток и текст гайда в обоих языках. Добавили
// тип и забыли реестр — этот тест красный.
import { describe, expect, it } from 'vitest';
import type { BlockType } from '../shared/types';
import { BRANCH_TYPES, usesBranches } from '../shared/types';
import { BLOCK_META, WHAT_IF, defaultBlock, summary, nodeLabel, guideTextKey, PALETTE_GROUPS } from '../web/src/blocks';
import { portsOf } from '../web/src/ports';
import { translate, loadDict } from '../web/src/i18n';

// Полный список типов: ключи BLOCK_META — Record<BlockType, …>, поэтому TS
// гарантирует полноту на уровне типа, а здесь мы сверяем рантайм с моделью
// через union-список (BRANCH_TYPES ⊂ всех типов).
const ALL_TYPES = Object.keys(BLOCK_META) as BlockType[];

describe('полнота реестра блоков', () => {
  it('BLOCK_META покрывает каждый тип: label, hint (ленивый i18n) и цвет', () => {
    for (const type of ALL_TYPES) {
      const m = BLOCK_META[type];
      expect(m, `нет META для ${type}`).toBeTruthy();
      // label/hint — геттеры: значение обязано быть непустой строкой, а не
      // сырым ключом словаря (ленивый i18n сломан).
      expect(m.label.startsWith('block.'), `label ${type} не переведён`).toBe(false);
      expect(m.hint.length, `hint ${type} пуст`).toBeGreaterThan(10);
      expect(m.color, `цвет ${type}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('WHAT_IF есть у каждого типа и переводится', () => {
    for (const type of ALL_TYPES) {
      const key = WHAT_IF[type];
      expect(key, `нет WHAT_IF для ${type}`).toBeTruthy();
      expect(translate('ru', key).startsWith('whatif.'), `whatif ${type} не переведён (ru)`).toBe(false);
    }
  });

  it('defaultBlock возвращает блок своего типа с params', () => {
    for (const type of ALL_TYPES) {
      const b = defaultBlock(type, `t_${type}`);
      expect(b.type).toBe(type);
      expect(b.id).toBe(`t_${type}`);
      expect(b.params).toBeTruthy();
      // Ветвящийся блок обязан иметь ключи веток в branches.
      if (usesBranches(type)) {
        expect(Object.keys(b.branches ?? {}).length, `нет branches у ${type}`).toBeGreaterThan(0);
      }
    }
  });

  it('summary и nodeLabel не падают ни на одном типе', () => {
    for (const type of ALL_TYPES) {
      const b = defaultBlock(type, `t_${type}`);
      expect(() => summary(b, 'ru'), `summary ${type}`).not.toThrow();
      const label = nodeLabel(b, 'ru');
      expect(label.length, `nodeLabel ${type}`).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(31); // 30 + многоточие
    }
  });

  it('порты: у ветвящегося блока — порты веток, у обычного — next', () => {
    for (const type of ALL_TYPES) {
      const b = defaultBlock(type, `t_${type}`);
      const ports = portsOf(b, 'ru');
      if (type === 'end' || type === 'goto' || type === 'subflow_return') {
        // Терминалы: исходящих связей нет (subflow_return завершает фрагмент).
        expect(ports).toEqual([]);
        continue;
      }
      if (usesBranches(type)) {
        expect(ports.length, `нет портов у ${type}`).toBeGreaterThan(0);
        for (const p of ports) {
          expect(p.kind).toBe('branch');
          expect(p.label.length, `пустая подпись порта ${type}:${p.branchKey}`).toBeGreaterThan(0);
          // Подпись — не сырой i18n-ключ.
          expect(p.label.startsWith('port.'), `порт ${type}:${p.branchKey} не переведён`).toBe(false);
        }
      } else {
        expect(ports.map((p) => p.id)).toEqual(['next']);
      }
    }
  });

  it('каждый BRANCH_TYPES-блок имеет ветки из контракта', () => {
    // Ключи веток сверены с движком (worker/src/engine.ts).
    const expected: Record<string, string[]> = {
      wait: ['reply', 'timeout'],
      poll: ['answered', 'skipped'],
      forward: ['ok', 'failed'],
      channel_check: ['member', 'not_member', 'error'],
      segment_broadcast: ['queued', 'empty'],
      payment_link: ['created', 'failed'],
      payment_check: ['paid', 'pending', 'failed'],
      foreach: ['each', 'done'],
      assert: ['pass', 'fail'],
      counter: ['ok', 'limit_reached'],
      condition: ['then', 'else'],
      keyword: ['hit', 'miss'],
      invoice: ['paid', 'cancelled'],
      data: ['found', 'not_found'],
      subflow: ['done', 'failed'],
    };
    for (const [type, keys] of Object.entries(expected)) {
      const ports = portsOf(defaultBlock(type as BlockType, 't'), 'ru');
      expect(ports.map((p) => p.branchKey), `порты ${type}`).toEqual(keys);
    }
    expect(BRANCH_TYPES.length).toBeGreaterThan(20);
    // S4-02 (аудит 18.10.2026): 6 типов набора 2026-10 были перечислены дважды —
    // контракт состава «врал» (длина списка ≠ числу ветвящихся блоков).
    expect(new Set(BRANCH_TYPES).size, 'в BRANCH_TYPES есть дубли').toBe(BRANCH_TYPES.length);
  });

  it('текст гайда есть у каждого типа в обоих языках', async () => {
    await loadDict('en');
    for (const type of ALL_TYPES) {
      const key = guideTextKey(type);
      const ru = translate('ru', key);
      const en = translate('en', key);
      expect(ru, `нет гайда (ru) для ${type}`).not.toBe(key);
      expect(en, `нет гайда (en) для ${type}`).not.toBe(key);
      expect(en.length).toBeGreaterThan(10);
    }
  });

  it('каждый тип лежит в палитре (advanced — дубль основных групп)', () => {
    const covered = new Set<BlockType>();
    for (const g of PALETTE_GROUPS) {
      if (g.id === 'advanced') continue;
      for (const type of g.items) covered.add(type);
    }
    for (const type of ALL_TYPES) {
      expect(covered.has(type), `${type} потерялся в палитре`).toBe(true);
    }
  });
});
