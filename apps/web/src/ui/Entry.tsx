// Entrada mínima: un campo para la clave, sobre el mismo cielo. La clave se cambia por una sesión
// (cookie) y no se guarda en el navegador ni viaja en la URL.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionApi } from '../data/session';
import { UnauthorizedError } from '../data/types';
import { useLang } from '../i18n';
import { COPY } from './copy';
import { LangSwitch } from './LangSwitch';

/** Los avisos de la entrada: se guarda la clave y se lee al pintar, así un cambio de idioma también los traduce. */
export type EntryNotice = 'entryEmpty' | 'entryBad' | 'entryOffline' | 'entryExpired';

export function Entry({ api, notice, onEnter }: { api: SessionApi; notice?: EntryNotice; onEnter: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EntryNotice | undefined>(notice);
  const input = useRef<HTMLInputElement>(null);
  useLang();

  useEffect(() => {
    input.current?.focus();
  }, []);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!token.trim()) {
      setError('entryEmpty');
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
      setError(e instanceof UnauthorizedError ? 'entryBad' : 'entryOffline');
      setBusy(false);
      input.current?.select();
    }
  }

  return (
    <main className="entry">
      <form className="entry-card" onSubmit={submit} noValidate>
        <div className="entry-head">
          <div className="word">
            <i aria-hidden="true" />
            dagyard
          </div>
          <LangSwitch />
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
            {COPY[error]}
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
