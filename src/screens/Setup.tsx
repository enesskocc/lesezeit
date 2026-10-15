import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { DATA_OWNER, DATA_REPO } from '../config';
import { clearKeys, saveKeys, type Settings } from '../lib/db';
import { checkDataRepoAccess } from '../lib/github';

// On iOS a home-screen app has its own storage, separate from Safari.
// Keys typed in Safari would not be visible after "Add to Home Screen".
function isIosBrowserTab(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}

export function Setup({ existing }: { existing: Settings | undefined }) {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [gemini, setGemini] = useState(existing?.geminiKey ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const githubToken = token.trim() || existing?.githubToken || '';
    if (!githubToken) {
      setError('GitHub token gerekli.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await checkDataRepoAccess(githubToken);
      await saveKeys(githubToken, gemini.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!window.confirm('Bu cihazdaki anahtarlar silinsin mi?')) return;
    await clearKeys();
    setToken('');
    setGemini('');
  }

  return (
    <>
      <h1 className="mb-1 font-read text-[26px] font-semibold">{existing ? 'Ayarlar' : 'Kurulum'}</h1>
      <p className="mb-4 text-muted">
        Metinler ve ilerlemen özel <b className="text-ink">{DATA_OWNER}/{DATA_REPO}</b> reposunda durur. Anahtarlar sadece bu
        cihazda saklanır.
      </p>

      {isIosBrowserTab() && (
        <p className="mb-4 rounded-[10px] bg-accent-soft px-3 py-2.5 text-sm">
          iPhone’da önce <b>Paylaş → Ana Ekrana Ekle</b> yap, uygulamayı ana ekrandan aç ve anahtarları orada gir. Safari’de
          girilenler ana ekran uygulamasına taşınmaz.
        </p>
      )}

      <form className="card flex flex-col gap-4" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1.5">
          <span className="label"><span lang="en">GitHub token</span></span>
          <input
            className="field font-mono text-sm"
            type="password"
            name="github-token"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={existing ? `Kayıtlı (…${existing.githubToken.slice(-4)}). Değiştirmek için yenisini yapıştır.` : 'github_pat_…'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <span className="text-[12.5px] text-muted">Fine-grained, sadece {DATA_REPO}: Contents ve Actions → Read and write.</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="label"><span lang="en">Gemini API</span> anahtarı (isteğe bağlı)</span>
          <input
            className="field font-mono text-sm"
            type="password"
            name="gemini-key"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="AIza…"
            value={gemini}
            onChange={(e) => setGemini(e.target.value)}
          />
          <span className="text-[12.5px] text-muted">Canlı yapay zekâ soruları için. 8. aşamaya kadar boş bırakabilirsin.</span>
        </label>

        {error && (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Kontrol ediliyor…' : 'Kaydet ve test et'}
        </button>
      </form>

      {existing && (
        <button className="btn mt-4 text-bad" onClick={() => void onClear()}>
          Anahtarları bu cihazdan sil
        </button>
      )}
    </>
  );
}
