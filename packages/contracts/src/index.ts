// Types du contrat de l'API, générés depuis openapi.yaml (jamais écrits à la main, FR-022).
//
// Attention : les entiers `int64` du contrat sont générés en `number`. Ces types décrivent la forme HTTP ;
// ils ne servent jamais à porter un montant interne (montants internes en `bigint`, SPECIFICATION §5.5 ;
// conversion aux frontières HTTP par un sérialiseur dédié).
import type { components } from '../generated/openapi';

export type { components, operations, paths } from '../generated/openapi';
export { PROBLEM_CODES } from '../generated/problem-codes';
export { PROBLEM_STATUSES } from '../generated/problem-statuses';

export type ProblemCode = components['schemas']['ProblemCode'];
