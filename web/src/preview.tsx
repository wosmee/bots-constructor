// Превью сценария: прогон настоящим движком на воркере (/simulate).
//
// Раньше здесь был второй, «локальный» интерпретатор, работавший прямо в
// браузере. Он не знал блоки «Оплата», «Альбом», «Рефералка» и веса в
// «Случайном», то есть гарантированно расходился с продом: автор видел не то,
// что реально сделает бот. Две разные логики хуже, чем отсутствие прогона при
// недоступном воркере, поэтому локальная копия удалена.
//
// Правило остаётся: семантику блоков превью НЕ воспроизводит. Все строки лога
// ([опрос], [правка сообщения], [цикл: 2/5], …) формирует воркер в
// simulateScenario — здесь они только отображаются. Служебные вводы прогона
// (member:, paid:, document:, …) — те же строки, которые понимает воркер.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useT, type TKey } from './i18n';
import { useSettings } from './settings';
import { friendlyApiError } from './journey';
import { Send } from './icons';
import type { Scenario } from '../../shared/types';
import './preview.css';

// Обратный отсчёт блока «Ожидание»: чисто визуальная подача — сколько секунд
// блок будет ждать перед веткой «таймаут». Семантику это не воспроизводит:
// сам прогон делает движок на воркере, здесь только цифры из params блока.
function WaitCountdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    if (seconds <= 0) return;
    const id = window.setInterval(() => setLeft((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [seconds]);
  if (seconds <= 0) return null;
  return <span className="badge accent mono">{left}s</span>;
}

// Служебные вводы /simulate: переключают заглушки воркера (членство в канале,
// статус оплаты) и имитируют вложения. Клик по чипсу отправляет ввод как есть —
// ветки новых блоков проверяются без живого бота.
const SIM_INPUTS: { value: string; label: TKey }[] = [
  { value: 'member:', label: 'preview.sim.member' },
  { value: 'notmember:', label: 'preview.sim.notMember' },
  { value: 'paid:', label: 'preview.sim.paid' },
  { value: 'pending:', label: 'preview.sim.pending' },
  { value: 'failed:', label: 'preview.sim.failed' },
  { value: 'document:', label: 'preview.sim.document' },
  { value: 'video:', label: 'preview.sim.video' },
  { value: 'voice:', label: 'preview.sim.voice' },
  { value: 'audio:', label: 'preview.sim.audio' },
  { value: 'any:', label: 'preview.sim.any' },
];

export function PreviewServer({
  botId,
  flowJson,
  structureKey,
}: {
  botId: string;
  flowJson: string;
  // Меняется только при изменении СОДЕРЖИМОГО графа (не позиций) — иначе
  // превью сбрасывалось на каждое перетаскивание блока.
  structureKey: string;
}) {
  const t = useT();
  const language = useSettings().language;
  const [log, setLog] = useState<{ who: 'bot' | 'user'; text: string }[]>([]);
  const [pending, setPending] = useState<{ kind: string; prompt?: string; buttons?: { label: string; value: string }[] } | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [inputs, setInputs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(
    async (next: string[]) => {
      setBusy(true);
      setError('');
      try {
        const r: any = await api.simulate(botId, flowJson, next);
        setLog(r?.log ?? []);
        setPending(r?.pending ?? null);
        setVars(r?.vars ?? {});
        setInputs(next);
      } catch (e: any) {
        setError(friendlyApiError(e, language) || t('preview.runUnavailable'));
      } finally {
        setBusy(false);
      }
    },
    [botId, flowJson, language, t]
  );

  // Перезапускаем прогон при изменении сценария (но не позиций блоков).
  useEffect(() => {
    run(['/start']);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [structureKey]);

  const submit = (val: string) => {
    if (busy || !val) return;
    run([...inputs, val]);
  };

  // Строки лога вида «[опрос] …», «[правка сообщения] …» — не сообщения бота,
  // а системные события прогона. Отличаем их оформлением, чтобы автор не
  // принимал квадратные скобки за текст, который увидит пользователь.
  const isSystem = (text: string) => text.startsWith('[') && text.includes(']');

  // Меню бота (блок «Меню»): reply-клавиатура живёт в служебной переменной
  // __menu и остаётся активной до следующего блока «Меню». В бою нажатие
  // приходит обычным текстом подписи — движок матчит его по __menu, поэтому
  // в прогоне отправляем ровно тот же ввод. Раньше кнопки меню в превью
  // вообще не было: пройти ветки меню можно было только вслепую.
  const menuButtons = useMemo(() => {
    const raw = vars['__menu'];
    if (!raw) return [];
    try {
      const menu = JSON.parse(String(raw));
      return Array.isArray(menu?.buttons) ? menu.buttons.filter((b: { label?: string }) => b?.label) : [];
    } catch {
      return [];
    }
  }, [vars]);

  // Ввод свободным текстом ждёт не только «Ввод»/«Ключевое слово»: блоки
  // «Ожидание» (wait) и «Контакт» принимают любой ответ.
  const wantsText =
    pending && (pending.kind === 'input' || pending.kind === 'keyword' || pending.kind === 'contact' || pending.kind === 'wait');

  // Для pending.wait находим блок в сценарии, чтобы показать его секунды и
  // ветки. Ищем по совпадению prompt; запасной вариант — единственный wait в
  // сценарии (обычный случай: двух одновременно ждущих wait не бывает).
  const waitBlock = useMemo(() => {
    if (pending?.kind !== 'wait') return null;
    try {
      const sc = JSON.parse(flowJson) as Scenario;
      const waits = Object.values(sc.blocks ?? {}).filter((b) => b.type === 'wait');
      return waits.find((b) => (b.params.prompt || '') === (pending.prompt || '')) ?? (waits.length === 1 ? waits[0] : null);
    } catch {
      return null;
    }
  }, [pending, flowJson, inputs.length]);

  return (
    <div className="preview">
      <div className="preview-head">
        <span>{t('preview.title')}</span>
        <span className="muted preview-badge" title={t('preview.serverBadge.title')}>
          {t('preview.serverBadge')} {busy ? t('auth.busy') : ''}
        </span>
        <button className="ghost" onClick={() => run(['/start'])} disabled={busy}>
          {t('preview.restart')}
        </button>
      </div>
      {error && <div className="err">{error}</div>}
      <div className="preview-chat">
        {log.map((m, i) => (
          <div
            key={i}
            className={
              m.who === 'user' ? 'bubble user' : isSystem(m.text) ? 'bubble bot sys' : 'bubble bot'
            }
          >
            {m.text}
          </div>
        ))}
        {!log.length && !busy && <div className="muted">{t('preview.empty')}</div>}
        {wantsText && (
          <div className="preview-input">
            <input
              placeholder={pending?.prompt || t('preview.inputPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value;
                  (e.target as HTMLInputElement).value = '';
                  submit(v);
                }
              }}
            />
            <button
              className="primary"
              aria-label={t('support.submit')}
              title={t('support.submit')}
              onClick={(e) => {
                const i = e.currentTarget.previousSibling as HTMLInputElement;
                const v = i.value;
                i.value = '';
                submit(v);
              }}
            >
              <Send />
            </button>
          </div>
        )}
        {/* S3-09: раньше выбор «гео или контакт» решался по русской подстроке
            в prompt — кастомная формулировка или EN-интерфейс ломали кнопку.
            Движок принимает оба ввода у блока «Контакт» (msg.contact ||
            msg.location), поэтому показываем обе быстрые кнопки: автор сам
            выбирает, какую ветку прогнать, и язык сценария не важен. */}
        {pending?.kind === 'contact' && (
          <div className="preview-buttons">
            <button onClick={() => submit('phone:+79000000000')}>{t('preview.sendContact')}</button>
            <button onClick={() => submit('location:55.75,37.61')}>{t('preview.sendGeo')}</button>
          </div>
        )}
        {/* Ожидание: обратный отсчёт и куда пойдёт сценарий. Любой текст
            в поле ввода — ветка «ответил»; «таймаут» в реальном боте сработает
            по расписанию воркера (в прогоне его не вызвать — честнее показать,
            чем рисовать кнопку, которая врёт). */}
        {pending?.kind === 'wait' && (
          <div className="preview-wait">
            <div className="preview-wait-head">
              <span className="muted">{t('preview.wait.countdown')}</span>
              <WaitCountdown seconds={Number(waitBlock?.params?.seconds ?? 0)} />
            </div>
            <div className="muted preview-wait-branches">
              {t('preview.wait.branches')}
            </div>
          </div>
        )}
        {/* Инлайн-кнопки и варианты опроса: воркер кладёт в buttons готовые
            значения (callback:… / poll:N) — отправляем их как есть. */}
        {(pending?.kind === 'choice' || pending?.kind === 'poll') && (
          <div className="preview-buttons">
            {(pending.buttons || []).map((b, i) => (
              <button key={i} onClick={() => submit(b.value)} disabled={busy}>
                {b.label}
              </button>
            ))}
          </div>
        )}
        {/* Тупик без кнопок: блок ждёт нажатия inline-кнопки, но все кнопки —
            ссылки. В бою нажатие открывает ссылку и апдейта не присылает, то
            есть сценарий действительно стоит. Честная подсказка лучше пустого
            ряда кнопок, из которого нельзя двинуться. */}
        {pending?.kind === 'choice' && (pending.buttons || []).length === 0 && (
          <div className="muted preview-note">{t('preview.noButtons')}</div>
        )}
        {/* Меню бота: подписи приходят текстом, как и в бою. */}
        {menuButtons.length > 0 && (
          <div className="preview-menu">
            <div className="muted preview-menu-title">{t('preview.menu.title')}</div>
            <div className="preview-buttons">
              {menuButtons.map((b: { label: string }, i: number) => (
                <button key={i} onClick={() => submit(b.label)} disabled={busy}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {!pending && log.length > 0 && !busy && <div className="muted preview-done">{t('preview.done')}</div>}
      </div>
      {Object.keys(vars).filter((k) => !k.startsWith('__')).length > 0 && (
        <div className="preview-vars mono">
          {Object.entries(vars)
            .filter(([k]) => !k.startsWith('__'))
            .slice(0, 12)
            .map(([k, v]) => `${k}=${String(v).slice(0, 24)}`)
            .join('  ·  ')}
        </div>
      )}
      {/* Служебные вводы прогона: чем переключать заглушки воркера и имитировать
          вложения, чтобы проверить ветки новых блоков без живого бота. */}
      <details className="preview-sim">
        <summary className="muted">{t('preview.sim.title')}</summary>
        <div className="preview-sim-chips">
          {SIM_INPUTS.map((s) => (
            <button key={s.value} type="button" className="badge neutral mono" onClick={() => submit(s.value)} disabled={busy}>
              {t(s.label)} <span className="muted">{s.value}</span>
            </button>
          ))}
        </div>
        <p className="muted preview-sim-hint">{t('preview.sim.hint')}</p>
      </details>
    </div>
  );
}
