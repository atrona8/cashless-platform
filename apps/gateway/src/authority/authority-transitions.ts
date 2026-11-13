// Table des transitions de la machine à états de la passerelle (data-model.md B.8), SEULE source
// côté code. Un test compare cette table à `edge_authority_transition` (SQL, figée par
// edge-0001) : toute divergence échoue. Ni plus, ni moins que B.8.
export const AUTHORITY_STATES = [
  'STANDBY',
  'ARMED',
  'GRANTED_PENDING',
  'ACTIVE',
  'RELEASING',
  'RELEASED',
  'STALE',
  'REVOKED',
] as const;
export type AuthorityState = (typeof AUTHORITY_STATES)[number];

export const AUTHORITY_TRANSITIONS: ReadonlyArray<readonly [AuthorityState, AuthorityState]> = [
  ['STANDBY', 'ARMED'], // promotion (rôle changé hors ligne de débit)
  ['ARMED', 'GRANTED_PENDING'], // handover GRANTED vu
  ['GRANTED_PENDING', 'ACTIVE'], // accusé 200 reçu
  ['GRANTED_PENDING', 'ARMED'], // handover FAILED
  ['ACTIVE', 'RELEASING'], // RELEASE_REQUESTED vu
  ['ACTIVE', 'STALE'], // époque supérieure confirmée ou plausible
  ['STALE', 'ACTIVE'], // levée locale à deux personnes (lien coupé)
  ['RELEASING', 'RELEASED'], // autorité revenue au central
  ['RELEASING', 'ACTIVE'], // FAILED, même époque seulement
  ['STALE', 'GRANTED_PENDING'], // nouvel accord
  ['RELEASED', 'ARMED'],
  ['ACTIVE', 'REVOKED'], // certificat refusé
  ['ARMED', 'REVOKED'], // certificat refusé
];

const ALLOWED = new Set(AUTHORITY_TRANSITIONS.map(([from, to]) => `${from}>${to}`));

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`transition ${from} -> ${to} absente de la table de la passerelle`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: AuthorityState, to: AuthorityState): boolean {
  return ALLOWED.has(`${from}>${to}`);
}

/** Refuse toute transition hors table, AVANT toute écriture. */
export function assertTransition(from: AuthorityState, to: AuthorityState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
