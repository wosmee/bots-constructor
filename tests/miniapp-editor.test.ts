// Редактор мини-аппов: чистые функции (snap, undo) и гейт валидации схемы.
import { describe, expect, it } from 'vitest';
import { snapPosition, pushUndo } from '../web/src/miniRender';
import { validateMiniAppShape, miniElement, emptyMiniApp } from '../shared/miniapp';

describe('snapPosition', () => {
  it('притягивает к левому краю и центру по X', () => {
    const a = snapPosition(4, 100, 200, 50);
    expect(a.x).toBe(0);
    expect(a.snapX).toBe(100);
    const b = snapPosition(97, 100, 200, 50); // центр = (390-200)/2 = 95
    expect(b.x).toBe(95);
  });
  it('вне порога 6px не притягивает', () => {
    const a = snapPosition(40, 300, 200, 50);
    expect(a.x).toBe(40);
    expect(a.snapX).toBeNull();
    expect(a.snapY).toBeNull();
  });
  it('притягивает к верху и вертикальному центру', () => {
    const a = snapPosition(50, 3, 100, 80);
    expect(a.y).toBe(0);
    const b = snapPosition(50, 384, 100, 80); // (844-80)/2 = 382
    expect(b.y).toBe(382);
  });
});

describe('pushUndo', () => {
  it('копит снапшоты и держит потолок', () => {
    let stack: string[] = [];
    for (let i = 0; i < 70; i++) stack = pushUndo(stack, { i });
    expect(stack).toHaveLength(60);
    expect(JSON.parse(stack[stack.length - 1])).toEqual({ i: 69 });
  });
});

describe('гейт схемы редактора', () => {
  it('валидная схема проходит, битая — нет', () => {
    const app = emptyMiniApp('p1');
    app.pages = [{ id: 'p1', name: 'Главная', bg: '#fff', els: [miniElement('text', 'e1', 10, 10)] }];
    expect(validateMiniAppShape(app)).toBe(true);
    const bad = JSON.parse(JSON.stringify(app));
    bad.pages[0].els[0].x = 'left';
    expect(validateMiniAppShape(bad)).toBe(false);
    const bad2 = JSON.parse(JSON.stringify(app));
    bad2.startPageId = 'nope';
    expect(validateMiniAppShape(bad2)).toBe(false);
  });
});
