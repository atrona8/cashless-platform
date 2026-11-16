// Intégration (mission 9a, WP03, décision 14) : le titulaire reçoit de quoi construire son lien. De bout en bout, sans
// lecture en base : défi envoyé au faux, décision avec les valeurs reçues, code absent de toute réponse du demandeur.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeOtpSender, OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { TenantTx } from '../../../src/db/tenant-tx';
import { HolderChallengeService } from '../../../src/refunds/holder-challenge.service';
import { RefundsHolderModule } from '../../../src/refunds/refunds-holder.module';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import { createHolder, insertRequest } from './holder-fixtures';

describe('lien du titulaire (faux envoyeur, bout en bout)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let fake: FakeOtpSender;
  let tx: TenantTx;
  let challenges: HolderChallengeService;

  beforeAll(async () => {
    w = await createMediaWorld();
    app = await createTestApp({ identity: w.idp, imports: [RefundsHolderModule] });
    fake = app.get(OTP_SENDER, { strict: false }) as FakeOtpSender;
    tx = app.get(TenantTx, { strict: false });
    challenges = app.get(HolderChallengeService, { strict: false });
  });
  afterAll(async () => {
    await app.close();
  });

  const start = async () => {
    const holder = await withOwner((db) => createHolder(db, w));
    const req = await withOwner((db) => insertRequest(db, w, holder));
    await tx.run(w.ops.a, (client) =>
      challenges.startHolderChallenge(client, req.id, holder.phone),
    );
    const sent = fake.lastSent()!;
    return { holder, req, sent };
  };

  it.each([
    ['BLOCK', 'BLOCKED'],
    ['CONFIRM', 'REQUESTED'],
  ])('%s : décision avec les valeurs reçues par le faux', async (decision, status) => {
    const { holder, req, sent } = await start();
    expect(sent.phone).toBe(holder.phone);
    expect(sent.link?.refundRequestId).toBe(req.id);
    expect(sent.link?.otpRequestId).toMatch(/^otp_[0-9a-f-]{36}$/);
    const res = await request(app.getHttpServer())
      .post(`/v1/refund-requests/${sent.link!.refundRequestId}/holder-decision`)
      .send({ decision, otp_request_id: sent.link!.otpRequestId, code: sent.code });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(status);
  });

  it('le code du titulaire ne sort dans aucune réponse du demandeur ni en-tête de test', async () => {
    const { sent } = await start();
    // Aucune réponse n'est produite par startHolderChallenge ; les routes publiques ne rendent jamais le code.
    const res = await request(app.getHttpServer())
      .post(`/v1/refund-requests/${sent.link!.refundRequestId}/holder-decision`)
      .send({ decision: 'BLOCK', otp_request_id: sent.link!.otpRequestId, code: '000000' });
    expect(JSON.stringify([res.body, res.headers])).not.toContain(sent.code);
    expect(res.headers['x-test-otp-code']).toBeUndefined();
  });
});
