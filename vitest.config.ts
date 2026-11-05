import { defineConfig } from 'vitest/config';

// S5-02 (аудит 2026-10-18): заявленный гейт `npm test` подхватывал repro-черновики
// из tmp/ (EXPECTED-FAIL по дизайну аудитов) и краснел — красный гейт = гейта нет.
// Проектные тесты живут только в tests/; tmp/ и чужие артефакты исключены явно.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'tmp/**', 'tools/**', 'screenshots/**', '**/dist/**'],
  },
});
