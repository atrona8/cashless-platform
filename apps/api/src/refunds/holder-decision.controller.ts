// `decideRefundRequestAsHolder` (contrat, ADR-76) : route PUBLIQUE, le titulaire se prouve par le code reçu sur son
// numéro vérifié. Le contrôleur reste mince : l'ordre des contrôles est dans `HolderChallengeService.decide`.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../audit/audit-context';
import { ProblemException } from '../errors/problem';
import { Public } from '../identity/public.decorator';
import { HolderChallengeService, type HolderDecision } from './holder-challenge.service';

const invalid = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });
const CODE = /^[0-9]{6}$/;

export function parseHolderDecision(raw: unknown): {
  decision: HolderDecision;
  otpRequestId: string;
  code: string;
} {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw invalid('Corps JSON attendu.');
  const unknown = Object.keys(raw).filter(
    (key) => !['decision', 'otp_request_id', 'code'].includes(key),
  );
  if (unknown.length > 0) throw invalid(`${unknown.join(', ')} : champ inconnu.`);
  const value = raw as Record<string, unknown>;
  if (value.decision !== 'CONFIRM' && value.decision !== 'BLOCK')
    throw invalid('decision : CONFIRM ou BLOCK attendu.');
  const id = value.otp_request_id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64)
    throw invalid('otp_request_id : texte de 1 à 64 caractères attendu.');
  if (typeof value.code !== 'string' || !CODE.test(value.code))
    throw invalid('code : 6 chiffres attendus.');
  return { decision: value.decision, otpRequestId: id, code: value.code };
}

@Controller('refund-requests')
export class HolderDecisionController {
  constructor(private readonly holder: HolderChallengeService) {}

  @Post(':refund_request_id/holder-decision')
  @HttpCode(200)
  @Public()
  decide(
    @Req() req: Request,
    @Param('refund_request_id') refundRequestId: string,
    @Body() body: unknown,
  ) {
    return this.holder.decide(refundRequestId, parseHolderDecision(body), auditContext(req));
  }
}
