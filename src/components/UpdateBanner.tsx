import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * registerType "prompt": a new version never reloads the page by itself (that would interrupt
 * reading). When it is ready, this bar offers to reload. iOS rarely relaunches a home-screen app,
 * so updates are also checked whenever the app comes back to the foreground.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => {});
      });
    },
  });

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 mx-auto flex max-w-[480px] items-center gap-2 border-b border-line bg-accent-soft px-4 pt-[max(8px,env(safe-area-inset-top))] pb-2 text-sm"
    >
      <span className="flex-1">Yeni sürüm hazır.</span>
      <button className="btn-primary" onClick={() => void updateServiceWorker(true)}>
        Yenile
      </button>
      <button className="btn" onClick={() => setNeedRefresh(false)}>
        Sonra
      </button>
    </div>
  );
}
