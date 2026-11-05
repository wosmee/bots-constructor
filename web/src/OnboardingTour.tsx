// Онбординг-тур: не «где что лежит», а «собери первого бота». Каждый шаг
// просит сделать реальное действие, а не просто указывает на элемент экрана.
// В конце у новичка остаётся работающий сценарий, а не знание, где палитра.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useT } from './i18n';
import type { TKey } from './i18n';

interface Step {
  title: TKey;
  text: TKey;
  /** Основная цель; если элемента нет — берём запасную, потом центр экрана. */
  target?: string;
  fallback?: string;
}

const STEPS: Step[] = [
  { title: 'tour.welcome.title', text: 'tour.welcome.text' },
  // Шаг 1: положить приветствие.
  { title: 'tour.step1.title', text: 'tour.step1.text', target: '.palette' },
  // Шаг 2: соединить со стартом.
  { title: 'tour.step2.title', text: 'tour.step2.text', target: '.react-flow__node', fallback: '.canvas' },
  // Шаг 3: написать свой текст в панели справа.
  { title: 'tour.step3.title', text: 'tour.step3.text', target: '.inspector', fallback: '.canvas' },
  // Шаг 4: добавить вопрос о имени и переменную.
  { title: 'tour.step4.title', text: 'tour.step4.text', target: '.palette' },
  // Шаг 5: проверить и опубликовать.
  { title: 'tour.step5.title', text: 'tour.step5.text', target: '.constructor-top' },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const CARD_W = 340;
const CARD_H = 210;

export function OnboardingTour({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = STEPS[i];

  const measure = useCallback(() => {
    const sel = step.target;
    if (!sel) {
      setRect(null);
      return;
    }
    const el = document.querySelector(sel) ?? (step.fallback ? document.querySelector(step.fallback) : null);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) {
      setRect(null);
      return;
    }
    setRect({
      top: Math.max(0, r.top - PAD),
      left: Math.max(0, r.left - PAD),
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    });
  }, [step.target, step.fallback]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    // Цель может появиться/сменить размер позже (например, открылся инспектор).
    const id = window.setInterval(measure, 600);
    return () => {
      window.removeEventListener('resize', measure);
      window.clearInterval(id);
    };
  }, [measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
      if (e.key === 'ArrowRight' || e.key === 'Enter') setI((v) => Math.min(v + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const isLast = i === STEPS.length - 1;

  // Позиции считаем как ИЗМЕРЕНИЯ, а не как анимируемые свойства: прожектор и
  // карточка стоят в углу (0,0) и переезжают трансформом. Анимация top/left
  // заставляла браузер перекладывать страницу каждый кадр.
  const spotStyle: React.CSSProperties | null = rect
    ? {
        transform: `translate3d(${rect.left}px, ${rect.top}px, 0) scale(${rect.width / 100}, ${rect.height / 100})`,
      }
    : null;

  // Карточка: под целью, если влезает, иначе над ней, иначе по центру.
  let cardX = Math.round(window.innerWidth / 2 - CARD_W / 2);
  let cardY = Math.round(window.innerHeight / 2 - CARD_H / 2);
  if (rect) {
    const below = rect.top + rect.height + 12;
    cardY = below + CARD_H < window.innerHeight - 12 ? below : Math.max(12, rect.top - CARD_H - 12);
    cardX = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - CARD_W - 12));
  }
  const cardStyle: React.CSSProperties = {
    transform: `translate3d(${cardX}px, ${cardY}px, 0)`,
    width: CARD_W,
  };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('tour.title')}>
      {rect && <div className="tour-spot" style={spotStyle ?? undefined} aria-hidden="true" />}
      {rect && (
        <div
          className="tour-frame"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
      )}
      {!rect && <div className="tour-dim" aria-hidden="true" />}

      <div className="tour-card" style={cardStyle}>
        <div className="tour-step muted">{t('tour.step', { n: i + 1, total: STEPS.length })}</div>
        <h3>{t(step.title)}</h3>
        <p className="muted">{t(step.text)}</p>
        <div className="tour-actions">
          {i > 0 && (
            <button className="ghost" onClick={() => setI((v) => v - 1)}>
              {t('tour.back')}
            </button>
          )}
          <div className="spacer" />
          <button className="ghost" onClick={onDone}>
            {t('tour.skip')}
          </button>
          <button className="primary" onClick={() => (isLast ? onDone() : setI((v) => v + 1))}>
            {isLast ? t('tour.finish') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
