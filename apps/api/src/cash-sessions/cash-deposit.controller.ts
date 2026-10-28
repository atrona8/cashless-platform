// `POST /ledgers/{ledger_id}/cash-deposits/approval-requests` (`requestCashDeposit`, mission 6, lot WP08, T041) :
// crée la demande `CASH_DEPOSIT` (`202`), rien n'est écrit au grand livre ; une autre personne l'approuve par
// `approveApprovalRequest`. Modèle : `reversals.controller.ts` (chemin de la personne).
import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { objectBody, requireUuid, unprocessable } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import { BANK_REFERENCE_MAX, CASH_DEPOSIT_ROLES, CashDepositActions } from './cash-deposit-action';

@Controller('ledgers')
export class CashDepositController {
  constructor(
    private readonly access: TenantAccess,
    private readonly deposits: CashDepositActions,
  ) {}

  @Post(':ledger_id/cash-deposits/approval-requests')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:', keyUuid: true })
  request(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('ledger_id') ledgerId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    // Rôle tenu quelque part (403 sinon) ; le rôle sur l'événement du grand livre est contrôlé par la demande.
    const actor = this.access.actor(req, CASH_DEPOSIT_ROLES);
    const id = requireUuid(ledgerId);
    const input = parse(body);
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.deposits.request(
          client,
          actor.operatorId,
          { ledgerId: id, ...input },
          { principal: actor.principal, audit: actor.audit },
        ),
      ),
    );
  }
}

function parse(raw: unknown): { amount: number; bankReference: string } {
  let body: Record<string, unknown>;
  try {
    body = objectBody(raw);
  } catch {
    throw unprocessable('Corps JSON (objet) attendu.');
  }
  const foreign = Object.keys(body).filter((key) => key !== 'amount' && key !== 'bank_reference');
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  const { amount, bank_reference: reference } = body;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0)
    throw unprocessable('amount : entier strictement positif attendu.');
  if (
    typeof reference !== 'string' ||
    reference.trim() === '' ||
    reference.length > BANK_REFERENCE_MAX ||
    /[\r\n]/.test(reference)
  )
    throw unprocessable(
      `bank_reference : texte d’une ligne de 1 à ${BANK_REFERENCE_MAX} caractères.`,
    );
  return { amount, bankReference: reference.trim() };
}
