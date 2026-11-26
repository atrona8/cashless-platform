// Cas d'isolement de `listEventSales` et `getSale` (WP06) : le personnel de B ne lit ni la liste ni le détail des
// ventes de l'événement de A (403 ou 404), et aucun identifiant de A (vente, commerçant, point de vente, vendeur,
// terminal) n'apparaît dans la réponse.
import { withOwner } from '../../../support/db';
import { seedSales } from '../../backoffice/sales-seed';
import type { BackofficeFixture, BackofficeIsolationCase } from './registry';

async function prepare(fx: BackofficeFixture): Promise<void> {
  if (fx.data.saleId) return;
  const sales = await withOwner((db) => seedSales(db, fx.w, { count: 12, rich: true }));
  fx.data.saleId = sales.sales[0]!;
  fx.secrets.push(
    ...sales.sales,
    sales.reversalId,
    ...sales.merchants,
    ...sales.pos,
    ...sales.vendors,
    ...sales.devices,
  );
}

export const cases: BackofficeIsolationCase[] = [
  {
    // Un seul cas par opération (registre) : le filtre `status=REVERSED` exerce le chemin rapide des annulées
    // (`reversedQuery`) ; la graine contient une vente annulée de A. La portée et la RLS du chemin général sont
    // les mêmes (`sales.spec.ts` couvre la liste sans filtre).
    operationId: 'listEventSales',
    method: 'GET',
    path: (fx) => `/events/${fx.w.ids.eventA}/sales?status=REVERSED`,
    prepare,
  },
  {
    operationId: 'getSale',
    method: 'GET',
    path: (fx) => `/sales/${fx.data.saleId}`,
    prepare,
  },
];
