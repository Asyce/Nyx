#!/usr/bin/env node
import { runLibrarySync } from './core.mjs';

runLibrarySync().then((report) => {
  console.log(JSON.stringify(report, null, 2));
}).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
