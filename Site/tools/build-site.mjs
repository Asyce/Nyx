import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(siteDir, 'src');
const generatedDataDir = path.resolve(srcDir, 'data', 'generated');
const distDir = path.resolve(siteDir, 'dist');
const vendorDir = path.resolve(distDir, 'vendor');
const require = createRequire(import.meta.url);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

function packageDir(name) {
  return path.dirname(require.resolve(`${name}/package.json`, { paths: [siteDir] }));
}

async function compileJsxBundle(files, outFile, prelude = '') {
  const chunks = [
    '(() => {',
    '"use strict";',
    'const React = window.React;',
    'const ReactDOM = window.ReactDOM;',
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

  chunks.push('})();\n');
  await fs.writeFile(path.resolve(distDir, outFile), chunks.join('\n'), 'utf8');
}

await ensureDir(distDir);

const reactDir = packageDir('react');
const reactDomDir = packageDir('react-dom');
await copyFile(
  path.resolve(reactDir, 'umd', 'react.production.min.js'),
  path.resolve(vendorDir, 'react.production.min.js'),
);
await copyFile(
  path.resolve(reactDomDir, 'umd', 'react-dom.production.min.js'),
  path.resolve(vendorDir, 'react-dom.production.min.js'),
);

await copyFile(path.resolve(generatedDataDir, 'cm-data.js'), path.resolve(distDir, 'cm-data.js'));
for (const entry of await fs.readdir(generatedDataDir)) {
  if (/^cm-data-[a-z]+\.js$/.test(entry)) {
    await copyFile(path.resolve(generatedDataDir, entry), path.resolve(distDir, entry));
  }
}
await copyFile(path.resolve(generatedDataDir, 'nyx-data.js'), path.resolve(distDir, 'nyx-data.js'));

await compileJsxBundle(
  [
    'components/game-page-components.jsx',
    'features/materials/char-materials.jsx',
    'data/generated/pulls-weapons-gi.js',
    'data/generated/pulls-weapons-hsr.js',
    'data/generated/pulls-weapons-zzz.js',
    'data/generated/pulls-weapons-wuwa.js',
    'features/gacha/pulls-banners-gi.js',
    'features/gacha/pulls-engine.js',
    'features/gacha/pulls-storage.js',
    'features/gacha/gacha-tracker.jsx',
    'features/gacha/pulls-overview.jsx',
    'app/nyx-app.jsx',
  ],
  'game-page.bundle.js',
);

console.log(`Built ${path.relative(siteDir, distDir)}`);