// Визуальные группы холста (Промпт 2, TASK 9): чистые хелперы из web/src/graph.
// Контракт: группы — canvas-метаданные; они НЕ меняют scenarioContentHash и
// не видны движку/валидатору.
import { describe, expect, it } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import {
  createGroupAround,
  pointInGroup,
  membersAfterDrag,
  collapseRect,
  serializeGroups,
  parseGroups,
  sanitizeGroups,
  copiedGroups,
  copyIdMap,
  copySubgraph,
  graphToScenario,
  newGroupId,
  searchBlocks,
  COLLAPSED_W,
  COLLAPSED_H,
  GROUP_HEADER_H,
  GROUP_MIN_W,
  GROUP_MIN_H,
  type CanvasGroup,
  type NodeData,
} from '../web/src/graph';
import { scenarioContentHash } from '../shared/graph';
import type { Block } from '../shared/types';

const node = (id: string, block?: Partial<Block>, position = { x: 0, y: 0 }): Node => ({
  id,
  type: 'bot',
  position,
  data: { block: { id, type: 'message', params: {}, ...block } as Block } as NodeData,
});

const group = (over: Partial<CanvasGroup> = {}): CanvasGroup => ({
  id: 'g1',
  title: 'Тест',
  color: '#3b82f6',
  collapsed: false,
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  members: ['a', 'b'],
  ...over,
});

describe('createGroupAround', () => {
  it('рамка покрывает все узлы с padding, сверху — запас под заголовок', () => {
    const a = node('a', {}, { x: 100, y: 100 });
    const b = node('b', {}, { x: 400, y: 250 });
    const g = createGroupAround('g1', [a, b], 28)!;
    expect(g.x).toBe(100 - 28);
    expect(g.y).toBe(100 - 28 - GROUP_HEADER_H);
    expect(g.x + g.w).toBeGreaterThanOrEqual(400 + 220 + 28); // ширина узла (fallback 220) + padding
    expect(g.y + g.h).toBeGreaterThanOrEqual(250 + 96 + 28);
    expect(g.members).toEqual(['a', 'b']);
    expect(g.collapsed).toBe(false);
  });

  it('пустой набор узлов — null, а не битая группа', () => {
    expect(createGroupAround('g1', [])).toBeNull();
  });

  it('учитывает измеренные размеры react-flow (measured)', () => {
    const n = { ...node('a', {}, { x: 0, y: 0 }), measured: { width: 300, height: 120 } };
    const g = createGroupAround('g1', [n], 10)!;
    expect(g.x).toBe(-10);
    expect(g.w).toBe(320);
  });
});

describe('pointInGroup', () => {
  const g = group({ x: 10, y: 20, w: 100, h: 50 });

  it('внутри', () => {
    expect(pointInGroup({ x: 50, y: 40 }, g)).toBe(true);
  });

  it('снаружи', () => {
    expect(pointInGroup({ x: 5, y: 40 }, g)).toBe(false);
    expect(pointInGroup({ x: 200, y: 40 }, g)).toBe(false);
    expect(pointInGroup({ x: 50, y: 5 }, g)).toBe(false);
    expect(pointInGroup({ x: 50, y: 200 }, g)).toBe(false);
  });

  it('граница считается попаданием', () => {
    expect(pointInGroup({ x: 10, y: 20 }, g)).toBe(true);
    expect(pointInGroup({ x: 110, y: 70 }, g)).toBe(true);
  });
});

describe('membersAfterDrag', () => {
  const g = group({ x: 0, y: 0, w: 100, h: 100, members: ['a', 'b'] });

  it('блок утащен наружу — членство снято', () => {
    const kept = membersAfterDrag(g, { a: { x: 200, y: 50 }, b: { x: 50, y: 50 } });
    expect(kept).toEqual(['b']);
  });

  it('оба внутри — состав не меняется', () => {
    expect(membersAfterDrag(g, { a: { x: 10, y: 10 }, b: { x: 90, y: 90 } })).toEqual(['a', 'b']);
  });

  it('новый блок затащили в рамку — добавлен', () => {
    expect(membersAfterDrag(g, { a: { x: 10, y: 10 }, c: { x: 20, y: 20 } })).toEqual(['a', 'c']);
  });
});

describe('collapseRect', () => {
  it('плитка фиксированного размера, anchored в левом верхнем углу группы', () => {
    const g = group({ x: 40, y: 60, w: 900, h: 700, collapsed: true });
    const r = collapseRect(g);
    expect(r).toEqual({ x: 40, y: 60, w: COLLAPSED_W, h: COLLAPSED_H });
    // Стабильность: повторный вызов и другая рамка на размер плитки не влияют.
    expect(collapseRect(g)).toEqual(r);
    expect(collapseRect(group({ x: 1, y: 2, w: 10, h: 10 }))).toEqual({ x: 1, y: 2, w: COLLAPSED_W, h: COLLAPSED_H });
  });
});

describe('serializeGroups / parseGroups', () => {
  it('roundtrip сохраняет группы', () => {
    const gs = [group(), group({ id: 'g2', collapsed: true, members: ['c'] })];
    expect(parseGroups(serializeGroups(gs))).toEqual(gs);
  });

  it('битый JSON — пустой массив, а не исключение', () => {
    expect(parseGroups('{не json')).toEqual([]);
    expect(parseGroups('')).toEqual([]);
    expect(parseGroups('null')).toEqual([]);
  });

  it('sanitize отбрасывает мусор и дубли id, чинит дефолты', () => {
    const dirty = [
      null,
      42,
      { id: 'ok', title: 'x', members: ['a'] }, // нет геометрии — дефолты
      { id: 'ok', members: ['b'] }, // дубль id
      { id: 'bad-members', members: 'a' }, // members не массив
      { id: '', members: [] }, // пустой id
      { id: 'dupes', members: ['a', 'a', 'b'], w: 5 }, // дубли участников, w ниже минимума
    ];
    const out = sanitizeGroups(dirty);
    expect(out.map((g) => g.id)).toEqual(['ok', 'dupes']);
    expect(out[0].w).toBe(GROUP_MIN_W);
    expect(out[0].h).toBe(GROUP_MIN_H);
    expect(out[0].collapsed).toBe(false);
    expect(out[0].color).toBeTruthy();
    expect(out[1].members).toEqual(['a', 'b']);
  });
});

describe('copy/paste группировки', () => {
  it('скопировали ВСЕХ участников — копия группы есть, id свежий, members переназначены', () => {
    const nodes = [node('a'), node('b'), node('outside')];
    const gs = [group({ members: ['a', 'b'] })];
    const copy = copySubgraph(nodes, [], ['a', 'b'], 0);
    const map = copyIdMap(nodes, ['a', 'b'], copy.nodes);
    const out = copiedGroups(gs, map, 40, 40);
    expect(out).toHaveLength(1);
    expect(out[0].id).not.toBe('g1');
    expect(out[0].members).toEqual(copy.nodes.map((n) => n.id));
    expect(out[0].x).toBe(gs[0].x + 40);
    expect(out[0].y).toBe(gs[0].y + 40);
    expect(out[0].collapsed).toBe(false);
  });

  it('скопировали часть участников — группы в копии нет', () => {
    const nodes = [node('a'), node('b')];
    const gs = [group({ members: ['a', 'b'] })];
    const copy = copySubgraph(nodes, [], ['a'], 0);
    const out = copiedGroups(gs, copyIdMap(nodes, ['a'], copy.nodes));
    expect(out).toEqual([]);
  });
});

describe('удаление группы и сериализация сценария', () => {
  it('удаление группы не трогает блоки', () => {
    const nodes = [node('a'), node('b')];
    const edges: Edge[] = [];
    const gs = [group({ members: ['a', 'b'] })];
    const after = gs.filter((g) => g.id !== 'g1'); // removeGroup в Constructor
    const sc = graphToScenario(nodes, edges, null, after);
    expect(Object.keys(sc.blocks)).toEqual(['a', 'b']);
    expect(sc.groups).toBeUndefined(); // пустой список не сериализуется
  });

  it('группы переживают save/draft: попадают в JSON сценария', () => {
    const sc = graphToScenario([node('a'), node('b')], [], null, [group()]);
    const parsed = JSON.parse(JSON.stringify(sc));
    expect(parseGroups(JSON.stringify(parsed.groups))).toEqual([group()]);
  });

  it('участник удалённого блока вычищается, пустая группа снимается', () => {
    const sc = graphToScenario([node('a')], [], null, [
      group({ id: 'g1', members: ['a', 'ghost'] }),
      group({ id: 'g2', members: ['ghost'] }),
    ]);
    expect(sc.groups).toHaveLength(1);
    expect(sc.groups![0].members).toEqual(['a']);
  });

  it('scenarioContentHash НЕ меняется от групп (никаких лишних версий)', () => {
    const nodes = [node('a'), node('b')];
    const withGroups = graphToScenario(nodes, [], null, [group()]);
    const without = graphToScenario(nodes, [], null);
    expect(scenarioContentHash(withGroups)).toBe(scenarioContentHash(without));
  });

  it('newGroupId уникален', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newGroupId()));
    expect(ids.size).toBe(200);
  });
});

describe('searchBlocks по новым блокам (TASK 10)', () => {
  const labelOf = (b: Block) => b.type;

  it('находит poll по тексту вопроса', () => {
    const nodes = [node('p', { type: 'poll', params: { question: 'Какой цвет маникюра?' } })];
    const hits = searchBlocks(nodes, 'маникюр', labelOf);
    // Совпадение внутри JSON.stringify(params) — поле question.
    const h = searchBlocks(nodes, 'цвет', labelOf);
    expect(h).toHaveLength(1);
    expect(h[0].id).toBe('p');
    expect(h[0].snippet).toContain('question');
    expect(hits).toHaveLength(1);
  });

  it('находит wait по reminderText', () => {
    const nodes = [node('w', { type: 'wait', params: { reminderText: 'Напомнить про оплату' } })];
    const hits = searchBlocks(nodes, 'напомнить', labelOf);
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('reminderText');
  });

  it('находит assert по failMessage', () => {
    const nodes = [node('as', { type: 'assert', params: { failMessage: 'Подписка не найдена' } })];
    const hits = searchBlocks(nodes, 'подписка', labelOf);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('as');
  });

  it('находит segment_broadcast по segmentText', () => {
    const nodes = [node('sb', { type: 'segment_broadcast', params: { segmentText: 'VIP-клиентам' } })];
    const hits = searchBlocks(nodes, 'vip', labelOf);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('sb');
  });

  it('находит payment_link и foreach по машинному типу', () => {
    const nodes = [
      node('pl', { type: 'payment_link', params: {} }),
      node('fe', { type: 'foreach', params: {} }),
      node('m', { type: 'message', params: { text: 'привет' } }),
    ];
    expect(searchBlocks(nodes, 'payment_link', labelOf).map((h) => h.id)).toEqual(['pl']);
    expect(searchBlocks(nodes, 'foreach', labelOf).map((h) => h.id)).toEqual(['fe']);
  });

  it('snippet показывает совпавшее поле даже в длинных params', () => {
    const filler = 'x'.repeat(300);
    const nodes = [node('w', { type: 'wait', params: { note: filler, reminderText: 'секретный маркер' } })];
    const hits = searchBlocks(nodes, 'секретный маркер', labelOf);
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('секретный маркер');
    expect(hits[0].snippet.length).toBeLessThan(200);
  });

  it('пустой запрос — пустой результат', () => {
    expect(searchBlocks([node('a')], '   ', labelOf)).toEqual([]);
  });
});
