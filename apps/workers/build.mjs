/**
 * Bundle a worker into a Lambda-ready zip using esbuild + archiver.
 * Usage: node apps/workers/build.mjs <workerName>
 * e.g.:  node apps/workers/build.mjs listingWorker
 */
import { build } from 'esbuild';
import { createWriteStream, mkdirSync } from 'node:fs';
import archiver from 'archiver';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

const WORKERS = {
  listingWorker: { entry: 'handler.ts', out: 'handler.js' },
  paymentWorker: { entry: 'outboxWorker.ts', out: 'outboxWorker.js' },
};

const worker = process.argv[2];
if (!WORKERS[worker]) {
  console.error(`Unknown worker "${worker}". Valid: ${Object.keys(WORKERS).join(', ')}`);
  process.exit(1);
}

const { entry, out } = WORKERS[worker];
const outDir = resolve(root, `apps/workers/dist/${worker}`);
const zipPath = resolve(root, `apps/workers/dist/${worker}.zip`);

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(root, `apps/workers/${worker}/${entry}`)],
  outfile: resolve(outDir, out),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // AWS SDK v3 is pre-installed in the Lambda nodejs20.x runtime
  external: ['@aws-sdk/*'],
});

await new Promise((resolve, reject) => {
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.on('error', reject);
  output.on('close', resolve);

  archive.pipe(output);
  archive.directory(outDir, false);
  archive.finalize();
});

console.log(`Built ${worker} -> ${zipPath}`);
