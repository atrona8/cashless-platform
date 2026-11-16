// Restitution (`POST /media/{id}/release`, contrat `releaseMedia`) et remise en stock d'un bracelet rendu d'un lot
// réattribuable (`POST /media/{id}/reassignment`, `reassignPoolMedia`) : routes de guichet (terminal ET personne),
// idempotentes par terminal. La lecture du bracelet est facultative à la restitution ; présentée, elle doit être celle
// de CE bracelet. `refund_deposit_by` et `settle_balance` enchaînent le guichet de retour (SPECIFICATION §7.9) dans la
// transaction de l'appel. Le jeton d'approbation sur place n'est exigé qu'au-delà du maximum de l'événement : la garde
// vérifie un jeton présenté, le service décide s'il le faut et le consomme dans la transaction.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  consumeOnsiteApproval,
  RequiresOnsiteApproval,
  type OnsiteRequest,
} from '../../approval/onsite/onsite-approval';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { requestDevice } from '../../device-identity/device-identity.port';
import { pickLanguage } from '../../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import {
  intField,
  invalid,
  objectBody,
  requireUuid,
} from '../../organization/platform/platform.dto';
import { parseTap, type TapInput } from '../taps/taps.dto';
import { TapService } from '../taps/tap.service';
import { CounterAccess, CounterAuth, counterScope, requireCashSession } from './counter-access';
import { counterRefusal, parseCashSessionId, payment, type Payment } from './lifecycle.dto';
import { ReleaseService, type ReleaseChain } from './release.service';

const HEX32 = /^[0-9a-f]{64}$/;

/** `CashMovement` du contrat : seul le moyen `CASH` existe. */
function cashMovement(raw: unknown, name: string): Payment | null {
  const parsed = payment(raw, name);
  if (parsed !== null && parsed.method !== 'CASH')
    throw invalid(`${name}.method : seul CASH est accepté.`);
  return parsed;
}

@Controller('media/:media_id')
export class ReleaseController {
  constructor(
    private readonly counter: CounterAccess,
    private readonly releases: ReleaseService,
    private readonly taps: TapService,
    private readonly audit: AuditService,
  ) {}

  @Post('release')
  @HttpCode(200)
  // Garde du jeton après celle du terminal (décorateurs appliqués de bas en haut) : portée = événement du terminal.
  @RequiresOnsiteApproval({
    operationId: 'releaseMedia',
    role: 'SUPERVISOR',
    optional: true,
    scope: (req) => ({ type: 'EVENT', id: requestDevice(req).eventId ?? '' }),
  })
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  async release(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() raw: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const id = requireUuid(mediaId);
    const language = pickLanguage(req.header('Accept-Language'));
    const body = raw === undefined || raw === null || raw === '' ? {} : objectBody(raw);
    const settleBalance = cashMovement(body.settle_balance, 'settle_balance');
    const refundDepositBy = cashMovement(body.refund_deposit_by, 'refund_deposit_by');
    const tapId = intField(body, 'tap_id', 0, Number.MAX_SAFE_INTEGER, 'optional') ?? null;
    const tap: TapInput | null =
      body.tap === undefined || body.tap === null ? null : parseTap(body.tap);
    const cashSessionId = parseCashSessionId(body);
    const chain: ReleaseChain | null =
      settleBalance === null && refundDepositBy === null
        ? null
        : {
            settleBalance,
            refundDepositBy,
            approve: (req as OnsiteRequest).onsiteApproval
              ? (client: TxClient) => consumeOnsiteApproval(client, req, this.audit)
              : null,
            cashSessionId,
          };
    try {
      return await tx.run(async (client) => {
        const actor = await this.counter.authorize(client, req);
        // Session indiquée : validée (session ouverte du terminal) et renvoyée ; sans enchaînement, aucune espèce écrite.
        if (cashSessionId !== null) requireCashSession(actor, language, cashSessionId);
        const presented = tap
          ? await this.taps.registerOrRefuse(client, actor.device, tap)
          : tapId !== null
            ? await this.taps.byId(client, actor.device, tapId)
            : null;
        if (presented && presented.mediaId !== id)
          throw counterRefusal('return.wrong_media', language);
        const done = await this.releases.release(client, actor, id, language, chain);
        return cashSessionId === null ? done : { ...done, cash_session_id: cashSessionId };
      });
    } catch (error) {
      return this.taps.settleRefusal(error, requestDevice(req), tap);
    }
  }

  @Post('reassignment')
  @HttpCode(200)
  @CounterAuth()
  @Idempotent({ scope: counterScope })
  reassign(
    @Req() req: Request,
    @Param('media_id') mediaId: string,
    @Body() raw: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const id = requireUuid(mediaId);
    const language = pickLanguage(req.header('Accept-Language'));
    const body = objectBody(raw);
    const unknown = Object.keys(body).filter((key) => key !== 'new_token_hash');
    if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
    if (typeof body.new_token_hash !== 'string' || !HEX32.test(body.new_token_hash))
      throw invalid('new_token_hash : 64 chiffres hexadécimaux en minuscules attendus.');
    const newTokenHash = Buffer.from(body.new_token_hash, 'hex');
    return tx.run(async (client) =>
      this.releases.reassign(
        client,
        await this.counter.authorize(client, req),
        id,
        newTokenHash,
        language,
      ),
    );
  }
}
