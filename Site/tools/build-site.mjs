import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(siteDir, 'src');
const generatedDataDir = path.resolve(srcDir, 'data', 'generated');
const distDir = path.resolve(siteDir, 'dist');
const vendorDir = path.resolve(distDir, 'vendor');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function compileJsxBundle(files, outFile, prelude = '') {
  const chunks = [
    '"use strict";',
    'import React from "react";',
    'import { createPortal } from "react-dom";',
    'import { createRoot } from "react-dom/client";',
    'const ReactDOM = { createRoot, createPortal };',
    'const CM_CFG = window.CM_CFG || {};',
    'const CM_RAR = window.CM_RAR || {};',
    'const CM_ELEM = window.CM_ELEM || {};',
    'const NYX_DB = window.NYX_DB || {};',
    prelude,
  ];

  for (const file of files) {
    const sourcePath = path.resolve(srcDir, file);
    const source = await fs.readFile(sourcePath, 'utf8');
    const result = await transform(source, {
      loader: 'jsx',
      target: 'es2019',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      legalComments: 'none',
    });
    chunks.push(`\n// ${file}\n${result.code}`);
  }

  await build({
    stdin: {
      contents: chunks.join('\n'),
      sourcefile: outFile.replace(/\.js$/, '.entry.jsx'),
      loader: 'jsx',
      resolveDir: siteDir,
    },
    outfile: path.resolve(distDir, outFile),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2019',
    jsx: 'transform',
    legalComments: 'none',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });
}

await ensureDir(distDir);
await fs.rm(vendorDir, { recursive: true, force: true });

await fs.writeFile(
  path.resolve(distDir, 'artwork-webp-manifest.js'),
  'window.NYX_WEBP_MANIFEST = Object.freeze({});\n'
);

await copyFile(path.resolve(generatedDataDir, 'cm-data.js'), path.resolve(distDir, 'cm-data.js'));
for (const entry of await fs.readdir(generatedDataDir)) {
  if (/^cm-data-[a-z]+(?:-beta)?\.js$/.test(entry)) {
    await copyFile(path.resolve(generatedDataDir, entry), path.resolve(distDir, entry));
  }
}
await copyFile(path.resolve(generatedDataDir, 'nyx-data.js'), path.resolve(distDir, 'nyx-data.js'));

await compileJsxBundle(
  [
    'utils/artwork-quality.js',
    'components/game-page-components.jsx',
    'features/materials/char-materials.jsx',
    'data/generated/pulls-weapons-gi.js',
    'data/generated/pulls-weapons-hsr.js',
    'data/generated/pulls-weapons-zzz.js',
    'data/generated/pulls-weapons-wuwa.js',
    'features/gacha/pulls-banners-gi.js',
    'features/gacha/pulls-engine.js',
    'features/gacha/pulls-storage.js',
    'features/gacha/pulls-sync.js',
    'features/gacha/gacha-tracker.jsx',
    'features/gacha/pulls-overview.jsx',
    'app/nyx-app.jsx',
  ],
  'game-page.bundle.js',
);

console.log(`Built ${path.relative(siteDir, distDir)}`);
