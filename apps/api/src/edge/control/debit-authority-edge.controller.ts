// `GET /ledgers/{ledger_id}/debit-authority` en `edgeMtls` (getDebitAuthority côté passerelle, interfaces.md § 3,
// § 12.6). Lit uniquement le grand livre de la passerelle appelante : tout autre `ledger_id`, inconnu ou étranger,
// répond le même `404`. La lecture `humanBearer` du même chemin est dans l'API publique (WP11).
import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemException } from '../../errors/problem';
import { assertOwnGateway, edgeGatewayOf } from '../auth/edge-gateway';
import { EdgeAuth } from '../auth/edge-mtls.guard';
import { EdgeTx } from '../edge-tx';
import { DebitAuthorityReader, type DebitAuthorityState } from './debit-authority-reader';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('ledgers')
export class DebitAuthorityEdgeController {
  constructor(
    private readonly tx: EdgeTx,
    private readonly reader: DebitAuthorityReader,
  ) {}

  @Get(':ledger_id/debit-authority')
  @EdgeAuth()
  async get(
    @Req() req: Request,
    @Param('ledger_id') ledgerId: string,
  ): Promise<DebitAuthorityState> {
    const gateway = edgeGatewayOf(req);
    const notFound = (): ProblemException => new ProblemException('NOT_FOUND');
    if (!UUID.test(ledgerId)) throw notFound();
    assertOwnGateway(req, { ledgerId }, notFound);
    const observed = await this.tx.run(gateway, (client) =>
      this.reader.readIn(client, gateway, gateway.ledgerId),
    );
    return observed.state;
  }
}
