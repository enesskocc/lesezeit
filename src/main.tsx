import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// autoUpdate: a new service worker activates and reloads the page as soon as it is found.
// iOS usually resumes a home-screen app instead of relaunching it, so it rarely checks for
// updates on its own — check whenever the app comes back to the foreground.
// TODO(milestone 5): switch to registerType 'prompt' so a reload never interrupts reading/review.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update().catch(() => {});
    });
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
