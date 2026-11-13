// `POST /edge/handovers/{handover_id}/ack` et `/release` (ackEdgeHandover, releaseEdgeHandover ; garde `edgeMtls`).
// Corps validé ici (forme seulement) : entier 64 bits sûr et positif, `Hex32` en minuscules. Un corps invalide répond
// `422 VALIDATION_FAILED`, comme ailleurs dans l'API (le contrat ne déclare pas de `400` ni de `422` ici, écart 3 de
// edge-routes.md). La passerelle est toujours celle de la garde : le corps ne porte aucune identité.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemException } from '../../errors/problem';
import { edgeGatewayOf } from '../auth/edge-gateway';
import { EdgeAuth } from '../auth/edge-mtls.guard';
import type { DebitAuthorityState } from '../control/debit-authority-reader';
import { HandoverService } from './handover.service';

const HEX32 = /^[0-9a-f]{64}$/;

function invalid(detail: string): ProblemException {
  return new ProblemException('VALIDATION_FAILED', { status: 422, detail });
}

function record(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw invalid('Corps JSON (objet) attendu.');
  return body as Record<string, unknown>;
}

/** Entier 64 bits du contrat, positif ou nul, représentable sans perte. */
function int64(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalid(`${field} : entier positif ou nul attendu.`);
  return value;
}

export function parseAckBody(body: unknown): { epoch: number; replicatedPostingId: number } {
  const input = record(body);
  return {
    epoch: int64(input, 'epoch'),
    replicatedPostingId: int64(input, 'replicated_posting_id'),
  };
}

export function parseReleaseBody(body: unknown): {
  epoch: number;
  finalEdgeSeq: number;
  lastChainHash: Buffer;
  operationsCount: number;
} {
  const input = record(body);
  const hash = input.last_chain_hash;
  if (typeof hash !== 'string' || !HEX32.test(hash))
    throw invalid('last_chain_hash : 32 octets en hexadécimal minuscule attendus.');
  return {
    epoch: int64(input, 'epoch'),
    finalEdgeSeq: int64(input, 'final_edge_seq'),
    lastChainHash: Buffer.from(hash, 'hex'),
    operationsCount: int64(input, 'operations_count'),
  };
}

@Controller('edge/handovers')
export class HandoverController {
  constructor(private readonly service: HandoverService) {}

  @Post(':handover_id/ack')
  @HttpCode(200)
  @EdgeAuth()
  ack(
    @Req() req: Request,
    @Param('handover_id') handoverId: string,
    @Body() body: unknown,
  ): Promise<DebitAuthorityState> {
    return this.service.ack(edgeGatewayOf(req), handoverId, parseAckBody(body));
  }

  @Post(':handover_id/release')
  @HttpCode(200)
  @EdgeAuth()
  release(
    @Req() req: Request,
    @Param('handover_id') handoverId: string,
    @Body() body: unknown,
  ): Promise<DebitAuthorityState> {
    return this.service.release(edgeGatewayOf(req), handoverId, parseReleaseBody(body));
  }
}
