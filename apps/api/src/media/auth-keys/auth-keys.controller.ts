// `POST /media/auth-keys` (contrat, `x-process: tag-keys`) : route de terminal, servie par le processus des clés de
// bracelet et par lui seul. La réponse porte un mot de passe sous enveloppe : jamais conservée, jamais mise en cache.
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DeviceAuth } from '../../device-identity/device.guard';
import { requestDevice } from '../../device-identity/device-identity.port';
import { intField, invalid, objectBody } from '../../organization/platform/platform.dto';
import { AuthKeysService } from './auth-keys.service';

const UID = /^[0-9a-f]{14}$/;

@Controller('media/auth-keys')
export class AuthKeysController {
  constructor(private readonly authKeys: AuthKeysService) {}

  @Post()
  @HttpCode(200)
  @DeviceAuth()
  get(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() raw: unknown) {
    const body = objectBody(raw);
    if (typeof body.nfc_uid !== 'string' || !UID.test(body.nfc_uid)) throw invalid('nfc_uid : 14 chiffres hexadécimaux en minuscules attendus.');
    const keyIndex = intField(body, 'key_index', 0, 65535, 'required')!;
    res.setHeader('Cache-Control', 'no-store');
    return this.authKeys.get(requestDevice(req), Buffer.from(body.nfc_uid, 'hex'), keyIndex);
  }
}
