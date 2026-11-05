// Тесты функций выражений: белый список, вложенность, ошибки автора и
// безопасность. Модуль стоит между интерполяцией {{var}} и evalExpression(),
// поэтому отдельно фиксируется: без вызовов поведение прежнее до символа.
import { describe, it, expect } from 'vitest';
import {
  EXPR_FUNCTIONS,
  evalExprWithFunctions,
  evalCalls,
  hasFunctionCall,
  unknownFunctionNames,
  hasMalformedCall,
  splitArgs,
  toDate,
  formatDate,
} from '../shared/expr';
import { evalExpression, interpolate } from '../shared/types';

// Фиксированные now и rand: иначе now()/today()/random() не проверяемы.
const NOW = Date.UTC(2026, 8, 23, 12, 34, 56); // 2026-09-23T12:34:56Z
const ev = (src: string, rand: () => number = () => 0) =>
  evalExprWithFunctions(src, { now: NOW, rand });
const valueOf = (src: string, rand?: () => number) => ev(src, rand).value;
const str = (src: string, rand?: () => number) => String(ev(src, rand).value);

describe('EXPR_FUNCTIONS', () => {
  it('белый список содержит ровно обещанные функции', () => {
    expect([...EXPR_FUNCTIONS].sort()).toEqual(
      ['ceil', 'concat', 'default', 'floor', 'format_date', 'len', 'lower', 'now', 'random', 'replace', 'round', 'substr', 'today', 'trim', 'upper'].sort()
    );
  });
});

describe('функции: строки', () => {
  it('len: длина строки', () => {
    expect(valueOf('len("abc")')).toBe(3);
    expect(valueOf('len("")')).toBe(0);
    // Кириллица: длина в символах, а не в байтах.
    expect(valueOf('len("привет")')).toBe(6);
  });

  it('upper/lower: регистр', () => {
    expect(valueOf('upper("ab")')).toBe('AB');
    expect(valueOf('lower("AB")')).toBe('ab');
    expect(valueOf('upper("привет")')).toBe('ПРИВЕТ');
  });

  it('trim: без второго аргумента обрезает пробелы', () => {
    expect(valueOf('trim("  ab  ")')).toBe('ab');
    expect(valueOf('trim("\t ab \t")')).toBe('ab');
  });

  it('trim: второй аргумент — набор символов для обрезки', () => {
    expect(valueOf('trim("--ab--", "-")')).toBe('ab');
    expect(valueOf('trim("xxabyy", "xy")')).toBe('ab');
    // Пустой второй аргумент — как его отсутствие.
    expect(valueOf('trim("  ab  ", "")')).toBe('ab');
    // Обрезается только по краям, середина не трогается.
    expect(valueOf('trim("xaxbx", "x")')).toBe('axb');
  });

  it('substr: старт, длина и отрицательный старт', () => {
    expect(valueOf('substr("abcdef", 2)')).toBe('cdef');
    expect(valueOf('substr("abcdef", 1, 3)')).toBe('bcd');
    expect(valueOf('substr("abcdef", -2)')).toBe('ef');
    expect(valueOf('substr("abcdef", -4, 2)')).toBe('cd');
    // Старт за концом строки и отрицательная длина — пустая строка, без ошибки.
    expect(valueOf('substr("abc", 99)')).toBe('');
    expect(valueOf('substr("abc", 1, -1)')).toBe('');
  });

  it('replace: разделитель — строка, а не регулярка', () => {
    expect(valueOf('replace("a-b-c", "-", "+")')).toBe('a+b+c');
    expect(valueOf('replace("a.b.c", ".", "-")')).toBe('a-b-c');
    // Точка не значит «любой символ»: будь это RegExp, «a.b.c» дал бы «---».
    expect(valueOf('replace("axbxc", ".", "-")')).toBe('axbxc');
  });

  it('replace: пустой второй аргумент возвращает исходную строку', () => {
    // Пустой разделитель в split/join дал бы «XaXbXcX» — модуль это отсекает.
    expect(valueOf('replace("abc", "", "X")')).toBe('abc');
  });

  it('concat: склейка, в том числе без аргументов', () => {
    expect(valueOf('concat("a", "b", "c")')).toBe('abc');
    expect(valueOf('concat("a", "b", "c", "d", "e")')).toBe('abcde');
    expect(valueOf('concat()')).toBe('');
  });

  it('default: пусто -> второй аргумент, непусто -> первое значение', () => {
    expect(valueOf('default("", "fallback")')).toBe('fallback');
    expect(valueOf('default("есть", "fallback")')).toBe('есть');
    // Строки-заглушки из интерполяции тоже считаются «пусто».
    expect(valueOf('default("undefined", "x")')).toBe('x');
    expect(valueOf('default("null", "x")')).toBe('x');
    // Без второго аргумента пустое значение остаётся пустым.
    expect(valueOf('default("")')).toBe('');
  });
});

describe('функции: дата и время', () => {
  it('now: без аргумента — число (мс), с шаблоном — форматированная дата', () => {
    expect(valueOf('now()')).toBe(NOW);
    expect(str('now("YYYY-MM-DD HH:mm:ss")')).toBe('2026-09-23 12:34:56');
    expect(str('now("DD.MM.YYYY")')).toBe('23.09.2026');
  });

  it('today: по умолчанию YYYY-MM-DD', () => {
    // Со шаблоном результат безопасен: «23.09.2026» калькулятор не разберёт.
    expect(str('today("DD.MM.YYYY")')).toBe('23.09.2026');
    expect(str('today("DD.MM.YYYY HH:mm")')).toBe('23.09.2026 12:34');
    // Поведение today() по умолчанию — в блоке известных дефектов ниже.
  });

  it('format_date: из ISO-строки', () => {
    expect(str('format_date("2026-09-23", "DD.MM.YYYY")')).toBe('23.09.2026');
    expect(str('format_date("2026-09-23T10:20:30Z", "HH:mm:ss")')).toBe('10:20:30');
  });

  it('format_date: из unix-секунд', () => {
    // 1758628496 = 2025-09-23T11:54:56Z (10 цифр -> секунды).
    expect(str('format_date("1758628496", "DD.MM.YYYY")')).toBe('23.09.2025');
    expect(str('format_date("1758628496", "YYYY-MM-DD HH:mm:ss")')).toBe('2025-09-23 11:54:56');
  });

  it('format_date: из unix-миллисекунд', () => {
    // 13 цифр -> это уже мс, домножать нельзя.
    expect(toDate('1758628496000', NOW)?.toISOString()).toBe(toDate('1758628496', NOW)?.toISOString());
    expect(str('format_date("1758628496000", "DD.MM.YYYY")')).toBe('23.09.2025');
  });

  it('format_date: неразбираемая дата — ошибка, а не мусор в сообщении', () => {
    const r = ev('format_date("не дата", "YYYY")');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expr-malformed');
  });
});

describe('функции: числа и случайность', () => {
  it('random: без аргумента 0..99 при фиксированном rand', () => {
    expect(str('random()', () => 0)).toBe('0');
    expect(str('random()', () => 0.99)).toBe('99');
  });

  it('random(max): 0..max-1', () => {
    expect(str('random(10)', () => 0)).toBe('0');
    expect(str('random(10)', () => 0.99)).toBe('9');
  });

  it('random(min, max): [min, max)', () => {
    expect(str('random(5, 10)', () => 0.5)).toBe('7');
    expect(str('random(5, 10)', () => 0)).toBe('5');
    // Вырожденный диапазон возвращает min, а не уходит в случайность.
    expect(str('random(5, 5)', () => 0.99)).toBe('5');
  });

  it('round/floor/ceil: без второго аргумента — целые', () => {
    expect(valueOf('round(2.4)')).toBe(2);
    expect(valueOf('round(2.6)')).toBe(3);
    expect(valueOf('floor(2.9)')).toBe(2);
    expect(valueOf('floor(-2.1)')).toBe(-3);
    expect(valueOf('ceil(2.1)')).toBe(3);
  });

  it('round/floor/ceil: второй аргумент — число знаков после запятой', () => {
    expect(valueOf('round(2.345, 2)')).toBe(2.35);
    expect(valueOf('floor(2.99, 1)')).toBe(2.9);
    expect(valueOf('ceil(2.001, 2)')).toBe(2.01);
    // 0 знаков — то же, что без аргумента.
    expect(valueOf('round(2.6, 0)')).toBe(3);
  });
});

describe('вложенность вызовов', () => {
  it('upper(trim("  ab  ")) -> AB', () => {
    expect(valueOf('upper(trim("  ab  "))')).toBe('AB');
  });

  it('concat(a, upper(b))', () => {
    expect(valueOf('concat("a", upper("b"))')).toBe('aB');
    expect(valueOf('concat(upper("a"), lower("B"))')).toBe('Ab');
  });

  it('вложенность с датой и разбором аргументов', () => {
    expect(valueOf('len(today("YYYY-MM-DD"))')).toBe(10);
    expect(valueOf('concat("дата: ", now("DD.MM.YYYY"))')).toBe('дата: 23.09.2026');
  });

  it('скобка внутри строкового аргумента не ломает разбор вызова', () => {
    // Регексп бы такое не разобрал, а ручной разбор учитывает кавычки.
    expect(str('replace("a)b", ")", "-")')).toBe('a-b');
    expect(str('replace("a,b", ",", ";")')).toBe('a;b');
    expect(splitArgs('"a)b", 1')).toEqual(['"a)b"', ' 1']);
  });
});

describe('splitArgs', () => {
  it('режет по запятым верхнего уровня, кавычки и скобки не разделители', () => {
    expect(splitArgs('a, b')).toEqual(['a', ' b']);
    expect(splitArgs('"c, d", upper(x)')).toEqual(['"c, d"', ' upper(x)']);
    expect(splitArgs('a, b, "c, d", upper(x)')).toEqual(['a', ' b', ' "c, d"', ' upper(x)']);
    // Пустой ввод — один пустой аргумент: вызывающий код сам решает, что это [].
    expect(splitArgs('')).toEqual(['']);
  });
});

describe('evalCalls', () => {
  it('заменяет вызовы результатами, остальной текст не трогает', () => {
    expect(evalCalls('upper("a") b', 0, { now: NOW, rand: () => 0 })).toEqual({ ok: true, text: 'A b' });
    expect(evalCalls('привет', 0, { now: NOW, rand: () => 0 })).toEqual({ ok: true, text: 'привет' });
  });

  it('без вызовов возвращает тот же текст', () => {
    const res = evalCalls('1 + 2', 0, { now: NOW, rand: () => 0 });
    expect(res.ok).toBe(true);
    expect(res.text).toBe('1 + 2');
  });

  it('неизвестная функция — ok=false и исходный текст', () => {
    const res = evalCalls('foo(1)', 0, { now: NOW, rand: () => 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('expr-unknown-fn');
    expect(res.text).toBe('foo(1)');
  });

  it('незакрытая скобка — ok=false, expr-malformed', () => {
    const res = evalCalls('len("a"', 0, { now: NOW, rand: () => 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('expr-malformed');
  });
});

describe('toDate / formatDate', () => {
  it('toDate разбирает секунды, миллисекунды и ISO-строку', () => {
    expect(toDate('1758628496', NOW)?.toISOString()).toBe('2025-09-23T11:54:56.000Z');
    expect(toDate('1758628496000', NOW)?.toISOString()).toBe('2025-09-23T11:54:56.000Z');
    expect(toDate('2026-09-23', NOW)?.toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(toDate('2026-09-23T10:20:30Z', NOW)?.toISOString()).toBe('2026-09-23T10:20:30.000Z');
  });

  it('toDate возвращает null на пустом и неразбираемом вводе', () => {
    expect(toDate('', NOW)).toBeNull();
    expect(toDate('не дата', NOW)).toBeNull();
    expect(toDate('23.09.2026', NOW)).toBeNull();
  });

  it('formatDate подставляет YYYY MM DD HH mm ss и молчит про остальное', () => {
    const d = toDate('2026-09-23T10:20:30Z', NOW)!;
    expect(formatDate(d, 'DD.MM.YYYY HH:mm:ss')).toBe('23.09.2026 10:20:30');
    // Шаблон по умолчанию — YYYY-MM-DD.
    expect(formatDate(d)).toBe('2026-09-23');
    // Неизвестные буквы остаются как есть: «сегодня 23.09» автор пишет сам.
    expect(formatDate(d, 'сегодня DD.MM')).toBe('сегодня 23.09');
  });
});

describe('без вызовов функций поведение прежнее (evalExpression)', () => {
  it('арифметика и текст совпадают с evalExpression', () => {
    for (const src of ['1+2', '3 * 2', 'abc', '', '(1+2)*3']) {
      expect(ev(src).value).toBe(evalExpression(src));
      expect(ev(src).ok).toBe(true);
    }
  });

  it('подставленный шаблон «{{n}} * 2» считается как арифметика', () => {
    // Движок сначала интерполирует, потом считает: здесь проверяем второй шаг.
    const interpolated = interpolate('{{n}} * 2', { n: 3 });
    expect(interpolated).toBe('3 * 2');
    const r = evalExprWithFunctions(interpolated, { now: NOW, rand: () => 0 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(evalExpression(interpolated));
    expect(r.value).toBe(6);
  });

  it('код возврата успеха не заполнен ошибкой', () => {
    const r = ev('1+2');
    expect(r.error).toBeUndefined();
    expect(r.message).toBeUndefined();
  });
});

describe('безопасность: ничего не исполняется', () => {
  it('хостел-ввод из данных пользователя остаётся текстом', () => {
    const hostile = '{{x}}); process.exit(';
    const r = ev(hostile);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(hostile);
    // Проверка перед вызовом: подозрительный ввод даже не считается выражением.
    expect(hasFunctionCall(hostile)).toBe(false);
    expect(unknownFunctionNames(hostile)).toEqual([]);
  });

  it('eval("1") — неизвестное имя, а не исполнение', () => {
    const r = ev('upper("a") eval("1")');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expr-unknown-fn');
    // Исходная строка отдаётся как есть — движок не отправит усечённый текст.
    expect(r.value).toBe('upper("a") eval("1")');
    expect(unknownFunctionNames('eval("1")')).toEqual(['eval']);
  });

  it('constructor(1) — неизвестное имя', () => {
    const r = ev('upper("a") constructor(1)');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expr-unknown-fn');
    expect(r.value).toBe('upper("a") constructor(1)');
    expect(unknownFunctionNames('constructor(1)')).toEqual(['constructor']);
  });

  it('process.exit(1) — неизвестное имя, не вызов процесса', () => {
    expect(unknownFunctionNames('process.exit(1)')).toEqual([]);
    // Для nameAt() точка — запрет на склейку, так что «process.exit(» именем не
    // считается вовсе: это не вызов функции, а обычный текст.
    expect(hasFunctionCall('process.exit(1)')).toBe(false);
  });

  it('слишком глубокая вложенность — ошибка, а не переполнение стека', () => {
    const deep = 'upper('.repeat(30) + '"a"' + ')'.repeat(30);
    const r = ev(deep);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expr-malformed');
    expect(r.message).toContain('вложенность');
    // 20 уровней — в пределах потолка и считаются нормально.
    expect(valueOf('upper('.repeat(20) + '"a"' + ')'.repeat(20))).toBe('A');
  });
});

describe('разбор имён: hasFunctionCall / unknownFunctionNames / hasMalformedCall', () => {
  it('hasFunctionCall отличает вызов от обычного текста', () => {
    expect(hasFunctionCall('просто текст')).toBe(false);
    expect(hasFunctionCall('abc')).toBe(false);
    expect(hasFunctionCall('upper("a")')).toBe(true);
    // Пробел между именем и скобкой допустим.
    expect(hasFunctionCall('len ("a")')).toBe(true);
    // Имя, приклеенное к числу («2ab(3)»), функцией не считается.
    expect(hasFunctionCall('2ab(3)')).toBe(false);
    // Имя вне белого списка — тоже не «вызов функции» для этого модуля.
    expect(hasFunctionCall('foo("a")')).toBe(false);
  });

  it('unknownFunctionNames находит имена не из белого списка', () => {
    expect(unknownFunctionNames('upper("a") + len("b")')).toEqual([]);
    expect(unknownFunctionNames('foo(1) bar(2) upper(3)')).toEqual(['foo', 'bar']);
    // Повторы схлопываются: автору достаточно увидеть имя один раз.
    expect(unknownFunctionNames('foo(1) foo(2)')).toEqual(['foo']);
    // Битая скобка — не «неизвестное имя», для неё есть hasMalformedCall().
    expect(unknownFunctionNames('foo(1')).toEqual([]);
  });

  it('hasMalformedCall ловит незакрытую скобку вызова', () => {
    expect(hasMalformedCall('len(')).toBe(true);
    expect(hasMalformedCall('len("a")')).toBe(false);
    expect(hasMalformedCall('просто текст')).toBe(false);
    // Скобка в обычной фразе — не вызов функции и не придирка валидатора.
    expect(hasMalformedCall('привет (как дела')).toBe(false);
  });
});

describe('ошибки автора: число аргументов', () => {
  it('неверное число аргументов -> expr-malformed', () => {
    for (const src of ['upper()', 'upper("a","b")', 'len()', 'round()', 'substr("a")', 'replace("a","b")', 'trim("a","b","c")', 'now("a","b")']) {
      const r = ev(src);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('expr-malformed');
      // Возвращается исходная строка: автор видит в сообщении свой текст.
      expect(r.value).toBe(src);
    }
  });
});

// Регрессия на два дефекта, найденные при написании этих тестов и исправленные
// в shared/expr.ts. Раньше здесь стояли `it.fails` как маркеры: тесты падали,
// пока баг жив, и проходили после починки. Баг исправлен — маркеры сняты.
describe('регрессия: даты и производительность разбора', () => {
  it('format_date: ISO-дата без шаблона не проходит через калькулятор', () => {
    // Раньше: format_date("2026-09-23") -> '1994'. Результат функции уходил в
    // evalExpression(), а «2026-09-23» состоит из разрешённых калькулятору
    // символов и считался вычитанием: 2026 - 9 - 23 = 1994.
    expect(str('format_date("2026-09-23")')).toBe('2026-09-23');
  });

  it('today: результат не попадает в арифметику', () => {
    // today() -> formatDate(..., 'YYYY-MM-DD') -> '2026-09-23' -> тот же 1994.
    expect(str('today()')).toBe('2026-09-23');
  });

  it('format_date: шаблон по умолчанию для даты со временем тоже цел', () => {
    expect(str('format_date("2026-09-23T10:20:30Z")')).toBe('2026-09-23');
  });

  it('арифметика в шаблоне по-прежнему считается', () => {
    // Обратная сторона правила: если арифметика была ВНЕ вызовов, её считаем.
    expect(valueOf('1 + 2')).toBe(3);
    expect(valueOf('len("abc") + 1')).toBe(4);
  });

  it('числовой результат функции остаётся числом', () => {
    // Функции возвращают значение, а не строку: round(...,2) -> 2.35, now() -> мс.
    expect(valueOf('round(2.345, 2)')).toBe(2.35);
    expect(valueOf('len("abc")')).toBe(3);
    expect(valueOf('now()')).toBe(NOW);
  });

  it('длинная строка из букв разбирается мгновенно', () => {
    // Раньше nameAt() на каждой позиции досчитывала «слово» до конца: разбор
    // был квадратичным, и строка в 100 КБ вешала воркер на минуты. Теперь скан
    // однопроходный, а слова копируются целиком.
    // Пробел перед len( обязателен: без него «aaaa…len» — одно длинное имя,
    // а не вызов функции, и это корректно по грамматике.
    const src = 'a'.repeat(100000) + ' len(';
    const started = Date.now();
    const r = evalExprWithFunctions(src, { now: NOW, rand: () => 0 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expr-malformed');
    expect(r.value).toBe(src);
  });

  it('длинное слово без вызова не считается вызовом и не тормозит', () => {
    // Границы слова нет — это имя переменной, а не функция. Разбор линеен.
    const src = 'a'.repeat(100000) + 'len(';
    const started = Date.now();
    const r = evalExprWithFunctions(src, { now: NOW, rand: () => 0 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(src);
  });

  it('100 000 символов без букв разбираются мгновенно', () => {
    const src = '!'.repeat(100000) + 'len(';
    const started = Date.now();
    const r = evalExprWithFunctions(src, { now: NOW, rand: () => 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expr-malformed');
    expect(r.value).toBe(src);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
