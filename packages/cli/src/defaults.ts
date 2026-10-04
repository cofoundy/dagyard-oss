/**
 * Lo que el CLI escribe por su cuenta en un proyecto (etapas, misiones, opciones por defecto), en los dos
 * idiomas (#77). El idioma lo pone el proyecto (`project.lang`), nunca `LANG`: un mismo proyecto no mezcla
 * idiomas según quién lo toque. Los mensajes de consola siguen a `LANG` (i18n.ts).
 */
import { DEFAULT_STAGES_BY_LANG, slugify, type Lang, type Stage } from '@dagyard/model';

/** Palabras de `phase:` que caen en cada etapa por defecto (misma posición que DEFAULT_STAGES_BY_LANG). */
export const PHASE_WORDS: readonly string[][] = [
  ['discovery', 'research', 'descubrimiento', 'spec', 'plan', 'planning'],
  ['design', 'diseño', 'diseno', 'ux'],
  ['build', 'implementation', 'implement', 'dev', 'development', 'construccion', 'construcción'],
  ['verification', 'verify', 'test', 'testing', 'qa', 'pruebas', 'review'],
  ['deploy', 'post-deploy', 'release', 'launch', 'lanzamiento', 'rollout', 'ship'],
];

/** La etapa donde `sync` deja las tareas nuevas: «Build» / «Construcción». */
const BUILD = 2;

/**
 * Etapas por profundidad (D10: nunca «Etapa N»): la primera, la última y las del medio en orden; alcanzan para
 * las 10 que caben entre la primera y la última (tope de 12).
 */
const DEPTH_STAGES: Record<Lang, { first: string; last: string; middle: string[] }> = {
  en: {
    first: 'Getting started',
    last: 'Finally',
    middle: ['Next', 'Then', 'After that', 'Later', 'Further on', 'Well along', 'Toward the end', 'Near the end', 'Almost at the end', 'Right before the end'],
  },
  es: {
    first: 'Para empezar',
    last: 'Al final',
    middle: ['Después', 'Luego', 'Más adelante', 'Más tarde', 'Ya avanzado', 'Bien avanzado', 'Hacia el final', 'Cerca del final', 'Casi al final', 'Justo antes del final'],
  },
};

/** La 1ª «Getting started» / «Para empezar», la última «Finally» / «Al final», las del medio con nombre propio. */
export function depthStageName(d: number, max: number, lang: Lang): string {
  const names = DEPTH_STAGES[lang];
  if (d === 0) return names.first;
  if (d === max) return names.last;
  return names.middle[d - 1] ?? names.middle[2]!;
}

/** La misión que el import le pone a una tarea que no trae `goal`. */
export function importGoal(title: string, path: string, lang: Lang): string {
  return lang === 'en' ? `${title} — follow ${path} and meet its acceptance criteria` : `${title} — sigue ${path} y cumple su aceptación`;
}

/** La decisión de un issue `founder-input` cuyo cuerpo no trae opciones. */
export const YES_NO: Record<Lang, string[]> = { en: ['Yes', 'No'], es: ['Sí', 'No'] };

/** Cada etapa que el CLI sabe nombrar, como el conjunto de sus slugs en los dos idiomas. */
const SAME_STAGE: ReadonlyArray<ReadonlySet<string>> = [
  ...DEFAULT_STAGES_BY_LANG.en.map((en, i) => {
    const es = DEFAULT_STAGES_BY_LANG.es[i]!;
    return new Set([en.id, slugify(en.name), es.id, slugify(es.name)]);
  }),
  new Set([slugify(DEPTH_STAGES.en.first), slugify(DEPTH_STAGES.es.first)]),
  new Set([slugify(DEPTH_STAGES.en.last), slugify(DEPTH_STAGES.es.last)]),
  ...DEPTH_STAGES.en.middle.map((en, i) => new Set([slugify(en), slugify(DEPTH_STAGES.es.middle[i]!)])),
];

/**
 * La etapa del proyecto que nombra `wanted` (id o nombre, en cualquier idioma): primero la coincidencia exacta,
 * después la misma etapa en el otro idioma (`build` encuentra «Construcción»). Nunca inventa una.
 */
export function findStage(stages: readonly Stage[], wanted: string): Stage | undefined {
  const slug = slugify(wanted);
  const matches = (keys: ReadonlySet<string>) => (s: Stage) => keys.has(s.id) || keys.has(slugify(s.name));
  return stages.find(matches(new Set([slug]))) ?? stages.find(matches(SAME_STAGE.find((g) => g.has(slug)) ?? new Set()));
}

/** Donde `sync` deja una tarea nueva sin `--stage`: la de construcción (en cualquier idioma), si no la primera. */
export function defaultSyncStage(stages: readonly Stage[], lang: Lang): Stage | undefined {
  // por nombre: los ids son los mismos en los dos idiomas; con «Build» y «Construcción» juntas gana la del proyecto
  return findStage(stages, DEFAULT_STAGES_BY_LANG[lang][BUILD]!.name) ?? stages[0];
}
