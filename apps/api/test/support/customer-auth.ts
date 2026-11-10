// Aides des tests de l'authentification des festivaliers : code public d'un prestataire, demande et échange de code
// sur l'application de test (adresse variée par `X-Forwarded-For`, application créée avec `trustProxyHops: 1`).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { withOwner } from './db';

/** Adresse distincte par appel : les limites par adresse ne se croisent pas d'un test à l'autre. */
export const freshIp = (): string =>
  `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

/** Numéro de test unique (E.164, 12 chiffres). */
export const freshPhone = (): string =>
  `+2217${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

export async function createPublicCode(operatorId: string): Promise<string> {
  const code = `t-${randomUUID().slice(0, 8)}`;
  await withOwner((db) =>
    db.query('INSERT INTO operator_public_code (operator_id, code) VALUES ($1, $2)', [
      operatorId,
      code,
    ]),
  );
  return code;
}

export const requestOtp = (
  app: INestApplication,
  body: Record<string, unknown>,
  ip: string = freshIp(),
) =>
  request(app.getHttpServer()).post('/v1/customer-auth/otp').set('X-Forwarded-For', ip).send(body);

export const exchange = (app: INestApplication, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/v1/customer-auth/token').send(body);

export const refresh = (app: INestApplication, refreshToken: string) =>
  request(app.getHttpServer())
    .post('/v1/customer-auth/refresh')
    .send({ refresh_token: refreshToken });

export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/** Parcours complet : demande, lecture du code (en-tête de test du faux envoyeur), échange. */
export async function login(
  app: INestApplication,
  input: { operatorCode: string; phone: string },
): Promise<Tokens> {
  const sent = await requestOtp(app, { phone: input.phone, operator_code: input.operatorCode });
  if (sent.status !== 202) throw new Error(`demande de code : ${sent.status}`);
  const done = await exchange(app, {
    otp_request_id: sent.body.otp_request_id,
    code: sent.headers['x-test-otp-code'],
  });
  if (done.status !== 200) throw new Error(`échange : ${done.status}`);
  return done.body as Tokens;
}

export const bearer = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});
