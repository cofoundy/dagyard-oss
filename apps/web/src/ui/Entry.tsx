// Entrada mínima: un campo para la clave, sobre el mismo cielo. La clave se cambia por una sesión
// (cookie) y no se guarda en el navegador ni viaja en la URL.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionApi } from '../data/session';
import { UnauthorizedError } from '../data/types';
import { COPY } from './copy';

export function Entry({ api, notice, onEnter }: { api: SessionApi; notice?: string; onEnter: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(notice);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!token.trim()) {
      setError(COPY.entryEmpty);
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.login(token);
      setToken('');
      onEnter();
    } catch (e) {
      setError(e instanceof UnauthorizedError ? COPY.entryBad : COPY.entryOffline);
      setBusy(false);
      input.current?.select();
    }
  }

  return (
    <main className="entry">
      <form className="entry-card" onSubmit={submit} noValidate>
        <div className="word">
          <i aria-hidden="true" />
          dagyard
        </div>
        <h1>{COPY.entryTitle}</h1>
        <p className="lead">{COPY.entryLead}</p>
        <label htmlFor="clave">{COPY.entryLabel}</label>
        <input
          id="clave"
          ref={input}
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          value={token}
          placeholder={COPY.entryPlaceholder}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? 'clave-err' : undefined}
          onChange={(e) => {
            setToken(e.target.value);
            setError(undefined);
          }}
        />
        {error && (
          <p className="err" id="clave-err" role="alert">
            {error}
          </p>
        )}
        <button className="go work" type="submit" disabled={busy}>
          {busy ? COPY.entryChecking : COPY.entryCta}
        </button>
        <p className="fine">{COPY.entryFine}</p>
      </form>
    </main>
  );
}
