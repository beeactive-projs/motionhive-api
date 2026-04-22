// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // The project rule in CLAUDE.md: "Never use `any` — always use
      // strict types; prefer `unknown` + narrowing, or define an
      // explicit interface/type." Enforced at error level so new `any`
      // usage breaks CI.
      '@typescript-eslint/no-explicit-any': 'error',
      // The unsafe-* family stays at warn. They're noisy because they
      // fire on every Sequelize/Stripe result that TS can't fully
      // infer, but warnings show up in the IDE so new violations are
      // visible without blocking legitimate SDK usage.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
