// Selector discreto de idioma (EN · ES): en la entrada y en el selector de proyectos. Cambia sin recargar y se
// recuerda en este navegador (#73).

import { LANGS, setLang, t, useLang } from '../i18n';
import { COPY } from './copy';

export function LangSwitch() {
  const current = useLang();
  return (
    <div className="lang" role="group" aria-label={COPY.langSwitch}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === current}
          // cada idioma se nombra en sí mismo: «English», «Español»
          title={t('lang.name', undefined, l)}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
