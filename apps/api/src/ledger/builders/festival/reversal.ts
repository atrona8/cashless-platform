// REVERSAL : contre-passation exacte de la transaction d'origine, sans aucun recalcul (SPECIFICATION §5.4).
import { BuildError, type BuildContext, type LedgerCommand, type Line } from '../../types';
import { balanced, requireId } from './lines';

export type ReversalPayload = Record<string, never>;

export function buildReversal(command: LedgerCommand<'REVERSAL', ReversalPayload>, ctx: BuildContext): Line[] {
  requireId(command.reversesId, 'transaction contre-passée (reversesId)');
  if (!ctx.original?.length) throw new BuildError('VALIDATION_FAILED', "contre-passation : lignes d'origine non fournies");
  // Montants opposés, lignes en ordre inverse : c'est la forme du scénario de référence (T16 contre-passe T15),
  // normatif devant la fiche WP07 qui disait « même ordre » (SPECIFICATION §0.3, signalé FR-024).
  return balanced([...ctx.original].reverse().map((line) => ({ ...line, amount: -line.amount })));
}
