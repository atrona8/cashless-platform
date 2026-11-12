// Point d'entrée du processus « edge » : `/edge/*` et la lecture `edgeMtls` de `GET /ledgers/{id}/debit-authority`
// (mission passerelle-locale, WP10). Rôle de base cashless_edge, autorité des passerelles propre.
import 'reflect-metadata';
import { requireEdgeListenPort } from './edge/edge-listen-port';
import { serve } from './processes/bootstrap';
import { EdgeProcessModule } from './processes/edge.module';

void serve(EdgeProcessModule, requireEdgeListenPort(), { listener: 'edge' });
