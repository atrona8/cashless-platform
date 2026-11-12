// Fournit `EDGE_CA`. Aujourd'hui : le faux (isFake = true), que `assertProcessIsSafe` refuse en production. Le refus
// n'est volontairement PAS dans cette fabrique : un seul garde-fou, celui de tous les ports, prouvé par un démarrage
// réel (retirer `EDGE_CA` de sa liste fait échouer le test). L'adaptateur réel remplacera ce fournisseur (mission 12b).
import { Module } from '@nestjs/common';
import { EDGE_CA } from '../edge-ca.port';
import { FakeEdgeCa } from './fake-edge-ca';

@Module({
  providers: [{ provide: EDGE_CA, useFactory: () => FakeEdgeCa.inMemory() }],
  exports: [EDGE_CA],
})
export class EdgeCaModule {}
