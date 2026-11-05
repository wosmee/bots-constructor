// Quiz runtime: чистые хелперы проверки ответа викторины.
//
// Telegram quiz-poll присылает option_ids выбранных вариантов; правильный
// вариант ищем по id опции из конфига блока (correctOptionId). Движок
// использует результат для выбора ветки passed / failed.

// Индекс правильного варианта в списке опций; -1, если id не найден.
export function findCorrectIndex(
  pollOptions: Array<{ id?: string; text: string }>,
  correctOptionId: string
): number {
  if (!Array.isArray(pollOptions) || !correctOptionId) return -1;
  return pollOptions.findIndex((o) => o?.id === correctOptionId);
}

// Прошёл ли пользователь викторину: ровно один выбранный вариант и он
// совпадает с правильным индексом. Пустой ответ и мультивыбор — failed
// (quiz в Telegram одинократный).
export function evaluateQuizAnswer(
  pollOptions: Array<{ id?: string; text: string }>,
  correctOptionId: string,
  optionIds: number[]
): 'passed' | 'failed' {
  const correctIndex = findCorrectIndex(pollOptions, correctOptionId);
  if (correctIndex < 0) return 'failed';
  if (!Array.isArray(optionIds) || optionIds.length !== 1) return 'failed';
  return optionIds[0] === correctIndex ? 'passed' : 'failed';
}
