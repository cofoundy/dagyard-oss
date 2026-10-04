import { LIMITS } from './model.js';

/** `T-314-A` → `t-314-a`; `Diseño de pagos` → `diseno-de-pagos`. */
export function slugify(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, '');
}
