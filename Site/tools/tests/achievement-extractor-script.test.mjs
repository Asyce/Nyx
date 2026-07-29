import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, '../..');
const root = path.resolve(siteDir, '..');
const script = path.resolve(siteDir, 'public/scripts/pengo-achievements.ps1');
const guide = path.resolve(root, 'docs/achievement-extractor-2026-07-14.md');
const powershell = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

async function run(args, options = {}) {
  return execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    cwd: options.cwd || siteDir,
    env: { ...process.env, ...options.env },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

async function runFailure(args, options = {}) {
  try {
    await run(args, options);
    assert.fail('extractor unexpectedly succeeded');
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    assert.notEqual(error.code, undefined);
    return { stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

async function makeTemp(t) {
  const dir = await fs.mkdtemp(path.join(process.env.TEMP || process.env.TMP || siteDir, 'pengo-achievements-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function pengoIds(json) {
  assert.equal(json.kind, 'pengo-achievements');
  assert.equal(json.version, 1);
  assert.match(json.catalogVersion, /^(?:gi-6\.7|hsr-4\.4)$/);
  assert.doesNotThrow(() => new Date(json.exportedAt).toISOString());
  assert.ok(Array.isArray(json.achievements));
  return json.achievements.map((row) => {
    assert.deepEqual(Object.keys(row), ['id', 'status']);
    assert.equal(row.status, 'complete');
    return String(row.id);
  });
}

function quotePs(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function drawImage(file, rows, { width = 1600, height = 360, fontSize = 36 } = {}) {
  const drawRows = rows.map(({ text, x = 50, y }) =>
    `$g.DrawString(${quotePs(text)},$f,[Drawing.Brushes]::Black,${Number(x)},${Number(y)})`).join(';');
  const command = [
    'Add-Type -AssemblyName System.Drawing',
    `$b=New-Object Drawing.Bitmap ${Number(width)},${Number(height)}`,
    '$g=[Drawing.Graphics]::FromImage($b)',
    '$g.Clear([Drawing.Color]::White)',
    `$f=New-Object Drawing.Font('Arial',${Number(fontSize)},[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)`,
    '$g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit',
    drawRows,
    `$b.Save(${quotePs(file)},[Drawing.Imaging.ImageFormat]::Png)`,
    '$f.Dispose()', '$g.Dispose()', '$b.Dispose()',
  ].join(';');
  await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
}

async function drawCompleted(file, game = 'gi') {
  const title = game === 'gi' ? 'Tales of Monstrous Madness' : 'Ever-Burning Amber';
  await drawImage(file, [
    { text: title, y: 40 },
    { text: 'Completed on 2024/01/02', y: 130 },
  ]);
}

async function loadImporter() {
  const featureDir = path.resolve(siteDir, 'src/features/achievements');
  const source = (await Promise.all(['achievement-core.js', 'achievement-storage.js', 'achievement-import.js']
    .map((name) => fs.readFile(path.join(featureDir, name), 'utf8')))).join('\n');
  const window = {};
  vm.runInContext(source, vm.createContext({ window, console, Date, Math, Set, JSON, encodeURIComponent }));
  return window.NyxAchievementImport;
}

test('PowerShell 5 parser accepts the helper', async () => {
  const command = `$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile(${quotePs(script)},[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|% Message;exit 1}`;
  await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
});

test('PowerShell AST permits only the reviewed command surface', async () => {
  const command = `$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quotePs(script)},[ref]$tokens,[ref]$errors);if($errors.Count){exit 1};$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.CommandAst]},$true)|ForEach-Object { $name=$_.GetCommandName();if($null -eq $name){'__DYNAMIC__'}else{$name} }|Sort-Object -Unique|ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
  const commands = JSON.parse(stdout.trim());
  const allowed = new Set([
    'Add-Type', 'Assert-LocalPath', 'Assert-NoReparseChain', 'Assert-PlainPath', 'Await-WinRt',
    'ConvertFrom-Json', 'ForEach-Object', 'Get-AxisGap', 'Get-ChildItem', 'Get-CompletionDate',
    'Get-Date', 'Get-GameCatalog', 'Get-ImageFiles', 'Get-Item', 'Get-Location', 'Get-OcrLines',
    'Join-Path', 'Match-OcrLines', 'Measure-Object', 'New-Object', 'Normalize-Name',
    'Read-EmbeddedCatalog', 'Remove-CompletionDate', 'Remove-Item', 'Resolve-OutputPath',
    'Select-Object', 'Set-StrictMode', 'Sort-Object', 'Split-Path', 'Test-Path',
    'Test-ReparsePoint', 'Test-SameCardGeometry', 'Test-WrappedTitleGeometry', 'Warn-CloudSyncedPath', 'Where-Object',
    'Write-AtomicJson', 'Write-Host',
  ]);
  assert.deepEqual(commands.filter((name) => !allowed.has(name)), []);
  assert.doesNotMatch(commands.join('\n'), /__DYNAMIC__/);
});

test('embedded lookup exactly matches every unique released catalog name', async () => {
  const source = await fs.readFile(script, 'utf8');
  const match = source.match(/\$CatalogGzipBase64 = @'\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n'@/);
  assert.ok(match, 'embedded catalog payload is missing');
  const embedded = JSON.parse(zlib.gunzipSync(Buffer.from(match[1].replace(/\s/g, ''), 'base64')));
  const hsr44Block = source.match(/\$Hsr44Lookup\s*=\s*@\{\r?\n([\s\S]*?)\r?\n\}/);
  assert.ok(hsr44Block, 'embedded HSR 4.4 lookup is missing');
  const hsr44 = Object.fromEntries([...hsr44Block[1].matchAll(/^\s*'((?:[^']|'')*)'\s*=\s*'(\d+)'\s*$/gm)]
    .map((entry) => [entry[1].replaceAll("''", "'"), entry[2]]));
  embedded.hsr = { ...embedded.hsr, ...hsr44 };
  for (const game of ['gi', 'hsr']) {
    const catalog = JSON.parse(await fs.readFile(path.resolve(root, `Database/Achievements/${game}/catalog.json`), 'utf8'));
    const groups = new Map();
    for (const row of catalog.achievements) {
      const key = row.name.normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
      groups.set(key, [...(groups.get(key) || []), String(row.id)]);
    }
    const expected = Object.fromEntries([...groups].filter(([, ids]) => ids.length === 1)
      .map(([name, ids]) => [name, ids[0]]));
    assert.deepEqual(embedded[game], expected);
  }
});

test('names shared by both games are explicitly excluded at runtime', async () => {
  const source = await fs.readFile(script, 'utf8');
  for (const name of ['dance! dance! dance!', 'electric dreams', 'non-stop', 'fight fire with fire', 'the long goodbye', 'swordseeker', 'moonless night']) {
    assert.match(source, new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*=\\s*\\$true`, 'i'));
  }
  assert.match(source, /CrossGameDuplicateNames\.ContainsKey/);
});

for (const [game, title, expected] of [
  ['gi', 'Tales of Monstrous Madness', ['80091']],
  ['hsr', 'Ever-Burning Amber', ['4010101']],
]) {
  test(`${game} real offline OCR produces BOM-less importer-compatible JSON`, { skip: process.platform !== 'win32' }, async (t) => {
    const dir = await makeTemp(t);
    const image = path.join(dir, `${game}.png`);
    const output = path.join(dir, `${game}.json`);
    await drawImage(image, [{ text: title, y: 40 }, { text: 'Completed on 2024/01/02', y: 130 }]);
    const { stdout } = await run(['-Game', game, '-InputPath', image, '-OutputPath', output]);
    const bytes = await fs.readFile(output);
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const json = JSON.parse(bytes.toString('utf8'));
    assert.equal(json.game, game);
    assert.deepEqual(pengoIds(json), expected);
    assert.deepEqual(Object.keys(json), ['kind', 'version', 'game', 'catalogVersion', 'exportedAt', 'achievements']);
    const parsed = (await loadImporter()).parse(json);
    assert.equal(parsed.game, game);
    assert.deepEqual([...parsed.ids], expected);
    assert.match(stdout, /found 1 certain/);
    assert.doesNotMatch(stdout, new RegExp(`${title}|${expected[0]}`, 'i'));
  });
}

for (const scenario of [
  { name: 'negative completion wording', rows: [{ text: 'Tales of Monstrous Madness', y: 40 }, { text: 'Not yet completed', y: 130 }] },
  { name: 'status without a calendar date', rows: [{ text: 'Tales of Monstrous Madness', y: 40 }, { text: 'Completed', y: 130 }] },
  { name: 'date in another column', width: 2400, rows: [{ text: 'Tales of Monstrous Madness', x: 50, y: 60 }, { text: 'Completed on 2024/01/02', x: 1700, y: 60 }] },
  { name: 'date in a nearby second column', width: 1300, rows: [{ text: 'Tales of Monstrous Madness', x: 50, y: 60 }, { text: 'Completed on 2024/01/02', x: 560, y: 60 }] },
  { name: 'date in an adjacent row', height: 560, rows: [{ text: 'Tales of Monstrous Madness', y: 40 }, { text: 'Completed on 2024/01/02', y: 420 }] },
  { name: 'invalid calendar date', rows: [{ text: 'Tales of Monstrous Madness', y: 40 }, { text: 'Completed on 2024/02/30', y: 130 }] },
  { name: 'future calendar date', rows: [{ text: 'Tales of Monstrous Madness', y: 40 }, { text: 'Completed on 2999/01/01', y: 130 }] },
  { name: 'date before Genshin release', rows: [{ text: 'Tales of Monstrous Madness', y: 40 }, { text: 'Completed on 2020/09/27', y: 130 }] },
  { name: 'achievement from the other game', rows: [{ text: 'Ever-Burning Amber', y: 40 }, { text: 'Completed on 2024/01/02', y: 130 }] },
]) {
  test(`real OCR rejects ${scenario.name}`, { skip: process.platform !== 'win32' }, async (t) => {
    const dir = await makeTemp(t);
    const image = path.join(dir, 'screen.png');
    const output = path.join(dir, 'out.json');
    await drawImage(image, scenario.rows, { width: scenario.width, height: scenario.height });
    await runFailure(['-Game', 'gi', '-InputPath', image, '-OutputPath', output]);
    await assert.rejects(fs.access(output));
  });
}

test('real OCR rejects an HSR date before release', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await makeTemp(t);
  const image = path.join(dir, 'screen.png');
  const output = path.join(dir, 'out.json');
  await drawImage(image, [{ text: 'Ever-Burning Amber', y: 40 }, { text: 'Completed on 2023/04/25', y: 130 }]);
  await runFailure(['-Game', 'hsr', '-InputPath', image, '-OutputPath', output]);
  await assert.rejects(fs.access(output));
});

test('one date belongs only to the nearest stacked achievement title', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await makeTemp(t);
  const image = path.join(dir, 'stacked.png');
  const output = path.join(dir, 'out.json');
  await drawImage(image, [
    { text: 'Tales of Monstrous Madness', y: 25 },
    { text: 'Overlooking View', y: 70 },
    { text: 'Completed on 2024/01/02', y: 110 },
  ]);
  await run(['-Game', 'gi', '-InputPath', image, '-OutputPath', output]);
  assert.deepEqual(pengoIds(JSON.parse(await fs.readFile(output, 'utf8'))), ['81000']);
});

test('10,001-pixel image is rejected before OCR', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await makeTemp(t);
  const image = path.join(dir, 'wide.png');
  const output = path.join(dir, 'out.json');
  await drawImage(image, [], { width: 10001, height: 40, fontSize: 10 });
  await runFailure(['-Game', 'gi', '-InputPath', image, '-OutputPath', output]);
  await assert.rejects(fs.access(output));
});

test('dry-run writes nothing and existing output requires Force', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await makeTemp(t);
  const image = path.join(dir, 'screen.png');
  const output = path.join(dir, 'out.json');
  await drawCompleted(image);
  await run(['-Game', 'gi', '-InputPath', image, '-OutputPath', output, '-DryRun']);
  await assert.rejects(fs.access(output));
  await fs.writeFile(output, 'keep');
  await runFailure(['-Game', 'gi', '-InputPath', image, '-OutputPath', output]);
  assert.equal(await fs.readFile(output, 'utf8'), 'keep');
  await run(['-Game', 'gi', '-InputPath', image, '-OutputPath', output, '-Force']);
  assert.deepEqual(pengoIds(JSON.parse(await fs.readFile(output, 'utf8'))), ['80091']);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['out.json', 'screen.png']);
});

test('path failures are local-only and never echo private path text', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await makeTemp(t);
  const secret = 'UID123456789-token-veryprivate';
  for (const input of [
    path.join(dir, `${secret}.png`),
    `\\\\server\\share\\${secret}.png`,
    `\\\\?\\C:\\Users\\${secret}\\screen.png`,
  ]) {
    const result = await runFailure(['-Game', 'gi', '-InputPath', input]);
    const consoleText = `${result.stdout}\n${result.stderr}`;
    assert.doesNotMatch(consoleText, new RegExp(secret, 'i'));
    assert.doesNotMatch(consoleText, /\\\\server|\\\\\?\\|\.png/i);
  }
});

test('UNC and device output paths fail without exposing them', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await makeTemp(t);
  const image = path.join(dir, 'screen.png');
  const secret = 'UID987654321-output-token';
  await drawCompleted(image);
  for (const output of [`\\\\server\\share\\${secret}.json`, `\\\\?\\C:\\Users\\${secret}\\out.json`]) {
    const result = await runFailure(['-Game', 'gi', '-InputPath', image, '-OutputPath', output]);
    const consoleText = `${result.stdout}\n${result.stderr}`;
    assert.doesNotMatch(consoleText, new RegExp(secret, 'i'));
    assert.doesNotMatch(consoleText, /\\\\server|\\\\\?\\|\.json/i);
  }
});

test('cloud-like local paths receive a generic privacy warning', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await makeTemp(t);
  const synced = path.join(dir, 'OneDrive');
  await fs.mkdir(synced);
  const image = path.join(synced, 'private-screen.png');
  const output = path.join(synced, 'private-output.json');
  await drawCompleted(image);
  const { stdout } = await run(['-Game', 'gi', '-InputPath', image, '-OutputPath', output]);
  assert.match(stdout, /Privacy warning: the selected location may be cloud-synced/);
  assert.doesNotMatch(stdout, /private-screen|private-output|pengo-achievements-/i);
});

test('helper contains no forbidden behavior or production text-fixture route', async () => {
  const source = await fs.readFile(script, 'utf8');
  const forbidden = [
    /Invoke-(?:WebRequest|RestMethod)/i, /Start-BitsTransfer/i, /WebClient/i, /HttpClient/i,
    /Get-Process/i, /Win32_Process/i, /OpenProcess/i, /ReadProcessMemory/i, /WriteProcessMemory/i,
    /CreateRemoteThread/i, /SetWindowsHookEx/i, /SendKeys/i, /mouse_event/i, /keybd_event/i,
    /authkey/i, /cookie/i, /clipboard/i, /Start-Process/i, /RunAs/i, /Verb\s+RunAs/i,
    /Packet/i, /pcap/i, /HoYoLAB/i, /ConvertTo-SecureString/i, /FixtureTextPath/i,
    /PENGO_ACHIEVEMENT_EXTRACTOR_TEST_MODE/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern);
  assert.match(source, /Windows\.Media\.Ocr\.OcrEngine/);
  assert.match(source, /Get-CompletionDate/);
  assert.match(source, /Test-SameCardGeometry/);
  assert.match(source, /OcrEngine[\s\S]*MaxImageDimension/);
  assert.match(source, /DriveType[\s\S]*Network/);
  assert.match(source, /Only plain local paths are accepted/);
  assert.match(source, /\[Console\]::Error\.WriteLine\('The extractor stopped safely\./);
  assert.doesNotMatch(source, /Write-(?:Host|Output)[^\r\n]*\.Text/i, 'raw OCR must never be printed');
});

test('guide pins the exact script hash before any ExecutionPolicy bypass', async () => {
  const scriptBytes = await fs.readFile(script);
  const source = await fs.readFile(guide, 'utf8');
  const actual = crypto.createHash('sha256').update(scriptBytes).digest('hex');
  const documented = source.match(/\$expected\s*=\s*'([a-f0-9]{64})'/i)?.[1]?.toLowerCase();
  assert.equal(documented, actual);
  const hashIndex = source.indexOf('Get-FileHash');
  const comparisonIndex = source.indexOf('$actual -ne $expected');
  const bypassIndex = source.indexOf('ExecutionPolicy Bypass');
  assert.ok(hashIndex >= 0 && comparisonIndex > hashIndex && bypassIndex > comparisonIndex);
});
