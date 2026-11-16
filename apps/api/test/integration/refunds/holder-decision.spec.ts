// Intégration (mission 9a, WP03 ; FR-012, FR-013, NFR-005) : `decideRefundRequestAsHolder`, route publique.
// Le code est vérifié AVANT tout détail d'état ; les refus d'identifiant, de demande et de code sont indiscernables.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CustomerAuthService } from '../../../src/customer-auth/customer-auth.service';
import { OTP_SENDER } from '../../../src/customer-auth/otp-sender';
import { RefundsHolderModule } from '../../../src/refunds/refunds-holder.module';
import { createTestApp } from '../../support/app';
import { createPublicCode, requestOtp } from '../../support/customer-auth';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import {
  createHolder,
  insertRequest,
  RecordingSender,
  wrongCode,
  type Holder,
  type InsertedRequest,
} from './holder-fixtures';

describe('décision du titulaire (POST /refund-requests/{id}/holder-decision)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let auth: CustomerAuthService;
  let codeA: string;
  const sender = new RecordingSender();

  beforeAll(async () => {
    w = await createMediaWorld();
    codeA = await createPublicCode(w.ops.a);
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
  /** Demande ouverte et code du titulaire lié à cette demande. */
  const setup = async (options: Parameters<typeof insertRequest>[3] = {}) => {
    const holder: Holder = await withOwner((db) => createHolder(db, w));
    const req: InsertedRequest = await withOwner((db) => insertRequest(db, w, holder, options));
    const c = await auth.issueChallenge({
      operatorId: w.ops.a,
      phone: holder.phone,
      purpose: 'REFUND_HOLDER',
      subjectId: req.id,
    });
    return { holder, req, otp: c.otpRequestId, code: c.code };
  };
  const state = async (id: string) =>
    (
      await rows<{ j: Record<string, unknown> }>(
        'SELECT to_jsonb(r) AS j FROM refund_request r WHERE id = $1',
        [id],
      )
    )[0]!.j;
  /** Réponse sans les identifiants propres à chaque requête. */
  const shape = (res: request.Response) => {
    const {
      request_id: _r,
      instance: _i,
      trace_id: _t,
      ...body
    } = res.body as Record<string, unknown>;
    const { 'x-request-id': _x, date: _d, etag: _e, ...headers } = res.headers;
    return { status: res.status, body, headers };
  };

  it('CONFIRM : REQUESTED, seules les colonnes de la décision changent, réponse conforme', async () => {
    const s = await setup();
    const before = await state(s.req.id);
    const res = await decide(s.req.id, {
      decision: 'CONFIRM',
      otp_request_id: s.otp,
      code: s.code,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.refund_request_id).toBe(s.req.id);
    expect(contractViolations('RefundRequest', res.body)).toEqual([]);
    const after = await state(s.req.id);
    expect(after.holder_decision).toBe('CONFIRM');
    expect(after.holder_decided_at).not.toBeNull();
    const changed = Object.keys(after).filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
    );
    expect(changed.sort()).toEqual(
      ['holder_decided_at', 'holder_decision', 'status', 'updated_at'].sort(),
    );
    // Rejeu avec le même code : le code est consommé.
    const replay = await decide(s.req.id, {
      decision: 'CONFIRM',
      otp_request_id: s.otp,
      code: s.code,
    });
    expect(replay.status).toBe(422);
    expect(replay.body.code).toBe('OTP_INVALID');
  });

  it('BLOCK : BLOCKED (finale), alerte du contrat = ligne d’audit sans code ni numéro', async () => {
    const s = await setup();
    const res = await decide(s.req.id, { decision: 'BLOCK', otp_request_id: s.otp, code: s.code });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('BLOCKED');
    expect(contractViolations('RefundRequest', res.body)).toEqual([]);
    const audit = await rows<{ actor_id: string | null; actor_role: string; after: unknown }>(
      "SELECT actor_id, actor_role, after FROM audit_log WHERE action = 'REFUND_HOLDER_DECIDED' AND object_id = $1",
      [s.req.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: null, actor_role: 'HOLDER' });
    expect(audit[0]!.after).toMatchObject({ decision: 'BLOCK' });
    const text = JSON.stringify(audit[0]);
    expect(text).not.toContain(s.code);
    expect(text).not.toContain(s.holder.phone);
    expect((await state(s.req.id)).holder_decision).toBe('BLOCK');
  });

  it('demande inconnue, identifiant non conforme, code faux, défis d’autres usages : réponses identiques', async () => {
    const s = await setup();
    const other = await setup();
    const login = await requestOtp(app, { phone: s.holder.phone, operator_code: codeA });
    expect(login.status).toBe(202);
    const loginCode = sender.lastCode(s.holder.phone);
    const body = (otp: string, code: string) => ({
      decision: 'CONFIRM',
      otp_request_id: otp,
      code,
    });
    const cases = [
      await decide(randomUUID(), body(s.otp, s.code)), // demande inconnue
      await decide('pas-un-uuid', body(s.otp, s.code)), // identifiant non conforme
      await decide(s.req.id, body(s.otp, wrongCode(s.code))), // code faux
      await decide(s.req.id, body(login.body.otp_request_id, loginCode)), // défi de connexion
      await decide(s.req.id, body(other.otp, other.code)), // défi d'une autre demande
      await decide(s.req.id, body(`otp_${randomUUID()}`, '123456')), // défi inconnu
      await decide(s.req.id, body('nimporte', '123456')), // identifiant de défi mal formé
    ];
    for (const res of cases) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('OTP_INVALID');
    }
    const reference = shape(cases[0]!);
    for (const res of cases) expect(shape(res)).toEqual(reference);
    // Rien n'a changé : la demande est toujours en attente.
    expect((await state(s.req.id)).status).toBe('AWAITING_HOLDER');
  });

  it('défi d’un autre prestataire pour le même numéro et la même demande : 422', async () => {
    const s = await setup();
    const foreign = await auth.issueChallenge({
      operatorId: w.ops.b,
      phone: s.holder.phone,
      purpose: 'REFUND_HOLDER',
      subjectId: s.req.id,
    });
    const res = await decide(s.req.id, {
      decision: 'CONFIRM',
      otp_request_id: foreign.otpRequestId,
      code: foreign.code,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OTP_INVALID');
  });

  it('409 CONFLICT_STATE seulement avec un code valide : échue, ou hors AWAITING_HOLDER', async () => {
    const due = await setup({ holdSql: "clock_timestamp() - interval '1 minute'" });
    const notAwaiting = await setup({ status: 'REQUESTED' });
    for (const s of [due, notAwaiting]) {
      // Code faux : 422, jamais 409 (l'état ne se révèle pas sans code).
      const bad = await decide(s.req.id, {
        decision: 'BLOCK',
        otp_request_id: s.otp,
        code: wrongCode(s.code),
      });
      expect(bad.status).toBe(422);
      const ok = await decide(s.req.id, {
        decision: 'BLOCK',
        otp_request_id: s.otp,
        code: s.code,
      });
      expect(ok.status).toBe(409);
      expect(ok.body.code).toBe('CONFLICT_STATE');
      expect((await state(s.req.id)).holder_decision).toBeNull();
    }
  });

  it('5 essais faux : 429 avec Retry-After, puis le bon code est refusé (numéro bloqué)', async () => {
    const s = await setup();
    const wrong = { decision: 'CONFIRM', otp_request_id: s.otp, code: wrongCode(s.code) };
    for (let i = 0; i < 4; i += 1) expect((await decide(s.req.id, wrong)).status).toBe(422);
    const fifth = await decide(s.req.id, wrong);
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OTP_RATE_LIMITED');
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(0);
    const good = await decide(s.req.id, { ...wrong, code: s.code });
    expect(good.status).toBe(429);
    expect((await state(s.req.id)).status).toBe('AWAITING_HOLDER');
  });

  it('deux décisions simultanées avec le même code : une seule passe', async () => {
    const s = await setup();
    const [a, b] = await Promise.all([
      decide(s.req.id, { decision: 'CONFIRM', otp_request_id: s.otp, code: s.code }),
      decide(s.req.id, { decision: 'BLOCK', otp_request_id: s.otp, code: s.code }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const audit = await rows(
      "SELECT 1 FROM audit_log WHERE action = 'REFUND_HOLDER_DECIDED' AND object_id = $1",
      [s.req.id],
    );
    expect(audit).toHaveLength(1);
  });

  it('corps invalide : 400 VALIDATION_FAILED', async () => {
    const s = await setup();
    const good = { decision: 'CONFIRM', otp_request_id: s.otp, code: s.code };
    for (const bad of [
      { ...good, decision: 'MAYBE' },
      { ...good, code: '12' },
      { ...good, code: 123456 },
      { ...good, extra: true },
      { decision: 'CONFIRM', code: s.code },
      { ...good, otp_request_id: '' },
    ]) {
      const res = await decide(s.req.id, bad);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect((await state(s.req.id)).status).toBe('AWAITING_HOLDER');
  });

  it('la route est publique : aucune authentification exigée', async () => {
    const s = await setup();
    const res = await request(app.getHttpServer())
      .post(`/v1/refund-requests/${s.req.id}/holder-decision`)
      .send({ decision: 'CONFIRM', otp_request_id: s.otp, code: s.code });
    expect(res.status).toBe(200);
  });
});
