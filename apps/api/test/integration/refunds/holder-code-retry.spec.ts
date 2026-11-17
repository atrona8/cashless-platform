// Intégration (mission 9b, WP11 ; FR-019, OP-N124) : le code du titulaire n'est consommé que par la décision écrite.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { RefundsHolderModule } from '../../../src/refunds/refunds-holder.module';
import { CustomerAuthService } from '../../../src/customer-auth/customer-auth.service';
import { createTestApp } from '../../support/app';
import { createPublicCode } from '../../support/customer-auth';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import {
  backdateHold,
  createHolder,
  insertRequest,
  RecordingSender,
  wrongCode,
} from './holder-fixtures';

jest.setTimeout(300_000);

describe('code du titulaire : réessai après refus, blocage, décisions concurrentes (OP-N124)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let auth: CustomerAuthService;
  const sender = new RecordingSender();

  beforeAll(async () => {
    w = await createMediaWorld();
    await createPublicCode(w.ops.a);
    app = await createTestApp({
      identity: w.idp,
      trustProxyHops: 1,
      imports: [RefundsHolderModule],
      overrides: [{ provide: OTP_SENDER, useValue: sender }],
    });
    auth = app.get(CustomerAuthService, { strict: false });
  });
  afterAll(async () => {
    await app.close();
  });

  const decide = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/v1/refund-requests/${id}/holder-decision`).send(body);
  const setup = async () => {
    const holder = await withOwner((db) => createHolder(db, w));
    const req = await withOwner((db) => insertRequest(db, w, holder, {}));
    const c = await auth.issueChallenge({
      operatorId: w.ops.a,
      phone: holder.phone,
      purpose: 'REFUND_HOLDER',
      subjectId: req.id,
    });
    return { req, otp: c.otpRequestId, code: c.code };
  };
  const challenge = async (otp: string) =>
    (
      await rows<{ consumed: number; attempts: number }>(
        `SELECT count(*) FILTER (WHERE consumed_at IS NOT NULL)::int AS consumed, 0 AS attempts
           FROM otp_challenge WHERE id = $1`,
        [otp.slice(4)],
      )
    )[0]!;
  const status = async (id: string) =>
    (await rows<{ status: string }>('SELECT status FROM refund_request WHERE id = $1', [id]))[0]!
      .status;

  it('décision refusée (409, échue) : le code n’est pas consommé ; il sert quand la demande redevient décidable', async () => {
    const s = await setup();
    await withOwner((db) => backdateHold(db, s.req.id, "clock_timestamp() - interval '1 minute'"));
    const body = { decision: 'CONFIRM', otp_request_id: s.otp, code: s.code };
    expect((await decide(s.req.id, body)).status).toBe(409);
    expect((await decide(s.req.id, body)).status).toBe(409);
    expect((await challenge(s.otp)).consumed).toBe(0);
    await withOwner((db) => backdateHold(db, s.req.id, "clock_timestamp() + interval '1 hour'"));
    const ok = await decide(s.req.id, body);
    expect([ok.status, ok.body.status]).toEqual([200, 'REQUESTED']);
    expect((await challenge(s.otp)).consumed).toBe(1);
  });

  it('code faux : essais comptés (422) ; au 5e, 429 puis le bon code est refusé ; rien n’est consommé ni décidé', async () => {
    const s = await setup();
    const wrong = { decision: 'CONFIRM', otp_request_id: s.otp, code: wrongCode(s.code) };
    for (let i = 0; i < 4; i += 1) expect((await decide(s.req.id, wrong)).status).toBe(422);
    expect((await decide(s.req.id, wrong)).status).toBe(429);
    const good = await decide(s.req.id, { ...wrong, code: s.code });
    expect(good.status).toBe(429);
    expect((await challenge(s.otp)).consumed).toBe(0);
    expect(await status(s.req.id)).toBe('AWAITING_HOLDER');
  });

  it('20 décisions simultanées avec le même code : une seule écrite, un seul consumed_at, une seule ligne d’audit', async () => {
    const s = await setup();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        decide(s.req.id, {
          decision: i % 2 === 0 ? 'CONFIRM' : 'BLOCK',
          otp_request_id: s.otp,
          code: s.code,
        }),
      ),
    );
    const codes = results.map((x) => x.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    for (const c of codes.filter((x) => x !== 200)) expect([409, 422]).toContain(c);
    expect((await challenge(s.otp)).consumed).toBe(1);
    const audit = await rows(
      "SELECT 1 FROM audit_log WHERE action = 'REFUND_HOLDER_DECIDED' AND object_id = $1",
      [s.req.id],
    );
    expect(audit).toHaveLength(1);
    expect(['REQUESTED', 'BLOCKED']).toContain(await status(s.req.id));
  });
});
