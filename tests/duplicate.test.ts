// Дублирование со связями: копия должна вести туда же, куда ведёт оригинал.
// Обычное копирование обнуляет next (copySubgraph), поэтому профи дорисовывал
// стрелки заново — эта функция закрывает именно этот случай.
import { describe, expect, it } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { duplicateWithLinks } from '../web/src/graph';
import type { NodeData } from '../web/src/graph';
import type { Block } from '../shared/types';

const node = (id: string, block: Partial<Block>): Node => ({
  id,
  type: 'bot',
  position: { x: 0, y: 0 },
  data: { block: { id, type: 'message', params: {}, ...block } as Block } as NodeData,
});

describe('duplicateWithLinks', () => {
  it('внутренняя связь перенаправляется на копию', () => {
    const nodes = [
      node('a', { type: 'buttons', params: {}, branches: { yes: 'b' } }),
      node('b', { next: '' }),
    ];
    const edges: Edge[] = [{ id: 'e-a-b', source: 'a', target: 'b', sourceHandle: 'branch:yes', label: 'yes' }];
    const copy = duplicateWithLinks(nodes, edges, ['a', 'b']);
    const [ca, cb] = copy.nodes;
    const ab = (ca.data as NodeData).block;
    expect(ab.branches?.yes).toBe(cb.id);
    expect(copy.edges.some((e) => e.source === ca.id && e.target === cb.id)).toBe(true);
  });

  it('внешняя цель остаётся прежней и связь проводится заново', () => {
    const nodes = [node('a', { next: 'outside' }), node('outside', {})];
    const copy = duplicateWithLinks(nodes, [], ['a']);
    const ca = copy.nodes[0];
    expect((ca.data as NodeData).block.next).toBe('outside');
    expect(copy.edges.some((e) => e.source === ca.id && e.target === 'outside')).toBe(true);
  });

  it('оригиналы не меняются', () => {
    const nodes = [node('a', { next: 'b' }), node('b', {})];
    const before = JSON.stringify(nodes);
    duplicateWithLinks(nodes, [], ['a', 'b']);
    expect(JSON.stringify(nodes)).toBe(before);
  });

  it('копии получают новые id и не сталкиваются с оригиналами', () => {
    const nodes = [node('a', { next: 'x' }), node('x', {})];
    const copy = duplicateWithLinks(nodes, [], ['a']);
    expect(copy.nodes[0].id).not.toBe('a');
    expect(copy.nodes[0].position.x).toBe(48);
  });

  it('пустое выделение ничего не копирует', () => {
    expect(duplicateWithLinks([], [], [])).toEqual({ nodes: [], edges: [] });
  });
});
