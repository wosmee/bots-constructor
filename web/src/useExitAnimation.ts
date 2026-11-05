// Выходящая анимация для поверхностей, которые в коде живут по условию
// `{showX && <…>}`. Раньше они появлялись плавно и исчезали за 0 мс — из-за
// этой асимметрии интерфейс читался как дёрганый. Хук держит узел смонтированным
// ровно на время выхода (exit короче входа, ~0.6×) и сообщает об этом классом.
import { useCallback, useEffect, useRef, useState } from 'react';

/** Длительность выхода, мс. Вход модалки — 280ms, выход ≈ 0.6×. */
export const EXIT_MS = 170;

export function useExitAnimation(open: boolean, duration: number = EXIT_MS) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      // Возврат во время выхода: снимаем «закрывающийся» класс, не монтируя заново.
      setClosing(false);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setClosing(false);
      setMounted(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      setClosing(false);
      setMounted(false);
    }, duration);
    return () => window.clearTimeout(timer.current);
  }, [open, duration, mounted]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { mounted, closing };
}

/**
 * Тот же приём без хука — для узлов, которые нельзя переписать на компонент
 * (например, поповер внутри уже существующей разметки). Возвращает имя класса.
 */
export function exitClass(closing: boolean): string {
  return closing ? ' is-closing' : '';
}

/** Управляемый «закрыть с анимацией» для императивных закрытий. */
export function useClosing(close: () => void, duration: number = EXIT_MS) {
  const [closing, setClosing] = useState(false);
  const start = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      close();
    }, duration);
  }, [close, duration]);
  return { closing, start };
}
