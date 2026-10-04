// Monta la escena (src/scene, carril «escena») sobre el canvas y la capa de etiquetas, una sola vez.
// Los handlers viven en un ref: la escena siempre llama a la versión más nueva sin recrearse.

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createSky } from '../scene';
import type { SafeArea, SceneHandlers, Sky } from '../scene/contract';

export function useSky(
  canvas: RefObject<HTMLCanvasElement | null>,
  labels: RefObject<HTMLDivElement | null>,
  handlers: RefObject<SceneHandlers>,
  initialSafeArea: SafeArea,
): RefObject<Sky | null> {
  const sky = useRef<Sky | null>(null);
  const initial = useRef(initialSafeArea);

  useLayoutEffect(() => {
    if (!canvas.current || !labels.current) return;
    let created: Sky | null = null;
    try {
      created = createSky({
        canvas: canvas.current,
        labels: labels.current,
        safeArea: initial.current,
        handlers: {
          onPick: (id) => handlers.current.onPick(id),
          onModeChange: (m) => handlers.current.onModeChange?.(m),
        },
      });
    } catch (err) {
      // Sin WebGL la escena muestra su propio aviso; la interfaz sigue funcionando.
      console.error('No se pudo iniciar la escena', err);
    }
    sky.current = created;
    return () => {
      created?.dispose();
      if (sky.current === created) sky.current = null;
    };
  }, [canvas, labels, handlers]);

  return sky;
}
