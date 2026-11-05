// Хост для выхода поверхности. Поверхности в этом коде монтируются по условию
// (`{showX && <Modal/>}`), поэтому исчезали они за 0 мс, а появлялись плавно.
// Хост держит ребёнка смонтированным во время выхода и вешает класс
// `is-closing`; CSS сам решает, что в этот момент анимировать — саму панель
// или её затемнение.
//
// `display: contents` — важное: хост не создаёт бокс, поэтому раскладка
// страницы не меняется, а селекторы `.exit-host > *` продолжают работать.
import type { ReactNode } from 'react';
import { useExitAnimation } from './useExitAnimation';

export function ExitHost({ open, children }: { open: boolean; children: ReactNode }) {
  const { mounted, closing } = useExitAnimation(open);
  if (!mounted) return null;
  return <div className={`exit-host${closing ? ' is-closing' : ''}`}>{children}</div>;
}
