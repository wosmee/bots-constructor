// Тесты разметки: интерполяция переменных + экранирование под parse_mode.
// Модуль общий для воркера и превью, поэтому здесь фиксируется контракт:
// {{var}} экранируется, {{{var}}} — явный опт-ин «как есть».
import { describe, it, expect } from 'vitest';
import { escapeMarkup, renderMarkup, htmlTagProblem } from '../shared/markup';
import { interpolate } from '../shared/types';

// Все символы, значимые в MarkdownV2 по документации Telegram.
const MDV2_SPECIALS = ['.', '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '!'];

describe('escapeMarkup', () => {
  it('HTML экранирует только & < >', () => {
    expect(escapeMarkup('&<>', 'HTML')).toBe('&amp;&lt;&gt;');
    expect(escapeMarkup('a&<b>', 'HTML')).toBe('a&amp;&lt;b&gt;');
    // Амперсанд обрабатывается первым, иначе получилось бы &amp;lt;
    expect(escapeMarkup('<', 'HTML')).toBe('&lt;');
  });

  it('MarkdownV2 экранирует каждый значимый символ', () => {
    // Проверяем по одному: одиночный символ -> слэш + символ.
    for (const ch of MDV2_SPECIALS) {
      expect(escapeMarkup(ch, 'MarkdownV2')).toBe(`\\${ch}`);
    }
    // И весь набор целиком — порядок символов в строке сохраняется.
    const all = MDV2_SPECIALS.join('');
    expect(escapeMarkup(all, 'MarkdownV2')).toBe(MDV2_SPECIALS.map((c) => `\\${c}`).join(''));
  });

  it('MarkdownV2 экранирует и обратный слэш', () => {
    // В документации Telegram его нет в списке, но без экранирования он сам
    // начинает экранировать следующий символ — модуль закрывает эту дыру.
    expect(escapeMarkup('\\', 'MarkdownV2')).toBe('\\\\');
  });

  it("режимы 'none' и undefined ничего не трогают", () => {
    expect(escapeMarkup('a&<>_', 'none')).toBe('a&<>_');
    expect(escapeMarkup('a&<>_', undefined)).toBe('a&<>_');
    expect(escapeMarkup('*жирный* . {x}', 'none')).toBe('*жирный* . {x}');
  });
});

describe('renderMarkup: подстановка и экранирование', () => {
  it('HTML: {{var}} экранируется, тег из данных пользователя не проходит', () => {
    expect(renderMarkup('x {{v}} y', { v: '<b>&' }, 'HTML')).toBe('x &lt;b&gt;&amp; y');
    // Отдельный случай «злой пользователь пишет тег»: он остаётся текстом.
    expect(renderMarkup('{{nick}}', { nick: '<b>жирный</b>' }, 'HTML')).toBe('&lt;b&gt;жирный&lt;/b&gt;');
  });

  it('MarkdownV2: {{var}} экранируется целиком', () => {
    expect(renderMarkup('{{v}}', { v: '_a.b!' }, 'MarkdownV2')).toBe('\\_a\\.b\\!');
    expect(renderMarkup('a {{{x}}} b {{y}} c', { x: '12_34', y: 'a_b' }, 'MarkdownV2')).toBe('a 12_34 b a\\_b c');
  });

  it('MarkdownV2: разметка самого автора шаблона тоже экранируется', () => {
    // Правило безопасности: экранируется весь шаблон, а не только значения.
    // Автор, которому нужна жирная строка, должен писать её в HTML-режиме.
    expect(renderMarkup('*жирный*', {}, 'MarkdownV2')).toBe('\\*жирный\\*');
  });

  it('отсутствие значения и null дают пустую строку', () => {
    expect(renderMarkup('[{{v}}]', {}, 'HTML')).toBe('[]');
    expect(renderMarkup('[{{v}}]', { v: undefined }, 'HTML')).toBe('[]');
    expect(renderMarkup('[{{v}}]', { v: null }, undefined)).toBe('[]');
  });

  it('текст без подстановок возвращается как есть', () => {
    expect(renderMarkup('нет подстановок a&<>', {}, 'none')).toBe('нет подстановок a&<>');
    expect(renderMarkup('привет, {{name}}!', { name: 'Илья' }, 'none')).toBe('привет, Илья!');
  });

  it('имена переменных с точкой подставляются', () => {
    expect(renderMarkup('{{user.name}}', { 'user.name': 'Илья' }, 'HTML')).toBe('Илья');
    expect(renderMarkup('{{user.name}}', { 'user.name': 'Илья' }, 'none')).toBe('Илья');
  });
});

describe("renderMarkup: 'none'/undefined совместимы с interpolate()", () => {
  // Старые сценарии не знают про parseMode: для них поведение обязано совпасть
  // с прежней функцией interpolate() до символа.
  const cases: [string, Record<string, unknown>][] = [
    ['привет, {{name}}!', { name: 'Илья' }],
    ['{{a}} & {{b}} <tag>', { a: '<', b: '&' }],
    ['без подстановок', {}],
    ['{{miss}} x {{y}}', { y: '2' }],
    ['{{user.name}} и {{count}}', { 'user.name': 'Илья', count: 7 }],
  ];

  it("режим 'none' равен interpolate()", () => {
    for (const [tpl, vars] of cases) {
      expect(renderMarkup(tpl, vars, 'none')).toBe(interpolate(tpl, vars));
    }
  });

  it('отсутствие parseMode равно interpolate()', () => {
    for (const [tpl, vars] of cases) {
      expect(renderMarkup(tpl, vars, undefined)).toBe(interpolate(tpl, vars));
    }
  });

  it('нуль и пустая строка подставляются как значения, а не как «пусто»', () => {
    // interpolate() считает пустыми только undefined/null — модуль сохраняет это.
    expect(renderMarkup('{{n}}', { n: 0 }, 'HTML')).toBe(interpolate('{{n}}', { n: 0 }));
    expect(renderMarkup('{{n}}', { n: 0 }, 'HTML')).toBe('0');
    expect(renderMarkup('{{s}}', { s: '' }, 'HTML')).toBe('');
  });
});

describe('renderMarkup: raw-подстановка {{{var}}}', () => {
  it('raw-значение не экранируется, соседние обычные — экранируются', () => {
    expect(renderMarkup('{{a}}|{{{b}}}|{{a}}', { a: '<i>', b: '<b>ok</b>' }, 'HTML')).toBe(
      '&lt;i&gt;|<b>ok</b>|&lt;i&gt;'
    );
  });

  it('raw-значение не экранируется и в MarkdownV2', () => {
    expect(renderMarkup('{{{v}}}', { v: '_a.b!' }, 'MarkdownV2')).toBe('_a.b!');
    expect(renderMarkup('{{v}}', { v: '_a.b!' }, 'MarkdownV2')).toBe('\\_a\\.b\\!');
  });

  it('плейсхолдер raw-подстановки не портит соседний текст', () => {
    // Значение с цифрами и подчёркиваниями рядом с обычной подстановкой: если бы
    // raw-часть заменялась «в лоб», экранирование съело бы её цифры или соседа.
    expect(renderMarkup('a {{{x}}} b {{y}} c', { x: '12_34', y: 'z' }, 'HTML')).toBe('a 12_34 b z c');
    expect(renderMarkup('a {{{x}}} b {{y}} c', { x: '12_34', y: '<z>' }, 'HTML')).toBe('a 12_34 b &lt;z&gt; c');
    expect(renderMarkup('a {{{x}}} b {{y}} c', { x: '12_34', y: 'a_b' }, 'MarkdownV2')).toBe('a 12_34 b a\\_b c');
  });

  it('несколько raw-подстановок подряд разбираются по отдельности', () => {
    // ES-05: несбалансированные теги в raw-подстановке экранируются (безопасность).
    expect(renderMarkup('{{{a}}}|{{{b}}}', { a: '<x>', b: '<y>' }, 'HTML')).toBe('&lt;x&gt;|&lt;y&gt;');
    // Сбалансированные значения проходят как есть (авторская разметка).
    expect(renderMarkup('{{{a}}}|{{{b}}}', { a: '<b>x</b>', b: '<i>y</i>' }, 'HTML')).toBe('<b>x</b>|<i>y</i>');
    // Формально значения склеиваются в «1_23_4» — так и должно быть: raw-части
    // вставляются как есть, экранировать их никто не обязан.
    expect(renderMarkup('{{{a}}}{{{b}}}', { a: '1_2', b: '3_4' }, 'HTML')).toBe('1_23_4');
  });

  it('экранируется весь шаблон: собственный тег автора тоже становится текстом', () => {
    // Это следствие правила безопасности: escapeMarkup() проходит по всей строке,
    // а не только по значениям. Единственный способ отдать Telegram настоящий
    // тег — raw-подстановка, потому что она возвращается после экранирования.
    expect(renderMarkup('<b>{{x}}</b>', { x: 'V' }, 'HTML')).toBe('&lt;b&gt;V&lt;/b&gt;');
  });

  it('raw-подстановка отсутствующей переменной даёт пустую строку', () => {
    expect(renderMarkup('{{{v}}}', { v: undefined }, 'HTML')).toBe('');
    expect(renderMarkup('[{{{v}}}]', {}, 'HTML')).toBe('[]');
  });

  it('тройные скобки не поддерживает interpolate() — это и есть разница режимов', () => {
    // Явно фиксируем расхождение: raw — новая возможность renderMarkup,
    // старый interpolate() видит в «{{{v}}}» обычную подстановку с лишней скобкой.
    expect(renderMarkup('{{{v}}}', { v: 'V' }, 'none')).toBe('V');
    expect(interpolate('{{{v}}}', { v: 'V' })).toBe('{V}');
  });
});

describe('htmlTagProblem', () => {
  it('сбалансированные теги и текст без тегов — проблемы нет', () => {
    expect(htmlTagProblem('<b>жирный</b>')).toBeNull();
    expect(htmlTagProblem('просто текст')).toBeNull();
    expect(htmlTagProblem('')).toBeNull();
    expect(htmlTagProblem('<a href="https://example.com">ссылка</a>')).toBeNull();
  });

  it('вложенные теги, закрытые в правильном порядке, — проблемы нет', () => {
    expect(htmlTagProblem('<b><i>перепутан</i></b>')).toBeNull();
    expect(htmlTagProblem('<b><i><u>три</u></i></b>')).toBeNull();
  });

  it('незакрытый тег — проблема с именем тега', () => {
    const problem = htmlTagProblem('<b>не закрыт');
    expect(typeof problem).toBe('string');
    expect(problem).toContain('<b>');
    // Верхний незакрытый тег в стеке — тот, о котором и надо сообщить.
    expect(htmlTagProblem('<b><i>ой')).toContain('<i>');
  });

  it('лишний закрывающий тег — проблема', () => {
    expect(typeof htmlTagProblem('</b>лишний')).toBe('string');
    expect(htmlTagProblem('</b>лишний')).toContain('</b>');
    expect(typeof htmlTagProblem('текст</i>')).toBe('string');
  });

  it('перекрещенные теги — проблема', () => {
    expect(typeof htmlTagProblem('<b><i>ой</b></i>')).toBe('string');
  });

  it('самозакрывающиеся и void-теги не ломают баланс', () => {
    expect(htmlTagProblem('a<br>b')).toBeNull();
    expect(htmlTagProblem('a<br/>b')).toBeNull();
    expect(htmlTagProblem('a<hr>b')).toBeNull();
    expect(htmlTagProblem('<b>текст<br>ещё</b>')).toBeNull();
  });
});
