// Чистая логика error boundary (A4): извлечение текста ошибки из unknown,
// начальное и аварийное состояние. Без JSX и DOM — модуль тестируется
// в node-окружении (tests/error-boundary.test.ts).
import type { ReactNode } from 'react';

// Текст ошибки показывается в карточке fallback — длинный вывод (например,
// JSON) обрезаем, чтобы не разорвать вёрстку.
export const MAX_ERROR_MESSAGE = 200;

export type ErrorBoundaryState =
  | { hasError: false }
  | { hasError: true; message: string; error: unknown };

export interface ErrorBoundaryProps {
  children: ReactNode;
  // Вызывается из componentDidCatch: логирование/метрики на стороне вызывающего.
  onError?: (error: unknown, info: unknown) => void;
  // Fallback целиком задаёт вызывающий — компонент не содержит строк вне i18n.
  renderFallback: (error: unknown) => ReactNode;
}

// Короткий человекочитаемый текст из чего угодно: Error, строка, число,
// объект с message. Стек не выводится, переносы строк схлопываются.
export function errorToMessage(e: unknown): string {
  let raw = '';
  if (typeof e === 'string') {
    raw = e;
  } else if (e instanceof Error) {
    raw = e.message || e.name;
  } else if (typeof e === 'number' || typeof e === 'boolean' || typeof e === 'bigint') {
    raw = String(e);
  } else if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    raw = (e as { message: string }).message;
  } else if (e != null) {
    // Экзотика (объект без message, symbol, функция): String() может бросить
    // на объекте с null-прототипом — не роняем обработку ошибки.
    try {
      raw = String(e);
    } catch {
      raw = '';
    }
  }
  raw = raw.replace(/\s+/g, ' ').trim();
  if (raw.length > MAX_ERROR_MESSAGE) {
    raw = raw.slice(0, MAX_ERROR_MESSAGE - 1) + '…';
  }
  return raw;
}

export const boundaryInitialState: ErrorBoundaryState = { hasError: false };

// Результат getDerivedStateFromError: состояние fallback с текстом ошибки.
export function boundaryFallbackState(error: unknown): ErrorBoundaryState {
  return { hasError: true, message: errorToMessage(error), error };
}
