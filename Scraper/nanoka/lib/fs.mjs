import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function readJson(file, fallback = null) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
}

export async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function fromDatabasePath(databaseDir, databaseRelativePath) {
  return path.join(databaseDir, ...databaseRelativePath.split('/'));
}

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}
