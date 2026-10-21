import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { FatalScreen } from './components/ErrorBoundary';
import { db } from './lib/db';
import { Dictionary } from './screens/Dictionary';
import { Home } from './screens/Home';
import { Licenses } from './screens/Licenses';
import { Setup } from './screens/Setup';
import { TextPreview } from './screens/TextPreview';

// iOS sometimes loses the IndexedDB connection after a long suspend and the open never resolves.
const DB_TIMEOUT_MS = 5000;

// Hash routes (#/kurulum) because GitHub Pages has no SPA fallback for deep links.
export default function App() {
  // `null` while IndexedDB is loading, `undefined` when no keys are saved yet.
  const settings = useLiveQuery(() => db.settings.get('main'), [], null);
  const [dbStuck, setDbStuck] = useState(false);

  useEffect(() => {
    if (settings !== null) return;
    const t = setTimeout(() => setDbStuck(true), DB_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [settings]);

  if (settings === null) return dbStuck ? <FatalScreen detail="IndexedDB açılamadı." /> : null;

  const token = settings?.githubToken;
  return (
    <HashRouter>
      <main className="mx-auto max-w-[480px] pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] pt-[max(16px,env(safe-area-inset-top))] pb-28">
        <Routes>
          <Route path="/" element={token ? <Home token={token} /> : <Navigate to="/kurulum" replace />} />
          <Route path="/kurulum" element={<Setup existing={settings} />} />
          <Route path="/metin/:date/:id" element={token ? <TextPreview token={token} /> : <Navigate to="/kurulum" replace />} />
          <Route path="/sozluk" element={<Dictionary />} />
          <Route path="/lisanslar" element={<Licenses />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {token && <BottomNav />}
    </HashRouter>
  );
}
