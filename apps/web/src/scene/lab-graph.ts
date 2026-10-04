// Grafo local de 20 nodos (el «Marketplace de reservas» del preview) para el laboratorio y los tests de la escena.
// No es el fixture de la app (ese vive en src/data, carril interfaz).
import type { SceneGraph, SceneNode } from './contract';

type Row = [id: string, stage: number, title: string, status: SceneNode['status'], progress: number, deps: string[]];

const ROWS: Row[] = [
  ['entrevistas', 0, 'Entrevistas a 8 usuarios', 'done', 1, []],
  ['competencia', 0, 'Análisis de la competencia', 'done', 1, []],
  ['usuario', 0, 'Definir el usuario principal', 'done', 1, ['entrevistas', 'competencia']],
  ['registro-d', 1, 'Flujo de registro', 'done', 1, ['usuario']],
  ['busqueda-d', 1, 'Pantalla de búsqueda', 'done', 1, ['usuario']],
  ['comision', 1, 'Modelo de comisiones', 'blocked', 0, ['competencia']],
  ['checkout-d', 1, 'Diseño del pago', 'blocked', 0, ['busqueda-d']],
  ['perfil-d', 1, 'Perfil del proveedor', 'working', 0.55, ['usuario']],
  ['registro', 2, 'Registro e inicio de sesión', 'working', 0.68, ['registro-d']],
  ['buscador', 2, 'Buscador con filtros', 'working', 0.3, ['busqueda-d']],
  ['pagos', 2, 'Pagos con tarjeta', 'blocked', 0, []],
  ['reservas', 2, 'Reservas y calendario', 'pending', 0, ['buscador', 'perfil-d']],
  ['whatsapp', 2, 'Avisos por WhatsApp', 'pending', 0, ['registro']],
  ['panel', 2, 'Panel del proveedor', 'pending', 0, ['perfil-d', 'comision']],
  ['prueba-users', 3, 'Prueba con 5 usuarios reales', 'pending', 0, ['reservas', 'registro']],
  ['prueba-pagos', 3, 'Prueba de pagos de punta a punta', 'pending', 0, ['pagos', 'checkout-d']],
  ['velocidad', 3, 'Revisión de velocidad en celular', 'pending', 0, ['buscador']],
  ['landing', 4, 'Página de lanzamiento', 'pending', 0, ['usuario']],
  ['tiendas', 4, 'Publicar en App Store y Play Store', 'pending', 0, ['prueba-users', 'prueba-pagos', 'velocidad']],
  ['anuncio', 4, 'Anuncio a la lista de espera', 'pending', 0, ['tiendas', 'landing']],
];

export function labGraph(): SceneGraph {
  return {
    stages: ['Descubrimiento', 'Diseño', 'Construcción', 'Pruebas', 'Lanzamiento'].map((name, i) => ({ id: `s${i}`, name })),
    nodes: ROWS.map(([id, stage, title, status, progress]) => ({ id, stage, title, status, progress })),
    edges: ROWS.flatMap(([id, , , , , deps]) => deps.map((from) => ({ from, to: id }))),
  };
}
