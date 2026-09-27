/**
 * Builds the static demo into dist/:
 *   index.html        landing page (member app and staff panel side by side)
 *   app/, panel/      the real front-ends, built with VITE_DEMO (hash routes, API under the root)
 *   sw.js             service worker running the API routes and services on PGlite
 *   pglite.*.gz       Postgres compiled to WebAssembly, gzipped (static hosts do not compress them)
 *   demo-data.tgz     the seeded database (scripts/build-data.ts)
 * Any static host works; the GitHub Pages workflow publishes it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const dataFile = path.join(root, '.data/demo-data.tgz');

function run(cmd, args, cwd, env = {}) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (!existsSync(dataFile) || process.argv.includes('--fresh-data')) {
  run('pnpm', ['exec', 'tsx', 'scripts/build-data.ts'], root);
}

// Landing page first: its build empties dist/.
run('pnpm', ['exec', 'vite', 'build', '--config', 'site/vite.config.ts'], root);
for (const [pkg, dir] of [
  ['web', 'app'],
  ['panel', 'panel'],
]) {
  run(
    'pnpm',
    ['exec', 'vite', 'build', '--base', './', '--outDir', path.join(dist, dir), '--emptyOutDir'],
    path.join(root, '..', pkg),
    { VITE_DEMO: '1' },
  );
}

// The API's few Node imports, answered with browser implementations.
const shims = {
  'node:crypto': 'src/shims/node-crypto.ts',
  'node:util': 'src/shims/node-util.ts',
  'node:path': 'src/shims/node-path.ts',
  'node:fs/promises': 'src/shims/node-fs-promises.ts',
};
const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [path.join(root, 'src/sw.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  write: false,
  outfile: path.join(dist, 'sw.js'),
  define: {
    __DEMO_VERSION__: '"__DEMO_VERSION__"',
    'import.meta.url': 'self.location.href',
    'process.env.NODE_ENV': '"production"',
  },
  // PGlite's Node-only code paths, never taken in a browser.
  external: [
    'fs',
    'fs/promises',
    'module',
    'path',
    'stream',
    'stream/promises',
    'url',
    'util',
    'zlib',
    'crypto',
  ],
  plugins: [
    {
      name: 'node-shims',
      setup(b) {
        b.onResolve({ filter: /^node:/ }, (args) => {
          if (args.path === 'node:events') return { path: require.resolve('events/') };
          const shim = shims[args.path];
          if (!shim) return { errors: [{ text: `no browser shim for ${args.path}` }] };
          return { path: path.join(root, shim) };
        });
      },
    },
  ],
  logLevel: 'warning',
});
const data = await readFile(dataFile);
const code = bundle.outputFiles[0].text;
// A new build (code or data) starts from fresh data: the schema may have changed.
const version = createHash('sha256').update(code).update(data).digest('hex').slice(0, 12);
await writeFile(path.join(dist, 'sw.js'), code.replaceAll('__DEMO_VERSION__', version));

const pglite = path.join(path.dirname(require.resolve('@electric-sql/pglite')));
for (const file of ['pglite.wasm', 'pglite.data']) {
  await writeFile(
    path.join(dist, `${file}.gz`),
    gzipSync(await readFile(path.join(pglite, file)), { level: 9 }),
  );
}
await copyFile(dataFile, path.join(dist, 'demo-data.tgz'));
await writeFile(path.join(dist, '.nojekyll'), '');
console.log(`demo built → ${path.relative(process.cwd(), dist)} (version ${version})`);
