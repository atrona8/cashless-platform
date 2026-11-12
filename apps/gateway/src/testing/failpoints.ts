// Points d'arrêt (interfaces.md § 10, research R-26) : le banc de WP25 tue la passerelle à des
// instants précis pour
// prouver la reprise. ACTIFS SEULEMENT si NODE_ENV vaut `development` ou `test` ET
// EDGE_ALLOW_FAILPOINTS=1.
// Syntaxe : `EDGE_FAILPOINT=<nom>[:<n>]` (le n-ième passage, 1 par défaut). Hors de ces deux
// conditions, un point posé
// est IGNORÉ et une ligne d'audit `FAILPOINT_REFUSED` est écrite ; en production, la garde de
// démarrage refuse de
// démarrer (`processes/startup-guard.ts`).
//
// `failpoint(name)` est gratuit quand rien n'est posé : la configuration est lue UNE fois au
// démarrage
// (`configureFailpoints`), jamais `process.env` à chaque appel.
//  - `before-local-write`, `after-local-write-before-reply`,
// `during-drain-after-send-before-result`,
//    `after-releasing-persisted` : `SIGKILL` du processus lui-même ;
//  - `kill-local-database` : écrit `FAILPOINT kill-local-database reached` sur la sortie standard
// puis ATTEND sans
//    valider ; le banc exécute alors `docker kill` du conteneur PostgreSQL local (A28). Le code de
// production n'appelle
//    jamais Docker.
export const FAILPOINT_NAMES = [
  'before-local-write',
  'after-local-write-before-reply',
  'during-drain-after-send-before-result',
  'after-releasing-persisted',
  'kill-local-database',
] as const;
export type FailpointName = (typeof FAILPOINT_NAMES)[number];

export interface FailpointSettings {
  nodeEnv: string;
  failpoint: string | null;
  allowFailpoints: string | null;
}

export interface FailpointOutcome {
  /** Le point est armé (les deux conditions réunies). */
  armed: boolean;
  /** Un point était posé mais ignoré : le démarrage écrit `FAILPOINT_REFUSED`. */
  refused: boolean;
  name: FailpointName | null;
}

let armedName: FailpointName | null = null;
let armedAt = 1;
let passes = 0;

export function parseFailpoint(raw: string): { name: FailpointName; at: number } {
  const [name, n, ...rest] = raw.split(':');
  if (!FAILPOINT_NAMES.includes(name as FailpointName) || rest.length > 0) {
    throw new Error(`EDGE_FAILPOINT : nom inconnu (${FAILPOINT_NAMES.join(', ')})`);
  }
  const at = n === undefined ? 1 : /^[0-9]{1,6}$/.test(n) ? Number(n) : 0;
  if (at < 1) throw new Error('EDGE_FAILPOINT : le n-ième passage est un entier de 1 à 999999');
  return { name: name as FailpointName, at };
}

/** Lecture unique au démarrage. */
export function configureFailpoints(settings: FailpointSettings): FailpointOutcome {
  armedName = null;
  passes = 0;
  if (settings.failpoint === null) return { armed: false, refused: false, name: null };
  const { name, at } = parseFailpoint(settings.failpoint);
  const allowed =
    (settings.nodeEnv === 'development' || settings.nodeEnv === 'test') &&
    settings.allowFailpoints === '1';
  if (!allowed) return { armed: false, refused: true, name };
  armedName = name;
  armedAt = at;
  return { armed: true, refused: false, name };
}

/** Appel gratuit quand rien n'est posé (un test de pointeur, pas de promesse). */
export function failpoint(name: FailpointName): Promise<void> | undefined {
  if (armedName !== name) return undefined;
  passes += 1;
  if (passes !== armedAt) return undefined;
  if (name === 'kill-local-database') {
    process.stdout.write('FAILPOINT kill-local-database reached\n');
    return new Promise<void>(() => undefined);
  }
  process.kill(process.pid, 'SIGKILL');
  return new Promise<void>(() => undefined);
}
