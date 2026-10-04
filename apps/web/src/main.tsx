import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HttpApi } from './data/http';
import type { AppApi } from './data/session';
import { App } from './ui/App';
import './styles.css';

async function boot() {
  let api: AppApi;
  let demo = false;
  // `pnpm dev:fixture`: sin servidor, con el proyecto de ejemplo en memoria. Vite reemplaza la variable
  // en tiempo de build, así que el fixture no entra al bundle de producción.
  if (import.meta.env.VITE_FIXTURE) {
    const { FixtureApi } = await import('./data/fixture');
    const fixture = new FixtureApi({ latency: 220 });
    // Simulador del CLI desde la consola del navegador, p. ej.:
    //   dagyard.message('marketplace-reservas', 'pagos-con-tarjeta', 'Ya conecté la pasarela.')
    //   dagyard.done('marketplace-reservas', 'registro-e-inicio-de-sesion')
    (window as unknown as { dagyard: typeof fixture }).dagyard = fixture;
    api = fixture;
    demo = true;
  } else {
    api = new HttpApi();
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App api={api} demo={demo} />
    </StrictMode>,
  );
}

void boot();
