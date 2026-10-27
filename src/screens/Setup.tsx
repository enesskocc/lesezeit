import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DATA_OWNER, DATA_REPO } from '../config';
import { backupNow, restoreBackup } from '../lib/backup';
import { clearKeys, DEFAULT_PREFS, getPrefs, saveKeys, setPrefs, type Settings } from '../lib/db';
import { checkDataRepoAccess } from '../lib/github';
import { formatInterval } from '../lib/srs';

/** A daily limit: typed freely, saved on blur; an empty or invalid field keeps the saved value. */
function LimitField({ label, value, max, onSave }: { label: string; value: number; max: number; onSave: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <input
        className="field w-24 text-right tabular-nums"
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Math.round(Number(draft));
          if (draft !== null && draft.trim() !== '' && Number.isFinite(n)) onSave(Math.min(max, Math.max(0, n)));
          setDraft(null);
        }}
      />
    </label>
  );
}

/** Spec "Daily limits (settings)". */
function VocabSettings() {
  const prefs = useLiveQuery(getPrefs, [], DEFAULT_PREFS);
  return (
    <section className="card mt-4 flex flex-col gap-3" aria-label="Kelime çalışması">
      <span className="label">Kelime çalışması</span>
      <LimitField label="Günde yeni kart" value={prefs.newPerDay} max={100} onSave={(n) => void setPrefs({ newPerDay: n })} />
      <LimitField label="Günde en fazla tekrar" value={prefs.maxReviews} max={999} onSave={(n) => void setPrefs({ maxReviews: n })} />
    </section>
  );
}

/** Spec "Backup and sync": when the last backup was made, back up now, restore on a new phone. */
function BackupSettings({ token }: { token: string }) {
  const prefs = useLiveQuery(getPrefs, [], DEFAULT_PREFS);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000); // keep "… önce" current
    return () => clearInterval(t);
  }, []);

  const ago = (iso: string) => {
    const ms = Date.now() - Date.parse(iso);
    return ms < 60_000 ? 'az önce' : `${formatInterval(ms)} önce`;
  };
  const run = async (kind: 'backup' | 'restore') => {
    if (kind === 'restore' && !window.confirm('Bu telefondaki kelimeler, kartlar ve geçmiş yedektekilerle değiştirilecek. Devam edilsin mi?')) return;
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'backup') {
        await backupNow(token);
        setMessage('Yedeklendi.');
      } else {
        const r = await restoreBackup(token);
        setMessage(`Geri yüklendi: ${r.cards} kart, ${r.words} kelime durumu.`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card mt-4 flex flex-col gap-3" aria-label="Yedek">
      <span className="label">Yedek</span>
      <p className="text-sm text-muted" data-testid="backup-status">
        {prefs.backupAt ? `Son yedek: ${ago(prefs.backupAt)}.` : 'Henüz yedeklenmedi.'} İlerlemen her değişiklikten sonra otomatik olarak{' '}
        {DATA_REPO} reposuna yedeklenir (en fazla 10 dakikada bir).
      </p>
      {prefs.backupError && !busy && (
        <p className="text-sm text-bad" role="alert">
          Son yedekleme başarısız: {prefs.backupError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy !== null} onClick={() => void run('backup')}>
          {busy === 'backup' ? 'Yedekleniyor…' : 'Şimdi yedekle'}
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => void run('restore')}>
          {busy === 'restore' ? 'Geri yükleniyor…' : 'Yedekten geri yükle'}
        </button>
      </div>
      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

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
  // Token just saved, waiting for App's live settings to contain it before leaving setup.
  const [saved, setSaved] = useState<string | null>(null);

  // Navigating right after the write raced App's live query: "/" rendered with the old (empty)
  // settings and redirected back here (seen as flaky E2E on the slower CI runner, 2026-10-22).
  useEffect(() => {
    if (saved && existing?.githubToken === saved) navigate('/', { replace: true });
  }, [saved, existing, navigate]);

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
      setSaved(githubToken); // the effect above navigates once App sees it
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          <span className="text-[12.5px] text-muted">Şu an hiçbir özellik kullanmıyor; boş bırakabilirsin.</span>
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

      {existing && <VocabSettings />}
      {existing && <BackupSettings token={existing.githubToken} />}

      <Link to="/lisanslar" className="mt-6 block text-sm text-muted underline">
        Lisanslar ve kaynaklar
      </Link>
    </>
  );
}
