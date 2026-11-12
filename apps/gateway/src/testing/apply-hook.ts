// Point d'arrêt de test de la réplication (panne injectée entre deux tables d'une page). Comme
// `failpoints.ts` : ACTIF seulement en `development` ou `test` (`nodeEnv()` de shared-rules ; toute
// autre valeur, y compris absente ou inconnue, l'éteint). En production, `setReplicationApplyHook`
// ne fait rien et `replicationApplyHook` rend toujours `undefined`.
import { nodeEnv } from '@cashless/shared-rules';

export type ApplyStepHook = (step: string) => void | Promise<void>;

let hook: ApplyStepHook | undefined;

function hookAllowed(): boolean {
  try {
    const env = nodeEnv(process.env.NODE_ENV);
    return env === 'development' || env === 'test';
  } catch {
    return false;
  }
}

export function setReplicationApplyHook(next: ApplyStepHook | undefined): void {
  hook = hookAllowed() ? next : undefined;
}

export function replicationApplyHook(): ApplyStepHook | undefined {
  return hookAllowed() ? hook : undefined;
}
