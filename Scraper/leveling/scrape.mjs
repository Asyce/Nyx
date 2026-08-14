#!/usr/bin/env node
import { runLevelingSync } from './core.mjs';

runLevelingSync().then((report) => {
  console.log(JSON.stringify(report, null, 2));
}).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
