// Garde de présence et de valeurs de `x-roles` (mission 11b, WP04 ; FR-003, FR-004, SC-002).
// Fonction pure, sans lecture de fichier : le test l'applique au contrat réel puis à des contrats mutés.
import { operationsOf, ROLE_VALUES } from './apply.mjs';

/**
 * Doutes tranchés par le porteur : operationId dont le contrôle est absent du code et qui reste SANS `x-roles`.
 * Liste explicite, à vider dès que la route existe (une opération qui n'est plus douteuse doit en sortir).
 * 24/11/2026 : les huit opérations posClient/terminal sans route dans `apps/api/src` (rapport de WP04).
 */
export const DOUBTS_ACCEPTED = [
  'createPaymentIntent',
  'getPaymentIntent',
  'capturePaymentIntent',
  'cancelPaymentIntent',
  'listDevicePaymentIntents',
  'listWebhookEndpoints',
  'createWebhookEndpoint',
  'deleteWebhookEndpoint',
];

/** Erreurs nommées ; liste vide = garde satisfaite. */
export function guardProblems(doc, table, doubtsAccepted = DOUBTS_ACCEPTED) {
  const problems = [];
  const ids = new Set();
  for (const { operationId, method, path, op } of operationsOf(doc)) {
    ids.add(operationId);
    const where = `${operationId} (${method.toUpperCase()} ${path})`;
    const entry = table[operationId];
    if (!entry) problems.push(`${where} : absente de roles.json`);
    if (entry?.doubt) {
      if (!doubtsAccepted.includes(operationId)) {
        problems.push(`${where} : DOUTE non tranché (${entry.question ?? 'sans question'})`);
      }
      if (op['x-roles'] !== undefined) problems.push(`${where} : douteuse mais annotée`);
      continue;
    }
    const roles = op['x-roles'];
    if (!Array.isArray(roles)) problems.push(`${where} : x-roles absent`);
    else if (roles.length === 0) problems.push(`${where} : x-roles vide`);
    else {
      for (const role of roles) {
        if (!ROLE_VALUES.includes(role)) problems.push(`${where} : valeur hors liste : ${role}`);
      }
      if (new Set(roles).size !== roles.length) problems.push(`${where} : doublon dans x-roles`);
    }
    if (entry && !entry.doubt && (!Array.isArray(entry.roles) || entry.roles.length === 0)) {
      problems.push(`${where} : roles.json sans rôle`);
    } else if (
      entry &&
      Array.isArray(roles) &&
      JSON.stringify(roles) !== JSON.stringify(ROLE_VALUES.filter((r) => entry.roles.includes(r)))
    ) {
      problems.push(`${where} : x-roles ${JSON.stringify(roles)} différent de roles.json`);
    }
  }
  for (const id of Object.keys(table)) {
    if (!ids.has(id)) problems.push(`${id} : entrée de roles.json sans opération du contrat`);
  }
  for (const id of doubtsAccepted) {
    if (!table[id]?.doubt) problems.push(`${id} : dans DOUBTS_ACCEPTED sans doute dans roles.json`);
  }
  return problems;
}
