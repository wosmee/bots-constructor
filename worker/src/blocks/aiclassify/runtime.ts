// AI classify runtime: построение промпта классификатора и разбор ответа.
//
// Движок отправляет buildClassifyPrompt в ИИ-модель, а ответ прогоняет
// через parseClassifyAnswer: модель может вернуть метку в кавычках, с
// префиксом «Метка:» или лишними словами — всё это надо свести к одной
// из меток автора либо к fallbackLabel (по умолчанию 'other').

// Системный промпт классификатора: роль, нумерованный список меток,
// требование ответить одним словом; контекст и вход вставляются как есть.
export function buildClassifyPrompt(labels: string[], context: string, input: string): string {
  const list = (labels ?? []).map((l, i) => `${i + 1}. ${l}`).join('\n');
  const parts = [
    'Ты — классификатор сообщений. Выбери для текста пользователя ровно одну метку из списка.',
    '',
    'Метки:',
    list,
    '',
    'Ответь ОДНИМ словом — самой меткой, без пояснений, кавычек, номера и точки.',
  ];
  if (String(context ?? '').trim()) {
    parts.push('', 'Контекст задачи:', String(context));
  }
  parts.push('', 'Текст пользователя:', String(input ?? ''));
  return parts.join('\n');
}

// Очистка ответа модели: трим, префикс «Метка:», обрамляющие кавычки и точки.
function stripDecorations(raw: string): string {
  let s = String(raw ?? '').trim();
  s = s.replace(/^метка\s*[:\-]\s*/i, '').trim();
  // Кавычки и точки могут чередоваться («"спам".») — снимаем слоями.
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\.+$/g, '').trim();
    const m = s.match(/^["'«](.*)["'»]$/s);
    if (m && m[1].trim()) s = m[1].trim();
    else break;
  }
  return s;
}

// Экранирование метки для regex: метки — произвольный текст автора.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Ответ → метка. Точное совпадение без учёта регистра возвращает метку
// КАК в labels. Иначе — если ответ содержит ровно одну метку целиком
// словом (границы по буквам/цифрам любой письменности). Несколько меток
// в ответе — не угадываем, возвращаем fallbackLabel.
export function parseClassifyAnswer(answer: string, labels: string[], fallbackLabel: string): string {
  const list = Array.isArray(labels) ? labels.filter((l) => typeof l === 'string' && l.trim()) : [];
  const clean = stripDecorations(answer);
  if (!clean || list.length === 0) return fallbackLabel;

  const lower = clean.toLowerCase();
  const exact = list.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;

  const hits = list.filter((l) => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(l.toLowerCase())}(?![\\p{L}\\p{N}_])`, 'iu');
    return re.test(lower);
  });
  return hits.length === 1 ? hits[0] : fallbackLabel;
}
