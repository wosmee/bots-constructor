import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import { useT } from './i18n';
// Дизайн-система одна на всё приложение; стили холста (@xyflow + переопределения)
// уехали в ленивый чанк конструктора — см. Constructor.tsx.
import './styles.css';

// Полноэкранный fallback корневого boundary: без него исключение в рендере
// размонтирует всё дерево и пользователь видит голый фон body — «серую страницу».
// Строки — только через i18n, стили — существующие классы (.login-screen/.login-card).
function AppErrorFallback() {
  const t = useT();
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>{t('error.app.title')}</h1>
        <p className="muted">{t('error.app.text')}</p>
        <button className="primary" onClick={() => window.location.reload()}>
          {t('error.reload')}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary onError={(error, info) => console.error('[app] render error', error, info)} renderFallback={() => <AppErrorFallback />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
