import { useLiveQuery } from 'dexie-react-hooks';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { db } from './lib/db';
import { Home } from './screens/Home';
import { Setup } from './screens/Setup';

// Hash routes (#/kurulum) because GitHub Pages has no SPA fallback for deep links.
export default function App() {
  // `null` while IndexedDB is loading, `undefined` when no keys are saved yet.
  const settings = useLiveQuery(() => db.settings.get('main'), [], null);
  if (settings === null) return null;

  const token = settings?.githubToken;
  return (
    <HashRouter>
      <main className="mx-auto max-w-[480px] px-[max(16px,env(safe-area-inset-left))] pt-[max(16px,env(safe-area-inset-top))] pb-28">
        <Routes>
          <Route path="/" element={token ? <Home token={token} /> : <Navigate to="/kurulum" replace />} />
          <Route path="/kurulum" element={<Setup existing={settings} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {token && <BottomNav />}
    </HashRouter>
  );
}
