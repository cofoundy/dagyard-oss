import { describe, expect, it, vi } from 'vitest';
import { DagyardClient } from '../../cli/src/api.js';
import { composeReply, ReplyError } from '../src/reply.js';
import { handleReply } from '../src/server.js';
import { PID } from './fixtures.js';

describe('composeReply', () => {
  it('solo hice', () => {
    expect(composeReply({ node: 'Pagos', hice: '  Conecté   Yape ' })).toEqual({ nodeId: 'pagos', input: { text: 'Conecté Yape' } });
  });

  it('hice + duda + reporte', () => {
    const r = composeReply({ node: 'pagos', hice: 'Conecté Yape', duda: '¿Activo también Plin?', reporte: 'https://basalt.cofoundy.dev/r/1' });
    expect(r.input).toEqual({ text: 'Conecté Yape. Duda: ¿Activo también Plin?', reportUrl: 'https://basalt.cofoundy.dev/r/1' });
  });

  it('no duplica el punto', () => {
    expect(composeReply({ node: 'pagos', hice: 'Listo!', duda: 'x' }).input.text).toBe('Listo! Duda: x');
  });

  it('error claro si pasa de 280', () => {
    expect(() => composeReply({ node: 'pagos', hice: 'a'.repeat(200), duda: 'b'.repeat(100) })).toThrow(
      /queda en 308 caracteres y el máximo es 280: acorta «hice» o «duda»/,
    );
    expect(() => composeReply({ node: 'pagos', hice: 'a'.repeat(280) })).not.toThrow();
  });

  it('valida campos', () => {
    expect(() => composeReply({ hice: 'x' })).toThrow(/falta «node»/);
    expect(() => composeReply({ node: 'pagos' })).toThrow(/falta «hice»/);
    expect(() => composeReply({ node: 'pagos', hice: '   ' })).toThrow(/vacío/);
    expect(() => composeReply({ node: '***', hice: 'x' })).toThrow(ReplyError);
    expect(() => composeReply({ node: 'pagos', hice: 'x', reporte: 'basalt/r/1' })).toThrow(/http/);
    expect(() => composeReply({ node: 'pagos', hice: 1 })).toThrow(/texto/);
    expect(() => composeReply(null)).toThrow(/falta «node»/);
  });
});

describe('handleReply', () => {
  const log = () => {};
  const asFetch = (f: unknown) => f as typeof globalThis.fetch;

  it('POST /messages con text y reportUrl', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: 'm_1' }), { status: 201 }));
    const client = new DagyardClient({ baseUrl: 'https://d.dev/', key: 'k', fetch: asFetch(fetch) });
    const res = await handleReply({ client, projectId: PID, log }, { node: 'pagos', hice: 'Hecho', reporte: 'https://b.dev/r' });
    expect(res.isError).toBeFalsy();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://d.dev/api/projects/${PID}/nodes/pagos/messages`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Hecho', reportUrl: 'https://b.dev/r' });
  });

  it('validación → isError sin llamar a la API', async () => {
    const fetch = vi.fn();
    const client = new DagyardClient({ baseUrl: 'https://d.dev', key: 'k', fetch: asFetch(fetch) });
    const res = await handleReply({ client, projectId: PID, log }, { node: 'pagos', hice: 'x'.repeat(281) });
    expect(res.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('error de la API → isError con el mensaje del servidor', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'no existe el nodo' } }), { status: 404 }),
    );
    const client = new DagyardClient({ baseUrl: 'https://d.dev', key: 'k', fetch: asFetch(fetch) });
    const res = await handleReply({ client, projectId: PID, log }, { node: 'nada', hice: 'x' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('not_found: no existe el nodo');
  });
});
