// Гайд: быстрый старт, справочник блоков, рецепты, публикация и FAQ.
// Весь текст — из словаря i18n, чтобы переключение языка покрывало и справку.
//
// Промпт 2 (TASKS 5+6): ОДИН глобальный поиск вверху модалки — индекс по
// всем вкладкам строится чистой логикой guideSearch.ts (один раз на язык,
// useMemo), компонент только рисует. Справочник блоков ГЕНЕРИРУЕТСЯ из
// BLOCK_META + guideTextKey: новый блок попадает в гайд и в поиск сам.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockType } from '../../shared/types';
import { BLOCK_META, guideTextKey } from './blocks';
import { useT, loadDict, type TKey } from './i18n';
import { useSettings } from './settings';
import { useModalA11y } from './useModalA11y';
import { Term, GLOSSARY_TERMS, GLOSSARY_GROUPS } from './Glossary';
import { X, Search } from './icons';
import {
  buildGuideIndex,
  matchGuide,
  groupHits,
  moveCursor,
  escapeAction,
  GUIDE_RECIPES,
  GUIDE_FAQ,
  GUIDE_MINI_ARTICLES,
  GUIDE_MINI_FAQ,
  GUIDE_PUBLISH_STEPS,
  GUIDE_CHECKS,
  GUIDE_CL_ITEMS,
  type GuideHit,
} from './guideSearch';
import './guide.css';

type Tab = 'start' | 'blocks' | 'recipes' | 'mini' | 'publish' | 'faq';

const TABS: { id: Tab; label: TKey }[] = [
  { id: 'start', label: 'guide.tab.start' },
  { id: 'blocks', label: 'guide.tab.blocks' },
  { id: 'recipes', label: 'guide.tab.recipes' },
  { id: 'mini', label: 'guide.tab.mini' },
  { id: 'publish', label: 'guide.tab.publish' },
  { id: 'faq', label: 'guide.tab.faq' },
];

export function Guide({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { skill_level, hints_enabled, language } = useSettings();
  const [tab, setTab] = useState<Tab>('start');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(-1);
  // Навигация к записи: цель лежит в ref, а эффект срабатывает после того,
  // как новый таб отрендерился (navTick меняется вместе с setTab).
  const [navTick, setNavTick] = useState(0);
  const pendingNav = useRef<{ targetId: string; detailsKey?: string; flash: boolean } | null>(null);
  const flashCleanup = useRef<(() => void) | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);

  // Английский словарь грузится асинхронно: t при этом не меняет идентичность,
  // поэтому индекс пересобираем ещё и по факту загрузки словаря (dictTick).
  const [dictTick, setDictTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadDict(language).then(() => {
      if (alive) setDictTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [language]);

  // Индекс — ОДИН раз на язык/словарь, не на каждое нажатие клавиши.
  // dictTick в зависимостях — осознанный: идентичность t при загрузке EN-чанка
  // не меняется, поэтому пересборку индекса триггерим счётчиком.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const index = useMemo(() => buildGuideIndex({ t: (key) => t(key) }), [t, dictTick]);

  const queryActive = q.trim().length > 0;
  const hits = useMemo(() => (queryActive ? matchGuide(index, q) : []), [index, q, queryActive]);
  const groups = useMemo(() => groupHits(hits), [hits]);
  const hitIndexById = useMemo(() => new Map(hits.map((h, i) => [h.id, i])), [hits]);
  const matchedIds = useMemo(() => new Set(hits.map((h) => h.targetId)), [hits]);
  const activeIdx = cursor >= 0 && cursor < hits.length ? cursor : -1;

  // Сброс курсора при каждом изменении запроса.
  useEffect(() => {
    setCursor(-1);
  }, [q]);

  // Активная запись результатов держится в видимой области списка.
  useEffect(() => {
    if (activeIdx < 0) return;
    document.getElementById(`guide-hit-${activeIdx}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  useEffect(() => () => flashCleanup.current?.(), []);

  // Переход к записи: скролл к data-guide-id, раскрытие <details> (FAQ) и
  // короткая подсветка .guide-flash (~1.2с).
  useEffect(() => {
    const p = pendingNav.current;
    if (!p) return;
    pendingNav.current = null;
    const root = bodyRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-guide-id="${p.targetId}"]`);
    if (!el) return;
    if (p.detailsKey && el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ block: 'center' });
    if (p.flash) {
      flashCleanup.current?.();
      el.classList.add('guide-flash');
      const timer = window.setTimeout(() => {
        el.classList.remove('guide-flash');
        flashCleanup.current = null;
      }, 1200);
      flashCleanup.current = () => {
        window.clearTimeout(timer);
        el.classList.remove('guide-flash');
      };
    }
  }, [navTick, tab]);

  const goTo = useCallback((targetId: string, detailsKey?: string, flash = false) => {
    pendingNav.current = { targetId, detailsKey, flash };
    setNavTick((n) => n + 1);
  }, []);

  const openHit = useCallback(
    (hit: GuideHit) => {
      setTab(hit.tab);
      goTo(hit.targetId, hit.detailsKey, true);
    },
    [goTo]
  );

  const clearQuery = useCallback(() => {
    setQ('');
    inputRef.current?.focus();
  }, []);

  // Клавиши в поле поиска: стрелки двигают курсор, Enter открывает активную
  // запись. Escape обрабатывается уровнем выше (на модалке), чтобы работать
  // при фокусе где угодно внутри.
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => moveCursor(hits.length, c, 'down'));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => moveCursor(hits.length, c, 'up'));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      openHit(hits[activeIdx]);
    }
  };

  // Порядок Escape: ПЕРВЫЙ очищает запрос, ВТОРОЙ закрывает модалку
  // (escapeAction из guideSearch.ts).
  const onModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (escapeAction(q) === 'clear') clearQuery();
    else onClose();
  };

  // --- видимость записей при активном запросе -------------------------------
  const show = useCallback(
    (targetId: string): boolean => !queryActive || matchedIds.has(targetId),
    [queryActive, matchedIds]
  );

  const visibleBlockTypes = useMemo(() => {
    const all = Object.keys(BLOCK_META) as BlockType[];
    if (!queryActive) return all;
    const set = new Set(hits.filter((h) => h.tab === 'blocks').map((h) => h.targetId));
    return all.filter((type) => set.has(`block-${type}`));
  }, [queryActive, hits]);

  // Только фокус-треп (WU-05): Escape здесь двухступенчатый и обработан
  // собственным onModalKeyDown — дублирующий обработчик хука сломал бы его.
  const modalRef = useModalA11y<HTMLDivElement>(null);

  const visibleGlossary = useMemo(
    () => (queryActive ? GLOSSARY_TERMS.filter((term) => matchedIds.has(`gloss-${term.id}`)) : GLOSSARY_TERMS),
    [queryActive, matchedIds]
  );

  // --- оглавление вкладки ---------------------------------------------------
  const toc = useMemo<{ targetId: string; label: string }[]>(() => {
    switch (tab) {
      case 'start':
        return [
          { targetId: 'start-main', label: t('guide.start.title') },
          { targetId: 'start-examples', label: t('guide.start.examples') },
          { targetId: 'start-hotkeys', label: t('guide.start.hotkeys') },
          { targetId: 'start-glossary', label: t('glossary.title') },
        ];
      case 'blocks':
        // Якоря на каждый видимый блок справочника.
        return visibleBlockTypes.map((type) => ({ targetId: `block-${type}`, label: BLOCK_META[type].label }));
      case 'recipes':
        return GUIDE_RECIPES.filter((r) => show(r.id)).map((r) => ({ targetId: r.id, label: t(r.title) }));
      case 'mini':
        return [
          ...GUIDE_MINI_ARTICLES.filter((a) => show(a.id)).map((a) => ({ targetId: a.id, label: t(a.title) })),
          { targetId: 'mini-faq', label: t('guide.mini.faq.title') },
        ];
      case 'publish':
        return [
          { targetId: 'publish-main', label: t('guide.publish.title') },
          { targetId: 'publish-checks', label: t('guide.publish.checks') },
          { targetId: 'publish-checklist', label: t('guide.publish.checklist') },
        ];
      case 'faq':
        return [
          { targetId: 'faq-main', label: t('guide.faq.title') },
          ...(queryActive ? [] : [{ targetId: 'faq-skill', label: t('guide.skill.title') }]),
        ];
    }
  }, [tab, t, visibleBlockTypes, show, queryActive]);

  const showAllButton = queryActive ? (
    <button type="button" className="ghost guide-showall" onClick={clearQuery}>
      {t('guide.showAll')}
    </button>
  ) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal guide"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onModalKeyDown}
      >
        <header className="modal-head guide-head">
          <div className="guide-head-row">
            <div className="modal-head-text">
              <h2 className="modal-title">{t('editor.guides.title')}</h2>
            </div>
            <button
              className="ghost icon-btn"
              onClick={onClose}
              aria-label={t('common.close.title')}
              title={t('common.close.title')}
            >
              <X />
            </button>
          </div>

          {/* Один поиск на всю модалку: ищет по всем вкладкам сразу. */}
          <div className="guide-search-wrap">
            <div className="guide-search-row guide-search">
              <Search className="search-icon" size={16} />
              {/* Результаты — обычные кнопки: скринридер читает их сам, а
                  клавиатурная навигация (стрелки/Enter) живёт в onSearchKeyDown. */}
              <input
                ref={inputRef}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={t('guide.search.placeholder')}
                aria-label={t('guide.search.aria')}
                aria-controls={queryActive ? 'guide-search-results' : undefined}
              />
              {q && (
                <button
                  type="button"
                  className="guide-search-clear"
                  onClick={clearQuery}
                  aria-label={t('common.close.title')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <p className="guide-search-hint">{t('guide.search.hint')}</p>
          </div>

          <div className="guide-tabs">
            {TABS.map((item) => (
              <button key={item.id} className={tab === item.id ? 'tab active' : 'tab'} onClick={() => setTab(item.id)}>
                {t(item.label)}
              </button>
            ))}
          </div>
        </header>

        <div className="modal-body" ref={bodyRef}>
          {/* Результаты глобального поиска — под инпутом, группами по секциям. */}
          {queryActive && (
            <div className="guide-results" id="guide-search-results" role="region" aria-label={t('guide.search.results')}>
              {!hits.length && <p className="guide-results-empty">{t('guide.search.empty')}</p>}
              {Array.from(groups.entries()).map(([section, g]) => (
                <div className="guide-results-group" key={section}>
                  <div className="guide-results-head">
                    <b>{t(section)}</b>
                    <span className="count">{g.count}</span>
                  </div>
                  {g.hits.map((hit) => {
                    const idx = hitIndexById.get(hit.id) ?? -1;
                    return (
                      <button
                        type="button"
                        key={hit.id}
                        id={`guide-hit-${idx}`}
                        aria-current={idx === activeIdx || undefined}
                        className={idx === activeIdx ? 'guide-hit active' : 'guide-hit'}
                        onClick={() => openHit(hit)}
                      >
                        <span className="hit-label">{hit.label}</span>
                        {hit.snippet && <span className="hit-snippet">{hit.snippet}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="guide-with-toc">
            {toc.length > 0 && (
              <details className="guide-toc" open>
                <summary>{t('guide.toc.title')}</summary>
                <ul>
                  {toc.map((item) => (
                    <li key={item.targetId}>
                      <button type="button" onClick={() => goTo(item.targetId)}>
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {tab === 'start' && (
              <div className="guide-section">
                {show('start-main') && (
                  <section className="modal-section" data-guide-id="start-main">
                    <h2>{t('guide.start.title')}</h2>
                    {skill_level === 'low' && hints_enabled && <div className="callout"><b>{t('guide.beginner.first')}</b> {t('guide.beginner.first.text')}</div>}
                    <ol className="guide-steps">
                      <li>
                        <b>{t('guide.start.s1.b')}</b> {t('guide.start.s1.a')} <code>/newbot</code>{' '}
                        {t('guide.start.s1.c')}
                      </li>
                      <li>
                        <b>{t('guide.start.s2.b')}</b> {t('guide.start.s2.a')} <b>{t('block.start.label')}</b>{' '}
                        {t('guide.start.s2.c')} <b>{t('block.message.label')}</b>
                        {t('guide.start.s2.d')}
                      </li>
                      <li>
                        <b>{t('guide.start.s3.b')}</b> {t('guide.start.s3.a')}
                      </li>
                      <li>
                        <b>{t('guide.start.s4.b')}</b> {t('guide.start.s4.a')} <code>{'{{name}}'}</code>{' '}
                        {t('guide.start.s4.c')}
                      </li>
                      <li>
                        <b>{t('guide.start.s5.b')}</b> {t('guide.start.s5.a')}
                      </li>
                      <li>
                        <b>{t('guide.start.s6.b')}</b> {t('guide.start.s6.a')}
                      </li>
                    </ol>
                    <div className="callout">
                      <b>{t('guide.start.rule.b')}</b> {t('guide.start.rule')}
                    </div>
                  </section>
                )}

                {show('start-examples') && (
                  <section className="modal-section" data-guide-id="start-examples">
                    <h3>{t('guide.start.examples')}</h3>
                    <ul>
                      <li>
                        <b>{t('guide.start.ex1')}</b> {t('guide.start.ex1.t')}
                      </li>
                      <li>
                        <b>{t('guide.start.ex2')}</b> {t('guide.start.ex2.t')}
                      </li>
                      <li>
                        <b>{t('guide.start.ex3')}</b> {t('guide.start.ex3.t')}
                      </li>
                    </ul>
                  </section>
                )}

                {show('start-hotkeys') && (
                  <section className="modal-section" data-guide-id="start-hotkeys">
                    <h3>{t('guide.start.hotkeys')}</h3>
                    <ul>
                      <li>
                        <b>{t('guide.start.hk1')}</b> {t('guide.start.hk1.t')}
                      </li>
                      <li>
                        <b>{t('guide.start.hk2')}</b> {t('guide.start.hk2.t')}
                      </li>
                      <li>
                        <b>{t('guide.start.hk3')}</b> {t('guide.start.hk3.t')}
                      </li>
                    </ul>
                  </section>
                )}

                {/* Термины, которые встречаются по всему интерфейсу: клик
                    раскрывает объяснение в один вопрос. Список сгруппирован
                    по темам — словарь разросся и плоской простынёй не читается. */}
                {visibleGlossary.length > 0 && (
                  <section className="modal-section" data-guide-id="start-glossary">
                    <h3>
                      {t('glossary.title')}{' '}
                      <span className="muted">{t('glossary.count', { n: GLOSSARY_TERMS.length })}</span>
                    </h3>
                    {GLOSSARY_GROUPS.map((g) => {
                      const terms = visibleGlossary.filter((term) => term.group === g.id);
                      if (!terms.length) return null;
                      return (
                        <div key={g.id} className="glossary-group">
                          <h4>{t(g.title)}</h4>
                          <ul>
                            {terms.map((term) => (
                              <li key={term.id} data-guide-id={`gloss-${term.id}`}>
                                <Term
                                  id={term.id}
                                  open={activeTerm === term.id}
                                  onOpenChange={(open) => setActiveTerm(open ? term.id : null)}
                                /> — {t(term.text)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </section>
                )}
                {showAllButton}
              </div>
            )}

            {tab === 'blocks' && (
              <div className="guide-section">
                <section className="modal-section" data-guide-id="blocks-ref">
                  <h2>{t('guide.blocks.title')}</h2>
                  {skill_level === 'low' && hints_enabled && <p className="guide-beginner-intro">{t('guide.beginner.blocks')}</p>}
                </section>
                <section className="modal-section">
                  {/* Справочник ГЕНЕРИРУЕТСЯ из BLOCK_META + guideTextKey(type):
                      новый блок появляется здесь автоматически, руками его
                      дописывать не нужно. Порядок — Object.keys(BLOCK_META). */}
                  <div className="block-ref">
                    {visibleBlockTypes.map((type) => {
                      const m = BLOCK_META[type];
                      return (
                        <div className="block-ref-item guide-block-item" key={type} data-guide-id={`block-${type}`}>
                          <div className="block-ref-head">
                            <span className="dot" style={{ background: m.color }} />
                            <b>{m.label}</b>
                            <code className="guide-block-machinename">{type}</code>
                          </div>
                          <div className="muted">{m.hint}</div>
                          <div className="guide-block-example">{t(guideTextKey(type))}</div>
                        </div>
                      );
                    })}
                    {!visibleBlockTypes.length && <p className="muted">{t('guide.blocks.empty')}</p>}
                  </div>
                </section>
              </div>
            )}

            {tab === 'recipes' && (
              <div className="guide-section">
                {!queryActive && (
                  <section className="modal-section">
                    <h2>{t('guide.recipes.title')}</h2>
                    <p className="muted">{t('guide.recipes.intro')}</p>
                  </section>
                )}
                <section className="modal-section">
                  {GUIDE_RECIPES.filter((r) => show(r.id)).map((r) => (
                    <div className="recipe" key={r.id} data-guide-id={r.id}>
                      <h3>{t(r.title)}</h3>
                      <ol>
                        {r.steps.map((s, i) => (
                          <li key={i}>{t(s)}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                  {showAllButton}
                </section>
              </div>
            )}

            {tab === 'mini' && (
              <div className="guide-section">
                {!queryActive && (
                  <section className="modal-section">
                    <h2>{t('guide.mini.title')}</h2>
                    <p className="muted">{t('guide.mini.intro')}</p>
                  </section>
                )}
                <section className="modal-section">
                  {GUIDE_MINI_ARTICLES.filter((a) => show(a.id)).map((a) => (
                    <div className="recipe" key={a.id} data-guide-id={a.id}>
                      <h3>{t(a.title)}</h3>
                      <ol>
                        {a.steps.map((s, i) => (
                          <li key={i}>{t(s)}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </section>
                <section className="modal-section" data-guide-id="mini-faq">
                  {!queryActive && <h3>{t('guide.mini.faq.title')}</h3>}
                  {GUIDE_MINI_FAQ.filter((f) => show(f.id)).map((f) => (
                    <details className="faq-item" key={f.id} data-guide-id={f.id} open={queryActive || undefined}>
                      <summary>{t(f.q)}</summary>
                      <p className="muted">{t(f.a)}</p>
                    </details>
                  ))}
                  {showAllButton}
                </section>
              </div>
            )}

            {tab === 'publish' && (
              <div className="guide-section">
                {GUIDE_PUBLISH_STEPS.some((_s, i) => show(`publish-s${i}`)) && (
                  <section className="modal-section" data-guide-id="publish-main">
                    {!queryActive && (
                      <>
                        <h2>{t('guide.publish.title')}</h2>
                        <p className="muted">{t('guide.publish.intro')}</p>
                      </>
                    )}
                    <ol className="guide-steps">
                      {GUIDE_PUBLISH_STEPS.map((s, i) =>
                        show(`publish-s${i}`) ? (
                          <li key={i} data-guide-id={`publish-s${i}`}>
                            {t(s)}
                          </li>
                        ) : null
                      )}
                    </ol>
                    {!queryActive && (
                      <div className="callout">
                        <b>{t('guide.publish.note.b')}</b> {t('guide.publish.note')}
                      </div>
                    )}
                  </section>
                )}
                {GUIDE_CHECKS.some((_c, i) => show(`publish-check-${i}`)) && (
                  <section className="modal-section" data-guide-id="publish-checks">
                    <h3>{t('guide.publish.checks')}</h3>
                    <div className="block-ref">
                      {GUIDE_CHECKS.map((c, i) =>
                        show(`publish-check-${i}`) ? (
                          <div className="block-ref-item" key={c.q} data-guide-id={`publish-check-${i}`}>
                            <div className="block-ref-head">
                              <b>{t(c.q)}</b>
                            </div>
                            <div className="muted">{t(c.a)}</div>
                          </div>
                        ) : null
                      )}
                    </div>
                  </section>
                )}
                {GUIDE_CL_ITEMS.some((item) => show(item.id)) && (
                  <section className="modal-section" data-guide-id="publish-checklist">
                    <h3>{t('guide.publish.checklist')}</h3>
                    <ul>
                      {GUIDE_CL_ITEMS.map((item) =>
                        show(item.id) ? (
                          <li key={item.id} data-guide-id={item.id}>
                            {item.id === 'publish-cl1' ? (
                              <>
                                {t('guide.publish.cl1.a')} <code>{'{{var}}'}</code> {t('guide.publish.cl1.b')}
                              </>
                            ) : (
                              t(item.keys[0])
                            )}
                          </li>
                        ) : null
                      )}
                    </ul>
                  </section>
                )}
                {showAllButton}
              </div>
            )}

            {tab === 'faq' && (
              <div className="guide-section">
                <section className="modal-section" data-guide-id="faq-main">
                  {!queryActive && <h2>{t('guide.faq.title')}</h2>}
                  {GUIDE_FAQ.filter((f) => show(f.id)).map((f) => (
                    <details className="faq-item" key={f.id} data-guide-id={f.id} open={queryActive || undefined}>
                      <summary>{t(f.q)}</summary>
                      <p className="muted">{t(f.a)}</p>
                    </details>
                  ))}
                  {showAllButton}
                </section>

                {/* Уровни объясняются всегда, независимо от выбранного уровня:
                    человек должен понимать, что он получает и что теряет.
                    При активном поиске секция скрыта — остаются только совпадения. */}
                {!queryActive && (
                  <section className="modal-section" data-guide-id="faq-skill">
                    <h2 className="guide-skill-head">{t('guide.skill.title')}</h2>
                    <p className="muted">{t('guide.skill.intro')}</p>
                    <div className="block-ref">
                      {(['low', 'medium', 'high'] as const).map((lv) => (
                        <div className="block-ref-item" key={lv}>
                          <div className="block-ref-head">
                            <b>{t(`guide.skill.${lv}` as TKey)}</b>
                          </div>
                          <div className="muted">{t(`guide.skill.${lv}.text` as TKey)}</div>
                        </div>
                      ))}
                    </div>
                    <p className="muted">{t('guide.skill.change')}</p>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="modal-foot">
          <span className="muted">{t('guide.foot')}</span>
          <button className="ghost" onClick={onClose}>
            {t('guide.ok')}
          </button>
        </footer>
      </div>
    </div>
  );
}
