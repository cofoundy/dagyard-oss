// El enlace de la vista: `/?p=<proyecto>&n=<tarea>` abre ese proyecto y la ficha de esa tarea, y la URL sigue a lo que
// miras para que cualquier vista se pueda copiar y mandar (#64). Solo viajan ids de proyecto y de tarea, nunca la clave.

export interface Link {
  project: string | null;
  node: string | null;
}

const MAX_ID = 200;

function id(v: string | null): string | null {
  const s = v?.trim();
  return s && s.length <= MAX_ID ? s : null;
}

/** Lo que pide el enlace con el que se abrió la página. Una tarea sin proyecto no dice a dónde ir: se ignora. */
export function readLink(search: string = window.location.search): Link {
  const q = new URLSearchParams(search);
  const project = id(q.get('p'));
  return { project, node: project ? id(q.get('n')) : null };
}

/** Deja en la URL la vista actual sin crear una entrada de historial; conserva el resto de parámetros y el ancla. */
export function writeLink(link: Link): void {
  const url = new URL(window.location.href);
  if (link.project) url.searchParams.set('p', link.project);
  else url.searchParams.delete('p');
  if (link.project && link.node) url.searchParams.set('n', link.node);
  else url.searchParams.delete('n');
  if (url.href === window.location.href) return;
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
