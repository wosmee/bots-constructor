// Статический рендер элементов мини-аппа для холста редактора и превью.
// Один каталог компонентов на редактор и рантайм-превью: что собрал — то и
// увидел. Data-блоки в редакторе рисуют мок-строки (реальные строки приходят
// только рантайму через /m/api и не должны утекать в конструктор).
import type { JSX } from 'react';
import type { MiniElement } from '../../shared/miniapp';
import { MINI_CANVAS_W, MINI_CANVAS_H } from '../../shared/miniapp';

// F3-306: мёртвый `esc` удалён — React экранирует текстовые узлы сам,
// richtext идёт через sanitizeRichText; экспорт без вызовов вводил в
// заблуждение («тексты экранируются»).

const MOCK_ROWS: [string, string][] = [
  ['Позиция 1', '1 000 ₽'],
  ['Позиция 2', '2 000 ₽'],
  ['Позиция 3', '3 000 ₽'],
];

// Snap к краям и центру холста (порог 6px). Чистая функция — тестируется.
export function snapPosition(x: number, y: number, w: number, h: number): { x: number; y: number; snapX: number | null; snapY: number | null } {
  const TH = 6;
  let sx: number | null = null;
  let sy: number | null = null;
  let nx = x;
  let ny = y;
  for (const c of [0, (MINI_CANVAS_W - w) / 2, MINI_CANVAS_W - w]) {
    if (Math.abs(x - c) < TH) { nx = c; sx = c + w / 2; break; }
  }
  for (const c of [0, (MINI_CANVAS_H - h) / 2, MINI_CANVAS_H - h]) {
    if (Math.abs(y - c) < TH) { ny = c; sy = c + h / 2; break; }
  }
  return { x: nx, y: ny, snapX: sx, snapY: sy };
}

// Undo-стек снапшотов JSON. Чистые операции — тестируются без React.
export function pushUndo(stack: string[], state: unknown, cap = 60): string[] {
  const next = [...stack, JSON.stringify(state)];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// opts.mock !== false — data-блоки рисуют плейсхолдер-строки (реальные данные
// приходят только рантайму через /m/api). Тексты из props экранируются.
export function renderMiniElement(el: MiniElement, opts?: { mock?: boolean }): JSX.Element {
  const mock = opts?.mock !== false;
  const s = el.style || {};
  const p = el.props || {};
  const radius = s.radius ?? 10;
  const wrap = (inner: JSX.Element) => inner;

  switch (el.type) {
    case 'text':
    case 'heading': {
      const big = el.type === 'heading';
      return wrap(
        <div
          style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start',
            fontSize: s.size || (big ? 24 : 14), fontWeight: big ? 700 : 400,
            color: s.color || '#1d1d1f', textAlign: s.align || 'left',
          }}
        >
          {String(p.text ?? (big ? 'Заголовок' : 'Текст'))}
        </div>
      );
    }
    case 'button':
      return wrap(
        <div style={{ width: '100%', height: '100%', background: s.bg || '#6d5efc', color: s.color || '#fff', borderRadius: radius, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: s.size || 15, boxShadow: '0 4px 14px rgba(0,0,0,.12)' }}>
          {String(p.text ?? 'Кнопка')}
        </div>
      );
    case 'image': {
      const src = p.src as { type?: string; url?: string } | undefined;
      const hasUrl = src?.type === 'url' || src?.type === 'filebase' ? Boolean(src.url) : false;
      const grad = String(p.grad || 'linear-gradient(135deg,#dbe2ef,#c3cfe2)');
      return wrap(
        <div style={{ width: '100%', height: '100%', background: src?.type === 'tg' || !hasUrl ? grad : '#eef0f4', borderRadius: radius, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.min(el.h / 2.5, 56), overflow: 'hidden' }}>
          {hasUrl ? <img src={src!.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : String(p.emoji || '🖼')}
        </div>
      );
    }
    case 'card':
      return wrap(<div style={{ width: '100%', height: '100%', background: s.bg || '#ffffff', borderRadius: radius, boxShadow: s.shadow !== false ? '0 8px 30px rgba(0,0,0,.12)' : undefined, border: s.shadow === false ? '1px solid #e5e7eb' : undefined }} />);
    case 'input':
      return wrap(<div style={{ width: '100%', height: '100%', background: '#fff', border: '1.5px solid #d8dbe2', borderRadius: radius, display: 'flex', alignItems: p.multiline ? 'flex-start' : 'center', padding: '10px 14px', color: '#9aa0aa', fontSize: 14 }}>{String(p.ph || 'Введите…')}</div>);
    case 'divider':
      return wrap(<div style={{ width: '100%', height: '100%', background: s.bg || '#e5e7eb', borderRadius: 2 }} />);
    case 'spacer':
      return wrap(<div style={{ width: '100%', height: '100%' }} />);
    case 'form':
      return wrap(
        <div style={{ width: '100%', height: '100%', background: s.bg || '#f4f6fb', borderRadius: radius, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(Array.isArray(p.fields) ? p.fields : []).map((f: any, i: number) => (
            <div key={i} style={{ background: '#fff', border: '1.5px solid #d8dbe2', borderRadius: 8, padding: '9px 12px', color: '#9aa0aa', fontSize: 13 }}>{String(f?.label || f?.id || 'Поле')}</div>
          ))}
          <div style={{ background: '#6d5efc', color: '#fff', borderRadius: 8, padding: '10px', textAlign: 'center', fontWeight: 700, fontSize: 14, marginTop: 'auto' }}>{String(p.submit || 'Отправить')}</div>
        </div>
      );
    case 'product':
      return wrap(
        <div style={{ width: '100%', height: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: radius, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: '55%', background: 'linear-gradient(135deg,#dbe2ef,#c3cfe2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>{String(p.emoji || '🛍')}</div>
          <div style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: '#333' }}>{String(p.title || 'Товар')}</div>
          <div style={{ padding: '0 10px 8px', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <b>{String(p.price || '0 ₽')}</b>
            <span style={{ color: '#6d5efc', fontWeight: 600 }}>{String(p.button || 'Купить')}</span>
          </div>
        </div>
      );
    case 'grid':
      return mock
        ? wrap(
            <div style={{ width: '100%', height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, overflow: 'hidden' }}>
              {MOCK_ROWS.slice(0, 4).map((r, i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid #eef0f4', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ height: 52, background: 'linear-gradient(135deg,#ffd6e0,#ffc2d1)' }} />
                  <div style={{ padding: '6px 8px', fontSize: 11, color: '#333' }}>{String(r[0])}</div>
                  <div style={{ padding: '0 8px 6px', fontSize: 11, fontWeight: 700, color: '#6d5efc' }}>{String(r[1])}</div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#8a8f98' }}>📋 data-таблица «{String(p.table || '…')}»</div>
            </div>
          )
        : wrap(<div style={{ width: '100%', height: '100%' }} />);
    case 'chips':
      return mock
        ? wrap(
            <div style={{ width: '100%', height: '100%', display: 'flex', gap: 6, alignItems: 'center', overflow: 'hidden' }} title={`data-таблица «${String(p.table || '…')}»`}>
              {['все', 'значение 1', 'значение 2'].map((c, i) => (
                <span key={i} style={{ background: i === 0 ? '#6d5efc' : '#eef0f4', color: i === 0 ? '#fff' : '#555', borderRadius: 20, padding: '5px 12px', fontSize: 11, whiteSpace: 'nowrap' }}>{c}</span>
              ))}
            </div>
          )
        : wrap(<div style={{ width: '100%', height: '100%' }} />);
    case 'search':
      return mock
        ? wrap(<div style={{ width: '100%', height: '100%', background: '#fff', border: '1.5px solid #d8dbe2', borderRadius: radius, display: 'flex', alignItems: 'center', padding: '0 12px', color: '#9aa0aa', fontSize: 13 }}>🔍 Поиск по «{String(p.table || 'таблице')}»</div>)
        : wrap(<div style={{ width: '100%', height: '100%', background: '#fff', border: '1.5px solid #d8dbe2', borderRadius: radius }} />);
    case 'sort':
      return wrap(<div style={{ width: '100%', height: '100%', background: '#fff', border: '1.5px solid #d8dbe2', borderRadius: radius, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', fontSize: 12, color: '#555' }}>Сортировка: {String(p.column || '—')} <span>⇅</span></div>);
    case 'stat':
      return mock
        ? wrap(
            <div style={{ width: '100%', height: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: radius, padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1d1d1f' }}>{p.mode === 'sum' ? '12 400' : '37'}</div>
              <div style={{ fontSize: 10, color: '#8a8f98' }}>{p.mode === 'sum' ? 'сумма' : 'записей'}</div>
              <div style={{ fontSize: 10, color: '#8a8f98' }}>📋 data-таблица «{String(p.table || '…')}»</div>
            </div>
          )
        : wrap(<div style={{ width: '100%', height: '100%' }} />);
    case 'table':
      return mock
        ? wrap(
            <div style={{ width: '100%', height: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: radius, overflow: 'hidden' }}>
              <div style={{ padding: '6px 12px', fontSize: 10, color: '#8a8f98', borderBottom: '1px solid #eef0f4', background: '#fafbfc' }}>📋 data-таблица «{String(p.table || '…')}»</div>
              {MOCK_ROWS.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #eef0f4', fontSize: 12, color: '#333' }}>
                  <span>{String(r[0])}</span><b>{String(r[1])}</b>
                </div>
              ))}
            </div>
          )
        : wrap(<div style={{ width: '100%', height: '100%' }} />);
    case 'record_form':
      return wrap(
        <div style={{ width: '100%', height: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: radius, padding: 10, fontSize: 11, color: '#777', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ border: '1.5px solid #d8dbe2', borderRadius: 8, padding: '8px 10px' }}>поиск по «{String(p.searchColumn || 'полю')}»</div>
          {(Array.isArray(p.editColumns) ? p.editColumns : ['колонка 1', 'колонка 2']).slice(0, 3).map((c: any, i: number) => (
            <div key={i} style={{ border: '1.5px dashed #d8dbe2', borderRadius: 8, padding: '8px 10px' }}>{String(typeof c === 'string' ? c : c?.column || 'колонка')}</div>
          ))}
          <div style={{ background: '#6d5efc', color: '#fff', borderRadius: 8, padding: 8, textAlign: 'center', fontWeight: 700, marginTop: 'auto' }}>Сохранить</div>
        </div>
      );
    case 'user_list':
      return wrap(
        <div style={{ width: '100%', height: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: radius, overflow: 'hidden' }}>
          {[['Марк', 'VIP'], ['Аня', '—'], ['Боря', 'мастер']].map((r, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #eef0f4', fontSize: 12, color: '#333' }}>
              <span>{r[0]}</span><span style={{ color: '#8a8f98' }}>{r[1]}</span>
            </div>
          ))}
        </div>
      );
    case 'user_info':
      return wrap(
        <div style={{ width: '100%', height: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: radius, padding: 12, fontSize: 12, color: '#333' }}>
          <b>{'{user.name}'}</b>
          <div style={{ color: '#8a8f98', fontSize: 11 }}>id {'{user.id}'} · теги: {'{user.tags}'}</div>
        </div>
      );
    case 'support':
      return wrap(
        <div style={{ width: '100%', height: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: radius, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#333' }}>Обращение в поддержку</div>
          <div style={{ border: '1.5px solid #d8dbe2', borderRadius: 8, padding: '8px 10px', color: '#9aa0aa', fontSize: 11, flex: 1 }}>Текст обращения…</div>
          <div style={{ background: '#6d5efc', color: '#fff', borderRadius: 8, padding: 8, textAlign: 'center', fontWeight: 700, fontSize: 12 }}>Отправить</div>
        </div>
      );
    case 'refresh':
      return wrap(<div style={{ width: '100%', height: '100%', background: '#fff', border: '1.5px solid #d8dbe2', borderRadius: radius, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#555' }}>⟳ Обновить</div>);
    case 'richtext':
      // dangerouslySetInnerHTML безопасен: props.html проходит sanitizeRichText
      // в инспекторе при каждом изменении и повторно — на публикации (воркер).
      return wrap(
        <div
          style={{ width: '100%', height: '100%', overflow: 'hidden', fontSize: s.size || 14, color: s.color || '#1d1d1f', textAlign: s.align || 'left' }}
          dangerouslySetInnerHTML={{ __html: String(p.html ?? '<b>Богатый текст</b>') }}
        />
      );
    case 'carousel': {
      // Лента слайдов из props.items; пока слайдов нет — три мок-заглушки.
      const items: any[] = Array.isArray(p.items) ? p.items : [];
      const slides: any[] = items.length ? items.slice(0, 5) : [null, null, null];
      return wrap(
        <div style={{ width: '100%', height: '100%', display: 'flex', gap: 8, overflowX: 'auto' }}>
          {slides.map((it, i) => (
            <div key={i} style={{ flex: '0 0 70%', height: '100%', borderRadius: radius, overflow: 'hidden', background: 'linear-gradient(135deg,#dbe2ef,#c3cfe2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', fontSize: 28 }}>
              {typeof it?.url === 'string' && it.url ? <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🖼'}
              {typeof it?.caption === 'string' && it.caption ? (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '4px 8px', background: 'rgba(0,0,0,.45)', color: '#fff', fontSize: 11 }}>{String(it.caption)}</div>
              ) : null}
            </div>
          ))}
        </div>
      );
    }
    case 'video': {
      const url = String(p.url ?? '');
      const yt = /youtu\.be|youtube\.com/i.test(url);
      return wrap(
        <div style={{ width: '100%', height: '100%', background: '#111', borderRadius: radius, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: yt ? '#ff0000' : 'rgba(255,255,255,.2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>▶</div>
          <div style={{ color: '#fff', fontSize: 11, opacity: 0.85 }}>{yt ? 'YouTube' : 'видео'}</div>
        </div>
      );
    }
    case 'ai_gen':
      return wrap(
        <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#ecfdf5,#d1fae5)', border: '1px solid #a7f3d0', borderRadius: radius, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#065f46' }}>✨ AI-генерация</div>
          <div style={{ border: '1.5px solid #a7f3d0', background: '#fff', borderRadius: 8, padding: '8px 10px', color: '#9aa0aa', fontSize: 11, flex: 1 }}>{String(p.placeholder || 'Опиши картинку…')}</div>
          <div style={{ background: '#10b981', color: '#fff', borderRadius: 8, padding: 8, textAlign: 'center', fontWeight: 700, fontSize: 12 }}>Сгенерировать</div>
        </div>
      );
    default:
      return wrap(<div style={{ width: '100%', height: '100%', background: '#f3f4f6', borderRadius: 8 }} />);
  }
}
