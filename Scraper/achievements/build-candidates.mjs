import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAchievementCandidateReport,
  normalizeEndfieldCandidate,
  normalizeEndfieldClientCandidate,
  normalizeWuwaCandidate,
  normalizeZzzCandidate,
  sha256CandidateParts,
} from './candidates.mjs';
import {
  parseWuwaReferencePage,
  reconcileWuwaReleasedReference,
} from './wuwa-reference.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'Database', 'Achievements', 'candidates');
const USER_AGENT = 'pengo-achievement-candidate-builder';
const WUWA_REPOSITORY = 'Arikatsu/WutheringWaves_Data';
const WUWA_BRANCH = '3.5';
const STARD_API_REPOSITORY = 'juliuskreutz/stardb-api';
const ZZZ_REFERENCE_REPOSITORY = 'Aitidi/zzz-achievement-tracker-android';
const ZZZ_REFERENCE_COMMIT = '992e17f6020d39e60da16c406511de7728236908';
const ENDFIELD_DATA_REPOSITORY = '555me/beyondGameData';
const ENDFIELD_DATA_BRANCH = 'main';
const ENDFIELD_PROFILE_REPOSITORY = 'EnkaNetwork/API-docs';
const ENDFIELD_PROFILE_BRANCH = 'master';

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return {
    url,
    text: await response.text(),
    retrievedAt: response.headers.get('date') || new Date().toISOString(),
  };
}

async function fetchJson(url) {
  const result = await fetchText(url);
  try {
    return { ...result, json: JSON.parse(result.text) };
  } catch (error) {
    throw new Error(`GET ${url} returned invalid JSON: ${error.message}`);
  }
}

async function githubJson(pathname) {
  return fetchJson(`https://api.github.com/${pathname}`);
}

async function githubHead(repository, branch) {
  const result = await githubJson(`repos/${repository}/commits/${encodeURIComponent(branch)}`);
  const commit = result.json;
  if (!/^[a-f0-9]{40}$/.test(commit?.sha || '')) throw new Error(`${repository} branch ${branch} has no valid commit`);
  return { sha:commit.sha, timestamp:commit.commit?.committer?.date || result.retrievedAt };
}

async function mapInBatches(values, batchSize, mapper) {
  const results = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(...await Promise.all(values.slice(index, index + batchSize).map(mapper)));
  }
  return results;
}

function rawGithub(repository, commit, file) {
  return `https://raw.githubusercontent.com/${repository}/${commit}/${file}`;
}

function uniqueSourceParts(parts) {
  return [...new Map(parts.map((part) => [part.url, part])).values()];
}

function sourceFromParts({
  name,
  parts,
  revision,
  revisionType,
  codeRevision = null,
}) {
  return {
    name,
    urls: parts.map(({ url }) => url),
    revision,
    revisionType,
    codeRevision,
    retrievedAt: parts.map(({ retrievedAt }) => retrievedAt).sort().at(-1),
    snapshotSha256: sha256CandidateParts(parts.map(({ url, text }) => ({ label:url, bytes:text }))),
  };
}

async function buildZzz(generatedAt) {
  const api = await fetchJson('https://stardb.gg/api/zzz/achievements?lang=en');
  const chineseApi = await fetchJson('https://stardb.gg/api/zzz/achievements?lang=zh-cn');
  const apiCode = await githubJson(
    `repos/${STARD_API_REPOSITORY}/commits?path=${encodeURIComponent('src/api/zzz/achievements/mod.rs')}&per_page=1`,
  );
  const codeRevision = apiCode.json?.[0]?.sha;
  if (!/^[a-f0-9]{40}$/.test(codeRevision || '')) throw new Error('StarDB ZZZ API code revision is invalid');
  const referenceBase = `https://raw.githubusercontent.com/${ZZZ_REFERENCE_REPOSITORY}/${ZZZ_REFERENCE_COMMIT}/`;
  const referenceIndex = await fetchJson(`${referenceBase}data/index.json`);
  if (!Array.isArray(referenceIndex.json?.versions) || !referenceIndex.json.versions.length) {
    throw new Error('ZZZ readable reference index is invalid');
  }
  const referenceVersions = await Promise.all(referenceIndex.json.versions.map(({ file }) => (
    fetchJson(`${referenceBase}${file}`)
  )));
  const readableRows = referenceVersions.flatMap(({ json }) => {
    if (!Array.isArray(json?.items)) throw new Error('ZZZ readable reference version is invalid');
    return json.items;
  });
  const parts = [api, chineseApi, referenceIndex, ...referenceVersions];
  const snapshotSha256 = sha256CandidateParts(parts.map(({ url, text }) => ({ label:url, bytes:text })));
  return normalizeZzzCandidate(api.json, {
    generatedAt,
    chineseRows: chineseApi.json,
    readableRows,
    release: {
      version: '3.0',
      officialUrl: 'https://www.hoyolab.com/article/45488578',
      verifiedAt: generatedAt,
    },
    source: sourceFromParts({
      name: 'StarDB bilingual ZZZ API snapshot plus pinned readable version reference',
      parts,
      revision: snapshotSha256,
      revisionType: 'snapshot-sha256',
      codeRevision,
    }),
  });
}

async function buildWuwa(generatedAt) {
  const head = await githubHead(WUWA_REPOSITORY, WUWA_BRANCH);
  const paths = {
    achievements: 'BinData/achievement/achievement.json',
    categories: 'BinData/achievement/achievementcategory.json',
    groups: 'BinData/achievement/achievementgroup.json',
    starLevels: 'BinData/achievement/achievementstarlevel.json',
    englishTextRows: 'Textmaps/en/multi_text/MultiText.json',
    dropPackages: 'BinData/drop/droppackage.json',
  };
  const entries = await Promise.all(Object.entries(paths).map(async ([key, file]) => [
    key,
    await fetchJson(rawGithub(WUWA_REPOSITORY, head.sha, file)),
  ]));
  const localizedLegacy = await fetchJson(
    'https://api.dotgg.gg/cgfw/getgacha?game=wuthering-waves&type=achievements',
  );
  const releasedReferencePage = await fetchText(
    'https://wuwa.wiki/en/codex/trophies/1/1014',
  );
  const referenceOverview = parseWuwaReferencePage(releasedReferencePage.text);
  if (!referenceOverview.overview || !referenceOverview.resourceVersion) {
    throw new Error('WuWa released trophy reference metadata is missing');
  }
  const referenceGroups = referenceOverview.overview.list.flatMap((category) => (
    category.child.map((group) => ({ categoryId:category.id, groupId:group.id }))
  ));
  const releasedReferenceGroupPages = await mapInBatches(referenceGroups, 5, async ({ categoryId, groupId }) => {
    const page = await fetchText(
      `https://wuwa.wiki/en/codex/trophies/${categoryId}/${groupId}`,
    );
    const parsed = parseWuwaReferencePage(page.text);
    if (!parsed.group || parsed.group.id !== groupId) {
      throw new Error(`WuWa released trophy reference group ${groupId} is missing`);
    }
    return { page, group:parsed.group };
  });
  const fetched = Object.fromEntries(entries);
  const normalizedInput = {
    achievements: fetched.achievements.json,
    categories: fetched.categories.json,
    groups: fetched.groups.json,
    starLevels: fetched.starLevels.json,
    englishTextRows: fetched.englishTextRows.json,
    dropPackages: fetched.dropPackages.json,
    localizedLegacy: localizedLegacy.json,
  };
  const preliminary = normalizeWuwaCandidate(normalizedInput, {
    generatedAt,
    standardOnly: true,
    excludeUnlocalizedPlaceholders: true,
    source: sourceFromParts({
      name: 'Arikatsu 3.5 raw achievement structures plus DotGG legacy English list',
      parts: [...Object.values(fetched), localizedLegacy],
      revision: head.sha,
      revisionType: 'github-commit',
    }),
  });
  const reconciliation = reconcileWuwaReleasedReference(
    preliminary.achievements,
    referenceOverview.overview,
    releasedReferenceGroupPages.map(({ group }) => group),
  );
  const parts = [
    ...Object.values(fetched),
    localizedLegacy,
    releasedReferencePage,
    ...releasedReferenceGroupPages.map(({ page }) => page),
  ];
  return normalizeWuwaCandidate(normalizedInput, {
    generatedAt,
    standardOnly: true,
    excludeUnlocalizedPlaceholders: true,
    releasedReference: {
      total: referenceOverview.overview.count.value,
      dataVersion: referenceOverview.resourceVersion,
      url: releasedReferencePage.url,
      retrievedAt: [releasedReferencePage, ...releasedReferenceGroupPages.map(({ page }) => page)]
        .map(({ retrievedAt }) => retrievedAt)
        .sort()
        .at(-1),
      reconciliation,
    },
    source: sourceFromParts({
      name: 'Arikatsu 3.5 raw achievement structures plus DotGG legacy English list and reviewed WuWa trophy pages',
      parts: uniqueSourceParts(parts),
      revision: head.sha,
      revisionType: 'github-commit',
    }),
  });
}

async function buildEndfield(generatedAt) {
  const [dataHead, profileHead] = await Promise.all([
    githubHead(ENDFIELD_DATA_REPOSITORY, ENDFIELD_DATA_BRANCH),
    githubHead(ENDFIELD_PROFILE_REPOSITORY, ENDFIELD_PROFILE_BRANCH),
  ]);
  const [achievements, types, timeRanges, profileMedals, profileTooltip] = await Promise.all([
    fetchJson(rawGithub(
      ENDFIELD_DATA_REPOSITORY,
      dataHead.sha,
      'tableCfg/AchievementTable.json',
    )),
    fetchJson(rawGithub(
      ENDFIELD_DATA_REPOSITORY,
      dataHead.sha,
      'tableCfg/AchievementTypeTable.json',
    )),
    fetchJson(rawGithub(
      ENDFIELD_DATA_REPOSITORY,
      dataHead.sha,
      'tableCfg/TimeRangeTable.json',
    )),
    fetchJson(rawGithub(
      ENDFIELD_PROFILE_REPOSITORY,
      profileHead.sha,
      'store/ef/medals.json',
    )),
    fetchJson(rawGithub(
      ENDFIELD_PROFILE_REPOSITORY,
      profileHead.sha,
      'tooltip-data/ef/EN/medals.json',
    )),
  ]);
  const parts = [achievements, types, timeRanges, profileMedals, profileTooltip];
  const snapshotSha256 = sha256CandidateParts(parts.map(({ url, text }) => ({ label:url, bytes:text })));
  return normalizeEndfieldClientCandidate({
    achievements: achievements.json,
    types: types.json,
    timeRanges: timeRanges.json,
    profileMedals: profileMedals.json,
    profileTooltip: profileTooltip.json,
  }, {
    generatedAt,
    source: sourceFromParts({
      name: 'Current extracted Endfield client achievement tables plus Enka profile medal mapping',
      parts,
      revision: snapshotSha256,
      revisionType: 'snapshot-sha256',
    }),
  });
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
}

const generatedAt = new Date().toISOString();
const candidates = await Promise.all([
  buildZzz(generatedAt),
  buildWuwa(generatedAt),
  buildEndfield(generatedAt),
]);
const report = createAchievementCandidateReport(candidates, { generatedAt });
for (const candidate of candidates) {
  await writeJsonAtomic(path.join(OUTPUT_ROOT, candidate.game, 'catalog.json'), candidate);
}
await writeJsonAtomic(path.join(OUTPUT_ROOT, 'report.json'), report);
for (const candidate of candidates.sort((left, right) => left.game.localeCompare(right.game, 'en'))) {
  console.log(`${candidate.game}: ${candidate.achievementCount} candidate achievements in ${candidate.categoryCount} categories (blocked)`);
}
