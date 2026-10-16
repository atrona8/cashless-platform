// Intégration : résolveur de configuration réel (FR-016, SC-004, research R-10) sur une configuration construite par
// l'API — règles en vigueur à une date (avant et après un remplacement), version de configuration à la date,
// commerçant sans commission, règle manquante signalée, isolation.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SqlConfigResolver } from '../../../src/configuration/sql-config-resolver';
import { TenantTx } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { CONFIG_RESOLVER } from '../../../src/ledger/ledger.module';
import type { ResolvedConfig } from '../../../src/ledger/types';
import { createApiConfigFixture, type ApiConfigFixture } from '../../scenario/api-config-fixture';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp } from '../../support/fake-idp';
import { createOperators } from '../transverse/fixtures';

jest.setTimeout(120_000);

describe('résolveur de configuration réel', () => {
  let app: INestApplication;
  let fx: ApiConfigFixture;
  let resolver: SqlConfigResolver;
  let tx: TenantTx;

  beforeAll(async () => {
    const idp = await FakeIdp.create();
    app = await createTestApp({ identity: idp });
    fx = await createApiConfigFixture(app, idp);
    resolver = app.get<SqlConfigResolver>(CONFIG_RESOLVER);
    tx = app.get(TenantTx);
  });

  afterAll(async () => {
    await app.close();
  });

  const resolveAt = (
    at: string,
    ledgerId: string = fx.ledgerId,
    eventId: string | undefined = fx.eventId,
    operatorId: string = fx.parties.OPE,
  ): Promise<ResolvedConfig> =>
    tx.run(operatorId, (client) =>
      resolver.resolve({ ledgerId, eventId, occurredAt: new Date(at), client }),
    );
  const api = (who: { token: string }, method: 'post' | 'patch', path: string, body: object) =>
    request(app.getHttpServer())
      [method](`/v1/operators/${fx.parties.OPE}${path}`)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const caught = async (promise: Promise<unknown>): Promise<ProblemException> => {
    try {
      await promise;
    } catch (error) {
      return error as ProblemException;
    }
    throw new Error('aucune erreur levée');
  };

  it('parties, contrat, profil de législation et cascade de l’événement', async () => {
    const config = await resolveAt('2026-12-11T18:00:00Z');
    expect(config.parties).toEqual({
      platformId: fx.parties.PLT,
      operatorId: fx.parties.OPE,
      organizerId: fx.parties.ORG,
    });
    expect(config).toMatchObject({
      taxBps: 1800n,
      breakageOrganizerBps: 8000n,
      spendOrder: 'PROMO_FIRST',
      pspFeeBearer: 'ORGANIZER',
      chargebackBearer: 'ORGANIZER',
      cashDiffBearer: 'ORGANIZER',
      offlineLossBearer: 'ORGANIZER',
      breakageDestination: 'ORGANIZER',
    });
    expect(config.pitchFees).toEqual({
      [fx.participations.FOOD]: 15000n,
      [fx.participations.TEE]: 10000n,
    });
    expect(Object.keys(config.pspFees).sort()).toEqual(['CARTE', 'OM', 'WAVE']);
    expect(config.operatorFees.map((f) => f.basis)).toEqual(['TOPUP_AMOUNT', 'PER_MEDIA']);
  });

  it('règle remplacée : l’ancienne vaut avant la date d’effet, la nouvelle à partir d’elle, chacune avec son identifiant', async () => {
    const replaced = await api(
      fx.people.organizerAdmin,
      'post',
      `/fee-rules/${fx.commissionRules.TEE}/replacements`,
      {
        scope_type: 'PARTICIPATION',
        scope_id: fx.participations.TEE,
        payer_purpose: 'MERCHANT',
        beneficiary_purpose: 'ORG_COM',
        basis: 'SALE_AMOUNT',
        rate_bps: 1500,
        trigger: 'REALTIME',
        valid_from: '2026-12-15T00:00:00Z',
      },
    );
    expect(replaced.status).toBe(201);
    const before = await resolveAt('2026-12-14T23:59:59Z');
    const after = await resolveAt('2026-12-15T00:00:00Z');
    expect(before.commissions[fx.participations.TEE]).toMatchObject({
      id: fx.commissionRules.TEE,
      rateBps: 1000n,
    });
    expect(after.commissions[fx.participations.TEE]).toMatchObject({
      id: replaced.body.fee_rule_id,
      rateBps: 1500n,
    });
    // Les autres règles ne bougent pas.
    expect(after.commissions[fx.participations.FOOD]).toEqual(
      before.commissions[fx.participations.FOOD],
    );
    // Avant toute date d'effet : aucune règle en vigueur.
    expect((await resolveAt('2025-06-01T00:00:00Z')).commissions).toEqual({});
  });

  it('version de configuration de l’événement en vigueur à la date', async () => {
    const [v1] = await withOwner(
      async (db) =>
        (
          await db.query<{ id: string; valid_from: Date }>(
            `SELECT id, valid_from FROM config_version WHERE scope_type = 'EVENT' AND scope_id = $1 AND version = 1`,
            [fx.eventId],
          )
        ).rows,
    );
    const patched = await api(fx.people.organizerAdmin, 'patch', `/events/${fx.eventId}`, {
      reversal_window_minutes: 20,
    });
    expect(patched.status).toBe(200);
    const [v2] = await withOwner(
      async (db) =>
        (
          await db.query<{ id: string; valid_from: Date }>(
            `SELECT id, valid_from FROM config_version WHERE scope_type = 'EVENT' AND scope_id = $1 AND version = 2`,
            [fx.eventId],
          )
        ).rows,
    );
    expect(patched.body.config_version_id).toBe(v2!.id);
    expect(
      (await resolveAt(new Date(v2!.valid_from.getTime() + 1).toISOString())).configVersionId,
    ).toBe(v2!.id);
    expect((await resolveAt('2027-02-16T10:00:00Z')).configVersionId).toBe(v2!.id);
    if (v2!.valid_from.getTime() - v1!.valid_from.getTime() > 2) {
      expect(
        (await resolveAt(new Date(v1!.valid_from.getTime() + 1).toISOString())).configVersionId,
      ).toBe(v1!.id);
    }
    // Opération datée d'avant la création de l'événement : la première version.
    expect((await resolveAt('2026-01-15T00:00:00Z')).configVersionId).toBe(v1!.id);
  });

  it('commerçant sans commission ni droit de place : absent des tables, jamais une règle inventée', async () => {
    const merchant = await api(fx.people.organizerAdmin, 'post', '/merchants', {
      legal_name: 'Stand sans commission',
    });
    const participation = await api(
      fx.people.organizerAdmin,
      'post',
      `/events/${fx.eventId}/participations`,
      { merchant_id: merchant.body.merchant_id, link_type: 'EXTERNAL' },
    );
    expect(participation.status).toBe(201);
    const config = await resolveAt('2026-12-11T18:00:00Z');
    expect(config.commissions).not.toHaveProperty(participation.body.participation_id as string);
    expect(config.pitchFees).not.toHaveProperty(participation.body.participation_id as string);
  });

  it('règle manquante : erreur explicite à la lecture, pas un frais nul ; contrat manquant : refus', async () => {
    const bare = await api(fx.people.organizerAdmin, 'post', '/events', {
      organizer_id: fx.parties.ORG,
      name: `Sans règles ${randomUUID()}`,
      currency: 'XOF',
      timezone: 'Africa/Dakar',
      jurisdiction_id: fx.jurisdictionId,
      funds_holder: 'ORGANIZER',
      contract_id: fx.contractId,
    });
    expect(bare.status).toBe(201);
    const config = await resolveAt('2026-12-11T18:00:00Z', bare.body.ledger_id, bare.body.event_id);
    // Les règles du contrat et de la plateforme valent aussi pour cet événement ; ses propres frais n'existent pas.
    expect(config.operatorFees).toHaveLength(2);
    expect(config.platformFee.id).toEqual(expect.any(String));
    expect(config.commissions).toEqual({});
    expect(config.pspFees).toEqual({});
    for (const read of [() => config.activationFee, () => config.refundFee]) {
      let error: unknown;
      try {
        read();
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(ProblemException);
      expect([(error as ProblemException).code, (error as ProblemException).status]).toEqual([
        'VALIDATION_FAILED',
        422,
      ]);
      expect((error as ProblemException).detail).toContain('Règle de frais manquante');
    }
    const noContract = await api(fx.people.organizerAdmin, 'post', '/events', {
      organizer_id: fx.parties.ORG,
      name: `Sans contrat ${randomUUID()}`,
      currency: 'XOF',
      timezone: 'Africa/Dakar',
      jurisdiction_id: fx.jurisdictionId,
      funds_holder: 'ORGANIZER',
    });
    const refused = await caught(
      resolveAt('2026-12-11T18:00:00Z', noContract.body.ledger_id, noContract.body.event_id),
    );
    expect([refused.code, refused.status]).toEqual(['VALIDATION_FAILED', 422]);
    expect(refused.detail).toContain('contrat');
  });

  it('grand livre d’un autre prestataire, ou qui n’est pas celui de l’événement : rien n’est résolu', async () => {
    const others = await createOperators();
    const foreign = await caught(
      resolveAt('2026-12-11T18:00:00Z', fx.ledgerId, fx.eventId, others.a),
    );
    expect(foreign.code).toBe('VALIDATION_FAILED');
    expect((await caught(resolveAt('2026-12-11T18:00:00Z', fx.ledgerId, randomUUID()))).code).toBe(
      'VALIDATION_FAILED',
    );
    await expect(
      resolver.resolve({ ledgerId: fx.ledgerId, eventId: fx.eventId, occurredAt: new Date() }),
    ).rejects.toThrow('client de la transaction requis');
  });
});
