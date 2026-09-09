import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/src/generated/**',
      'benchmarks/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
  {
    // Standalone CLI scripts: stdout is their interface, not a stray debug log.
    files: ['**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // The web package: JSX needs the browser DOM lib, and React's rules of
    // hooks are worth enforcing since a violation there fails silently at
    // runtime rather than at compile time.
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { React: 'readonly' },
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // console.error/warn are how a component surfaces a caught error
      // without a logging library the browser bundle would need to ship.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
);
