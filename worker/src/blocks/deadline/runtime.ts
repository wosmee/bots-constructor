// Дедлайн (набор 2026-10): чистые правила выбора ветки при срабатывании крона.
// Крон читает ЖИВУЮ сессию: переменная-флаг отмены установлена — пользователь
// успел (оплатил, подтвердил) и поток идёт в done без сообщения; иначе expired.

// Флаг отмены «установлен»: любое значение, кроме пустого, '0' и 'false'
// (регистр не важен). Числовая строка '0' и булево-строка 'false' — это
// авторское «не успел», а не отмена.
export function isCancelledFlag(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  return s !== '0' && s.toLowerCase() !== 'false';
}

// Ветка срабатывания дедлайна по переменным сессии.
export function deadlineBranch(vars: Record<string, unknown>, cancelVar: string): 'done' | 'expired' {
  if (!cancelVar) return 'expired';
  return isCancelledFlag(vars[cancelVar]) ? 'done' : 'expired';
}
