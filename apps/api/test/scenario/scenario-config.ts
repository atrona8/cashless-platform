// ConfigResolver du scénario : paramètres de scenario_reference.json, taux convertis en points de base depuis leur
// texte (jamais relus en flottant, research R-09). La lecture des paramètres est celle des tests des constructeurs
// (test/unit/builders/support/scenario-lines.ts) ; seules changent les clés réelles des participations et des parties.
import type { ConfigResolver } from '../../src/ledger/ports/config-resolver';
import type { ResolvedConfig } from '../../src/ledger/types';
import { scenarioConfig } from '../unit/builders/support/scenario-lines';
import type { ScenarioFixture } from './fixture';

export function scenarioResolvedConfig(fx: ScenarioFixture): ResolvedConfig {
  const symbolic = scenarioConfig();
  const byParticipation = <T>(table: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(table).map(([merchant, value]) => [fx.participations[merchant as keyof ScenarioFixture['participations']], value]));
  return {
    ...symbolic,
    parties: { platformId: fx.parties.PLT, operatorId: fx.parties.OPE, organizerId: fx.parties.ORG },
    commissions: byParticipation(symbolic.commissions),
    pitchFees: byParticipation(symbolic.pitchFees),
  };
}

/** Même configuration quelle que soit la date de l'opération (le scénario n'a qu'une version). */
export function scenarioConfigResolver(fx: () => ScenarioFixture): ConfigResolver {
  return { resolve: () => Promise.resolve(scenarioResolvedConfig(fx())) };
}
