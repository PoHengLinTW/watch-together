import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const watch = process.argv.includes('--watch');
const serverUrl = process.env.SERVER_URL ?? 'wss://watchtogether.example.com';
const e2eTest = process.env.E2E_TEST === '1';

const sharedAlias = {
  '@watchtogether/shared': join(__dirname, '../shared/protocol.ts'),
};

const baseConfig = {
  bundle: true,
  sourcemap: true,
  alias: sharedAlias,
  define: {
    __SERVER_URL__: JSON.stringify(serverUrl),
  },
};

function copyStatic() {
  mkdirSync('dist/popup', { recursive: true });
  mkdirSync('dist/background', { recursive: true });
  mkdirSync('dist/content', { recursive: true });

  // Copy popup static files
  copyFileSync('src/popup/popup.html', 'dist/popup/popup.html');
  copyFileSync('src/popup/popup.css', 'dist/popup/popup.css');

  // Build manifest (with optional E2E override)
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  if (e2eTest) {
    // Allow content script on localhost for E2E tests
    manifest.content_scripts[0].matches.push('http://localhost/*');
  }

  // Remove icon references if icon files don't exist (e.g. in dev/test builds)
  const iconsExist = existsSync('icons/icon16.png');
  if (!iconsExist) {
    delete manifest.icons;
    if (manifest.action) delete manifest.action.default_icon;
  } else {
    mkdirSync('dist/icons', { recursive: true });
    for (const size of ['16', '48', '128']) {
      copyFileSync(`icons/icon${size}.png`, `dist/icons/icon${size}.png`);
    }
  }

  writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
}

async function build() {
  copyStatic();

  const contexts = await Promise.all([
    esbuild.context({
      ...baseConfig,
      entryPoints: ['src/background/index.ts'],
      outfile: 'dist/background/index.js',
      format: 'esm',
      platform: 'browser',
    }),
    esbuild.context({
      ...baseConfig,
      entryPoints: ['src/content/index.ts'],
      outfile: 'dist/content/index.js',
      format: 'iife',
      platform: 'browser',
    }),
    esbuild.context({
      ...baseConfig,
      entryPoints: ['src/popup/popup.ts'],
      outfile: 'dist/popup/popup.js',
      format: 'iife',
      platform: 'browser',
    }),
  ]);

  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
