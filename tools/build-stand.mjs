// tools/build-stand.mjs — стендовая сборка фронта (задача Todoist #6hvh927XmCFfwJ7j).
// Бандл для локального стенда (tmp/ui-stand/serve.mjs) обязан собираться БЕЗ прод-URL:
// если VITE_API_BASE уедет в бандл, приложение будет слать запросы мимо прокси на
// *.workers.dev, который из headless-браузера не открывается (DPI, §17/§18).
//
// Почему node-обёртка, а не PowerShell: пустое ПРИСВАИВАНИЕ в PowerShell
// (`$env:VITE_API_BASE=''`) УДАЛЯЕТ переменную, а удалённая переменная не
// перебивает .env.production — соберётся прод-бандл. Только env ПРОЦЕССА
// с буквальной пустой строкой VITE_API_BASE="" доезжает до vite как override.
// (Ловушки п. 83 vs п. 93.)
//
// Запуск из корня репо: node tools/build-stand.mjs [--out <dir>]
// По умолчанию out = tmp/dist-stand (не трогает web/dist — прод-сборка остаётся чистой).
// Vite вызывается напрямую: execFileSync(node vite.js --outDir ...), npm-шимы
// (.cmd/.ps1) в этой среде блокируются политикой (§17).
//
// Гейт: grep "workers.dev" по собранным ассетам — 0 вхождений в JS-коде
// (проверка из §17/§18; если найдено — сборка считается проваленной, exit 1).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url))); // корень репо
const VITE = join(ROOT, "web/node_modules/vite/bin/vite.js");

// --out <dir>: абсолютный или относительно корня репо
const args = process.argv.slice(2);
let out = join(ROOT, "tmp/dist-stand");
const iOut = args.indexOf("--out");
if (iOut !== -1 && args[iOut + 1]) {
  const v = args[iOut + 1];
  out = /^[a-zA-Z]:[\\/]/.test(v) ? v : join(ROOT, v);
}

console.log("Стендовая сборка фронта (без VITE_API_BASE) -> " + out);
execFileSync(process.execPath, [VITE, "build", "--outDir", out], {
  cwd: join(ROOT, "web"),
  env: { ...process.env, VITE_API_BASE: "" }, // КЛЮЧЕВОЕ: пустая строка как override, не удаление
  stdio: "inherit",
});

// Гейт: в стендовом бандле не должно быть прод-URL. Читаем ассеты как текст.
let bad = 0;
for (const f of readdirSync(join(out, "assets"))) {
  if (!f.endsWith(".js")) continue;
  const text = readFileSync(join(out, "assets", f), "utf8");
  let idx = text.indexOf("workers.dev");
  while (idx !== -1) {
    bad++;
    console.error("FAIL " + f + " содержит workers.dev: …" + text.slice(Math.max(0, idx - 40), idx + 60) + "…");
    idx = text.indexOf("workers.dev", idx + 1);
  }
}
if (bad > 0) {
  console.error("\nИтог: стендовый бандл содержит прод-URL (" + bad + " вхожд.) — он уйдёт мимо прокси. Сборка НЕ годится.");
  process.exit(1);
}
console.log("Итог: стендовый бандл чист (workers.dev в JS-ассетах нет), стенд может раздавать " + out);
