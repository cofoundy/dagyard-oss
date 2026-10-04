import type { ErrorCode } from '@dagyard/model';

const STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  cycle: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
};

/** Error con la forma del contrato: `{"error": {"code", "message"}}`, mensaje en español. */
export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export const fail = (code: ErrorCode, message: string): never => {
  throw new ApiFailure(code, message);
};

export function errorResponse(code: ErrorCode, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status: STATUS[code], headers });
}

export const notFound = (what: string): never => fail('not_found', `${what} no existe`);
