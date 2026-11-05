// Лимиты Telegram в авторинг-валидаторе (§7 аудита): callback_data кнопки,
// заголовок/описание счёта, уведомление cbToast/cbAlert. Значения — из
// shared/limits.ts, уровень btn-value-long — error (блокирует публикацию),
// остальные — warn.
import { describe, it, expect } from 'vitest';
import { validateScenario } from '../shared/validate';
import type { Scenario, Block } from '../shared/types';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

// Минимальный корректный блок: строка в 4-м аргументе — next, объект — branches.
function block(id: string, type: Block['type'], params: Block['params'], branchesOrNext?: Block['branches'] | string): Block {
  const isNext = typeof branchesOrNext === 'string';
  return { id, type, params, ...(isNext ? { next: branchesOrNext } : { branches: branchesOrNext }) } as any;
}

function withStart(blocks: Scenario['blocks']): Scenario {
  return {
    version: 1,
    start: 's',
    blocks: {
      s: { id: 's', type: 'start', params: { command: '/start' }, next: Object.keys(blocks)[0] ?? '' },
      ...blocks,
    },
  } as Scenario;
}

// ---------------- callback_data кнопок (64 байта) ----------------

describe('validate: btn-value-long', () => {
  const value64 = 'a'.repeat(64);
  const value65 = 'a'.repeat(65);

  it('значение ровно 64 байта — ошибки нет', () => {
    const b = block('b', 'buttons', { buttons: [{ label: 'Да', value: value64 }] }, { [value64]: 'e' });
    expect(codes(validateScenario(withStart({ b, e: block('e', 'end', {}) })))).not.toContain('btn-value-long');
  });

  it('значение 65 байт — btn-value-long уровня error', () => {
    const b = block('b', 'buttons', { buttons: [{ label: 'Да', value: value65 }] }, { [value65]: 'e' });
    const issues = validateScenario(withStart({ b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('btn-value-long');
    expect(issues.find((i) => i.code === 'btn-value-long')?.level).toBe('error');
  });

  it('кириллица: 33 символа = 66 байт — error (лимит в байтах, не символах)', () => {
    const value = 'к'.repeat(33);
    const b = block('b', 'buttons', { buttons: [{ label: 'Да', value }] }, { [value]: 'e' });
    const issues = validateScenario(withStart({ b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('btn-value-long');
    expect(issues.find((i) => i.code === 'btn-value-long')?.level).toBe('error');
  });

  it('значение с шаблоном {{var}} длиннее лимита — error', () => {
    // Шаблон проверяется по обоим вариантам: исходная строка (60 + 11 = 71 байт)
    // и после staticInterpolate (60 + 1 = 61 байт — в пределах). Ошибка идёт из
    // исходного варианта: для шаблонов достаточно проверки самого шаблона.
    const value = 'k'.repeat(60) + '{{user_id}}';
    const b = block('b', 'buttons', { buttons: [{ label: 'Да', value }] }, { [value]: 'e' });
    expect(codes(validateScenario(withStart({ b, e: block('e', 'end', {}) })))).toContain('btn-value-long');
  });

  it('reply-layout с длинным значением — ошибки нет (нет callback_data)', () => {
    const b = block('b', 'buttons', { layout: 'reply', buttons: [{ label: 'Да', value: value65 }] }, { [value65]: 'e' });
    expect(codes(validateScenario(withStart({ b, e: block('e', 'end', {}) })))).not.toContain('btn-value-long');
  });

  it('url-кнопка с длинным значением — ошибки нет', () => {
    const b = block('b', 'buttons', { buttons: [{ label: 'Сайт', value: value65, url: 'https://example.com' }] }, {});
    expect(codes(validateScenario(withStart({ b, e: block('e', 'end', {}) })))).not.toContain('btn-value-long');
  });

  it('меню (case menu) проверяется так же, как buttons', () => {
    const b = block('m', 'menu', { buttons: [{ label: 'Прайс', value: value65 }] }, { [value65]: 'e' });
    const issues = validateScenario(withStart({ m: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('btn-value-long');
    expect(issues.find((i) => i.code === 'btn-value-long')?.level).toBe('error');
  });
});

// ---------------- счёт: заголовок 32, описание 255 ----------------

describe('validate: invoice-title-long / invoice-desc-long', () => {
  const base = { amount: 1500, currency: 'RUB', providerToken: 'tok' };

  function invoiceIssues(title: string, description: string) {
    const b = block('i', 'invoice', { invoice: { title, description, ...base } }, { paid: 'e', cancelled: 'e' });
    return validateScenario(withStart({ i: b, e: block('e', 'end', {}) }));
  }

  it('заголовок 32 символа — предупреждения нет', () => {
    expect(codes(invoiceIssues('t'.repeat(32), 'Описание'))).not.toContain('invoice-title-long');
  });

  it('заголовок 33 символа — invoice-title-long (warn)', () => {
    const issues = invoiceIssues('t'.repeat(33), 'Описание');
    expect(codes(issues)).toContain('invoice-title-long');
    expect(issues.find((i) => i.code === 'invoice-title-long')?.level).toBe('warn');
  });

  it('описание 255 символов — предупреждения нет', () => {
    expect(codes(invoiceIssues('Заголовок', 'd'.repeat(255)))).not.toContain('invoice-desc-long');
  });

  it('описание 256 символов — invoice-desc-long (warn)', () => {
    const issues = invoiceIssues('Заголовок', 'd'.repeat(256));
    expect(codes(issues)).toContain('invoice-desc-long');
    expect(issues.find((i) => i.code === 'invoice-desc-long')?.level).toBe('warn');
  });
});

// ---------------- уведомление кнопки: cbToast/cbAlert ~200 символов ----------------

describe('validate: cbt-toast-long', () => {
  function toastIssues(params: Block['params']) {
    const b = block('m', 'message', { text: 'Привет', ...params }, 'e');
    return validateScenario(withStart({ m: b, e: block('e', 'end', {}) }));
  }

  it('cbToast 200 символов — предупреждения нет', () => {
    expect(codes(toastIssues({ cbToast: 'x'.repeat(200) }))).not.toContain('cbt-toast-long');
  });

  it('cbToast 201 символ — cbt-toast-long (warn), сообщение называет поле', () => {
    const issues = toastIssues({ cbToast: 'x'.repeat(201) });
    const hit = issues.find((i) => i.code === 'cbt-toast-long');
    expect(hit?.level).toBe('warn');
    expect(hit?.message).toContain('toast');
  });

  it('cbAlert 201 символ — тоже cbt-toast-long (warn), сообщение называет поле', () => {
    const issues = toastIssues({ cbAlert: 'x'.repeat(201) });
    const hit = issues.find((i) => i.code === 'cbt-toast-long');
    expect(hit?.level).toBe('warn');
    expect(hit?.message).toContain('alert');
  });

  it('cbToast с шаблоном, раскрывающимся за лимит — warn', () => {
    // 190 литеральных символов + 11 шаблонов: staticInterpolate даёт 201 символ.
    const issues = toastIssues({ cbToast: 'x'.repeat(190) + '{{a}}'.repeat(11) });
    expect(codes(issues)).toContain('cbt-toast-long');
  });
});

// ---------------- F-025: poll/quiz — вопрос ≤300, вариант ≤100 ----------------

describe('validate: poll-question-long / poll-option-long (F-025)', () => {
  function pollIssues(params: Record<string, unknown>) {
    const b = block(
      'p',
      'poll',
      {
        question: 'Вопрос',
        pollOptions: [
          { id: 'a', text: 'да' },
          { id: 'b', text: 'нет' },
        ],
        ...params,
      },
      { answered: 'e', skipped: 'e' }
    );
    return validateScenario(withStart({ p: b, e: block('e', 'end', {}) }));
  }

  it('вопрос 300 символов — ошибки нет, 301 — poll-question-long (error)', () => {
    expect(codes(pollIssues({ question: 'q'.repeat(300) }))).not.toContain('poll-question-long');
    const issues = pollIssues({ question: 'q'.repeat(301) });
    expect(codes(issues)).toContain('poll-question-long');
    expect(issues.find((i) => i.code === 'poll-question-long')?.level).toBe('error');
  });

  it('вариант 100 символов — ошибки нет, 101 — poll-option-long (error)', () => {
    const ok = pollIssues({
      pollOptions: [
        { id: 'a', text: 'o'.repeat(100) },
        { id: 'b', text: 'нет' },
      ],
    });
    expect(codes(ok)).not.toContain('poll-option-long');
    const issues = pollIssues({
      pollOptions: [
        { id: 'a', text: 'o'.repeat(101) },
        { id: 'b', text: 'нет' },
      ],
    });
    expect(codes(issues)).toContain('poll-option-long');
    expect(issues.find((i) => i.code === 'poll-option-long')?.level).toBe('error');
  });

  it('вопрос с интерполяцией {{…}} статически не проверяется', () => {
    const issues = pollIssues({ question: '{{long_answer}}' + 'q'.repeat(400) });
    expect(codes(issues)).not.toContain('poll-question-long');
  });

  it('quiz: те же лимиты — quiz-question-long / quiz-option-long (error)', () => {
    const quiz = (params: Record<string, unknown>) => {
      const b = block(
        'q',
        'quiz',
        {
          question: 'Вопрос',
          pollOptions: [
            { id: 'a', text: 'да' },
            { id: 'b', text: 'нет' },
          ],
          correctOptionId: 'a',
          ...params,
        },
        { passed: 'e', failed: 'e' }
      );
      return validateScenario(withStart({ q: b, e: block('e', 'end', {}) }));
    };
    const qIssues = quiz({ question: 'q'.repeat(301) });
    expect(codes(qIssues)).toContain('quiz-question-long');
    expect(qIssues.find((i) => i.code === 'quiz-question-long')?.level).toBe('error');
    const oIssues = quiz({
      pollOptions: [
        { id: 'a', text: 'o'.repeat(101) },
        { id: 'b', text: 'нет' },
      ],
    });
    expect(codes(oIssues)).toContain('quiz-option-long');
    expect(oIssues.find((i) => i.code === 'quiz-option-long')?.level).toBe('error');
  });
});

// ---------------- F-026: статический текст ≤4096, caption ≤1024 ----------------

describe('validate: msg-text-long / media-caption-long / editm-text-long (F-026)', () => {
  it('message: текст 4096 — ошибки нет, 4097 — msg-text-long (error)', () => {
    const mk = (len: number) => {
      const b = block('m', 'message', { text: 'x'.repeat(len) }, 'e');
      return validateScenario(withStart({ m: b, e: block('e', 'end', {}) }));
    };
    expect(codes(mk(4096))).not.toContain('msg-text-long');
    const issues = mk(4097);
    expect(codes(issues)).toContain('msg-text-long');
    expect(issues.find((i) => i.code === 'msg-text-long')?.level).toBe('error');
  });

  it('media: caption 1025 — media-caption-long (error)', () => {
    const b = block('m', 'media', { mediaUrl: 'https://x/y.png', caption: 'c'.repeat(1025) }, 'e');
    const issues = validateScenario(withStart({ m: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('media-caption-long');
    expect(issues.find((i) => i.code === 'media-caption-long')?.level).toBe('error');
  });

  it('edit_message: editText 4097 — editm-text-long (error)', () => {
    const b = block('m', 'edit_message', { editText: 'x'.repeat(4097) }, { ok: 'e', too_old: 'e', not_found: 'e' });
    const issues = validateScenario(withStart({ m: b, e: block('e', 'end', {}) }));
    expect(codes(issues)).toContain('editm-text-long');
    expect(issues.find((i) => i.code === 'editm-text-long')?.level).toBe('error');
  });

  it('динамический текст ({{…}}) статически не проверяется', () => {
    const b = block('m', 'message', { text: '{{story}}' + 'x'.repeat(5000) }, 'e');
    expect(codes(validateScenario(withStart({ m: b, e: block('e', 'end', {}) })))).not.toContain('msg-text-long');
  });
});
