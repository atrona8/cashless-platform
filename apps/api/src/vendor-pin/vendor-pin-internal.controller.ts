// Routes internes du processus `vendor-pin` (mission 11a, lot WP06 ; FR-005, C-006). Appelées par
// l'API seule (client : WP07), authentifiées par la signature de `vendor-pin-call.guard.ts` ; hors
// contrat public (`openapi.yaml` inchangé). Chemins : `/v1/internal/vendor-pin/{open,hash}`.
//
// `open` : charge `{ vendorId, deviceId, operatorId, pin }` (aucun autre champ), en-tête
//   `X-Request-Id` repris dans l'audit.
//   200 `{ vendor_session_id, vendor_id, vendor_display_name, expires_at }` : session ouverte ;
//   403 `{ outcome: 'PIN_REFUSED' }` : un seul code et un seul corps pour toutes les causes ;
//   409 `{ outcome: 'CONCURRENT' }` : deux ouvertures simultanées du terminal (WP07 : 429) ;
//   401 (signature), 422 (charge ou PIN mal formé, sans écho, aucun essai compté), 5xx sans détail.
// `hash` : `{ pin }` → 200 `{ pin_hash }` ; 422 sans écho si le PIN n'a pas 6 chiffres.
import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PIN_PATTERN } from '../common/pin-pattern';
import { ProblemException } from '../errors/problem';
import { requestIdOf } from '../http/request-id.middleware';
import { Public } from '../identity/public.decorator';
import { VendorPinCallGuard } from './vendor-pin-call.guard';
import { VendorPinOpenService, type VendorPinOpenInput } from './vendor-pin-open.service';
import { VendorPinDigester } from './vendor-pin.digester';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unprocessable = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });

/** Corps objet dont les champs sont exactement `fields` ; jamais la valeur reçue dans l'erreur. */
function strictBody(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw unprocessable('Corps objet attendu.');
  const body = raw as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)))
    throw unprocessable('Champs du corps invalides.');
  return body;
}

function pinOf(body: Record<string, unknown>): string {
  const pin = body.pin;
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin))
    throw unprocessable('pin : exactement 6 chiffres attendus.');
  return pin;
}

function uuidOf(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !UUID.test(value))
    throw unprocessable(`${field} : UUID attendu.`);
  return value.toLowerCase();
}

@Controller('internal/vendor-pin')
export class VendorPinInternalController {
  constructor(
    private readonly opening: VendorPinOpenService,
    private readonly digester: VendorPinDigester,
  ) {}

  @Post('open')
  @Public()
  @UseGuards(VendorPinCallGuard)
  @HttpCode(200)
  async open(
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const body = strictBody(raw, ['vendorId', 'deviceId', 'operatorId', 'pin']);
    const input: VendorPinOpenInput = {
      vendorId: uuidOf(body, 'vendorId'),
      deviceId: uuidOf(body, 'deviceId'),
      operatorId: uuidOf(body, 'operatorId'),
      pin: pinOf(body),
      requestId: requestIdOf(req) || null,
    };
    const outcome = await this.opening.open(input);
    if (outcome.kind === 'opened') return { ...outcome.session };
    res.status(outcome.kind === 'concurrent' ? 409 : 403);
    return { outcome: outcome.kind === 'concurrent' ? 'CONCURRENT' : 'PIN_REFUSED' };
  }

  @Post('hash')
  @Public()
  @UseGuards(VendorPinCallGuard)
  @HttpCode(200)
  async hash(@Body() raw: unknown): Promise<{ pin_hash: string }> {
    const pin = pinOf(strictBody(raw, ['pin']));
    return { pin_hash: await this.digester.hash(pin) };
  }
}
