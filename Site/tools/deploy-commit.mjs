const FULL_COMMIT = /^[a-f0-9]{40,64}$/;

function requireCommit(value, label) {
  const commit = String(value ?? '').trim();
  if (!FULL_COMMIT.test(commit)) throw new Error(`${label} is not a full Git commit`);
  return commit;
}

export function selectDeployCommit({ explicitCommit, gitHead, githubSha } = {}) {
  const head = gitHead ? requireCommit(gitHead, 'Git HEAD') : null;
  const selected = requireCommit(explicitCommit || head || githubSha, 'Deploy commit');
  if (head && selected !== head) throw new Error(`Deploy commit ${selected} does not match Git HEAD ${head}`);
  return selected;
}

export function cacheStampForCommit(commit) {
  return requireCommit(commit, 'Deploy commit').slice(0, 12);
}

export function assertDeployCommitIdentity({ head, version, pages } = {}) {
  const commit = requireCommit(head, 'Git HEAD');
  if (version?.commit !== commit) throw new Error(`version.json commit ${version?.commit ?? '<missing>'} does not match Git HEAD ${commit}`);
  if (version?.shortCommit !== commit.slice(0, 8)) throw new Error('version.json shortCommit does not match Git HEAD');

  const expectedStamp = cacheStampForCommit(commit);
  const entries = Object.entries(pages ?? {});
  if (!entries.length) throw new Error('No deploy pages were provided for cache-stamp verification');
  for (const [page, html] of entries) {
    const stamps = [...String(html).matchAll(/\?v=([\w.-]+)/g)].map((match) => match[1]);
    if (!stamps.length) throw new Error(`${page} has no cache-busted assets`);
    if (stamps.some((stamp) => stamp !== expectedStamp)) throw new Error(`${page} cache stamp does not match Git HEAD ${expectedStamp}`);
  }
  return { commit, shortCommit: commit.slice(0, 8), cacheStamp: expectedStamp, pages: entries.length };
}
