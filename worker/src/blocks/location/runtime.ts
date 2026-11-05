// Location runtime: чтение геопозиции из апдейта Telegram.
//
// Движок кладёт результат в user.lat / user.lon (строками) и ведёт сценарий
// дальше; null — апдейт без location (текст, callback и т.п.).

// latitude/longitude из message.location либо edited_message.location.
// Telegram шлёт числа, но прокси/клиенты могут привести их к строкам —
// поддерживаем оба вида. Некорректные значения → null.
export function readLocationFromUpdate(update: any): { lat: number; lon: number } | null {
  const loc = update?.message?.location ?? update?.edited_message?.location;
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
