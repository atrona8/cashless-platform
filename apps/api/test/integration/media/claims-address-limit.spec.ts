// Intégration : limite de la consultation anonyme par adresse (contrat `lookupBalanceByClaimCode` :
// 60 par adresse IP et par heure ; OP-N53). L'adresse est `req.ip`, réglée par `trust proxy` borné à
// `TRUST_PROXY_HOPS` (processes/bootstrap.ts). Ici, un répartiteur de confiance (1 saut) : l'adresse
// du client est le dernier élément de `X-Forwarded-For`, ce qu'il ajoute plus à gauche n'est pas lu.
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { generateClaimCode } from '@cashless/tag-format';
import request from 'supertest';
import { createTestApp } from '../../support/app';

describe('consultation anonyme : limite par adresse derrière un répartiteur de confiance', () => {
  let app: INestApplication;
  // Adresses propres à cette exécution (plage de test 198.18.0.0/15) : aucune ligne d'un autre test.
  const run = randomBytes(2);
  const address = (n: number) => `198.${18 + (run[0]! % 2)}.${run[1]!}.${n}`;
  const lookup = (forwardedFor: string) =>
    request(app.getHttpServer())
      .post('/v1/public/balance-lookups')
      .set('X-Forwarded-For', forwardedFor)
      .send({ claim_code: generateClaimCode(randomBytes) });

  beforeAll(async () => {
    app = await createTestApp({ trustProxyHops: 1 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('61ᵉ consultation de la même adresse dans l’heure : 429 ; une autre adresse est comptée à part ; un X-Forwarded-For falsifié ne contourne pas la limite', async () => {
    const a = address(1);
    const b = address(2);
    // Codes tous différents : la limite par code (20 par heure) n'entre pas en jeu.
    for (let i = 0; i < 60; i += 1) expect((await lookup(a)).status).toBe(404);
    const blocked = await lookup(a);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('3600');

    // Deux adresses transmises par le répartiteur de confiance : comptées séparément.
    expect((await lookup(b)).status).toBe(404);

    // Adresses inventées par le client à gauche de celle que le répartiteur a ajoutée : ignorées.
    for (const spoofed of [`${address(3)}, ${a}`, `${b}, ${address(4)}, ${a}`, `unknown, ${a}`])
      expect((await lookup(spoofed)).status).toBe(429);
  });

  it('réglage Express : 0 (défaut hors production) ne fait confiance à aucun saut ; 1 à un seul', async () => {
    type Express = { get(name: string): (address: string, hop: number) => boolean };
    const trustFn = (a: INestApplication) =>
      (a.getHttpAdapter().getInstance() as Express).get('trust proxy fn');
    const direct = await createTestApp();
    try {
      expect(trustFn(direct)('127.0.0.1', 0)).toBe(false);
    } finally {
      await direct.close();
    }
    expect(trustFn(app)('127.0.0.1', 0)).toBe(true);
    expect(trustFn(app)('127.0.0.1', 1)).toBe(false);
  });
});
