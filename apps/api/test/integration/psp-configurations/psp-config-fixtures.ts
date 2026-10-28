// Jeu d'essai des configurations PSP (mission 6, lot WP10, T053) : le prestataire A construit par les routes de
// l'API (organisateur, événement et grand livre, titulaire des fonds = l'organisateur), ses personnes (deux
// OPERATOR_ADMIN de plus, un second ORGANIZER_ADMIN de l'organisateur, un ORGANIZER_ADMIN d'un autre organisateur),
// et le prestataire B (OPERATOR_ADMIN, ORGANIZER_ADMIN, une configuration). Écritures directes en base :
// amorçage seulement (personnes, organisateur de B, passage d'un événement en direct).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TenantTx } from '../../../src/db/tenant-tx';
import { createApiConfigFixture, type ApiConfigFixture } from '../../scenario/api-config-fixture';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators } from '../transverse/fixtures';

export type Method = 'get' | 'post' | 'put' | 'patch';

export interface PspWorld {
  app: INestApplication;
  idp: FakeIdp;
  fx: ApiConfigFixture;
  /** OPERATOR_ADMIN de A : fx.people.operatorAdmin (1) et deux autres. */
  op1: TestPerson;
  op2: TestPerson;
  op3: TestPerson;
  /** ORGANIZER_ADMIN de l'organisateur de A : fx.people.organizerAdmin (1) et un second. */
  org1: TestPerson;
  org2: TestPerson;
  /** Second organisateur de A et son administrateur. */
  organizer2: string;
  org2Other: TestPerson;
  /** Prestataire B. */
  opB: string;
  organizerB: string;
  opBAdmin: TestPerson;
  orgBAdmin: TestPerson;
  bConfigId: string;
  close(): Promise<void>;
  api(who: TestPerson, method: Method, path: string, body?: object, key?: string): request.Test;
  /** Crée une configuration (201 exigé) ; rend son identifiant. */
  createConfig(
    who: TestPerson,
    over?: Record<string, unknown>,
    organizerId?: string,
  ): Promise<string>;
  /** Règle de frais `PSP_CONFIGURATION` de la configuration (201 exigé). */
  addFeeRule(who: TestPerson, configId: string, rateBps?: number): Promise<string>;
  /** Demande de changement de statut (`202` exigé) ; rend la demande. */
  requestChange(
    who: TestPerson,
    configId: string,
    body: object,
  ): Promise<{ approval_request_id: string }>;
  approve(who: TestPerson, requestId: string): request.Test;
  /** Création, règle de frais, demande par `op1`, approbation par `op2` : configuration ACTIVE. */
  activeConfig(over?: Record<string, unknown>, organizerId?: string): Promise<string>;
  /** Événement du prestataire A (brouillon), créé par l'API. */
  createEvent(): Promise<string>;
  setLive(eventId: string): Promise<void>;
  owner<T>(sql: string, values?: unknown[]): Promise<T[]>;
}

export async function createPspWorld(): Promise<PspWorld> {
  const idp = await FakeIdp.create();
  const app = await createTestApp({ identity: idp });
  const fx = await createApiConfigFixture(app, idp);
  const op = fx.parties.OPE;
  const org = fx.parties.ORG;
  const api: PspWorld['api'] = (who, method, path, body, key) => {
    let req = request(app.getHttpServer())
      [method](`/v1${path}`)
      .set('Authorization', `Bearer ${who.token}`);
    if (method !== 'get') req = req.set('Idempotency-Key', key ?? randomUUID());
    return body ? req.send(body) : req;
  };
  const owner = <T>(sql: string, values: unknown[] = []) =>
    withOwner(async (db) => (await db.query(sql, values)).rows as T[]);

  const person = (
    operatorId: string,
    role: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN',
    scopeType: 'OPERATOR' | 'ORGANIZER',
    scopeId: string,
  ): Promise<TestPerson> =>
    withOwner((db) => idp.createPerson(db, { operatorId, roles: [{ role, scopeType, scopeId }] }));
  const op1 = fx.people.operatorAdmin;
  const op2 = await person(op, 'OPERATOR_ADMIN', 'OPERATOR', op);
  const op3 = await person(op, 'OPERATOR_ADMIN', 'OPERATOR', op);
  const org1 = fx.people.organizerAdmin;
  const org2 = await person(op, 'ORGANIZER_ADMIN', 'ORGANIZER', org);
  const o2 = await api(op1, 'post', `/operators/${op}/organizers`, {
    legal_name: 'Organisateur 2',
  });
  const organizer2 = o2.body.organizer_id as string;
  const org2Other = await person(op, 'ORGANIZER_ADMIN', 'ORGANIZER', organizer2);

  const others = await createOperators();
  const opB = others.a;
  const organizerB = randomUUID();
  await withOwner((db) =>
    db.query(
      `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Organisateur de B')`,
      [organizerB, opB],
    ),
  );
  const opBAdmin = await person(opB, 'OPERATOR_ADMIN', 'OPERATOR', opB);
  const orgBAdmin = await person(opB, 'ORGANIZER_ADMIN', 'ORGANIZER', organizerB);

  const world: PspWorld = {
    app,
    idp,
    fx,
    op1,
    op2,
    op3,
    org1,
    org2,
    organizer2,
    org2Other,
    opB,
    organizerB,
    opBAdmin,
    orgBAdmin,
    bConfigId: '',
    close: () => app.close(),
    api,
    owner,
    async createConfig(who, over = {}, organizerId = org) {
      const holder = (over.holder_party_id as string | undefined) ?? org;
      const res = await api(who, 'post', `/organizers/${organizerId}/psp-configurations`, {
        method: 'WAVE',
        provider: 'WAVE',
        holder_party_id: holder,
        secret_ref: `psp/${holder}/ref-${randomUUID().slice(0, 8)}`,
        ...over,
      });
      if (res.status !== 201) throw new Error(`création : ${res.status} ${res.text}`);
      return res.body.psp_config_id as string;
    },
    async addFeeRule(who, configId, rateBps = 150) {
      const res = await api(who, 'post', `/operators/${op}/fee-rules`, {
        scope_type: 'PSP_CONFIGURATION',
        scope_id: configId,
        payer_purpose: 'ORG_FPSP',
        beneficiary_purpose: 'PSP_FRAIS',
        basis: 'TOPUP_AMOUNT',
        rate_bps: rateBps,
        trigger: 'REALTIME',
        valid_from: '2026-01-01T00:00:00Z',
      });
      if (res.status !== 201) throw new Error(`règle de frais : ${res.status} ${res.text}`);
      return res.body.fee_rule_id as string;
    },
    async requestChange(who, configId, body) {
      const res = await api(who, 'post', `/psp-configurations/${configId}/approval-requests`, body);
      if (res.status !== 202) throw new Error(`demande : ${res.status} ${res.text}`);
      return res.body as { approval_request_id: string };
    },
    approve: (who, requestId) => api(who, 'post', `/approval-requests/${requestId}/approve`, {}),
    async activeConfig(over = {}, organizerId = org) {
      const id = await world.createConfig(op1, over, organizerId);
      await world.addFeeRule(op1, id);
      const req = await world.requestChange(op1, id, { status: 'ACTIVE', compliance_ref: 'KYB-1' });
      const res = await world.approve(op2, req.approval_request_id);
      if (res.status !== 200 || res.body.status !== 'EXECUTED')
        throw new Error(`activation : ${res.status} ${res.text}`);
      return id;
    },
    async createEvent() {
      const res = await api(org1, 'post', `/operators/${op}/events`, {
        organizer_id: org,
        name: `Événement ${randomUUID().slice(0, 6)}`,
        currency: 'XOF',
        timezone: 'Africa/Dakar',
        jurisdiction_id: fx.jurisdictionId,
        funds_holder: 'ORGANIZER',
        contract_id: fx.contractId,
      });
      if (res.status !== 201) throw new Error(`événement : ${res.status} ${res.text}`);
      return res.body.event_id as string;
    },
    async setLive(eventId) {
      await app
        .get(TenantTx)
        .run(op, (client) =>
          client.query('SELECT set_event_status($1, $2, $3)', [eventId, 'LIVE', op1.userId]),
        );
    },
  };
  world.bConfigId = await world.createConfig(opBAdmin, { holder_party_id: organizerB }, organizerB);
  return world;
}
