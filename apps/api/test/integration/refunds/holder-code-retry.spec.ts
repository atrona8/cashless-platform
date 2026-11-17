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

  /**
   * Remet l'échéance à +1 h seulement si la demande est encore `AWAITING_HOLDER`, en une transaction : le verrou de
   * ligne sérialise avec `promote_due_refund_requests()`. Renvoie le nombre de codes consommés lu dans la même
   * transaction (avant la remise), ou `null` si une autre suite a promu la demande entre-temps (irréversible).
   */
  const restoreHoldIfPending = (id: string, otp: string): Promise<number | null> =>
    withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query("SET LOCAL session_replication_role = 'replica'");
        const r = await db.query(
          `UPDATE refund_request SET hold_until = clock_timestamp() + interval '1 hour'
            WHERE id = $1 AND status = 'AWAITING_HOLDER'`,
          [id],
        );
        const c = await db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM otp_challenge WHERE id = $1 AND consumed_at IS NOT NULL',
          [otp.slice(4)],
        );
        await db.query('COMMIT');
        return r.rowCount === 1 ? c.rows[0]!.n : null;
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    });

  it('décision refusée (409, échue) : le code n’est pas consommé ; il sert quand la demande redevient décidable', async () => {
    // `promote_due_refund_requests()` balaie tous les prestataires : une autre suite en parallèle peut promouvoir la
    // demande dans la fenêtre où son échéance est reculée (promotion irréversible). Cette fenêtre est réduite à un
    // aller-retour (refus simultanés, remise conditionnelle atomique) ; si la demande a été promue, on refait
    // l'enchaînement complet sur une demande neuve. Rien n'est affaibli : le refus et le service du code sont
    // toujours prouvés sur la même demande, dans l'ordre.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const s = await setup();
      await withOwner((db) =>
        backdateHold(db, s.req.id, "clock_timestamp() - interval '1 minute'"),
      );
      const body = { decision: 'CONFIRM', otp_request_id: s.otp, code: s.code };
      const refused = await Promise.all([decide(s.req.id, body), decide(s.req.id, body)]);
      expect(refused.map((r) => r.status)).toEqual([409, 409]);
      const consumedBefore = await restoreHoldIfPending(s.req.id, s.otp);
      if (consumedBefore === null) continue;
      expect(consumedBefore).toBe(0);
      const ok = await decide(s.req.id, body);
      expect([ok.status, ok.body.status]).toEqual([200, 'REQUESTED']);
      expect((await challenge(s.otp)).consumed).toBe(1);
      return;
    }
    throw new Error('demande promue par une autre suite à chacun des 30 essais');
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
