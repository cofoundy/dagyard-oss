import { app } from './app.js';
import type { Env } from './env.js';

export { Store } from './db.js';
export { ProjectRoom } from './room.js';

export default {
  fetch: (req, env, ctx) => app.fetch(req, env, ctx),
} satisfies ExportedHandler<Env>;
