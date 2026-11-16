import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { RULES_ID } from '../src/online/server-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'supabase/functions/_shared/generated-game-core.js');
const rulesFile = resolve(root, 'src/online/rules-id.ts');
await mkdir(dirname(outfile), { recursive: true });
const result = await build({ entryPoints: [resolve(root, 'src/online/server-core.ts')], outfile, bundle: true, write: false,
  platform: 'neutral', format: 'esm', target: 'es2022', legalComments: 'none', sourcemap: false, logLevel: 'warning' });
const generated = result.outputFiles[0]?.text;
if (!generated) throw new Error('esbuild produced no online game bundle');
if (process.argv.includes('--check')) {
  let current = '';
  let currentRules = '';
  try { current = await readFile(outfile, 'utf8'); } catch { /* missing artifact is stale */ }
  try { currentRules = await readFile(rulesFile, 'utf8'); } catch { /* missing artifact is stale */ }
  if (current !== generated || currentRules !== `export const CLIENT_RULES_ID = ${JSON.stringify(RULES_ID)} as const;\n`)
    throw new Error('Generated online game core/rules ID is stale. Run npm run build:online-core.');
  console.log('Generated online core is fresh.');
} else {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outfile, generated);
  await writeFile(rulesFile, `export const CLIENT_RULES_ID = ${JSON.stringify(RULES_ID)} as const;\n`);
  console.log(`Built ${outfile} (${Buffer.byteLength(generated)} bytes).`);
}
