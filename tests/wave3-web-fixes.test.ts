// Волна 3 фиксов аудита 2026-10-18 (web-зона): F-015 (409 version-conflict),
// S3-02 (flush черновика мини-редактора), WS-02 (yookassa linkTemplate),
// F-041 (действие pay в редакторе), S3-03 (friendlyApiError в мини-компонентах),
// S3-05 (кламп контекстного меню), S3-06 (useModalA11y в SupportWidget),
// S3-07 (мёртвый MiniAppPage/bar-mode-*), S3-09 (хардкод RU-строк),
// S3-10 (catch открытия редактора), ES-07 (FAQ оператора «в списке»).
// Чистые хелперы проверяются импортом; компоненты — source-level гардами
// (без React-рендера это единственный способ поймать отвязывание).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isVersionConflict, versionConflictCurrent, createApiError } from '../web/src/journey';
import { translate, loadDict, type TKey } from '../web/src/i18n';
import { GUIDE_FAQ, buildGuideIndex } from '../web/src/guideSearch';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const editorSrc = read('../web/src/MiniAppEditor.tsx');
const inspectorSrc = read('../web/src/MiniInspector.tsx');
const constructorSrc = read('../web/src/Constructor.tsx');
const appSrc = read('../web/src/App.tsx');
const paymentsSrc = read('../web/src/PaymentsPage.tsx');
const previewSrc = read('../web/src/preview.tsx');
const supportSrc = read('../web/src/SupportWidget.tsx');
const apiSrc = read('../web/src/api.ts');
const styles = read('../web/src/styles.css');

// ------------------------------------------------------------------ F-015

describe('F-015: детектор 409 version-conflict', () => {
  it('ловит контрактный ответ сервера (status 409 + code)', () => {
    const e = createApiError(409, { code: 'version-conflict', current: 7 });
    expect(isVersionConflict(e)).toBe(true);
    expect(versionConflictCurrent(e)).toBe(7);
  });

  it('409 без кода и другие статусы конфликтом не считаются', () => {
    expect(isVersionConflict(createApiError(409, { error: 'slug занят' }))).toBe(false);
    expect(isVersionConflict(createApiError(400, { code: 'version-conflict' }))).toBe(false);
    expect(isVersionConflict(createApiError(500, null))).toBe(false);
    expect(isVersionConflict(new Error('409'))).toBe(false);
    expect(isVersionConflict(undefined)).toBe(false);
  });

  it('current не число — null (версию не подменяем)', () => {
    expect(versionConflictCurrent(createApiError(409, { code: 'version-conflict' }))).toBe(null);
    expect(versionConflictCurrent(createApiError(409, { code: 'version-conflict', current: '8' }))).toBe(null);
  });

  it('doSave разводит конфликт и обычную ошибку; полоса предлагает два действия', () => {
    expect(constructorSrc).toContain('isVersionConflict(e)');
    expect(constructorSrc).toContain('versionConflictCurrent(e)');
    expect(constructorSrc).toContain("t('status.versionConflict')");
    expect(constructorSrc).toContain("t('conflict.reload')");
    expect(constructorSrc).toContain("t('conflict.overwrite')");
    // «Сохранить поверх» принимает версию сервера перед повтором.
    expect(constructorSrc).toMatch(/scenarioVersion\.current = versionConflict\.current/);
  });

  it('i18n-ключи конфликта есть в RU и EN', () => {
    expect(translate('ru', 'status.versionConflict' as TKey)).toContain('другой вкладке');
    expect(translate('ru', 'conflict.reload' as TKey)).toContain('актуальную');
    expect(translate('ru', 'conflict.overwrite' as TKey)).toContain('поверх');
  });
});

// ------------------------------------------------------------------ S3-02

describe('S3-02: flush черновика мини-редактора на уходе', () => {
  it('beforeunload/pagehide/visibilitychange + keepalive — как в конструкторе', () => {
    expect(editorSrc).toContain("addEventListener('beforeunload'");
    expect(editorSrc).toContain("addEventListener('pagehide'");
    expect(editorSrc).toContain("addEventListener('visibilitychange'");
    expect(editorSrc).toContain('saveMiniAppDraft(miniId, next, undefined, true)');
  });

  it('saveMiniAppDraft в api.ts принимает keepalive', () => {
    expect(apiSrc).toMatch(/saveMiniAppDraft: \(id: string, draft: any, name\?: string, keepalive = false\)/);
    expect(apiSrc).toContain('keepalive }) as Promise<{ ok: true }>');
  });
});

// ------------------------------------------------------------------ WS-02

describe('WS-02: yookassa linkTemplate в форме подключения', () => {
  it('spec провайдера содержит linkTemplate со своей подсказкой', () => {
    const yo = paymentsSrc.slice(paymentsSrc.indexOf('yookassa: {'), paymentsSrc.indexOf('robokassa: {'));
    expect(yo).toContain("key: 'linkTemplate'");
    expect(yo).toContain('payments.help.yookassa.linkTemplate');
  });

  it('подсказка объясняет обязательность (RU) и есть EN-пара', () => {
    const ru = read('../web/src/i18n.frag.pay.ts');
    const en = read('../web/src/i18n.frag.pay.en.ts');
    expect(ru).toContain('Ссылка на API-checkout YooKassa — без неё платежи не фиксируются');
    expect(en).toContain('payments.help.yookassa.linkTemplate');
  });

  it('мёртвое verifyViaApi не отображается в UI', () => {
    expect(paymentsSrc).not.toContain('verifyViaApi');
  });
});

// ------------------------------------------------------------------ F-041

describe('F-041: действие pay в редакторе мини-аппа', () => {
  it('pay входит в ACTION_IDS и подписан', () => {
    expect(inspectorSrc).toMatch(/const ACTION_IDS = \[[^\]]*'pay'\]/);
    expect(inspectorSrc).toContain("pay: 'miniInsp.act.pay'");
  });

  it('поля product/stars пишутся в action; stars — целое 1..10000 (контракт воркера)', () => {
    expect(inspectorSrc).toMatch(/case 'pay':\s*return \{ id: 'pay', product: '', stars: 1 \}/);
    expect(inspectorSrc).toContain('Math.max(1, Math.min(10000, n))');
  });

  it('видео-элемент остаётся на props.url — рантайм читает url ?? src (F-042)', () => {
    expect(inspectorSrc).toMatch(/case 'video':[\s\S]*?patchProps\(\{ url: e\.target\.value \}\)/);
  });

  it('подписи pay есть в RU и EN', () => {
    expect(translate('ru', 'miniInsp.act.pay' as TKey)).toContain('Stars');
    const en = read('../web/src/i18n.frag.mini.en.ts');
    expect(en).toContain("'miniInsp.act.pay'");
    expect(en).toContain("'miniInsp.act.pay.product'");
    expect(en).toContain("'miniInsp.act.pay.stars'");
  });
});

// ------------------------------------------------------------------ S3-03

describe('S3-03: ошибки мини-компонентов идут через friendlyApiError', () => {
  it('сырой String(e?.message) больше не используется в мини-компонентах', () => {
    for (const [name, src] of [
      ['MiniAppEditor', editorSrc],
      ['MiniInspector', inspectorSrc],
      ['CreateMiniAppModal', read('../web/src/CreateMiniAppModal.tsx')],
    ] as const) {
      const raw = src.split('\n').filter((l) => /String\(e\?\.message \|\| e\)/.test(l) && !l.trim().startsWith('//'));
      expect(raw, `${name}: сырой e.message`).toEqual([]);
    }
    expect(editorSrc).toContain('friendlyApiError(e, settings.language)');
    expect(inspectorSrc).toContain('friendlyApiError(e,');
  });

  it('MiniAppPage.tsx удалён (S3-07) и нигде не импортируется', () => {
    expect(() => read('../web/src/MiniAppPage.tsx')).toThrow();
    expect(appSrc).not.toContain('MiniAppPage');
  });

  it('bar-mode-* правил в CSS больше нет', () => {
    expect(styles).not.toContain('bar-mode-');
  });
});

// ------------------------------------------------------------------ S3-05

describe('S3-05: контекстное меню холста клампится к viewport', () => {
  it('координаты клампятся по фактическому размеру меню', () => {
    expect(constructorSrc).toContain('ctxMenuRef');
    expect(constructorSrc).toContain('window.innerWidth - r.width - 8');
    expect(constructorSrc).toContain('window.innerHeight - r.height - 8');
  });
});

// ------------------------------------------------------------------ S3-06

describe('S3-06: SupportWidget подключает useModalA11y', () => {
  it('хук на .support-widget; ручной Esc-слушатель заменён хуком', () => {
    expect(supportSrc).toContain("import { useModalA11y } from './useModalA11y'");
    expect(supportSrc).toMatch(/useModalA11y<HTMLElement>\(\(\) => setOpen\(false\)\)/);
    expect(supportSrc).toMatch(/<section ref=\{dialogRef\} className="support-widget"/);
    expect(supportSrc).not.toContain("e.key === 'Escape'");
  });
});

// ------------------------------------------------------------------ S3-09

describe('S3-09: хардкод RU-строк убран', () => {
  it('notes превью/публикации и заголовок палитры — через i18n', () => {
    expect(editorSrc).not.toContain('Telegram.WebApp.close() — в Telegram');
    expect(editorSrc).not.toContain('Запись в data-таблицу');
    expect(editorSrc).not.toContain('Опубликовано, ревизия ${');
    expect(editorSrc).not.toContain('>Элементы<');
    expect(editorSrc).toContain("t('mini.palette.elements')");
    expect(editorSrc).toContain("t('mini.note.published'");
  });

  it('downloadCsv бросает ApiError со статусом, а не русскую строку (WU-07)', () => {
    expect(apiSrc).not.toContain('не удалось выгрузить файл');
    expect(apiSrc).toMatch(/if \(!res\.ok\) \{[\s\S]{0,400}throw createApiError\(res\.status, body\)/);
  });

  it('preview не выбирает гео/контакт по русской подстроке', () => {
    expect(previewSrc).not.toContain("includes('гео')");
    expect(previewSrc).toContain("submit('phone:+79000000000')");
    expect(previewSrc).toContain("submit('location:55.75,37.61')");
  });

  it('кнопка «Повторить» не зависит от подстрок текста статуса', () => {
    expect(constructorSrc).not.toContain("s.includes('не удалось')");
    expect(constructorSrc).toContain('status === saveErrorStatus');
  });
});

// ------------------------------------------------------------------ S3-10

describe('S3-10: ошибка открытия редактора после создания видна', () => {
  it('getMiniApp после createMiniApp имеет catch с friendlyApiError', () => {
    expect(appSrc).toMatch(/api\.getMiniApp\(id\)\.then\([\s\S]{0,300}\.catch\(\(e\) => \{\s*setErr\(t\('mini\.openFailed'/);
    expect(appSrc).toContain('friendlyApiError(e, settings.language)');
  });

  it('ключ mini.openFailed есть в RU и EN', () => {
    expect(translate('ru', 'mini.openFailed' as TKey)).toContain('создан');
    const en = read('../web/src/i18n.frag.mini.en.ts');
    expect(en).toContain("'mini.openFailed'");
  });
});

// ------------------------------------------------------------------ ES-07

describe('ES-07: FAQ оператора «в списке» (запятая в значении)', () => {
  it('запись faq-cond-in в GUIDE_FAQ — попадает в индекс поиска и на вкладку', () => {
    expect(GUIDE_FAQ.some((f) => f.id === 'faq-cond-in')).toBe(true);
    const index = buildGuideIndex({ t: (k) => translate('ru', k) });
    const hit = index.find((h) => h.id === 'faq-cond-in');
    expect(hit).toBeTruthy();
    expect(hit!.haystack).toContain('запят');
  });

  it('RU-текст объясняет ограничение и обходной путь', () => {
    const a = translate('ru', 'guide.faq.condin.a' as TKey);
    expect(a).toContain('разбивается по запятой');
    expect(a).toContain('совпасть никогда не может');
    expect(a).toContain('содержит');
  });

  it('EN-пара существует и загружается', async () => {
    await loadDict('en');
    const a = translate('en', 'guide.faq.condin.a' as TKey);
    expect(a).toContain('split by comma');
    expect(a).toContain('can never match');
  });
});
