// Routes de terminal des sessions de vendeur (mission 5b, lot WP09, T040 à T042) :
// `listTerminalVendors`, `openVendorSession`, `closeVendorSession`. Trois preuves du terminal
// (`@DeviceAuth()`, terminal ACTIVE) ; prestataire de la transaction : celui du terminal.
// Ouverture et fermeture : clé d'idempotence UUID (portée `device:<device_id>:`), réponse jamais
// conservée (`transient`) : un renvoi de la même clé reçoit `409 CONFLICT_STATE` et n'est pas un
// nouvel essai ; un refus (4xx) est enregistré et rejoué tel quel, sans nouveau comptage, sauf le `429` d'un
// essai simultané (clé relâchée). Le PIN n'entre dans l'empreinte que sous un dérivé argon2 (ADR-126).
import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DeviceAuth } from '../device-identity/device.guard';
import { assertDeviceMode, requestDevice } from '../device-identity/device-identity.port';
import { deviceScope } from '../idempotency/device-key';
import { RequestLock } from '../idempotency/request-lock';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { PIN_ATTEMPT_REQUEST_LOCK } from './pin-attempt-lock';
import { deviceAudit, VendorSessionsService } from './vendor-sessions.service';
import { parseVendorSessionOpen } from './vendors.dto';

/** Modes qui vendent sous une session de vendeur (contrat `openVendorSession`). */
export const SESSION_MODES = ['CATALOG_POS', 'KEYPAD_TPE'] as const;

@Controller('vendor-sessions')
export class VendorSessionsController {
  constructor(private readonly sessions: VendorSessionsService) {}

  @Get('vendors')
  @DeviceAuth()
  vendors(@Req() req: Request) {
    return this.sessions.listForTerminal(requestDevice(req));
  }

  @Post()
  @DeviceAuth()
  // Un essai de PIN à la fois par terminal : verrou pris AVANT l'idempotence (donc avant l'argon2 de
  // l'empreinte) et tenu jusqu'à la fin de la requête (ADR-126, cycle 3).
  @RequestLock(PIN_ATTEMPT_REQUEST_LOCK)
  @Idempotent({
    scope: deviceScope,
    transient: true,
    keyUuid: true,
    pinFields: ['pin'],
    nonFinal: ['RATE_LIMITED'],
  })
  open(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const device = requestDevice(req);
    // Contrôles avant toute écriture : mode, puis corps (PIN mal formé : 422 sans écho).
    assertDeviceMode(device, SESSION_MODES);
    const input = parseVendorSessionOpen(body);
    return this.sessions.open(device, input, tx, deviceAudit(req, device));
  }

  @Delete('current')
  @HttpCode(204)
  @DeviceAuth()
  @Idempotent({ scope: deviceScope, transient: true, keyUuid: true })
  async close(@Req() req: Request, @IdempotentTransaction() tx: IdempotentTx): Promise<void> {
    const device = requestDevice(req);
    await this.sessions.close(device, tx, deviceAudit(req, device));
  }
}
