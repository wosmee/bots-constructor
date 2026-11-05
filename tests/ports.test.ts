// Порты блоков (F5): у каждой исходящей ветки свой порт, поэтому куда ведёт
// кнопка — видно на холсте, а не только в списке инспектора.
import { describe, expect, it } from 'vitest';
import type { Block } from '../shared/types';
import { handleIdFor, hasPort, parseHandleId, portsForNode, portsOf } from '../web/src/ports';

const B = (type: Block['type'], params: Block['params'] = {}, branches?: Record<string, string>): Block => ({
  id: 'b',
  type,
  params,
  branches,
});

describe('portsOf', () => {
  it('две кнопки — два порта, подписанных текстом кнопок', () => {
    const ports = portsOf(
      B('buttons', { buttons: [{ label: 'Каталог', value: 'cat' }, { label: 'Помощь', value: 'help' }] })
    );
    expect(ports.map((p) => p.label)).toEqual(['Каталог', 'Помощь']);
    expect(ports.map((p) => p.id)).toEqual(['branch:cat', 'branch:help']);
  });

  it('кнопка-ссылка порта не создаёт: у неё нет перехода', () => {
    const ports = portsOf(
      B('buttons', {
        buttons: [
          { label: 'Каталог', value: 'cat' },
          { label: 'Сайт', value: '', url: 'https://example.com' },
        ],
      })
    );
    expect(ports.map((p) => p.label)).toEqual(['Каталог']);
  });

  it('удаление кнопки убирает её порт', () => {
    const before = portsOf(B('buttons', { buttons: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] }));
    const after = portsOf(B('buttons', { buttons: [{ label: 'A', value: 'a' }] }));
    expect(before).toHaveLength(2);
    expect(after.map((p) => p.id)).toEqual(['branch:a']);
    expect(hasPort(B('buttons', { buttons: [{ label: 'A', value: 'a' }] }), 'b')).toBe(false);
    expect(hasPort(B('buttons', { buttons: [{ label: 'A', value: 'a' }] }), 'a')).toBe(true);
  });

  it('условие — порты «да» и «нет»', () => {
    const ports = portsOf(B('condition', {}), 'ru');
    expect(ports.map((p) => p.id)).toEqual(['branch:then', 'branch:else']);
    expect(ports.map((p) => p.label)).toEqual(['да', 'нет']);
  });

  it('у «Перехода» и «Конца» портов нет', () => {
    expect(portsOf(B('goto', { target: 'x' }))).toEqual([]);
    expect(portsOf(B('end', {}))).toEqual([]);
  });

  it('обычный блок получает единственный порт «next»', () => {
    const ports = portsOf(B('message', { text: 'привет' }));
    expect(ports).toHaveLength(1);
    expect(ports[0].kind).toBe('next');
    expect(ports[0].id).toBe('next');
  });

  it('ветвящийся блок получает отдельный общий выход, если у него задан next', () => {
    const block = { ...B('condition', {}), next: 'after' };
    expect(portsOf(block).map((p) => p.id)).toEqual(['branch:then', 'branch:else', 'next']);
  });

  it('«Заметка» тоже пропускает поток дальше — у неё есть next', () => {
    expect(portsOf(B('note', { note: 'тут' })).map((p) => p.id)).toEqual(['next']);
  });

  it('переключатель: порт на каждый вариант плюс «иначе»', () => {
    const ports = portsOf(B('switch', { cases: [{ value: 'Москва' }, { value: 'СПб' }] }), 'ru');
    expect(ports.map((p) => p.id)).toEqual(['branch:c0', 'branch:c1', 'branch:default']);
    expect(ports.map((p) => p.label)).toEqual(['Москва', 'СПб', 'иначе']);
  });

  it('оплата — порты «оплатил» и «отменил»', () => {
    expect(portsOf(B('invoice', {}), 'ru').map((p) => p.label)).toEqual(['оплатил', 'отменил']);
  });

  it('данные — порты «найдено» и «не найдено»', () => {
    expect(portsOf(B('data', {}), 'ru').map((p) => p.label)).toEqual(['найдено', 'не найдено']);
  });

  it('ключевые слова — «есть совпадение» и «нет совпадения»', () => {
    expect(portsOf(B('keyword', {}), 'ru').map((p) => p.label)).toEqual(['есть совпадение', 'нет совпадения']);
  });

  it('пока английский словарь не догружен, подписи остаются русскими, а не пустыми', () => {
    // EN-словарь приезжает отдельным чанком (см. loadDict в i18n.ts). До его
    // загрузки translate отдаёт русский текст — пустая подпись хуже русской.
    const labels = portsOf(B('condition', {}), 'en').map((p) => p.label);
    expect(labels.every((l) => l.length > 0)).toBe(true);
  });

  it('случайный выбор — порт на каждую ветку с весом', () => {
    const ports = portsOf(B('random', { options: [{ key: 'a', weight: 1 }, { key: 'b', weight: 3 }] }));
    expect(ports.map((p) => p.id)).toEqual(['branch:a', 'branch:b']);
    expect(ports.map((p) => p.label)).toEqual(['a · 1', 'b · 3']);
  });

  it('меню — порты по кнопкам, как у кнопок', () => {
    const ports = portsOf(B('menu', { buttons: [{ label: 'Пункт 1', value: 'm1' }] }));
    expect(ports.map((p) => p.label)).toEqual(['Пункт 1']);
  });

  // F2/F3: тег и цепочка — обычные блоки потока, развилок у них нет.
  it('тег — один порт next: развилки у него нет', () => {
    expect(portsOf(B('tag', { tagOp: 'add', tagName: 'vip' })).map((p) => p.id)).toEqual(['next']);
  });

  it('цепочка — один порт next', () => {
    expect(portsOf(B('chain', { chainItems: [{ kind: 'text', text: 'привет' }] })).map((p) => p.id)).toEqual(['next']);
  });

  // --- набор 2026-09: ключи веток сверены с движком (contract в CODEBASE.md) ---
  it('ожидание — порты «ответил» и «таймаут»', () => {
    const ports = portsOf(B('wait', { seconds: 60 }), 'ru');
    expect(ports.map((p) => p.id)).toEqual(['branch:reply', 'branch:timeout']);
    expect(ports.map((p) => p.label)).toEqual(['ответил', 'таймаут']);
  });

  it('опрос — «ответил» и «пропустил»', () => {
    expect(portsOf(B('poll', {}), 'ru').map((p) => p.id)).toEqual(['branch:answered', 'branch:skipped']);
  });

  it('пересылка — «переслано» и «не удалось»', () => {
    expect(portsOf(B('forward', {}), 'ru').map((p) => p.id)).toEqual(['branch:ok', 'branch:failed']);
  });

  it('проверка канала — три порта: состоит / не состоит / ошибка', () => {
    expect(portsOf(B('channel_check', {}), 'ru').map((p) => p.id)).toEqual([
      'branch:member',
      'branch:not_member',
      'branch:error',
    ]);
  });

  it('рассылка сегменту — «в очереди» и «пусто»', () => {
    expect(portsOf(B('segment_broadcast', {}), 'ru').map((p) => p.id)).toEqual(['branch:queued', 'branch:empty']);
  });

  it('платёжная ссылка — «создано» и «не удалось»', () => {
    expect(portsOf(B('payment_link', {}), 'ru').map((p) => p.id)).toEqual(['branch:created', 'branch:failed']);
  });

  it('проверка оплаты — три порта: оплачено / ждём / не удалось', () => {
    expect(portsOf(B('payment_check', {}), 'ru').map((p) => p.id)).toEqual([
      'branch:paid',
      'branch:pending',
      'branch:failed',
    ]);
    expect(portsOf(B('payment_check', {}), 'ru').map((p) => p.label)).toEqual(['оплатил', 'ждём оплату', 'не удалось']);
  });

  it('цикл — «итерация» (обратная связь) и «список закончился»', () => {
    const ports = portsOf(B('foreach', {}), 'ru');
    expect(ports.map((p) => p.id)).toEqual(['branch:each', 'branch:done']);
    expect(ports.map((p) => p.label)).toEqual(['итерация', 'список закончился']);
  });

  it('утверждение — «прошло» и «не прошло»', () => {
    expect(portsOf(B('assert', {}), 'ru').map((p) => p.label)).toEqual(['прошло', 'не прошло']);
  });

  it('счётчик — «ок» и «лимит достигнут»', () => {
    expect(portsOf(B('counter', {}), 'ru').map((p) => p.id)).toEqual(['branch:ok', 'branch:limit_reached']);
  });

  it('подписи новых портов — человеческие, а не машинные ключи', () => {
    for (const type of ['wait', 'poll', 'forward', 'channel_check', 'segment_broadcast', 'payment_link', 'payment_check', 'foreach', 'assert', 'counter'] as const) {
      for (const p of portsOf(B(type, {}), 'ru')) {
        expect(p.label.length, `${type}:${p.branchKey}`).toBeGreaterThan(0);
        expect(p.label.startsWith('port.'), `${type}:${p.branchKey} — сырой ключ`).toBe(false);
        expect(p.label, `${type}:${p.branchKey} не должен быть машинным id`).not.toBe(p.branchKey);
      }
    }
  });
});

describe('handle id', () => {
  it('осиротевшая ветка получает порт с техническим ключом, а не теряет стрелку', () => {
    // Так бывает у старых сценариев: кнопку удалили, запись в branches осталась.
    // Без порта React Flow не найдёт источник связи и стрелка пропадёт молча.
    const block = B('buttons', { buttons: [{ label: 'Да', value: 'yes' }] }, { yes: 'a', gone: 'b' });
    const ids = portsForNode(block).map((p) => p.id);
    expect(ids).toContain('branch:yes');
    expect(ids).toContain('branch:gone');
  });

  it('живые ветки не дублируются осиротевшими портами', () => {
    const block = B('condition', {}, { then: 'a', else: 'b' });
    const ids = portsForNode(block).map((p) => p.id);
    expect(ids).toEqual(['branch:then', 'branch:else']);
  });

  it('у «Конца» и «Перехода» осиротевшие ветки портов не создают', () => {
    expect(portsForNode(B('end', {}, { x: 'a' }))).toEqual([]);
    expect(portsForNode(B('goto', { target: 'a' }, { x: 'a' }))).toEqual([]);
  });

  it('кодирует и разбирает адрес ветки', () => {
    expect(handleIdFor('next')).toBe('next');
    expect(handleIdFor('branch', 'cat')).toBe('branch:cat');
    expect(parseHandleId('branch:cat')).toEqual({ kind: 'branch', branchKey: 'cat' });
    expect(parseHandleId('next')).toEqual({ kind: 'next' });
  });

  it('порт кнопки с двоеточием в ключе разбирается целиком', () => {
    expect(parseHandleId(handleIdFor('branch', 'a:b'))).toEqual({ kind: 'branch', branchKey: 'a:b' });
  });
});
