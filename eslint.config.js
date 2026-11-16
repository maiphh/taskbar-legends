import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'web-preview/**', 'node_modules/**', 'shots/**', 'supabase/functions/_shared/generated-game-core.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], rules: { '@typescript-eslint/consistent-type-imports': 'error', '@typescript-eslint/no-explicit-any': 'error' } },
);
