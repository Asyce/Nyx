import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  createAchievementCandidateReport,
  normalizeEndfieldCandidate,
  normalizeEndfieldClientCandidate,
  normalizeWuwaCandidate,
  normalizeZzzCandidate,
  reconcileZzzReference,
  sha256CandidateParts,
  validateAchievementCandidate,
} from '../candidates.mjs';

const generatedAt = '2026-07-26T20:00:00Z';

function source(game, revisionType = 'snapshot-sha256') {
  const snapshotSha256 = sha256CandidateParts([{ label:`${game}.json`, bytes:`{"game":"${game}"}` }]);
  return {
    name: `${game} fixture`,
    urls: [`https://example.test/${game}.json`],
    revision: revisionType === 'github-commit' ? 'a'.repeat(40) : snapshotSha256,
    revisionType,
    codeRevision: null,
    retrievedAt: generatedAt,
    snapshotSha256,
  };
}

test('ZZZ candidate preserves stable IDs, categories, rewards, and hidden state while remaining blocked', () => {
  const candidate = normalizeZzzCandidate([
    {
      id: 1001,
      series: 10,
      series_name: 'Living on Sixth Street',
      name: 'A New Start',
      description: 'Finish the first task.',
      currency: 5,
      hidden: false,
      version: '3.0',
      arcade: false,
      related: [],
    },
    {
      id: 2,
      series: 1,
      series_name: 'Arcade',
      name: 'High Score',
      description: 'Reach the target score.',
      currency: 10,
      hidden: true,
      version: '3.0',
      arcade: true,
      related: [3],
    },
  ], {
    generatedAt,
    source:source('zzz'),
    release: {
      version: '3.0',
      officialUrl: 'https://www.hoyolab.com/article/45488578',
      verifiedAt: generatedAt,
    },
  });
  assert.equal(candidate.publishable, false);
  assert.equal(candidate.achievementCount, 2);
  assert.deepEqual(candidate.achievements.map(({ id }) => id), ['2', '1001']);
  assert.equal(candidate.metrics.arcadeRows, 1);
  assert.equal(candidate.capabilities.rewards, true);
  assert.equal(candidate.capabilities.releasedVersionProven, true);
  assert.equal(candidate.release.version, '3.0');
  assert.equal(candidate.release.officialUrl, 'https://www.hoyolab.com/article/45488578');
  assert.ok(candidate.blockers.some((blocker) => blocker.includes('complete-account import source')));
});

test('ZZZ release evidence fails closed and never makes a candidate publishable', () => {
  const row = {
    id: 1,
    series: 1,
    series_name: 'Series',
    name: 'Title',
    description: 'Description',
    currency: 5,
    hidden: false,
    version: '3.1',
    arcade: false,
  };
  const release = {
    version: '3.0',
    officialUrl: 'https://www.hoyolab.com/article/45488578',
    verifiedAt: generatedAt,
  };
  assert.throws(
    () => normalizeZzzCandidate([row], { generatedAt, source:source('zzz'), release }),
    /newer than the proven release/,
  );
  assert.throws(
    () => normalizeZzzCandidate([{ ...row, version:'3.0' }], {
      generatedAt,
      source:source('zzz'),
      release: { ...release, officialUrl:'https://example.test/release' },
    }),
    /official release URL is invalid/,
  );
  const candidate = normalizeZzzCandidate([{ ...row, version:'3.0' }], {
    generatedAt,
    source:source('zzz'),
    release,
  });
  assert.equal(candidate.publishable, false);
  assert.equal(candidate.status, 'candidate');
});

test('ZZZ reference reconciliation reports exact, title-only, composite, and unmatched stable rows', () => {
  const reconciliation = reconcileZzzReference([
    { id:1, name:'精确', description:'相同描述。', arcade:false },
    { id:2, name:'标题匹配', description:'新版描述。', arcade:false },
    { id:3, name:'组合甲', description:'甲', arcade:false },
    { id:4, name:'组合乙', description:'乙', arcade:false },
    { id:5, name:'街机', description:'不参与', arcade:true },
  ], [
    { 成就名:'精确', 描述:'相同描述' },
    { 成就名:'标题匹配', 描述:'旧版描述' },
    { 成就名:'组合甲/组合乙', 描述:'合并描述' },
  ]);
  assert.equal(reconciliation.stableNonArcadeRows, 4);
  assert.equal(reconciliation.exactMatches, 1);
  assert.equal(reconciliation.titleOnlyMatches, 1);
  assert.equal(reconciliation.unmatchedReferenceRows, 1);
  assert.deepEqual(reconciliation.unmatchedStableIds, ['3', '4']);
});

test('WuWa candidate keeps stable raw IDs and fails honestly on unresolved English text', () => {
  const candidate = normalizeWuwaCandidate({
    achievements: [{
      Id: 300101,
      GroupId: 3001,
      Level: 1,
      Name: 'Achievement_300101_Name',
      Desc: 'Achievement_300101_Desc',
      IconPath: '',
      OverrideDropId: 0,
      Hidden: false,
      NextLink: -1,
    }],
    categories: [{
      Id: 3,
      Name: 'AchievementCategory_3_Name',
      SpritePath: '/category-small',
      TexturePath: '/category-large',
    }],
    groups: [{
      Id: 3001,
      Category: 3,
      Name: 'AchievementGroup_3001_Name',
      Icon: '/group-large',
      SmallIcon: '/group-small',
      DropId: 0,
      Enable: true,
    }],
    starLevels: [{ Level:1, DropId:100101 }],
    localizedLegacy: [{
      id: 'legacy-title',
      name: 'Legacy title',
      description: 'Legacy description',
    }],
  }, { generatedAt, source:source('wuwa', 'github-commit') });
  assert.equal(candidate.achievements[0].id, '300101');
  assert.equal(candidate.achievements[0].title, null);
  assert.equal(candidate.achievements[0].metadata.rewardDropId, 100101);
  assert.equal(candidate.metrics.unresolvedEnglishRows, 1);
  assert.equal(candidate.capabilities.englishText, false);
});

test('WuWa candidate resolves pinned English text and concrete reward items', () => {
  const candidate = normalizeWuwaCandidate({
    achievements: [{
      Id: 300101, GroupId: 3001, Level: 1,
      Name:'Achievement_300101_Name', Desc:'Achievement_300101_Desc',
      IconPath:'', OverrideDropId:0, Hidden:false, NextLink:-1,
    }],
    categories: [{ Id:3, Name:'AchievementCategory_3_Name', SpritePath:'', TexturePath:'category.png' }],
    groups: [{
      Id:3001, Category:3, Name:'AchievementGroup_3001_Name',
      Icon:'group.png', SmallIcon:'', DropId:0, Enable:true,
    }],
    starLevels: [{ Level:1, DropId:100101 }],
    englishTextRows: [
      { Id:'Achievement_300101_Name', Content:'When Aix Cries' },
      { Id:'Achievement_300101_Desc', Content:'Defeat the Mourning Aix for the first time.' },
      { Id:'AchievementCategory_3_Name', Content:'Battle Memories' },
      { Id:'AchievementGroup_3001_Name', Content:'Voices From Afar' },
    ],
    dropPackages: [{
      Id:100101,
      DropPreview:[{ Key:3, Value:5 }],
    }],
  }, { generatedAt, source:source('wuwa', 'github-commit') });
  assert.equal(candidate.capabilities.englishText, true);
  assert.equal(candidate.capabilities.rewards, true);
  assert.equal(candidate.categories[0].title, 'Battle Memories');
  assert.equal(candidate.achievements[0].title, 'When Aix Cries');
  assert.equal(candidate.achievements[0].reward, 5);
  assert.deepEqual(candidate.achievements[0].metadata.rewardItems, [{ itemId:3, amount:5 }]);
  assert.equal(candidate.achievements[0].metadata.groupTitle, 'Voices From Afar');
});

test('WuWa released candidate excludes auxiliary systems and blank placeholders without hiding reconciliation gaps', () => {
  const candidate = normalizeWuwaCandidate({
    achievements: [
      {
        Id:1, GroupId:1001, Level:1, Name:'Achievement_1_Name', Desc:'Achievement_1_Desc',
        IconPath:'', OverrideDropId:0, Hidden:false, NextLink:-1,
      },
      {
        Id:2, GroupId:1001, Level:1, Name:'Achievement_2_Name', Desc:'Achievement_2_Desc',
        IconPath:'', OverrideDropId:0, Hidden:true, NextLink:-1,
      },
      {
        Id:7001, GroupId:7001, Level:1, Name:'Achievement_7001_Name', Desc:'Achievement_7001_Desc',
        IconPath:'', OverrideDropId:0, Hidden:false, NextLink:-1,
      },
    ],
    categories: [
      { Id:1, Name:'Category_1', SpritePath:'', TexturePath:'category.png' },
      { Id:7, Name:'Category_7', SpritePath:'', TexturePath:'event.png' },
    ],
    groups: [
      { Id:1001, Category:1, Name:'Group_1001', Icon:'group.png', SmallIcon:'', DropId:0, Enable:true },
      { Id:7001, Category:7, Name:'Group_7001', Icon:'event.png', SmallIcon:'', DropId:0, Enable:true },
    ],
    starLevels: [{ Level:1, DropId:100101 }],
    englishTextRows: [
      { Id:'Category_1', Content:'Exploration' },
      { Id:'Group_1001', Content:'Exploration: Test' },
      { Id:'Achievement_1_Name', Content:'Released Trophy' },
      { Id:'Achievement_1_Desc', Content:'Complete it.' },
      { Id:'Category_7', Content:'Friends' },
      { Id:'Group_7001', Content:'Event Group' },
      { Id:'Achievement_7001_Name', Content:'Event Achievement' },
      { Id:'Achievement_7001_Desc', Content:'Complete the event.' },
    ],
    dropPackages: [{ Id:100101, DropPreview:[{ Key:3, Value:5 }] }],
  }, {
    generatedAt,
    source:source('wuwa', 'github-commit'),
    standardOnly:true,
    excludeUnlocalizedPlaceholders:true,
    releasedReference: {
      total:2,
      dataVersion:'3.5.10',
      url:'https://wuwa.wiki/en/codex/trophies/1/1001',
      retrievedAt:generatedAt,
    },
  });
  assert.deepEqual(candidate.achievements.map(({ id }) => id), ['1']);
  assert.equal(candidate.metrics.auxiliaryRowsExcluded, 1);
  assert.equal(candidate.metrics.unlocalizedPlaceholderRowsExcluded, 1);
  assert.ok(candidate.blockers.some((blocker) => blocker.includes('1-row difference')));
});

test('Endfield candidate models levels, conditions, plating, and rare effects without flattening them', () => {
  const candidate = normalizeEndfieldCandidate([{
    id: 'achv_test',
    name: 'Test Medal',
    description: '',
    category: { id:'achv_type_test', name:'Test', priority:1, hidden:false },
    group: { id:'achv_group_test', name:'Tests' },
    canBePlated: '1',
    canBeUpgraded: '1',
    applyRareEffect: '1',
    initialLevel: '1',
    maxLevel: '2',
    order: '1',
    levels: [
      {
        level: 1,
        description: 'First state.',
        conditions: [{ id:'condition_1', description:'Do it once.', target:1 }],
      },
      {
        level: 2,
        description: 'Second state.',
        conditions: [{ id:'condition_2', description:'Do it twice.', target:2 }],
      },
    ],
  }], { generatedAt, source:source('ae') });
  assert.equal(candidate.achievements[0].progressModel, 'multi-state');
  assert.equal(candidate.achievements[0].states.length, 2);
  assert.equal(candidate.achievements[0].metadata.canBePlated, true);
  assert.equal(candidate.metrics.rareEffectRows, 1);
});

test('Endfield current client candidate maps stable IDs to profile IDs and medal icons', () => {
  const candidate = normalizeEndfieldClientCandidate({
    achievements: {
      achv_test: {
        achieveId:'achv_test',
        name:{ en:'Test Medal' },
        desc:{ en:'' },
        groupId:'achv_group_test',
        initLevel:'1',
        levelInfos: {
          1: {
            achieveLevel:'1',
            completeDesc:{ en:'First state.' },
            conditions:[{
              conditionId:'condition_1',
              desc:{ en:'Do it once.' },
              progressToCompare:'1',
            }],
          },
          2: {
            achieveLevel:'2',
            completeDesc:{ en:'Second state.' },
            conditions:[{
              conditionId:'condition_2',
              desc:{ en:'Do it twice.' },
              progressToCompare:'2',
            }],
          },
        },
        canBePlated:true,
        canBeUpgraded:true,
        applyRareEffect:true,
        specialProgress:false,
        displayTimeId:'time_test',
        order:'1',
      },
    },
    types: {
      achv_type_test: {
        categoryId:'achv_type_test',
        categoryName:{ en:'Tests' },
        categoryPriority:'1',
        achievementGroupData:[{
          groupId:'achv_group_test',
          groupName:{ en:'Test Group' },
        }],
      },
    },
    timeRanges: {
      time_test: {
        timeRangeList: [
          { openTime:'2026/8/1 12:00:00', closeTime:'' },
          { openTime:'2026/8/1 12:00:00', closeTime:'' },
          { openTime:'2026/8/1 12:00:00', closeTime:'' },
        ],
      },
    },
    profileMedals: {
      42: {
        IconByLevel: {
          1:'/ui/ef/medalicon/achv_test_lv01.png',
          2:'/ui/ef/medalicon/achv_test_lv02.png',
        },
      },
    },
    profileTooltip: {
      42: {
        Name:'Test Medal',
        LevelInfos: {
          1:{ ConditionDesc:'Do it once.' },
          2:{ ConditionDesc:'Do it twice.' },
        },
      },
    },
  }, { generatedAt, source:source('ae') });
  assert.equal(candidate.achievementCount, 1);
  assert.equal(candidate.capabilities.icons, true);
  assert.equal(candidate.capabilities.rewards, true);
  assert.equal(candidate.achievements[0].iconPath, '/ui/ef/medalicon/achv_test_lv02.png');
  assert.equal(candidate.achievements[0].metadata.profileMedalId, '42');
  assert.equal(candidate.achievements[0].metadata.rewardModel, 'none');
  assert.equal(candidate.achievements[0].metadata.availability, 'future');
  assert.equal(candidate.metrics.futureTimeGatedRows, 1);
  assert.equal(candidate.metrics.unresolvedTimeGatedRows, 0);
  assert.equal(candidate.metrics.timeGatedRows, 1);
});

test('candidate validation fails closed on publishability, duplicates, and unknown categories', () => {
  const candidate = normalizeZzzCandidate([{
    id: 1,
    series: 1,
    series_name: 'Series',
    name: 'Title',
    description: 'Description',
    currency: 5,
    hidden: false,
    version: '3.0',
    arcade: false,
  }], { generatedAt, source:source('zzz') });
  assert.throws(() => validateAchievementCandidate({ ...candidate, publishable:true }), /unpublished/);
  assert.throws(
    () => validateAchievementCandidate({
      ...candidate,
      achievements: [candidate.achievements[0], candidate.achievements[0]],
      achievementCount: 2,
    }),
    /duplicate/,
  );
  assert.throws(
    () => validateAchievementCandidate({
      ...candidate,
      achievements: [{ ...candidate.achievements[0], categoryId:'missing' }],
    }),
    /unknown category/,
  );
});

test('candidate report requires all three games and never promotes a candidate', () => {
  const zzz = normalizeZzzCandidate([{
    id: 1,
    series: 1,
    series_name: 'Series',
    name: 'Title',
    description: 'Description',
    currency: 5,
    hidden: false,
    version: '3.0',
    arcade: false,
  }], { generatedAt, source:source('zzz') });
  const wuwa = normalizeWuwaCandidate({
    achievements: [{
      Id: 1, GroupId: 1, Level: 1, Name:'TitleKey', Desc:'DescKey', IconPath:'',
      OverrideDropId: 0, Hidden: false, NextLink: -1,
    }],
    categories: [{ Id:1, Name:'CategoryKey', SpritePath:'', TexturePath:'' }],
    groups: [{ Id:1, Category:1, Name:'GroupKey', Icon:'', SmallIcon:'', DropId:0, Enable:true }],
    starLevels: [{ Level:1, DropId:100 }],
  }, { generatedAt, source:source('wuwa', 'github-commit') });
  const ae = normalizeEndfieldCandidate([{
    id: 'medal',
    name: 'Medal',
    category: { id:'category', name:'Category', priority:1, hidden:false },
    group: { id:'group', name:'Group' },
    canBePlated: '0',
    canBeUpgraded: '0',
    applyRareEffect: '0',
    initialLevel: '1',
    maxLevel: '1',
    order: '1',
    levels: [{
      level:1,
      description:'Complete it.',
      conditions:[{ id:'condition', description:'Do it.', target:1 }],
    }],
  }], { generatedAt, source:source('ae') });
  const report = createAchievementCandidateReport([zzz, wuwa, ae], { generatedAt });
  assert.equal(report.publishable, false);
  assert.deepEqual(report.games.map(({ game }) => game), ['ae', 'wuwa', 'zzz']);
  assert.ok(report.games.every(({ status, publishable }) => status === 'blocked' && publishable === false));
  assert.throws(() => createAchievementCandidateReport([zzz, wuwa], { generatedAt }), /all unreleased games/);
});

test('checked-in candidate artifacts validate and remain outside the released manifest', async () => {
  const root = new URL('../../../Database/Achievements/', import.meta.url);
  const candidates = await Promise.all(['zzz', 'wuwa', 'ae'].map(async (game) => {
    const parsed = JSON.parse(await fs.readFile(new URL(`candidates/${game}/catalog.json`, root), 'utf8'));
    return validateAchievementCandidate(parsed);
  }));
  const byGame = new Map(candidates.map((candidate) => [candidate.game, candidate]));
  assert.deepEqual([...byGame.keys()].sort(), ['ae', 'wuwa', 'zzz']);
  assert.equal(byGame.get('zzz').achievementCount, 894);
  assert.equal(byGame.get('zzz').categoryCount, 24);
  assert.equal(byGame.get('zzz').release.version, '3.0');
  assert.equal(byGame.get('zzz').capabilities.releasedVersionProven, true);
  assert.equal(byGame.get('wuwa').achievementCount, 1172);
  assert.equal(byGame.get('wuwa').categoryCount, 4);
  assert.equal(byGame.get('wuwa').capabilities.englishText, true);
  assert.equal(byGame.get('wuwa').capabilities.rewards, true);
  assert.equal(byGame.get('wuwa').metrics.releasedReference.total, 1163);
  assert.equal(byGame.get('ae').achievementCount, 140);
  assert.equal(byGame.get('ae').categoryCount, 8);
  assert.equal(byGame.get('ae').capabilities.englishText, true);
  assert.equal(byGame.get('ae').capabilities.stableIds, true);
  assert.equal(byGame.get('ae').capabilities.multiState, true);
  assert.equal(byGame.get('ae').capabilities.rewards, true);
  assert.equal(byGame.get('ae').metrics.profileMappedRows, 140);
  assert.equal(byGame.get('ae').metrics.levelRows, 182);
  assert.ok(candidates.every(({ publishable, blockers }) => publishable === false && blockers.length > 0));

  const report = JSON.parse(await fs.readFile(new URL('candidates/report.json', root), 'utf8'));
  assert.equal(report.publishable, false);
  assert.deepEqual(report.games.map(({ game }) => game), ['ae', 'wuwa', 'zzz']);
  for (const row of report.games) {
    const candidate = byGame.get(row.game);
    assert.equal(row.achievementCount, candidate.achievementCount);
    assert.equal(row.categoryCount, candidate.categoryCount);
    assert.equal(row.sourceSnapshotSha256, candidate.source.snapshotSha256);
  }

  const releasedManifest = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
  assert.deepEqual(releasedManifest.games.map(({ game }) => game), ['gi', 'hsr']);
});
