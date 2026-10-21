// `POST /v1/device-enrollments` (openapi.yaml : enrollDevice, `security: []`) : route sans
// compte ni certificat. L'adresse retenue pour les limites et l'audit est `req.ip`, celle de la
// connexion en production (TRUST_PROXY_HOPS = 0 exigé avec TLS, OP-N53) ; `X-Forwarded-For` n'y
// est pas lu.
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../../audit/audit-context';
import { Public } from '../../identity/public.decorator';
import { EnrollmentService } from './enrollment.service';

@Controller('device-enrollments')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Post()
  @HttpCode(201)
  @Public()
  enroll(@Req() req: Request, @Body() body: unknown) {
    const address = req.ip ?? req.socket.remoteAddress;
    if (!address) throw new Error('Enrôlement : adresse de connexion inconnue');
    return this.enrollment.enroll(body, auditContext(req), address);
  }
}
