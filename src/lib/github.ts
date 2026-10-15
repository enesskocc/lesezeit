import { DATA_OWNER, DATA_REPO } from '../config';

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
function explain(status: number, rateLimited: boolean): string {
  if (status === 401) return 'Token geçersiz ya da süresi dolmuş.';
  if (status === 403 && rateLimited) return 'GitHub istek limiti doldu, biraz sonra tekrar dene.';
  if (status === 403) return `Token'ın bu işlem için izni yok (Contents: Read and write olmalı).`;
  if (status === 404) return `Dosya ya da repo bulunamadı. Token'da "${DATA_REPO}" reposu seçili mi?`;
  return `GitHub beklenmeyen bir cevap verdi (HTTP ${status}).`;
}

async function request(token: string, path: string, accept: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers: headers(token, accept), cache: 'no-store' });
  } catch {
    throw new GitHubError(0, 'GitHub’a bağlanılamadı. İnternet bağlantını kontrol et.');
  }
  if (!res.ok) {
    throw new GitHubError(res.status, explain(res.status, res.headers.get('x-ratelimit-remaining') === '0'));
  }
  return res;
}

/**
 * Confirms the token can read AND write lesezeit-data.
 * Fine-grained tokens report their effective rights in `permissions` on the repo object.
 */
export async function checkDataRepoAccess(token: string): Promise<void> {
  const res = await request(token, `/repos/${DATA_OWNER}/${DATA_REPO}`, 'application/vnd.github+json');
  const repo = (await res.json()) as { private?: boolean; permissions?: { push?: boolean } };
  if (!repo.permissions?.push) {
    throw new GitHubError(403, 'Token sadece okuyabiliyor. "Contents: Read and write" izni ver.');
  }
  if (repo.private === false) {
    throw new GitHubError(0, `"${DATA_REPO}" public görünüyor. Bu repo private olmalı.`);
  }
}

/** Reads a JSON file from lesezeit-data. The raw media type skips base64 decoding. */
export async function readDataJson(token: string, filePath: string): Promise<unknown> {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  const res = await request(token, `/repos/${DATA_OWNER}/${DATA_REPO}/contents/${encoded}`, 'application/vnd.github.raw+json');
  try {
    return await res.json();
  } catch {
    throw new GitHubError(0, `${filePath} geçerli bir JSON değil.`);
  }
}
