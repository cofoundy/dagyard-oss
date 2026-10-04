/**
 * El pulso de la demo (#74): qué hace el equipo en un latido mientras alguien la mira. Puro y testeable sin
 * Worker: recibe el grafo, el idioma y un azar, y devuelve UN paso. El Worker lo aplica en una sola escritura
 * (ver apps/worker/src/writes.ts, `demoBeat`) y repite cada ~3,5 s. Nunca toca una tarea con un bloqueante
 * abierto ni abre o resuelve uno: las 3 cosas que esperan son del PM.
 */
import { demoSignature, demoTeam, type DemoLang } from './demo.js';
import { startable } from './graph.js';
import type { Blocker, DagNode, Edge } from './types.js';

export interface PulseState {
  nodes: Array<Pick<DagNode, 'id' | 'stage' | 'status' | 'progress' | 'team'>>;
  edges: Array<Pick<Edge, 'from' | 'to'>>;
  blockers: Array<Pick<Blocker, 'nodeId' | 'status'>>;
}

export interface PulseMessage {
  from: string;
  text: string;
}

export type PulseStep =
  /** sube el avance de una tarea en progreso; a veces con un mensaje corto */
  | { kind: 'advance'; nodeId: string; progress: number; message: PulseMessage | null }
  /** la tarea llegó a 100 %: queda lista, con su mensaje de cierre */
  | { kind: 'complete'; nodeId: string; message: PulseMessage }
  /** arranca una tarea pendiente con sus dependencias listas y le pone su equipo */
  | { kind: 'start'; nodeId: string; team: string }
  /** no queda nada que avanzar ni que arrancar */
  | { kind: 'idle' };

/** Cuánto sube el avance en un latido. */
export const PULSE_STEP = { min: 0.08, max: 0.18 } as const;
/** Cuántas tareas trabajan a la vez antes de arrancar otra: así se ve terminar una y arrancar la siguiente. */
export const PULSE_MAX_WORKING = 3;

/** Lo que cuenta cada equipo al pasar el 33 % y el 66 % de su tarea, y al cerrarla. */
const NEWS: Record<DemoLang, Record<string, [string, string, string]>> = {
  es: {
    comision: ['Armé los números con la opción que elegiste.', 'Revisé cómo queda el precio final para el cliente.', 'Modelo de comisiones listo, con la opción que elegiste.'],
    'checkout-d': ['Ajusté los últimos detalles del pago.', 'Revisé que el pago se entienda en 3 pantallas.', 'Diseño del pago listo para construir.'],
    'perfil-d': ['La galería ya muestra las fotos del proveedor.', 'Sumé las reseñas con estrellas debajo de la galería.', 'Perfil del proveedor listo: galería, reseñas y horarios.'],
    registro: ['El correo de bienvenida ya sale.', 'Probé el registro en 3 celulares distintos.', 'Registro listo. Ya se puede entrar con Google o con correo.'],
    buscador: ['La disponibilidad ya se ve en los resultados.', 'Los resultados ahora cargan en menos de un segundo.', 'Buscador listo, con filtros y disponibilidad real.'],
    pagos: ['Ya tengo el acceso. Conectando la pasarela.', 'El primer cobro de prueba pasó.', 'Pagos con tarjeta listos.'],
    reservas: ['El calendario del proveedor ya muestra los horarios libres.', 'Ya se puede reservar y cancelar desde el celular.', 'Reservas listas. El proveedor ve cada una en su calendario.'],
    whatsapp: ['Ya sale el aviso al reservar.', 'Programé el recordatorio de un día antes.', 'Avisos por WhatsApp listos: al reservar y un día antes.'],
    panel: ['El panel ya lista las reservas de la semana.', 'Sumé los cobros con la comisión que elegiste.', 'Panel del proveedor listo, con reservas y cobros.'],
    'prueba-users': ['Ya probaron 3 de los 5 usuarios.', 'Dos se trabaron al elegir el horario; lo anoto para mejorarlo.', 'Prueba lista. El informe dice dónde se traban y cómo arreglarlo.'],
    'prueba-pagos': ['El pago real pasó de punta a punta.', 'Probé el reembolso y llegó en minutos.', 'Prueba de pagos lista, reembolso incluido.'],
    velocidad: ['En un celular de gama media la búsqueda tardaba 4 s; ya va en 2.', 'Comprimí las fotos de los proveedores.', 'Revisión de velocidad lista. Todo carga en menos de 2 segundos.'],
    landing: ['El texto de la página ya está escrito.', 'La lista de espera ya guarda los correos.', 'Página de lanzamiento lista, con su lista de espera.'],
    tiendas: ['Subí la app a revisión en las dos tiendas.', 'App Store ya la aprobó; falta Play Store.', 'La app ya está publicada en las dos tiendas.'],
    anuncio: ['El correo del anuncio ya está escrito.', 'Lo programé para mañana a las 9.', 'Anuncio enviado a la lista de espera.'],
  },
  en: {
    comision: ['Ran the numbers with the option you picked.', 'Checked what the final price looks like for the customer.', 'Commission model is done, using the option you picked.'],
    'checkout-d': ['Polished the last details of checkout.', 'Made sure checkout reads clearly in 3 screens.', 'Checkout design is ready to build.'],
    'perfil-d': ["The gallery now shows the provider's photos.", 'Added star reviews below the gallery.', 'Provider profile is done: gallery, reviews and opening hours.'],
    registro: ['The welcome email is going out now.', 'Tested sign-up on 3 different phones.', 'Sign-up is done. People can log in with Google or email.'],
    buscador: ['Availability now shows up in the results.', 'Results now load in under a second.', 'Search is done, with filters and real availability.'],
    pagos: ['Got the access. Connecting the payment provider.', 'The first test charge went through.', 'Card payments are done.'],
    reservas: ["The provider's calendar now shows open slots.", 'You can now book and cancel from your phone.', 'Bookings are done. Providers see each one in their calendar.'],
    whatsapp: ['The booking confirmation is going out now.', 'Scheduled the reminder for one day before.', 'WhatsApp notifications are done: on booking and one day before.'],
    panel: ["The dashboard now lists the week's bookings.", 'Added payouts with the commission you picked.', 'Provider dashboard is done, with bookings and payouts.'],
    'prueba-users': ['3 of the 5 users have tried it.', 'Two got stuck picking a time; noting it down to fix.', 'Testing is done. The report shows where people get stuck and how to fix it.'],
    'prueba-pagos': ['A real payment went through from start to finish.', 'Tested a refund and it arrived within minutes.', 'Payment test is done, refund included.'],
    velocidad: ['On a mid-range phone search took 4 s; it now takes 2.', "Compressed the providers' photos.", 'Speed check is done. Everything loads in under 2 seconds.'],
    landing: ['The page copy is written.', 'The waitlist is saving emails now.', 'Launch page is done, with its waitlist.'],
    tiendas: ['Submitted the app for review in both stores.', 'The App Store approved it; Google Play is next.', 'The app is live in both stores.'],
    anuncio: ['The announcement email is written.', 'Scheduled it for 9 a.m. tomorrow.', 'Announcement sent to the waitlist.'],
  },
};

/** Para una tarea que no está en el guion (no debería pasar en la demo). */
const GENERIC: Record<DemoLang, [string, string, string]> = {
  es: ['Avanzando bien.', 'Ya falta poco.', 'Listo.'],
  en: ['Making good progress.', 'Almost there.', 'Done.'],
};

const news = (lang: DemoLang, nodeId: string) => NEWS[lang][nodeId] ?? GENERIC[lang];
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Un latido: qué hace el equipo ahora. No muta `state`. `rand` en [0, 1). */
export function demoPulse(state: PulseState, lang: DemoLang, rand: () => number = Math.random): PulseStep {
  const held = new Set(state.blockers.filter((b) => b.status === 'open').map((b) => b.nodeId));
  const working = state.nodes.filter((n) => n.status === 'working' && !held.has(n.id));
  const ready = startable(state.nodes as DagNode[], state.edges).filter((n) => !held.has(n.id));

  if (ready.length && working.length < PULSE_MAX_WORKING) {
    const n = ready[Math.floor(rand() * ready.length)]!;
    return { kind: 'start', nodeId: n.id, team: demoTeam(lang, n.stage) };
  }
  if (!working.length) return { kind: 'idle' };

  const n = working[Math.floor(rand() * working.length)]!;
  const from = demoSignature(lang, n.team ?? demoTeam(lang, n.stage));
  const [first, second, last] = news(lang, n.id);
  const progress = round(n.progress + PULSE_STEP.min + rand() * (PULSE_STEP.max - PULSE_STEP.min));
  if (progress >= 1) return { kind: 'complete', nodeId: n.id, message: { from, text: last } };
  // un mensaje al cruzar el 33 % y otro al cruzar el 66 %: «a veces», y nunca el mismo dos veces
  const crossed = (mark: number) => n.progress < mark && progress >= mark;
  const text = crossed(2 / 3) ? second : crossed(1 / 3) ? first : null;
  return { kind: 'advance', nodeId: n.id, progress, message: text ? { from, text } : null };
}
