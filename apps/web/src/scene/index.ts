// Placeholder del scaffold: el carril «escena» lo reemplaza con la escena real.
import type { CreateSkyOptions, Sky } from './contract';

export function createSky(_opts: CreateSkyOptions): Sky {
  return {
    setGraph() {},
    pulse() {},
    overview() {},
    flyStage() {},
    focus() {},
    setSafeArea() {},
    dispose() {},
  };
}
