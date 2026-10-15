import { Component, type ReactNode } from 'react';

/** Full-screen Turkish error with a reload button. */
export function FatalScreen({ detail }: { detail?: string }) {
  return (
    <main className="mx-auto max-w-[480px] px-4 pt-[max(24px,env(safe-area-inset-top))]" role="alert">
      <h1 className="font-read text-[22px] font-semibold">Bir şey ters gitti</h1>
      <p className="mt-2 text-muted">
        Uygulamayı tamamen kapatıp (yukarı kaydırarak) yeniden aç. Sorun sürerse telefonu yeniden başlat.
      </p>
      {detail && <p className="mt-3 font-mono text-xs text-muted break-words">{detail}</p>}
      <button className="btn-primary mt-4" onClick={() => window.location.reload()}>
        Yeniden yükle
      </button>
    </main>
  );
}

/** Catches render errors (e.g. IndexedDB unavailable) instead of showing a blank white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error ? <FatalScreen detail={this.state.error.message} /> : this.props.children;
  }
}
