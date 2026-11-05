// A4: error boundary. Чистая логика (boundaryCore.ts) проверяется в node без
// DOM; интеграция — source-level утверждениями по текстам файлов.
// (Модуль назван boundaryCore, а не errorBoundary: на Windows имя
// errorBoundary.ts неразличимо по регистру с ErrorBoundary.tsx — TS1149.)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_ERROR_MESSAGE,
  boundaryFallbackState,
  boundaryInitialState,
  errorToMessage,
} from '../web/src/boundaryCore';

const readSrc = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('errorToMessage', () => {
  it('достаёт message из Error', () => {
    expect(errorToMessage(new Error('x'))).toBe('x');
  });

  it('Error без message — имя ошибки, не пустота', () => {
    expect(errorToMessage(new Error(''))).toBe('Error');
  });

  it('строка возвращается как есть', () => {
    expect(errorToMessage('строка')).toBe('строка');
  });

  it('undefined/null/число не бросают', () => {
    expect(() => errorToMessage(undefined)).not.toThrow();
    expect(() => errorToMessage(null)).not.toThrow();
    expect(() => errorToMessage(42)).not.toThrow();
    expect(errorToMessage(undefined)).toBe('');
    expect(errorToMessage(null)).toBe('');
    expect(errorToMessage(42)).toBe('42');
  });

  it('объект с message обрабатывается как Error-подобный', () => {
    expect(errorToMessage({ message: 'api down' })).toBe('api down');
  });

  it('объект с бросающим toString не роняет обработку', () => {
    const evil = { toString() { throw new Error('boom'); } };
    expect(() => errorToMessage(evil)).not.toThrow();
  });

  it('переносы строк схлопываются', () => {
    expect(errorToMessage(new Error('a\n\n  b'))).toBe('a b');
  });

  it('длинный message обрезается до лимита с многоточием', () => {
    const long = 'x'.repeat(MAX_ERROR_MESSAGE + 100);
    const out = errorToMessage(new Error(long));
    expect(out.length).toBe(MAX_ERROR_MESSAGE);
    expect(out.endsWith('…')).toBe(true);
  });

  it('короткий message не обрезается', () => {
    expect(errorToMessage(new Error('short'))).toBe('short');
  });
});

describe('boundaryFallbackState', () => {
  it('возвращает hasError:true и текст ошибки', () => {
    const st = boundaryFallbackState(new Error('render fail'));
    expect(st.hasError).toBe(true);
    expect(st.hasError && st.message).toBe('render fail');
  });

  it('начальное состояние — без ошибки', () => {
    expect(boundaryInitialState.hasError).toBe(false);
  });
});

describe('интеграция boundary в исходниках (A4)', () => {
  it('main.tsx оборачивает <App /> в ErrorBoundary', () => {
    const src = readSrc('../web/src/main.tsx');
    expect(src).toContain('ErrorBoundary');
    expect(src.indexOf('<ErrorBoundary')).toBeGreaterThan(-1);
    expect(src.indexOf('<ErrorBoundary')).toBeLessThan(src.indexOf('<App'));
    expect(src.indexOf('</ErrorBoundary>')).toBeGreaterThan(src.indexOf('<App'));
  });

  it('Constructor.tsx содержит локальный boundary холста', () => {
    const src = readSrc('../web/src/Constructor.tsx');
    expect(src).toContain('<ErrorBoundary');
    expect(src).toContain('renderFallback');
  });

  it('ErrorBoundary.tsx реализует оба хука перехвата', () => {
    const src = readSrc('../web/src/ErrorBoundary.tsx');
    expect(src).toContain('getDerivedStateFromError');
    expect(src).toContain('componentDidCatch');
  });
});
