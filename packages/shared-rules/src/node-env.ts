/**
 * Valeurs admises de `NODE_ENV` (RISK-3 de la revue post-fusion de bracelets-nfc). `production`
 * arme toutes les gardes (aucun faux, secrets et références obligatoires) ; `development` (poste
 * local) et `test` (Jest, CI) les laissent désarmées. Toute autre valeur, ou son absence, refuse le
 * démarrage : un déploiement oublié ou mal nommé (`prod`, `staging`) démarrait sinon hors
 * production, avec les faux et le secret de test.
 */
export const NODE_ENVS = ['production', 'development', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export function nodeEnv(value: string | undefined): NodeEnv {
  if (!NODE_ENVS.includes(value as NodeEnv)) {
    throw new Error(
      `NODE_ENV ${value ? `inconnu (« ${value} »)` : 'manquant'} : ${NODE_ENVS.join(', ')} attendu`,
    );
  }
  return value as NodeEnv;
}
