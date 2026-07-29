// One source of truth for achievement support. A game can exist here without
// being exposed in navigation: routes require both a reviewed catalog and a
// working tracker.
window.NyxAchievementGames = (function () {
  'use strict';

  const games = Object.freeze({
    gi: Object.freeze({
      key: 'gi',
      aliases: Object.freeze(['gi', 'genshin', 'genshin-impact']),
      name: 'Genshin Impact',
      short: 'Genshin',
      defaultProfile: 'My Traveler',
      catalogUrl: '/data/achievements/gi/catalog.json',
      reward: Object.freeze({ name: 'Primogems' }),
      legacyImportField: 'gi_achievements',
      progressModel: 'boolean',
      features: Object.freeze({
        catalog: true,
        tracker: true,
        automaticImport: 'development',
        officialImport: false,
      }),
      methods: Object.freeze({
        automatic: Object.freeze({
          label: 'Automatic import',
          status: 'development',
          description: 'Launcher-assisted automatic export is still being tested.',
        }),
        official: null,
        file: Object.freeze({
          label: 'Import a Pengo JSON file',
          status: 'available',
          description: 'Use an export made by Pengo or a compatible legacy tool.',
        }),
        screenScan: Object.freeze({
          label: 'Screen scan',
          status: 'testing',
          description: 'The offline English screenshot reader is available for testing. It reads only images you choose and never contacts a server.',
          scriptUrl: '/scripts/pengo-achievements.ps1',
          sha256: 'd81e9f21c3b0ef7f8130b7583a671bfd00e4065a81a0144a867c23d4e576655d',
          command: 'powershell -ExecutionPolicy Bypass -File .\\pengo-achievements.ps1 -Game gi -InputPath .\\Screenshots',
        }),
      }),
    }),
    hsr: Object.freeze({
      key: 'hsr',
      aliases: Object.freeze(['hsr', 'star-rail', 'honkai-star-rail']),
      name: 'Honkai: Star Rail',
      short: 'Star Rail',
      defaultProfile: 'My Trailblazer',
      catalogUrl: '/data/achievements/hsr/catalog.json',
      reward: Object.freeze({ name: 'Stellar Jade' }),
      legacyImportField: 'hsr_achievements',
      progressModel: 'boolean',
      features: Object.freeze({
        catalog: true,
        tracker: true,
        automaticImport: 'development',
        officialImport: 'helper-testing',
      }),
      methods: Object.freeze({
        automatic: Object.freeze({
          label: 'Automatic import',
          status: 'development',
          description: 'Launcher-assisted import is being connected and tested.',
        }),
        official: Object.freeze({
          label: 'HoYoLAB export',
          status: 'helper-testing',
          description: 'Open the official cultivation page, then run the reviewed Pengo helper there. It exports completed IDs without putting your cookie or UID in the file.',
          pageUrl: 'https://act.hoyolab.com/sr/event/cultivation-tool/index.html',
          scriptUrl: '/scripts/pengo-hsr-hoyolab-achievements.js',
          sha256: 'b423e559ba88eca7c45bcfa80fde441c067691175cdbd4c94dde560090b91976',
        }),
        file: Object.freeze({
          label: 'Import a Pengo JSON file',
          status: 'available',
          description: 'Use a Pengo export, HoYoLAB helper export, or compatible legacy file.',
        }),
        screenScan: Object.freeze({
          label: 'Screen scan',
          status: 'testing',
          description: 'The offline English screenshot reader remains a testing fallback when HoYoLAB export is unavailable.',
          scriptUrl: '/scripts/pengo-achievements.ps1',
          sha256: 'd81e9f21c3b0ef7f8130b7583a671bfd00e4065a81a0144a867c23d4e576655d',
          command: 'powershell -ExecutionPolicy Bypass -File .\\pengo-achievements.ps1 -Game hsr -InputPath .\\Screenshots',
        }),
      }),
    }),
    zzz: Object.freeze({
      key: 'zzz',
      aliases: Object.freeze(['zzz', 'zenless', 'zenless-zone-zero']),
      name: 'Zenless Zone Zero',
      short: 'Zenless',
      defaultProfile: 'My Proxy',
      catalogUrl: '/data/achievements/zzz/catalog.json',
      reward: Object.freeze({ name: 'Polychrome' }),
      legacyImportField: null,
      progressModel: 'boolean',
      features: Object.freeze({
        catalog: false,
        tracker: false,
        automaticImport: 'research',
        officialImport: false,
      }),
      methods: Object.freeze({
        automatic: Object.freeze({
          label: 'Automatic import',
          status: 'research',
          description: 'No safe complete-account source has been proven yet.',
        }),
        official: null,
        file: Object.freeze({
          label: 'Pengo JSON import',
          status: 'contract-ready',
          description: 'The shared file format is ready; the reviewed catalog is not.',
        }),
        screenScan: Object.freeze({
          label: 'Screen scan',
          status: 'research',
          description: 'Local UI scanning is being investigated as a fallback.',
        }),
      }),
    }),
    wuwa: Object.freeze({
      key: 'wuwa',
      aliases: Object.freeze(['wuwa', 'ww', 'wuthering-waves']),
      name: 'Wuthering Waves',
      short: 'Wuthering Waves',
      defaultProfile: 'My Rover',
      catalogUrl: '/data/achievements/wuwa/catalog.json',
      reward: Object.freeze({ name: 'Astrite' }),
      legacyImportField: null,
      progressModel: 'boolean',
      features: Object.freeze({
        catalog: false,
        tracker: false,
        automaticImport: 'research',
        officialImport: false,
      }),
      methods: Object.freeze({
        automatic: Object.freeze({
          label: 'Automatic import',
          status: 'research',
          description: 'No safe complete-account endpoint has been proven.',
        }),
        official: null,
        file: Object.freeze({
          label: 'Pengo JSON import',
          status: 'contract-ready',
          description: 'The shared file format is ready; the reviewed catalog is not.',
        }),
        screenScan: Object.freeze({
          label: 'Automated screen scan',
          status: 'planned',
          description: 'A one-start local scan is the current practical fallback plan.',
        }),
      }),
    }),
    ae: Object.freeze({
      key: 'ae',
      aliases: Object.freeze(['ae', 'endfield', 'arknights-endfield']),
      name: 'Arknights: Endfield',
      short: 'Endfield',
      defaultProfile: 'My Endministrator',
      catalogUrl: '/data/achievements/ae/catalog.json',
      reward: Object.freeze({ name: 'Oroberyl' }),
      legacyImportField: null,
      progressModel: 'multi-state-draft',
      features: Object.freeze({
        catalog: false,
        tracker: false,
        automaticImport: 'research',
        officialImport: false,
      }),
      methods: Object.freeze({
        automatic: Object.freeze({
          label: 'Automatic import',
          status: 'research',
          description: 'No safe complete-account source has been proven.',
        }),
        official: null,
        file: Object.freeze({
          label: 'Pengo JSON import',
          status: 'blocked',
          description: 'Endfield progress has several states; its final import format is not published yet.',
        }),
        screenScan: Object.freeze({
          label: 'Screen scan',
          status: 'research',
          description: 'Local menu scanning is being investigated.',
        }),
      }),
    }),
  });

  function get(value) {
    const wanted = String(value == null ? '' : value).trim().toLowerCase();
    return Object.values(games).find((game) => game.aliases.includes(wanted)) || null;
  }

  function all() {
    return Object.values(games);
  }

  function supportsTracker(value) {
    const game = get(value);
    return Boolean(game && game.features.catalog && game.features.tracker);
  }

  return Object.freeze({ get, all, supportsTracker });
})();
