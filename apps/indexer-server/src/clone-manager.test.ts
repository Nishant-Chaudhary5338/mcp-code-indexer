import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubUrl } from './clone-manager.js';

// ---------------------------------------------------------------------------
// Accepted forms
// ---------------------------------------------------------------------------

test('parseGithubUrl accepts https://github.com/owner/repo', () => {
  const result = parseGithubUrl('https://github.com/facebook/react');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'facebook');
  assert.equal(result!.repo, 'react');
});

test('parseGithubUrl accepts https URL with .git suffix', () => {
  const result = parseGithubUrl('https://github.com/facebook/react.git');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'facebook');
  assert.equal(result!.repo, 'react');
});

test('parseGithubUrl accepts https URL with trailing slash', () => {
  const result = parseGithubUrl('https://github.com/facebook/react/');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'facebook');
  assert.equal(result!.repo, 'react');
});

test('parseGithubUrl accepts http:// (non-TLS) prefix', () => {
  const result = parseGithubUrl('http://github.com/microsoft/vscode');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'microsoft');
  assert.equal(result!.repo, 'vscode');
});

test('parseGithubUrl accepts bare github.com/owner/repo (no scheme)', () => {
  const result = parseGithubUrl('github.com/vercel/next.js');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'vercel');
  assert.equal(result!.repo, 'next.js');
});

test('parseGithubUrl accepts git@github.com:owner/repo.git SSH form', () => {
  const result = parseGithubUrl('git@github.com:torvalds/linux.git');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'torvalds');
  assert.equal(result!.repo, 'linux');
});

test('parseGithubUrl accepts bare owner/repo shorthand', () => {
  const result = parseGithubUrl('owner/repo');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'owner');
  assert.equal(result!.repo, 'repo');
});

test('parseGithubUrl accepts owner/repo with dots, hyphens, underscores', () => {
  const result = parseGithubUrl('my.org_name/some-repo_v2.0');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'my.org_name');
  assert.equal(result!.repo, 'some-repo_v2.0');
});

test('parseGithubUrl strips leading/trailing whitespace', () => {
  const result = parseGithubUrl('  https://github.com/owner/repo  ');
  assert.notEqual(result, null);
  assert.equal(result!.owner, 'owner');
});

// ---------------------------------------------------------------------------
// cloneUrl shape — always canonical https
// ---------------------------------------------------------------------------

test('cloneUrl is always https://github.com/<owner>/<repo>.git', () => {
  const cases = [
    'https://github.com/facebook/react',
    'git@github.com:facebook/react.git',
    'facebook/react',
    'github.com/facebook/react',
  ];
  for (const raw of cases) {
    const result = parseGithubUrl(raw);
    assert.notEqual(result, null, `expected parse to succeed for: ${raw}`);
    assert.equal(result!.cloneUrl, 'https://github.com/facebook/react.git', `bad cloneUrl for: ${raw}`);
  }
});

// ---------------------------------------------------------------------------
// id shape — filesystem-safe
// ---------------------------------------------------------------------------

test('id is lowercased and contains only [a-z0-9_]', () => {
  const cases = [
    'https://github.com/Facebook/React',
    'git@github.com:My.Org/Some-Repo.git',
    'owner/repo-name.v2',
  ];
  for (const raw of cases) {
    const result = parseGithubUrl(raw);
    assert.notEqual(result, null, `expected parse to succeed for: ${raw}`);
    assert.match(result!.id, /^[a-z0-9_]+$/, `id "${result!.id}" is not filesystem-safe for: ${raw}`);
  }
});

test('id starts with gh_ prefix', () => {
  const result = parseGithubUrl('facebook/react');
  assert.notEqual(result, null);
  assert.ok(result!.id.startsWith('gh_'), `id should start with "gh_", got: ${result!.id}`);
});

// ---------------------------------------------------------------------------
// Rejected: wrong hosts
// ---------------------------------------------------------------------------

test('parseGithubUrl rejects gitlab.com URLs', () => {
  assert.equal(parseGithubUrl('https://gitlab.com/owner/repo'), null);
});

test('parseGithubUrl rejects arbitrary host URLs', () => {
  assert.equal(parseGithubUrl('https://evil.com/owner/repo'), null);
});

test('parseGithubUrl rejects bitbucket.org URLs', () => {
  assert.equal(parseGithubUrl('https://bitbucket.org/owner/repo'), null);
});

// ---------------------------------------------------------------------------
// Rejected: gists and extra path segments
// ---------------------------------------------------------------------------

test('parseGithubUrl rejects GitHub gists', () => {
  assert.equal(parseGithubUrl('https://gist.github.com/owner/abc123'), null);
});

test('parseGithubUrl rejects URLs with extra path segments', () => {
  assert.equal(parseGithubUrl('https://github.com/owner/repo/tree/main'), null);
  assert.equal(parseGithubUrl('https://github.com/owner/repo/issues'), null);
});

// ---------------------------------------------------------------------------
// Rejected: empty and whitespace
// ---------------------------------------------------------------------------

test('parseGithubUrl rejects empty string', () => {
  assert.equal(parseGithubUrl(''), null);
});

test('parseGithubUrl rejects whitespace-only string', () => {
  assert.equal(parseGithubUrl('   '), null);
});

// ---------------------------------------------------------------------------
// Rejected: dangerous schemes
// ---------------------------------------------------------------------------

test('parseGithubUrl rejects javascript: scheme', () => {
  assert.equal(parseGithubUrl('javascript:alert(1)'), null);
});

test('parseGithubUrl rejects file:// scheme', () => {
  assert.equal(parseGithubUrl('file:///etc/passwd'), null);
});

test('parseGithubUrl rejects data: scheme', () => {
  assert.equal(parseGithubUrl('data:text/html,<h1>xss</h1>'), null);
});

// ---------------------------------------------------------------------------
// Rejected: @userinfo off-github
// ---------------------------------------------------------------------------

test('parseGithubUrl rejects URLs with @userinfo pointing off github', () => {
  // e.g. https://user@evil.com/owner/repo — the host is evil.com, not github.com
  assert.equal(parseGithubUrl('https://attacker@evil.com/owner/repo'), null);
});

// ---------------------------------------------------------------------------
// Rejected: path traversal in owner/repo segments
// ---------------------------------------------------------------------------

test('parseGithubUrl rejects path traversal in shorthand form', () => {
  assert.equal(parseGithubUrl('../../../etc/passwd'), null);
  assert.equal(parseGithubUrl('owner/../etc/passwd'), null);
});

test('parseGithubUrl rejects path traversal in https URL segments', () => {
  assert.equal(parseGithubUrl('https://github.com/../etc/passwd'), null);
  assert.equal(parseGithubUrl('https://github.com/owner/../etc/passwd'), null);
});

// ---------------------------------------------------------------------------
// Rejected: spaces in segments
// ---------------------------------------------------------------------------

test('parseGithubUrl rejects owner or repo containing spaces', () => {
  assert.equal(parseGithubUrl('https://github.com/my owner/repo'), null);
  assert.equal(parseGithubUrl('https://github.com/owner/my repo'), null);
  assert.equal(parseGithubUrl('my owner/repo'), null);
});

// ---------------------------------------------------------------------------
// Edge case: leading-hyphen owner is REJECTED.
// SEGMENT requires the first char to be alphanumeric (/^[A-Za-z0-9][...]*$/), so
// names like "-foo" — which GitHub itself disallows and which read like CLI
// options — never reach the git layer.
// ---------------------------------------------------------------------------

test('parseGithubUrl: leading-hyphen owner is rejected (shorthand form)', () => {
  assert.equal(parseGithubUrl('-foo/bar'), null);
});

test('parseGithubUrl: leading-hyphen owner is rejected (https form)', () => {
  assert.equal(parseGithubUrl('https://github.com/-malicious/repo'), null);
});

// ---------------------------------------------------------------------------
// Symlinks in an untrusted repo are checked out as plain files
// ---------------------------------------------------------------------------

test('cloneArgs checks a symlink out as a plain file, not a link', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, symlinkSync, lstatSync, readFileSync, rmSync } =
    await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { cloneArgs } = await import('./clone-manager.js');

  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'cg-clone-'));
  try {
    const secret = path.join(sandbox, 'secret.env');
    writeFileSync(secret, 'API_KEY=must-not-leak\n');
    const src = path.join(sandbox, 'src');
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', args, { cwd, stdio: 'ignore' });
    };
    execFileSync('git', ['init', '-q', src]);
    symlinkSync(secret, path.join(src, 'env.ts'));
    git(src, 'add', 'env.ts');
    git(src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'link');
    const url = `file://${src}`;

    // Control: a plain clone recreates the link, which is what makes it dangerous.
    const plain = path.join(sandbox, 'plain');
    git(sandbox, 'clone', '-q', url, plain);
    assert.equal(lstatSync(path.join(plain, 'env.ts')).isSymbolicLink(), true);

    const safe = path.join(sandbox, 'safe');
    execFileSync('git', cloneArgs(url, safe), { stdio: 'ignore' });
    const checkedOut = path.join(safe, 'env.ts');
    assert.equal(lstatSync(checkedOut).isSymbolicLink(), false);
    assert.equal(readFileSync(checkedOut, 'utf8'), secret);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
