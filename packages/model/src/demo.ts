/**
 * La demo «Marketplace de reservas»: los 20 nodos de design/preview-constelacion.html con sus 3
 * bloqueantes. La siembra el Worker (`PUT /api/projects/marketplace-reservas`) y la UI puede usarla
 * como fixture local. Sin nada de un cliente real (NDA).
 */
import { DEFAULT_STAGES, type NodeInput, type NodeStatus, type ProjectGraphInput } from './types.js';

export const DEMO_PROJECT_ID = 'marketplace-reservas';

type Row = [id: string, stage: number, title: string, status: NodeStatus, deps: string[], team: string | null, goal: string, progress?: number];

const ROWS: Row[] = [
  ['entrevistas', 0, 'Entrevistas a 8 usuarios', 'done', [], 'Investigación', 'Entrevista a 8 personas que reservan servicios y resume sus 3 dolores principales'],
  ['competencia', 0, 'Análisis de la competencia', 'done', [], 'Investigación', 'Compara 6 apps de reservas y di qué hace cada una mejor y peor'],
  ['usuario', 0, 'Definir el usuario principal', 'done', ['entrevistas', 'competencia'], 'Investigación', 'Elige al usuario principal con lo aprendido en entrevistas y competencia'],
  ['registro-d', 1, 'Flujo de registro', 'done', ['usuario'], 'Diseño', 'Diseña un registro de 2 pasos con Google o correo'],
  ['busqueda-d', 1, 'Pantalla de búsqueda', 'done', ['usuario'], 'Diseño', 'Diseña la búsqueda con filtros por zona, precio y horario'],
  ['comision', 1, 'Modelo de comisiones', 'blocked', ['competencia'], 'Diseño', 'Propón a quién cobrarle la comisión y cuánto, con números'],
  ['checkout-d', 1, 'Diseño del pago', 'blocked', ['busqueda-d'], 'Diseño', 'Diseña el pago en 3 pantallas como máximo'],
  ['perfil-d', 1, 'Perfil del proveedor', 'working', ['usuario'], 'Diseño', 'Diseña el perfil del proveedor con galería de fotos y reseñas', 0.55],
  ['registro', 2, 'Registro e inicio de sesión', 'working', ['registro-d'], 'Construcción', 'Construye el registro y el inicio de sesión según el diseño aprobado', 0.68],
  ['buscador', 2, 'Buscador con filtros', 'working', ['busqueda-d'], 'Construcción', 'Construye el buscador con filtros y disponibilidad real', 0.3],
  ['pagos', 2, 'Pagos con tarjeta', 'blocked', [], 'Construcción', 'Conecta la pasarela de pagos para cobrar con tarjeta'],
  ['reservas', 2, 'Reservas y calendario', 'pending', ['buscador', 'perfil-d'], null, 'Construye las reservas con calendario del proveedor'],
  ['whatsapp', 2, 'Avisos por WhatsApp', 'pending', ['registro'], null, 'Envía avisos por WhatsApp al reservar y un día antes'],
  ['panel', 2, 'Panel del proveedor', 'pending', ['perfil-d', 'comision'], null, 'Construye el panel donde el proveedor ve reservas y cobros'],
  ['prueba-users', 3, 'Prueba con 5 usuarios reales', 'pending', ['reservas', 'registro'], null, 'Prueba la app con 5 usuarios reales y reporta dónde se traban'],
  ['prueba-pagos', 3, 'Prueba de pagos de punta a punta', 'pending', ['pagos', 'checkout-d'], null, 'Prueba un pago real de punta a punta, incluido el reembolso'],
  ['velocidad', 3, 'Revisión de velocidad en celular', 'pending', ['buscador'], null, 'Mide la velocidad en un celular de gama media y corrige lo lento'],
  ['landing', 4, 'Página de lanzamiento', 'pending', ['usuario'], null, 'Arma la página de lanzamiento con la lista de espera'],
  ['tiendas', 4, 'Publicar en App Store y Play Store', 'pending', ['prueba-users', 'prueba-pagos', 'velocidad'], null, 'Publica la app en App Store y Play Store'],
  ['anuncio', 4, 'Anuncio a la lista de espera', 'pending', ['tiendas', 'landing'], null, 'Avísale a la lista de espera que ya pueden reservar'],
];

const MESSAGES: Array<[nodeId: string, text: string]> = [
  ['entrevistas', 'Listo. El dolor #1 es no saber si hay disponibilidad antes de llamar.'],
  ['competencia', 'Revisé 6 apps. Ninguna muestra disponibilidad en tiempo real.'],
  ['usuario', 'Elegimos al cliente que reserva desde el celular, entre semana.'],
  ['registro-d', 'Registro en 2 pasos, con Google o con correo.'],
  ['busqueda-d', 'Filtros por zona, precio y horario disponible.'],
  ['perfil-d', 'Armando la galería de fotos y las reseñas. Mañana te lo paso para revisar.'],
  ['registro', 'Ya entra con Google. Me falta el correo de bienvenida.'],
  ['buscador', 'Los filtros ya responden. Ahora conecto la disponibilidad real.'],
];

/** El grafo completo, listo para `PUT /api/projects/marketplace-reservas`. Devuelve una copia nueva. */
export function demoProject(): ProjectGraphInput {
  const team = new Map(ROWS.map((r) => [r[0], r[5]]));
  return {
    name: 'Marketplace de reservas',
    stages: DEFAULT_STAGES.map((s) => ({ ...s })),
    nodes: ROWS.map(([id, s, title, status, deps, t, goal, progress]): NodeInput => ({
      id,
      stage: DEFAULT_STAGES[s]!.id,
      title,
      status,
      progress: progress ?? (status === 'done' ? 1 : 0),
      team: t,
      goal,
      reportUrl: null,
      deps: [...deps],
    })),
    blockers: [
      {
        nodeId: 'comision',
        kind: 'decision',
        question: '¿A quién le cobramos la comisión?',
        options: ['Al proveedor (10 % por reserva)', 'Al cliente (cargo de servicio)'],
        accessLabel: null,
      },
      {
        nodeId: 'checkout-d',
        kind: 'review',
        question: 'Terminé el diseño del pago en 3 pantallas. Revísalo antes de que lo construyamos.',
        options: ['Aprobar', 'Pedir cambios'],
        accessLabel: null,
      },
      {
        nodeId: 'pagos',
        kind: 'access',
        question: 'Necesito acceso a la cuenta de la pasarela de pagos para cobrar con tarjeta.',
        options: [],
        accessLabel: 'Clave de la pasarela de pagos',
      },
    ],
    messages: MESSAGES.map(([nodeId, text]) => ({ nodeId, text, from: `Equipo de ${team.get(nodeId) ?? 'la fábrica'}` })),
  };
}
