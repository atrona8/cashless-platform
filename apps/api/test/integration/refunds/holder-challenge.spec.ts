// Intégration (mission 9a, WP03 ; FR-011, FR-012) : `resolveDestination` (matrice) et `startHolderChallenge`.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { CustomerAuthService } from '../../../src/customer-auth/customer-auth.service';
import { OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { TenantTx } from '../../../src/db/tenant-tx';
import { resolveDestination } from '../../../src/refunds/destination';
import { HolderChallengeService } from '../../../src/refunds/holder-challenge.service';
import { RefundsHolderModule } from '../../../src/refunds/refunds-holder.module';
import { createTestApp } from '../../support/app';
import { createPublicCode, freshPhone, requestOtp } from '../../support/customer-auth';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import { createHolder, insertRequest, RecordingSender, type Holder } from './holder-fixtures';

describe('destination du remboursement et code du titulaire', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let auth: CustomerAuthService;
  let tx: TenantTx;
  let challenges: HolderChallengeService;
  let holder: Holder;
  let stranger: Holder; // festivalier sans numéro vérifié
  const sender = new RecordingSender();
  let codeA: string;
  let codeB: string;

  beforeAll(async () => {
    w = await createMediaWorld();
    codeA = await createPublicCode(w.ops.a);
    codeB = await createPublicCode(w.ops.b);
    app = await createTestApp({
      identity: w.idp,
      trustProxyHops: 1,
      imports: [RefundsHolderModule],
      overrides: [{ provide: OTP_SENDER, useValue: sender }],
    });
    auth = app.get(CustomerAuthService, { strict: false });
    tx = app.get(TenantTx, { strict: false });
    challenges = app.get(HolderChallengeService, { strict: false });
    await withOwner(async (db) => {
      holder = await createHolder(db, w);
      stranger = await createHolder(db, w);
      await db.query('DELETE FROM customer_identity WHERE customer_id = $1', [stranger.customerId]);
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const verify: CustomerAuthService['verifyChallenge'] = (input) => auth.verifyChallenge(input);
  const resolve = (
    who: Holder,
    destination: Parameters<typeof resolveDestination>[1]['destination'],
  ) =>
    tx.run(w.ops.a, (client) =>
      resolveDestination(
        client,
        { operatorId: w.ops.a, walletId: randomUUID(), customerId: who.customerId, destination },
        verify,
      ),
    );
  const newCode = async (phone: string, operatorCode = codeA) => {
    const res = await requestOtp(app, { phone, operator_code: operatorCode });
    expect(res.status).toBe(202);
    return { otp_request_id: res.body.otp_request_id as string, code: sender.lastCode(phone) };
  };
  const notAllowed = { code: 'REFUND_NOT_ALLOWED' };
  const invalid = { code: 'OTP_INVALID', status: 422 };
  const consumed = async (id: string) =>
    (
      await rows<{ consumed_at: Date | null }>(
        'SELECT consumed_at FROM otp_challenge WHERE id = $1',
        [id.slice(4)],
      )
    )[0]!.consumed_at;

  it('virement bancaire : refusé avant toute lecture', async () => {
    await expect(
      resolve(holder, { method: 'BANK_TRANSFER', iban: 'SN08SN0100152000048500003035' }),
    ).rejects.toMatchObject(notAllowed);
  });

  it('numéro du titulaire, ou aucun numéro : pas de code ; un code joint est ignoré, non consommé', async () => {
    await expect(resolve(holder, { method: 'WAVE' })).resolves.toEqual({
      method: 'WAVE',
      msisdn: holder.phone,
      newNumber: false,
      holderPhone: holder.phone,
    });
    const joined = await newCode(freshPhone());
    const res = await resolve(holder, {
      method: 'ORANGE_MONEY',
      msisdn: holder.phone,
      new_number_otp: joined,
    });
    expect(res.newNumber).toBe(false);
    expect(await consumed(joined.otp_request_id)).toBeNull();
  });

  it('autre numéro : sans code refusé ; avec le bon code accepté et consommé, une seule fois', async () => {
    const phone = freshPhone();
    await expect(resolve(holder, { method: 'WAVE', msisdn: phone })).rejects.toMatchObject(
      notAllowed,
    );
    const otp = await newCode(phone);
    await expect(
      resolve(holder, { method: 'WAVE', msisdn: phone, new_number_otp: otp }),
    ).resolves.toEqual({
      method: 'WAVE',
      msisdn: phone,
      newNumber: true,
      holderPhone: holder.phone,
    });
    expect(await consumed(otp.otp_request_id)).not.toBeNull();
    // Code déjà consommé : refusé, et ne sert pas une seconde création.
    await expect(
      resolve(holder, { method: 'WAVE', msisdn: phone, new_number_otp: otp }),
    ).rejects.toMatchObject(invalid);
  });

  it('code d’un autre numéro, d’un autre prestataire ou d’un titulaire : 422 OTP_INVALID', async () => {
    const phone = freshPhone();
    const forOther = await newCode(freshPhone());
    await expect(
      resolve(holder, { method: 'WAVE', msisdn: phone, new_number_otp: forOther }),
    ).rejects.toMatchObject(invalid);
    const otherOperator = await newCode(phone, codeB);
    await expect(
      resolve(holder, { method: 'WAVE', msisdn: phone, new_number_otp: otherOperator }),
    ).rejects.toMatchObject(invalid);
    const h = await auth.issueChallenge({
      operatorId: w.ops.a,
      phone,
      purpose: 'REFUND_HOLDER',
      subjectId: randomUUID(),
    });
    await expect(
      resolve(holder, {
        method: 'WAVE',
        msisdn: phone,
        new_number_otp: { otp_request_id: h.otpRequestId, code: h.code },
      }),
    ).rejects.toMatchObject(invalid);
    // Le code du bon numéro n'a pas été brûlé par ces refus (aucun essai compté).
    expect(await consumed(forOther.otp_request_id)).toBeNull();
  });

  it('festivalier sans numéro vérifié : numéro obligatoire et code obligatoire', async () => {
    await expect(resolve(stranger, { method: 'WAVE' })).rejects.toMatchObject(notAllowed);
    const phone = freshPhone();
    await expect(resolve(stranger, { method: 'WAVE', msisdn: phone })).rejects.toMatchObject(
      notAllowed,
    );
    const otp = await newCode(phone);
    await expect(
      resolve(stranger, { method: 'WAVE', msisdn: phone, new_number_otp: otp }),
    ).resolves.toMatchObject({ newNumber: true, holderPhone: null });
  });

  it('startHolderChallenge : code envoyé au numéro du titulaire, défi lié à la demande', async () => {
    const h = await withOwner((db) => createHolder(db, w));
    const req = await withOwner((db) => insertRequest(db, w, h));
    const before = sender.count(h.phone);
    await tx.run(w.ops.a, (client) => challenges.startHolderChallenge(client, req.id, h.phone));
    expect(sender.count(h.phone)).toBe(before + 1);
    const sent = sender.sent[sender.sent.length - 1]!;
    expect(sent).toMatchObject({ phone: h.phone, channel: 'AUTO' });
    expect(sent.code).toMatch(/^[0-9]{6}$/);
    const row = await rows<{ purpose: string; subject_id: string; operator_id: string }>(
      'SELECT purpose, subject_id, operator_id FROM otp_challenge WHERE phone = $1',
      [h.phone],
    );
    expect(row).toEqual([{ purpose: 'REFUND_HOLDER', subject_id: req.id, operator_id: w.ops.a }]);
  });
});
