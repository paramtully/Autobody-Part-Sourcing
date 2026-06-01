/**
 * Bundle the API for Vercel serverless (monorepo workspace packages → single CJS file).
 * Usage: node apps/api/build.mjs
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'dist');
const outfile = resolve(outDir, 'server.cjs');

mkdirSync(outDir, { recursive: true });

await build({
    entryPoints: [resolve(__dirname, 'server.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
});

console.log(`Built API -> ${outfile}`);
