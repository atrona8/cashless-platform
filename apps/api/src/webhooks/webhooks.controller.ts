// Route publique des notifications de PSP (mission 6, lot WP12, T060 ; `receivePspWebhook`). Aucune identité de
// personne ni de terminal : l'authentification EST la signature du corps brut, vérifiée par WebhookIntake avant toute
// lecture d'un champ du corps. Pas d'`@Idempotent` : l'idempotence est celle de l'événement (config, id du PSP).
import { Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../identity/public.decorator';
import { WebhookIntake, type ReceiveResult } from './webhook-intake.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly intake: WebhookIntake) {}

  @Public()
  @Post(':provider/:psp_config_id')
  @HttpCode(200)
  receive(
    @Param('provider') provider: string,
    @Param('psp_config_id') configId: string,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReceiveResult> {
    return this.intake.receive({
      providerSegment: provider,
      configId,
      rawBody: req.rawBody,
      headers: req.headers,
      ip: req.ip,
      // La relecture d'un signal part quand la réponse est écrite (`finish`) ou quand la connexion est coupée avant
      // (`close`), jamais avant, et une seule fois (`close` suit aussi `finish`).
      afterResponse: (task) => runOnceAfterResponse(res, task),
    });
  }
}

/** Exécute `task` une seule fois, à `finish` ou à `close` de la réponse, selon le premier des deux. */
export function runOnceAfterResponse(res: Pick<Response, 'once'>, task: () => void): void {
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    task();
  };
  res.once('finish', run);
  res.once('close', run);
}
