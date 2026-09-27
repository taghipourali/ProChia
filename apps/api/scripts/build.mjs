// Bundles the API (and the workspace packages it imports) into dist/, leaving npm dependencies external.
import { build } from 'esbuild';
import { cp, readFile, rm } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@prochia/'));

await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: {
    main: 'src/main.ts',
    seed: 'src/db/seed/index.ts',
    migrate: 'src/db/migrate-cli.ts',
  },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  sourcemap: true,
  external: [...external, 'pino-pretty'],
  // Some CommonJS dependencies call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
await cp('drizzle', 'dist/drizzle', { recursive: true });
