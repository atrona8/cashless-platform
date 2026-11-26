// Cas d'isolement de `listAnomalies` et `classifyAnomaly` (WP07). Le balayage appelle ces routes avec le personnel
// de B sur l'anomalie de A : refus ou liste sans donnée de A, et rien de modifié chez A.
import { randomUUID } from 'node:crypto';
import { ownerRows } from '../../../support/media-fixtures';
import type { BackofficeFixture, BackofficeIsolationCase } from './registry';

/** Anomalie d'un type classable sur le grand livre de A ; son identifiant et son événement sont des secrets de A. */
async function prepare(fx: BackofficeFixture): Promise<void> {
  if (fx.data.anomalyA) return;
  const id = randomUUID();
  await ownerRows(
    `INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount) VALUES ($1, $2, $3, 'CASH_DIFF', 4242)`,
    [id, fx.w.ops.a, fx.w.ids.ledgerA],
  );
  fx.data.anomalyA = id;
  fx.secrets.push(id, fx.w.ids.eventA);
}

export const cases: BackofficeIsolationCase[] = [
  {
    operationId: 'listAnomalies',
    method: 'GET',
    path: () => '/anomalies?limit=200',
    prepare,
    selfScoped: true,
    note: 'Liste du prestataire de la personne : 200 sans aucune anomalie de A (identifiant, événement) pour B.',
  },
  {
    operationId: 'classifyAnomaly',
    method: 'POST',
    path: (fx) => `/anomalies/${fx.data.anomalyA}/classification`,
    body: () => ({ reason: 'Tentative depuis un autre prestataire' }),
    prepare,
    note: 'Anomalie de A classée par B : 404, et l’anomalie de A reste ouverte.',
  },
];
