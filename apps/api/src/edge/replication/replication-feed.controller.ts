// `GET /edge/replication-feed?after_posting_id=&limit=&after_change_seq=` (getEdgeReplicationFeed ; garde `edgeMtls`).
// `after_posting_id` requis (entier >= 0), `limit` de 1 à 200 (50 par défaut, `components/parameters/Limit`),
// `after_change_seq` facultatif (entier >= 0 ; absent : pas de bloc `reference`, présent y compris 0 : bloc servi).
// Hors bornes : `422 VALIDATION_FAILED`. Aucun cache : une page identique pour une même requête est normale.
import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemException } from '../../errors/problem';
import { edgeGatewayOf } from '../auth/edge-gateway';
import { EdgeAuth } from '../auth/edge-mtls.guard';
import {
  ReplicationFeedService,
  type FeedQuery,
  type ReplicationPage,
} from './replication-feed.service';

export const DEFAULT_LIMIT = 50;

function invalid(detail: string): ProblemException {
  return new ProblemException('VALIDATION_FAILED', { status: 422, detail });
}

function count(raw: unknown, name: string): number {
  if (typeof raw !== 'string' || !/^[0-9]{1,15}$/.test(raw))
    throw invalid(`${name} : entier positif ou nul attendu.`);
  return Number(raw);
}

export function parseFeedQuery(query: Record<string, unknown>): FeedQuery {
  if (query.after_posting_id === undefined) throw invalid('after_posting_id : paramètre requis.');
  const afterPostingId = count(query.after_posting_id, 'after_posting_id');
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    limit = count(query.limit, 'limit');
    if (limit < 1 || limit > 200) throw invalid('limit : entier de 1 à 200 attendu.');
  }
  const afterChangeSeq =
    query.after_change_seq === undefined ? null : count(query.after_change_seq, 'after_change_seq');
  return { afterPostingId, limit, afterChangeSeq };
}

@Controller('edge')
export class ReplicationFeedController {
  constructor(private readonly service: ReplicationFeedService) {}

  @Get('replication-feed')
  @EdgeAuth()
  @Header('Cache-Control', 'no-store')
  feed(@Req() req: Request, @Query() query: Record<string, unknown>): Promise<ReplicationPage> {
    return this.service.page(edgeGatewayOf(req), parseFeedQuery(query));
  }
}
