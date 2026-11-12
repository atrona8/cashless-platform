// Routes publiques de l'authentification des festivaliers (contrat `requestCustomerOtp`, `exchangeCustomerOtp`,
// `refreshCustomerToken`) : sans jeton, le compte se prouve par le code reçu sur le numéro.
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../identity/public.decorator';
import { parseOtpExchange, parseOtpRequest, parseRefresh } from './customer-auth.dto';
import { CustomerAuthService } from './customer-auth.service';
import { TEST_OTP_CODE_HEADER } from './otp-sender';

@Controller('customer-auth')
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Post('otp')
  @HttpCode(202)
  @Public()
  async requestOtp(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const input = parseOtpRequest(body);
    // `req.ip` : adresse du client grâce au réglage `trust proxy` (OP-N53) ; l'en-tête brut n'est jamais lu ici.
    const { code, ...accepted } = await this.auth.requestOtp(input, req.ip ?? 'inconnue');
    // Écart accepté par le porteur (ADR-180, OP-N120) : seul le FAUX envoyeur, interdit en production, rend le code.
    if (this.auth.senderIsFake) res.setHeader(TEST_OTP_CODE_HEADER, code);
    return accepted;
  }

  @Post('token')
  @HttpCode(200)
  @Public()
  exchange(@Body() body: unknown) {
    return this.auth.exchange(parseOtpExchange(body));
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parseRefresh(body).refreshToken);
  }
}
