import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const crawl4AiHelper = join(__dirname, '..', 'crawl4ai-fetch.py');
const defaultUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pythonCandidates() {
  const preferred = process.env.PYTHON || process.env.PYTHON_BIN;
  return [preferred, 'python', 'python3', 'py'].filter(Boolean);
}

function crawl4AiRequested() {
  return process.env.NYX_USE_CRAWL4AI === '1' || process.env.CRAWL4AI_ENABLED === '1';
}

async function runCrawl4Ai(url, options = {}) {
  if (!existsSync(crawl4AiHelper)) throw new Error(`Missing Crawl4AI helper: ${crawl4AiHelper}`);

  const timeoutMs = Number(options.timeoutMs || 30_000);
  let lastError = null;

  for (const python of pythonCandidates()) {
    const args = [
      crawl4AiHelper,
      '--url',
      url,
      '--timeout',
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '--user-agent',
      options.userAgent || defaultUserAgent,
    ];
    if (options.waitFor) args.push('--wait-for', options.waitFor);
    if (options.jsCode) args.push('--js-code', options.jsCode);

    const result = await new Promise((resolve) => {
      const child = spawn(python, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs + 5_000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ ok: false, error });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0 || stdout.trim(), code, stdout, stderr });
      });
    });

    if (!result.ok && result.error) {
      lastError = result.error;
      continue;
    }

    try {
      const payload = JSON.parse(result.stdout || '{}');
      if (payload.html) return payload;
      lastError = new Error(payload.error || result.stderr || `Crawl4AI helper returned no HTML for ${url}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No Python runtime could execute the Crawl4AI helper');
}

async function plainFetchText(url, options = {}) {
  const tries = Number(options.retries || 3);
  const timeoutMs = Number(options.timeoutMs || 30_000);
  let lastError = null;

  for (let i = 1; i <= tries; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': options.userAgent || defaultUserAgent,
          Accept: options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(options.headers || {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (i < tries) await sleep(750 * i);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error(`Unable to fetch ${url}`);
}

export async function fetchTextWithFallback(url, options = {}) {
  if (crawl4AiRequested()) {
    try {
      const payload = await runCrawl4Ai(url, options);
      if (payload.html) return payload.html;
    } catch (error) {
      if (options.logFallback !== false) {
        console.warn(`[html-fetch] Crawl4AI failed for ${url}: ${error.message}`);
      }
    }
  }
  return plainFetchText(url, options);
}

export { defaultUserAgent };
