import { useCallback, useEffect, useState } from 'react';
import { TestFileSchema, type TestFile } from '../../shared/schemas';
import { DATA_REPO, TEST_FILE_PATH } from '../config';
import { readDataJson } from '../lib/github';

type State = { kind: 'loading' } | { kind: 'ok'; data: TestFile } | { kind: 'error'; message: string };

const today = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });

export function Home({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const parsed = TestFileSchema.safeParse(await readDataJson(token, TEST_FILE_PATH));
      setState(parsed.success ? { kind: 'ok', data: parsed.data } : { kind: 'error', message: `${TEST_FILE_PATH} beklenen biçimde değil.` });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header className="mb-3.5 flex items-baseline justify-between gap-3">
        <h1 className="font-read text-[26px] font-semibold">Bugün</h1>
        <span className="text-[13px] text-muted">{today.format(new Date())}</span>
      </header>

      <section className="card" aria-live="polite">
        <div className="label">
          Bağlantı testi · <span lang="de">{DATA_REPO}</span>
        </div>
        {state.kind === 'loading' && <p className="mt-2 text-muted">Yükleniyor…</p>}
        {state.kind === 'ok' && (
          <>
            <p className="mt-2 font-read text-[19px] leading-relaxed" data-testid="test-message">
              {state.data.message}
            </p>
            <p className="mt-1 text-[12.5px] text-muted tabular-nums">
              {TEST_FILE_PATH} · {state.data.createdAt}
            </p>
          </>
        )}
        {state.kind === 'error' && (
          <p className="mt-2 text-bad" role="alert">
            {state.message}
          </p>
        )}
        <button className="btn mt-3" onClick={() => void load()} disabled={state.kind === 'loading'}>
          Yenile
        </button>
      </section>

      <p className="mt-4 text-[13px] text-muted">Günün metinleri 3. aşamadan itibaren burada listelenecek.</p>
    </>
  );
}
