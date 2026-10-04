// Sesión del dueño (docs/api.md §Sesión): la clave se cambia una vez por una cookie httpOnly que el
// navegador manda sola en cada fetch y en el WebSocket. La UI nunca guarda la clave.

import type { DagyardApi } from './types';

export interface SessionApi {
  /** ¿Hay una sesión viva? (cookie válida) */
  check(): Promise<boolean>;
  /** Cambia la clave por una sesión. Lanza `UnauthorizedError` si la clave no sirve. */
  login(token: string): Promise<void>;
  logout(): Promise<void>;
}

export type AppApi = DagyardApi & SessionApi;

/** Error de la API con su código (`not_found`, `conflict`, …) para decidir qué mostrar. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
