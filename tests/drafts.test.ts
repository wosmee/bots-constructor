// F9: несохранённые правки живут на сервере. От решения «показать черновик /
// выбросить его» зависит, потеряет ли автор работу, поэтому логика проверяется
// отдельно от компонента.
import { describe, expect, it } from 'vitest';
import { decideDraft, shouldFlushDraft } from '../web/src/drafts';

const saved = JSON.stringify({ version: 1, start: 'a', blocks: { a: { id: 'a', type: 'start', params: {} } } });

describe('decideDraft', () => {
  it('черновика нет — ничего не показываем и не удаляем', () => {
    expect(decideDraft(saved, null)).toEqual({ kind: 'none' });
    expect(decideDraft(saved, { flow_json: '', updated_at: 1 })).toEqual({ kind: 'none' });
  });

  it('черновик совпадает с сохранённым — он больше не нужен', () => {
    expect(decideDraft(saved, { flow_json: saved, updated_at: 5 }).kind).toBe('same');
  });

  it('черновик совпадает по содержимому, даже если JSON собран иначе', () => {
    // Другой порядок ключей и пробелы — это всё тот же сценарий, а не правка.
    const reformatted = JSON.stringify(JSON.parse(saved), null, 2);
    expect(decideDraft(saved, { flow_json: reformatted, updated_at: 5 }).kind).toBe('same');
  });

  it('черновик отличается — показываем и передаём время', () => {
    const changed = JSON.stringify({
      version: 1,
      start: 'a',
      blocks: { a: { id: 'a', type: 'start', params: {} }, b: { id: 'b', type: 'message', params: { text: 'да' } } },
    });
    const verdict = decideDraft(saved, { flow_json: changed, updated_at: 1234 });
    expect(verdict).toEqual({ kind: 'differs', updatedAt: 1234 });
  });
});

describe('shouldFlushDraft', () => {
  it('совпадение с сохранённым не отправляем', () => {
    expect(shouldFlushDraft(saved, saved, '')).toBe(false);
  });

  it('повторную отправку того же JSON не делаем', () => {
    expect(shouldFlushDraft('{"x":1}', saved, '{"x":1}')).toBe(false);
  });

  it('новые правки отправляем', () => {
    expect(shouldFlushDraft('{"x":1}', saved, '')).toBe(true);
    expect(shouldFlushDraft('{"x":2}', saved, '{"x":1}')).toBe(true);
  });

  it('пустой JSON не отправляем', () => {
    expect(shouldFlushDraft('', saved, '')).toBe(false);
  });
});
