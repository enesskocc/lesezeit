import { DATA_OWNER, DATA_REPO, TEST_FILE_PATH } from '../config';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function headers(token: string, accept: string): HeadersInit {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Turkish, user-facing explanation for a failed GitHub response. */
function explain(res: Response): string {
  // Primary limit: remaining = 0. Secondary limit: 403/429 with retry-after.
  const rateLimited =
    res.status === 429 || res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after');
  if (res.status === 401) return 'Token geçersiz ya da süresi dolmuş.';
  if (rateLimited) return 'GitHub istek limiti doldu, biraz sonra tekrar dene.';
  if (res.status === 403) return `Token'ın bu işlem için izni yok (Contents: Read and write olmalı).`;
  if (res.status === 404) return `Dosya ya da repo bulunamadı. Token'da "${DATA_REPO}" reposu seçili mi?`;
  return `GitHub beklenmeyen bir cevap verdi (HTTP ${res.status}).`;
}

async function send(token: string, path: string, accept: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  try {
    // A weak mobile connection must not leave the app on "Yükleniyor…" forever.
    return await fetch(`${API}${path}`, { ...init, headers: headers(token, accept), cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new GitHubError(0, 'GitHub’a bağlanılamadı. İnternet bağlantını kontrol et.');
  }
}

async function request(token: string, path: string, accept: string): Promise<Response> {
  const res = await send(token, path, accept);
  if (!res.ok) throw new GitHubError(res.status, explain(res));
  return res;
}

const repoPath = `/repos/${DATA_OWNER}/${DATA_REPO}`;

/**
 * Confirms the token can read AND write lesezeit-data, and that the repo is private.
 *
 * `permissions.push` on GET /repos shows the *user's* role, not the fine-grained token's
 * rights, so it cannot detect a read-only token. Instead we send a file update with a
 * deliberately wrong sha: a token with Contents:write gets 409 (sha mismatch, nothing is
 * written — verified against the real API), a read-only token gets 403.
 */
export async function checkDataRepoAccess(token: string): Promise<void> {
  const res = await request(token, repoPath, 'application/vnd.github+json');
  const repo = (await res.json()) as { private?: boolean };
  if (repo.private !== true) {
    throw new GitHubError(0, `"${DATA_REPO}" public görünüyor. Bu repo private olmalı.`);
  }

  const probe = await send(token, `${repoPath}/contents/${TEST_FILE_PATH}`, 'application/vnd.github+json', {
    method: 'PUT',
    body: JSON.stringify({ message: 'write check', content: 'e30=', sha: '0'.repeat(40) }),
  });
  if (probe.status === 409 || probe.status === 422) return;
  if (probe.status === 403 && !probe.headers.has('retry-after')) {
    throw new GitHubError(403, 'Token sadece okuyabiliyor. "Contents: Read and write" izni ver.');
  }
  throw new GitHubError(probe.status, explain(probe));
}

const contentsPath = (filePath: string) => `${repoPath}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;

/** Base64 of the UTF-8 bytes (btoa alone fails on "ä", "ş" …). */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Blob SHA of a file in lesezeit-data, null when it does not exist yet (needed to replace it). */
async function fileSha(token: string, filePath: string): Promise<string | null> {
  const res = await send(token, contentsPath(filePath), 'application/vnd.github+json');
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(res.status, explain(res));
  return ((await res.json()) as { sha?: string }).sha ?? null;
}

/**
 * Writes a JSON file to lesezeit-data as one commit. If the file changed in between (409, e.g. the
 * daily workflow pushed), the SHA is read again once.
 */
export async function writeDataJson(token: string, filePath: string, data: unknown, message: string): Promise<void> {
  const content = base64Utf8(JSON.stringify(data));
  for (let attempt = 1; ; attempt++) {
    const sha = await fileSha(token, filePath);
    const body = JSON.stringify({ message, content, ...(sha ? { sha } : {}) });
    const res = await send(token, contentsPath(filePath), 'application/vnd.github+json', { method: 'PUT', body }, 60_000);
    if (res.ok) return;
    if (res.status === 409 && attempt < 2) continue;
    throw new GitHubError(res.status, explain(res));
  }
}

/** Reads a JSON file from lesezeit-data. The raw media type skips base64 decoding. */
export async function readDataJson(token: string, filePath: string): Promise<unknown> {
  const res = await request(token, contentsPath(filePath), 'application/vnd.github.raw+json');
  try {
    return await res.json();
  } catch {
    throw new GitHubError(0, `${filePath} geçerli bir JSON değil.`);
  }
}
