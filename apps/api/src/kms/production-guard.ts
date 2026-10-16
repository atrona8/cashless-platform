// Aucun faux en production (règle du porteur du 13/10/2026, NFR-010) : un processus qui porte un faux service de clés,
// un faux terminal ou un faux festivalier refuse de démarrer en configuration de production. Aucun réglage ne
// désactive cette garde. Chaque point d'entrée l'appelle avant d'écouter.

export interface MaybeFake {
  readonly isFake?: boolean;
}

export class FakeInProductionError extends Error {
  constructor(readonly names: string[]) {
    super(`Démarrage refusé : ${names.join(', ')} ${names.length > 1 ? 'sont des faux' : 'est un faux'}, interdit en production`);
    this.name = 'FakeInProductionError';
  }
}

/** `providers` : nom lisible → fournisseur réellement injecté dans le processus. */
export function assertNoFakeInProduction(production: boolean, providers: Record<string, object | null | undefined>): void {
  if (!production) return;
  const fakes = Object.entries(providers)
    .filter(([, provider]) => (provider as MaybeFake | null | undefined)?.isFake === true)
    .map(([name]) => name);
  if (fakes.length > 0) throw new FakeInProductionError(fakes);
}
