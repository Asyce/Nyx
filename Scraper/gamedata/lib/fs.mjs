// GameData filesystem helpers. The generic JSON/dir primitives live in
// ../../lib/common.mjs (single source of truth); this module only adds the
// database-relative path resolver used by the asset bag.
import path from 'node:path';
import { ensureDir, fileExists, readJson, toPosixPath, writeJson } from '../../lib/common.mjs';

export { ensureDir, fileExists, readJson, toPosixPath, writeJson };

export function fromDatabasePath(databaseDir, databaseRelativePath) {
  return path.join(databaseDir, ...databaseRelativePath.split('/'));
}
