// Language runtime: нормализация language_code и выбор ветки блока language.
//
// Telegram присылает коды вида 'ru', 'en-US'; ветки блока ключеваны кодами,
// которые автор написал в langCodes. Совпадение ищем по базовому подтегу,
// но возвращаем код ИЗ ИСХОДНОГО списка — ветки сценария ссылаются на него
// как автор его задал.

// Нормализация кода языка: trim, нижний регистр, обрезка до базового
// подтега ('ru-RU' → 'ru'). Пустое/undefined → ''.
export function normalizeLangCode(code: unknown): string {
  const s = String(code ?? '').trim().toLowerCase();
  if (!s) return '';
  const cut = s.indexOf('-');
  return cut >= 0 ? s.slice(0, cut) : s;
}

// Какую ветку выбрать для langCode: совпавший код из codes (в исходном
// написании) либо 'fallback'. Пустой список кодов → 'fallback'.
export function pickLangBranch(codes: string[] | undefined, langCode: unknown): string {
  if (!Array.isArray(codes) || codes.length === 0) return 'fallback';
  const want = normalizeLangCode(langCode);
  if (!want) return 'fallback';
  for (const c of codes) {
    if (normalizeLangCode(c) === want) return c;
  }
  return 'fallback';
}
