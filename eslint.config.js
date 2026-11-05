import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.wrangler/**',
  'web/dist_old_*/**',
  // Рабочий мусор сессий: tmp/ целиком в gitignore, линтеру там делать нечего.
  'tmp/**',
  // S5-01 (аудит 2026-10-18): чужие chrome-профили и скриншоты прогонов —
  // минифицированный JS давал 14807 ошибок, из-за них гейт eslint был непригоден.
  'tools/**',
  'screenshots/**',
];

const unusedSymbolGate = {
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      args: 'all',
      argsIgnorePattern: '^_',
      caughtErrors: 'all',
      caughtErrorsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    },
  ],
};

export default tseslint.config(
  { ignores },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...unusedSymbolGate,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'off',
      // Existing legacy source is gated by TypeScript while it is remediated separately.
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
