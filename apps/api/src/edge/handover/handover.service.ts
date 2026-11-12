// Accusé et rendu de l'autorité de débit (WP12, T052 et T053 ; FR-006, FR-008, FR-021). Chaque route passe par une
// enveloppe `edge_*` avec `p_gateway` = passerelle authentifiée (jamais une table, jamais une fonction S12 brute) ; la
// base décide de tout (idempotence de l'accusé, compte d'opérations par cycle, chaîne, continuité) : l'API ne recode
// aucune de ces règles.
//
// Rendu en DEUX transactions séparées (A05, R-08) : `begin_edge_release` (RELEASE_REQUESTED vers RELEASING) est validée
// AVANT `edge_complete_release`. Un refus de la seconde (opérations manquantes, chaîne, compte) annule la seconde
// seulement : le handover reste RELEASING, rejouable. Jamais les deux dans la même transaction.
//
// Erreurs : les SQLSTATE `CL013` (handover inconnu OU d'une autre passerelle, même message, même réponse), `CL014`,
// `CL015`, `CL017` sont traduits par la correspondance commune (`errors/sqlstate-map.ts`). Ici : `CL014` du rendu porte
// `missing_edge_seqs`, `CL017` lève l'alerte `EDGE_CHAIN_BROKEN` (journal : identifiants et compteurs, ni empreinte ni
// contenu), et `42501` (passerelle retirée ou révoquée entre la garde et l'appel) répond le même 401 que la garde.
import { Injectable, Logger } from '@nestjs/common';
import { ProblemException } from '../../errors/problem';
import type { EdgeGateway } from '../auth/edge-gateway';
import type { DebitAuthorityState } from '../control/debit-authority-reader';
import { EdgeTx } from '../edge-tx';
import { stateAfter, type HandoverRow } from './handover.mapper';

export interface AckInput {
  epoch: number;
  replicatedPostingId: number;
}

export interface ReleaseInput {
  epoch: number;
  finalEdgeSeq: number;
  lastChainHash: Buffer;
  operationsCount: number;
}

/** Nombre maximal de numéros listés dans `missing_edge_seqs` (la passerelle reprend la vidange puis recommence). */
export const MISSING_SEQS_MAX = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Numéros manquants annoncés par la base (« missing_edge_seqs=[a,b] ») : la plage a..b, bornée. */
export function missingSeqsOf(message: string | undefined): number[] | undefined {
  const match = /missing_edge_seqs=\[(\d+),(\d+)\]/.exec(message ?? '');
  if (!match) return undefined;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return undefined;
  const count = Math.min(last - first + 1, MISSING_SEQS_MAX);
  return Array.from({ length: count }, (_, index) => first + index);
}

const sqlstate = (error: unknown): string | undefined => (error as { code?: string })?.code;

@Injectable()
export class HandoverService {
  private readonly logger = new Logger('EdgeHandover');

  constructor(private readonly tx: EdgeTx) {}

  /** `ackEdgeHandover` : GRANTED vers ACTIVE ; un accusé répété à l'identique rend l'état courant sans écriture. */
  async ack(
    gateway: EdgeGateway,
    handoverId: string,
    input: AckInput,
  ): Promise<DebitAuthorityState> {
    this.assertKnownShape(handoverId);
    try {
      return await this.tx.run(gateway, async (client) => {
        const { rows } = await client.query<HandoverRow>(
          'SELECT * FROM edge_ack_handover($1, $2, $3, $4)',
          [gateway.gatewayId, handoverId, String(input.epoch), String(input.replicatedPostingId)],
        );
        return stateAfter(client, gateway, rows[0]!);
      });
    } catch (error) {
      throw this.translate(error, gateway, handoverId, 'ack');
    }
  }

  /** `releaseEdgeHandover` : RELEASING d'abord (commit propre), puis la vérification dans une seconde transaction. */
  async release(
    gateway: EdgeGateway,
    handoverId: string,
    input: ReleaseInput,
  ): Promise<DebitAuthorityState> {
    this.assertKnownShape(handoverId);
    const args = [
      gateway.gatewayId,
      handoverId,
      String(input.epoch),
      String(input.finalEdgeSeq),
      input.lastChainHash,
      String(input.operationsCount),
    ];
    try {
      // Temps 1 : validée (COMMIT) avant toute vérification, même si le temps 2 échoue.
      await this.tx.run(gateway, async (client) => {
        await client.query('SELECT * FROM begin_edge_release($1, $2, $3, $4, $5, $6)', args);
      });
      // Temps 2 : transaction distincte ; un refus l'annule sans effacer RELEASING.
      return await this.tx.run(gateway, async (client) => {
        const { rows } = await client.query<HandoverRow>(
          'SELECT * FROM edge_complete_release($1, $2, $3, $4, $5, $6)',
          args,
        );
        return stateAfter(client, gateway, rows[0]!);
      });
    } catch (error) {
      throw this.translate(error, gateway, handoverId, 'release');
    }
  }

  /** Un identifiant qui n'est pas un UUID ne désigne aucun handover : même réponse qu'un handover inconnu. */
  private assertKnownShape(handoverId: string): void {
    if (!UUID.test(handoverId)) throw new ProblemException('HANDOVER_INVALID_STATE');
  }

  private translate(
    error: unknown,
    gateway: EdgeGateway,
    handoverId: string,
    route: 'ack' | 'release',
  ): unknown {
    const code = sqlstate(error);
    if (code === '42501') return new ProblemException('UNAUTHENTICATED');
    if (route === 'release' && code === 'CL014') {
      const missing = missingSeqsOf((error as Error).message);
      return new ProblemException('EDGE_NOT_CAUGHT_UP', {
        ...(missing ? { extensions: { missing_edge_seqs: missing } } : {}),
      });
    }
    if (route === 'release' && code === 'CL017') {
      // Alerte (R-30) : examen manuel. Ni empreinte ni contenu d'opération dans le journal.
      this.logger.error(
        JSON.stringify({
          event: 'edge.alert',
          alert: 'EDGE_CHAIN_BROKEN',
          gateway_id: gateway.gatewayId,
          handover_id: handoverId,
        }),
      );
    }
    return error;
  }
}
