// Parcours de bout en bout de la mission configuration-parties-evenements (SC-001, SC-004, SC-005 ; quickstart,
// étapes 1 à 5) : à partir d'un seul administrateur de la plateforme, toute la hiérarchie se construit par l'API —
// profil de législation, prestataire et son contrat, premier administrateur du prestataire, organisateur et son
// contrat, événement avec son grand livre, commerçants, participations, points de vente, commissions — puis
// l'événement est mis en service à deux personnes et modifié à deux pendant LIVE. Les chaînes d'audit de la
// plateforme et du prestataire sont vérifiées. (Étape 6, rejeu du scénario de référence : api-config-replay.spec.ts.)
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp } from '../../support/fake-idp';

jest.setTimeout(120_000);

describe('parcours complet : de la plateforme à l’événement en service', () => {
  let idp: FakeIdp;
  let app: INestApplication;

  beforeAll(async () => {
    idp = await FakeIdp.create();
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (token: string) => {
    const send = (method: 'post' | 'patch', path: string, body: object = {}) =>
      request(app.getHttpServer())
        [method](`/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);
    return {
      post: (path: string, body?: object) => send('post', path, body),
      patch: (path: string, body?: object) => send('patch', path, body),
      get: (path: string) =>
        request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    };
  };
  const rows = <T>(sql: string, params: unknown[] = []) =>
    withOwner(async (db) => (await db.query(sql, params)).rows as T[]);
  /** Personne créée et dotée d'un rôle par l'API (routes « Personnes » de la mission 2) ; rend son jeton. */
  const appoint = async (
    by: ReturnType<typeof as>,
    operatorId: string,
    role: string,
    scopeType: string,
    scopeId: string,
  ): Promise<{ token: string; userId: string }> => {
    const subject = `journey-${randomUUID()}`;
    const user = await by.post(`/operators/${operatorId}/users`, {
      issuer: idp.config.issuer,
      subject,
      display_name: `${role} du parcours`,
      email: `${subject}@journey.test`,
    });
    expect(user.status).toBe(201);
    const grant = await by.post(
      `/operators/${operatorId}/users/${user.body.user_id}/role-assignments`,
      { role, scope_type: scopeType, scope_id: scopeId },
    );
    expect(grant.status).toBe(201);
    return { token: await idp.accessToken(subject), userId: user.body.user_id as string };
  };

  it('plateforme → prestataire → organisateur → événement → participations → LIVE à deux → modification à deux', async () => {
    // Un seul administrateur de la plateforme, amorcé hors API.
    const root = await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
      );
      return idp.createPerson(db, {
        operatorId: null,
        roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }],
      });
    });
    const platform = as(root.token);

    // 1. Plateforme : profil de législation, prestataire, contrat, premier administrateur du prestataire.
    //    Pays réservé à ce parcours ; le profil existe déjà si la base n'a pas été recréée.
    const profileBody = {
      country_code: 'CI',
      valid_from: '2026-01-01',
      min_refund_window_days: 30,
      rules: { taxes: { VAT: { rate_bps: 1800, inclusive: true } } },
    };
    const profileCreation = await platform.post('/jurisdiction-profiles', profileBody);
    expect([201, 409]).toContain(profileCreation.status);
    if (profileCreation.status === 201) {
      // La destination de la casse n'a pas été saisie : valeur provisoire, signalée, à confirmer par le juriste.
      expect(profileCreation.body.provisional_fields).toEqual([
        { field: 'breakage_destination', confirm_by: 'juriste' },
      ]);
    }
    const profiles = await platform.get('/jurisdiction-profiles?country_code=CI&limit=200');
    const profile = (
      profiles.body.data as { profile_id: string; version: number; country_code: string }[]
    ).sort((a, b) => b.version - a.version)[0]!;

    const operator = await platform.post('/operators', {
      legal_name: 'Cashless Abidjan',
      country_code: 'CI',
    });
    expect(operator.status).toBe(201);
    const op = operator.body.operator_id as string;
    const O = `/operators/${op}`;
    const platformContract = await platform.post(`${O}/platform-contracts`, {
      valid_from: '2026-01-01T00:00:00Z',
      platform_fee_mode: 'IN_POOL',
    });
    expect(platformContract.status).toBe(201);
    const operatorAdmin = as((await appoint(platform, op, 'OPERATOR_ADMIN', 'OPERATOR', op)).token);

    // 2. Prestataire : organisateur, contrat, frais du prestataire, plafond, deux administrateurs d'organisateur.
    const organizer = await operatorAdmin.post(`${O}/organizers`, {
      legal_name: 'Festival des Lagunes',
      country_code: 'CI',
    });
    expect(organizer.status).toBe(201);
    const org = organizer.body.organizer_id as string;
    const contract = await operatorAdmin.post(`${O}/organizers/${org}/contracts`, {
      valid_from: '2026-01-01T00:00:00Z',
      offline_loss_bearer: 'ORGANIZER',
      cash_diff_bearer: 'OPERATOR',
      breakage_organizer_bps: 8000,
    });
    expect(contract.status).toBe(201);
    const operatorFee = await operatorAdmin.post(`${O}/fee-rules`, {
      scope_type: 'OPERATOR_CONTRACT',
      scope_id: contract.body.contract_id,
      payer_purpose: 'ORG_FPREST',
      beneficiary_purpose: 'OPE_FRAIS',
      basis: 'TOPUP_AMOUNT',
      rate_bps: 300,
      tax_code: 'VAT',
      trigger: 'CLOSING',
    });
    expect(operatorFee.status).toBe(201);
    expect(
      (
        await operatorAdmin.post(`${O}/config-versions`, {
          settings: { cash_refund_single_max_cap: 100000 },
        })
      ).status,
    ).toBe(201);
    const organizerAdmin1 = await appoint(operatorAdmin, op, 'ORGANIZER_ADMIN', 'ORGANIZER', org);
    const organizerAdmin2 = await appoint(operatorAdmin, op, 'ORGANIZER_ADMIN', 'ORGANIZER', org);
    const organizerAdmin = as(organizerAdmin1.token);
    const secondOrganizerAdmin = as(organizerAdmin2.token);

    // 3. Organisateur : événement (grand livre et comptes), commerçants, participations, points de vente, commissions.
    const event = await organizerAdmin.post(`${O}/events`, {
      organizer_id: org,
      name: 'Lagunes 2026',
      currency: 'XOF',
      timezone: 'Africa/Abidjan',
      jurisdiction_id: profile.profile_id,
      funds_holder: 'ORGANIZER',
      contract_id: contract.body.contract_id,
      starts_at: '2026-12-18T18:00:00Z',
      ends_at: '2026-12-20T06:00:00Z',
    });
    expect(event.status).toBe(201);
    expect(event.body).toMatchObject({
      status: 'DRAFT',
      currency: 'XOF',
      refund_deadline_source: 'PROVISIONAL_DEFAULT',
    });
    const eventId = event.body.event_id as string;
    expect(
      await rows(
        `SELECT status, (SELECT count(*)::int FROM account a WHERE a.ledger_id = l.id) AS accounts FROM ledger l WHERE l.id = $1`,
        [event.body.ledger_id],
      ),
    ).toEqual([{ status: 'OPEN', accounts: 28 }]);
    // Borne du profil : un remboursement à 10 jours est refusé quand la loi en impose 30, et le message cite la règle.
    const tooShort = await organizerAdmin.patch(`${O}/events/${eventId}`, {
      refund_deadline: '2026-12-30T06:00:00Z',
    });
    expect(tooShort.status).toBe(422);
    expect(JSON.parse(tooShort.text).detail).toContain('jurisdiction.min_refund_window_days');

    const participations: string[] = [];
    for (const [name, link] of [
      ['Maquis du Port', 'EXTERNAL'],
      ["Bar de l'organisateur", 'INTERNAL'],
    ] as const) {
      const merchant = await organizerAdmin.post(`${O}/merchants`, { legal_name: name });
      expect(merchant.status).toBe(201);
      const participation = await organizerAdmin.post(`${O}/events/${eventId}/participations`, {
        merchant_id: merchant.body.merchant_id,
        link_type: link,
        pitch_fee: link === 'EXTERNAL' ? 15000 : 0,
      });
      expect(participation.status).toBe(201);
      expect(participation.body.payout_to).toBe(
        link === 'INTERNAL' ? org : merchant.body.merchant_id,
      );
      participations.push(participation.body.participation_id as string);
      expect(
        (
          await organizerAdmin.post(
            `${O}/participations/${participation.body.participation_id}/points-of-sale`,
            { name: `Stand de ${name}` },
          )
        ).status,
      ).toBe(201);
      const commission = await organizerAdmin.post(`${O}/fee-rules`, {
        scope_type: 'PARTICIPATION',
        scope_id: participation.body.participation_id,
        payer_purpose: 'MERCHANT',
        beneficiary_purpose: 'ORG_COM',
        basis: 'SALE_AMOUNT',
        rate_bps: link === 'EXTERNAL' ? 1200 : 0,
        tax_code: 'VAT',
        trigger: 'REALTIME',
      });
      expect(commission.status).toBe(201);
    }
    expect(
      await rows(
        `SELECT count(*)::int AS n FROM account WHERE ledger_id = $1 AND purpose = 'MERCHANT' AND hot AND allow_negative`,
        [event.body.ledger_id],
      ),
    ).toEqual([{ n: 2 }]);

    // 4. Mise en service : conditions lues, demande, approbation par une seconde personne.
    const conditions = await organizerAdmin.get(`${O}/events/${eventId}/status-conditions`);
    expect(
      (conditions.body as { code: string; met: boolean }[]).filter((c) => c.met !== true),
    ).toEqual([]);
    const goLive = await organizerAdmin.post(`${O}/events/${eventId}/status-transitions`, {
      to: 'LIVE',
    });
    expect(goLive.status).toBe(202);
    expect(
      (await organizerAdmin.post(`/approval-requests/${goLive.body.approval_request_id}/approve`))
        .status,
    ).toBe(409);
    const approved = await secondOrganizerAdmin.post(
      `/approval-requests/${goLive.body.approval_request_id}/approve`,
    );
    expect(approved.body).toMatchObject({ status: 'EXECUTED', result: { status: 'LIVE' } });
    expect(
      await rows('SELECT to_status, actor_id FROM event_status_history WHERE event_id = $1', [
        eventId,
      ]),
    ).toEqual([{ to_status: 'LIVE', actor_id: organizerAdmin1.userId }]);

    // 5. Modification pendant LIVE : à deux ; la configuration résolue à une date antérieure rend l'ancienne valeur.
    const change = await organizerAdmin.patch(`${O}/events/${eventId}`, {
      cash_refund_single_max: 80000,
    });
    expect(change.status).toBe(202);
    expect(change.body.action).toBe('EVENT_SETTINGS_CHANGE');
    const applied = await secondOrganizerAdmin.post(
      `/approval-requests/${change.body.approval_request_id}/approve`,
    );
    expect(applied.body).toMatchObject({
      status: 'EXECUTED',
      result: { cash_refund_single_max: 80000 },
    });
    const [first] = await rows<{ valid_from: Date }>(
      `SELECT valid_from FROM config_version WHERE scope_type = 'EVENT' AND scope_id = $1 AND version = 1`,
      [eventId],
    );
    const earlier = await organizerAdmin.get(
      `${O}/events/${eventId}/config?at=${encodeURIComponent(new Date(first!.valid_from.getTime() + 1).toISOString())}`,
    );
    expect(earlier.body.cash_refund_single_max).toMatchObject({
      value: 50000,
      level: 'EVENT',
      version: 1,
    });
    const later = await organizerAdmin.get(`${O}/events/${eventId}/config?at=2027-01-01T00:00:00Z`);
    expect(later.body.cash_refund_single_max).toMatchObject({
      value: 80000,
      level: 'EVENT',
      version: 2,
    });
    expect(later.body.cash_refund_single_max_cap).toMatchObject({
      value: 100000,
      level: 'OPERATOR',
    });

    // Audit : chaque écriture du prestataire est dans sa chaîne, dans l'ordre ; les deux chaînes sont intactes.
    const actions = (
      await rows<{ action: string }>(
        `SELECT action FROM audit_log WHERE operator_id = $1 ORDER BY seq`,
        [op],
      )
    ).map((r) => r.action);
    const expectedOrder = [
      'USER_CREATED',
      'ROLE_GRANTED',
      'ORGANIZER_CREATED',
      'CONTRACT_CREATED',
      'FEE_RULE_CREATED',
      'CONFIG_VERSION_CREATED',
      'USER_CREATED',
      'ROLE_GRANTED',
      'USER_CREATED',
      'ROLE_GRANTED',
      'CONFIG_VERSION_CREATED',
      'EVENT_CREATED',
      'MERCHANT_CREATED',
      'PARTICIPATION_CREATED',
      'POINT_OF_SALE_CREATED',
      'FEE_RULE_CREATED',
      'MERCHANT_CREATED',
      'PARTICIPATION_CREATED',
      'POINT_OF_SALE_CREATED',
      'FEE_RULE_CREATED',
      'APPROVAL_REQUESTED',
      'EVENT_STATUS_CHANGED',
      'APPROVAL_EXECUTED',
      'APPROVAL_REQUESTED',
      'CONFIG_VERSION_CREATED',
      'EVENT_UPDATED',
      'APPROVAL_EXECUTED',
    ];
    expect(actions).toEqual(expectedOrder);
    const platformActions = (
      await rows<{ action: string }>(
        `SELECT action FROM audit_log WHERE operator_id IS NULL AND object_id = ANY($1::text[]) ORDER BY seq`,
        [[op, platformContract.body.contract_id]],
      )
    ).map((r) => r.action);
    expect(platformActions).toEqual(['OPERATOR_CREATED', 'CONTRACT_CREATED']);
    const problems = async (chain: string) =>
      (await rows('SELECT * FROM verify_audit_chain($1)', [chain])).length;
    expect(await problems(op)).toBe(0);
    expect(await problems('00000000-0000-0000-0000-000000000000')).toBe(0);
    expect(participations).toHaveLength(2);
  });
});
