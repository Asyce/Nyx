import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const appSource = await readFile(path.resolve(root, 'src/app/nyx-app.jsx'), 'utf8');
const buildSource = await readFile(path.resolve(root, 'tools/build-site.mjs'), 'utf8');
const engineSource = await readFile(path.resolve(root, 'src/features/pengo/shimeji.js'), 'utf8');

test('the old Pengo shimeji ships through the Nyx eye control', async () => {
  assert.match(buildSource, /'features\/pengo\/shimeji\.js',\s*'app\/nyx-app\.jsx'/);

  const eye = appSource.slice(appSource.indexOf('function NyxNavEye'), appSource.indexOf('function achievementsSupported'));
  assert.match(eye, /<button type="button" id="nyx-shimeji-toggle" className="gp-nav-eye"/);
  assert.match(eye, /aria-label="Open Magnum Opus Pengonis"/);
  assert.match(eye, /aria-haspopup="dialog"/);
  assert.match(eye, /aria-controls="nyx-shimeji-menu"/);
  assert.match(eye, /aria-expanded="false"/);

  assert.match(engineSource, /id = 'nyx-shimeji-menu'/);
  assert.match(engineSource, /setAttribute\('role', 'dialog'\)/);
  assert.match(engineSource, /setAttribute\('aria-label', 'Magnum Opus Pengonis'\)/);
  assert.match(engineSource, /<h3>Magnum Opus Pengonis<\/h3>/);
  assert.match(engineSource, /<input type="range"[^>]+step="0\.01"[^>]+aria-label="Pengo size"/);
  assert.match(engineSource, /<input type="number"[^>]+data-shime-size-number[^>]+min="' \+ MIN_SCALE \+ '"[^>]+max="' \+ MAX_SCALE \+ '"[^>]+step="0\.01"[^>]+aria-label="Pengo size value"/);
  const numberInputHandler = engineSource.slice(
    engineSource.indexOf("popoverEls.sizeNumber.addEventListener('input'"),
    engineSource.indexOf('const commitSizeNumber'),
  );
  assert.match(numberInputHandler, /setScaleAll\(next\)/);
  assert.match(numberInputHandler, /popoverEls\.size\.value = String\(scale\)/);
  assert.doesNotMatch(numberInputHandler, /syncPopover/);
  assert.match(engineSource, /sizeNumber\.addEventListener\('change', commitSizeNumber\)/);
  assert.match(engineSource, /sizeNumber\.addEventListener\('blur', commitSizeNumber\)/);
  assert.match(engineSource, /popoverEls\.sizeNumber\.value = String\(scale\)/);
  assert.match(engineSource, /\.shime-pop :is\(button,input\[type="range"\],input\[type="number"\]\):focus-visible\{outline:2px solid #fff;outline-offset:2px\}/);
  assert.match(engineSource, /syncPopover\(\);\s*popoverEls\.on\.focus\(\{ preventScroll:true \}\)/);
  assert.match(engineSource, /popoverEls\.on\.setAttribute\('aria-pressed', String\(!!window\.shimejisEnabled\)\)/);
  assert.match(engineSource, /popoverEls\.off\.setAttribute\('aria-pressed', String\(!window\.shimejisEnabled\)\)/);
  assert.match(engineSource, /const spriteImages = new Array\(46\)/);
  assert.match(engineSource, /this\.el = new Image\(\)/);
  assert.match(engineSource, /this\.el\.alt = ''/);
  assert.match(engineSource, /this\.el\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(engineSource, /this\.el\.draggable = false/);
  assert.match(engineSource, /this\.el\.decoding = 'sync'/);
  assert.match(engineSource, /setFrame\(n\) \{ this\.el\.src = spriteImages\[n - 1\]\?\.src \|\| sprite\(n\); \}/);
  assert.doesNotMatch(engineSource, /style\.backgroundImage/);
  const mascotCss = engineSource.match(/'\.mascot\{([^']+)\}'/)?.[1] || '';
  assert.match(mascotCss, /display:block/);
  assert.doesNotMatch(mascotCss, /background-(?:repeat|position|size)/);
  assert.match(engineSource, /spriteImages\[i - 1\] = img;\s*img\.decoding = 'sync';\s*img\.onload = async \(\) => \{\s*try \{ await img\.decode\(\); \} catch \{\}\s*res\(\);\s*\};\s*img\.onerror = \(\) => res\(\)/);

  const preloadFillSource = engineSource.match(/for \(let i = mascots\.length; i < startCount; i\+\+\) spawnOne\(\);/)?.[0];
  assert.ok(preloadFillSource, 'preload fill loop not found');
  const fillAfterPreload = Function('mascots', 'startCount', 'spawnOne', preloadFillSource);
  const resultingCount = (current, saved) => {
    const mascots = Array.from({ length:current }, () => ({}));
    fillAfterPreload(mascots, saved, () => mascots.push({}));
    return mascots.length;
  };
  assert.equal(resultingCount(2, 2), 2, 'Spawn before preload must not double the saved count');
  assert.equal(resultingCount(1, 1), 1, 'Reset before preload must not create a second mascot');
  assert.equal(resultingCount(1, 3), 3, 'preload completion still fills a missing difference');

  const menu = appSource.slice(appSource.indexOf('function PengoMenu'), appSource.indexOf('function SettingsPane'));
  assert.doesNotMatch(menu, /pm-opus|Magnum Opus Pengonis/);
  assert.doesNotMatch(appSource, /\b(?:lapis|energy|spawn|sacrifice)\s*:/);

  const assets = path.resolve(root, 'assets/shimeji');
  const files = [
    ...Array.from({ length:46 }, (_, index) => path.resolve(assets, 'img/Shimeji', `shime${index + 1}.png`)),
    path.resolve(assets, 'LICENSE.txt'),
    path.resolve(assets, 'alchemy-circle.png'),
  ];
  await Promise.all(files.map(async (file) => {
    await access(file);
    assert.ok((await stat(file)).size > 0, `${path.basename(file)} is empty`);
  }));

  assert.match(engineSource, /SHIMEJI_BASE = '\/assets\/shimeji\/img\/Shimeji'/);
  assert.match(engineSource, /'nyx-shimeji-enabled'/);
  assert.match(engineSource, /'nyx-shimeji-scale'/);
  assert.match(engineSource, /'nyx-shimeji-count'/);
  assert.match(engineSource, /document\.querySelectorAll\('\.gp-kofi'\)/);
  assert.match(engineSource, /document\.querySelectorAll\('\.gp-nav-eye'\)/);
  assert.doesNotMatch(engineSource, /asyce-shimeji|cos-rail/);
  assert.doesNotMatch(engineSource, /['"`]\/shimeji\//);
});
