// React error boundary (A4). Класс-компонент: getDerivedStateFromError ловит
// исключение рендера, componentDidCatch передаёт его наружу через onError.
// Сам компонент строк не содержит — fallback целиком задаёт renderFallback.
import { Component } from 'react';
import type { ReactNode } from 'react';
import {
  boundaryFallbackState,
  boundaryInitialState,
  type ErrorBoundaryProps,
  type ErrorBoundaryState,
} from './boundaryCore';

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = boundaryInitialState;

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return boundaryFallbackState(error);
  }

  componentDidCatch(error: unknown, info: unknown): void {
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    const st = this.state;
    if (!st.hasError) return this.props.children;
    return this.props.renderFallback(st.error);
  }
}
