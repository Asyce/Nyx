import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(root, 'Database', 'GenshinWiki', 'avatars');
const manifestPath = path.resolve(outDir, 'manifest.json');
const force = process.argv.includes('--force');
const API = 'https://genshin-impact.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=Category:Avatar&gcmnamespace=0&gcmlimit=500&prop=pageimages&piprop=thumbnail&pithumbsize=320&format=json&origin=*';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NyxAvatarScraper/1.0';

function displayName(title){
  return String(title || '').replace(/ \(Avatar\)$/i, '').replace(/^"(.*)"$/, '$1');
}

export function avatarEntryAfterFailure(entry, prior, destinationExists){
  return destinationExists && prior ? prior : { ...entry, failed:true };
}

async function main(){
  const { default:sharp } = await import('sharp');
  fs.mkdirSync(outDir, { recursive:true });
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { entries:[] };
  const previousById = new Map((previous.entries || []).map((entry) => [String(entry.id), entry]));
  const response = await fetch(API, { headers:{ 'User-Agent':UA }, signal:AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Avatar catalog request failed (${response.status})`);
  const data = await response.json();
  const entries = Object.values(data?.query?.pages || {}).map((page) => ({
    id:String(page.pageid),
    name:displayName(page.title),
    sortId:Number(page.pageid),
    sourceUrl:page.thumbnail?.source,
    art:`GenshinWiki/avatars/${page.pageid}.webp`,
  })).filter((entry) => entry.name && entry.sourceUrl).sort((a, b) => b.sortId - a.sortId);
  if (entries.length < 150) throw new Error(`Avatar catalog is unexpectedly small (${entries.length})`);

  let downloaded = 0;
  let cached = 0;
  let failed = 0;
  const queue = [...entries];
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift();
      const destination = path.resolve(root, 'Database', entry.art);
      const prior = previousById.get(entry.id);
      if (!force && fs.existsSync(destination) && prior?.sourceUrl === entry.sourceUrl) {
        cached += 1;
        continue;
      }
      try {
        const image = await fetch(entry.sourceUrl, { headers:{ 'User-Agent':UA, Accept:'image/*' }, signal:AbortSignal.timeout(20_000) });
        if (!image.ok || !/image/i.test(image.headers.get('content-type') || '')) throw new Error(`HTTP ${image.status}`);
        const buffer = Buffer.from(await image.arrayBuffer());
        fs.writeFileSync(destination, await sharp(buffer).resize({ width:320, height:320, fit:'inside', withoutEnlargement:true }).webp({ quality:88 }).toBuffer());
        downloaded += 1;
      } catch (error) {
        Object.assign(entry, avatarEntryAfterFailure(entry, prior, fs.existsSync(destination)));
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length:6 }, worker));
  const complete = entries.filter((entry) => !entry.failed);
  fs.writeFileSync(manifestPath, JSON.stringify({ source:'https://genshin-impact.fandom.com/wiki/Avatar', entries:complete }, null, 2) + '\n');
  console.log(`avatars: ${downloaded} downloaded, ${cached} cached, ${failed} failed, ${complete.length} published`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
