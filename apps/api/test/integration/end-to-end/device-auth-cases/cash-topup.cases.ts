// Cas de la matrice des preuves pour la recharge en espèces (mission 6, lot WP09 ; C-003 ; OP-N70) :
// `POST /topups/cash` (terminal ET personne, `@CounterAuth`, clé `<série>:<seq>`).
//
// Pas d'amorçage : le terminal de la matrice est partagé avec les cas des paiements (mode d'application que l'on
// ne change pas) et la matrice ne juge que les PREUVES. Avec des preuves valides, la route répond après la garde
// (`422 DEVICE_MODE_NOT_ALLOWED` : le terminal de la matrice n'est pas `TOPUP_DESK`, et la lecture du bracelet
// n'est ni consommée ni écrite) : un nonce consommé prouve que la garde réelle l'a servie. Le comportement
// métier est prouvé en intégration par `test/integration/topups/cash-*.spec.ts`.
import { tapBody } from '../../../support/media-fixtures';
import type { CaseContext, CaseFile, RouteCase } from './registry';

export const controllers: CaseFile['controllers'] = ['CashTopupController'];

export function cases(ctx: CaseContext): Record<string, RouteCase> {
  return {
    'POST /topups/cash': {
      server: 'api',
      counter: true,
      path: () => '/topups/cash',
      body: () => ({
        amount: 1000,
        currency: 'XOF',
        occurred_at: new Date().toISOString(),
        tap: tapBody(ctx.media, ctx.next()),
      }),
      idempotencyKey: (c, who) => c.seqKey(who),
    },
  };
}
