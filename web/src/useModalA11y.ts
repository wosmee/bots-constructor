// Доступность модальных окон (WU-05/UX-02): закрытие по Esc, начальный фокус
// внутри окна и цикл Tab, который не выпускает фокус под бэкдроп.
//
// Хук возвращает callback-ref, который вешается на элемент `.modal`. Работает
// и с окнами-компонентами (LogsModal, SettingsModal…), и с инлайн-окнами,
// которые монтируются по условию внутри большого компонента (модалки
// конструктора): ref-колбэк фиксирует появление узла, эффекты переставляются.
// onClose=null — окно принципиально не закрывается: Esc не вешается, ловушка
// фокуса продолжает работать.
import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function useModalA11y<T extends HTMLElement>(onClose?: (() => void) | null) {
  const [el, setEl] = useState<T | null>(null);
  // onClose держим в ref: инлайн-стрелки в JSX меняют идентичность каждый
  // рендер, а переподписывать document-слушатель из-за этого незачем.
  const closeRef = useRef(onClose ?? null);
  closeRef.current = onClose ?? null;
  const hasClose = onClose != null;

  // Esc закрывает окно — слушатель на document, чтобы срабатывать независимо
  // от того, где сейчас фокус (в том числе в поле ввода внутри окна). Активен
  // только пока узел окна в DOM: инлайн-модалки зовут хук безусловно.
  useEffect(() => {
    if (!el || !hasClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [el, hasClose]);

  // Начальный фокус — на первом контроле окна; Tab/Shift+Tab зациклены внутри.
  // Если фокус уже внутри (например, сработал autoFocus или окно открыли
  // повторно без размонтирования), позицию курсора не трогаем.
  useEffect(() => {
    if (!el) return;
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!el.contains(document.activeElement)) items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [el]);

  // Стабильная идентичность: иначе React на каждом рендере отцепляет/цепляет
  // ref заново и эффект начального фокуса перезапускается.
  return useCallback((node: T | null) => setEl(node), []);
}
