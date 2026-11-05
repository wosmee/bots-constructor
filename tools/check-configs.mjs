// tools/check-configs.mjs — преддеплойная страховка конфигов (задача Todoist #6hvh923JgF948MMj).
// Проверяет, что рабочие нетрекаемые конфиги на диске НЕ перетёрты example-шаблонами.
// Случай из 03.11: wrangler.toml был перезаписан шаблоном с YOUR_CLOUDFLARE_ACCOUNT_ID,
// деплой падал 7003 «Could not route», а выглядело как протухший токен.
// Запуск: node tools/check-configs.mjs  (exit 1 = деплой нельзя).
// Смысл проверок — в «Ловушках инструментов агента (Windows)» п. 93.

import { readFileSync } from "node:fs";

const fail = (msg) => { console.error("FAIL " + msg); process.exitCode = 1; };
const ok = (msg) => console.log("ok   " + msg);

// --- worker/wrangler.toml: реальный account_id (32 hex), не плейсхолдер ---
let toml = "";
try {
  toml = readFileSync("worker/wrangler.toml", "utf8");
} catch {
  fail("worker/wrangler.toml отсутствует — восстановить из git (см. Ловушки п. 93)");
}
if (toml) {
  if (/YOUR_[A-Z_]+/.test(toml)) {
    fail("worker/wrangler.toml содержит плейсхолдер YOUR_* — конфиг шаблонный; деплой уйдёт в 7003. " +
      "Восстановить: git show <последний коммит с конфигом>:worker/wrangler.toml");
  } else {
    const m = toml.match(/^account_id\s*=\s*"([0-9a-f]{32})"$/m);
    if (m) ok("worker/wrangler.toml: account_id " + m[1]);
    else fail("worker/wrangler.toml: account_id не найден или не 32-hex");
  }
  for (const key of ["routes", "[vars]", "[observability]", "[triggers]"]) {
    if (!toml.includes(key)) fail("worker/wrangler.toml: нет секции " + key + " (в шаблоне их не было)");
    else ok("worker/wrangler.toml: секция " + key + " на месте");
  }
}

// --- web/.env.production: реальный workers.dev, не example ---
try {
  const env = readFileSync("web/.env.production", "utf8");
  if (/your-/.test(env)) {
    fail("web/.env.production содержит шаблонное your-* значение");
  } else {
    const m = env.match(/^VITE_API_BASE=(\S+)$/m);
    if (m) ok("web/.env.production: VITE_API_BASE=" + m[1]);
    else fail("web/.env.production: VITE_API_BASE не найден");
  }
} catch {
  fail("web/.env.production отсутствует — прод-сборка фронта уйдёт мимо прода");
}

// --- worker/.dev.vars: не потеряны ли локальные ключи ---
try {
  const dev = readFileSync("worker/.dev.vars", "utf8");
  for (const key of ["ENCRYPTION_KEY=", "ADMIN_KEY="]) {
    if (!dev.includes(key)) fail("worker/.dev.vars: нет " + key + " — локальный стенд сломается");
    else ok("worker/.dev.vars: " + key.slice(0, -1) + " на месте");
  }
} catch {
  fail("worker/.dev.vars отсутствует — локальный стенд не поднимется");
}

if (process.exitCode) {
  console.error("\nИтог: деплой НЕ запускать — конфиги не в порядке.");
} else {
  console.log("\nИтог: конфиги в порядке, деплой можно.");
}
