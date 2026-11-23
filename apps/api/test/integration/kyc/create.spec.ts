// Intégration (mission 10a, WP05 ; FR-001 à FR-003, FR-006, C-005) : `createKycVerification` (POST /kyc-verifications).
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createCustomerWallet, createTestCustomer } from '../../support/fake-customer';
import { createMediaWorld, ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import { call } from '../refunds/refund-flow-fixtures';
import { fundedCustomer } from '../refunds/create-fixtures';

jest.setTimeout(300_000);

const RARE = 'Z9Q7';
const futureDate = '2031-05-31';

describe('identification au guichet (POST /kyc-verifications)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let eventB: string;
  let ledgerB: string;
  let cashierOtherEvent: TestPerson;
  const body = (extra: Record<string, unknown> = {}) => ({
    id_type: 'NATIONAL_ID',
    id_country: 'SN',
    id_last4: RARE,
    id_expires_on: futureDate,
    ...extra,
  });
  const post = (who: TestPerson | null, payload: unknown, key?: string) =>
    call(app, who, '/kyc-verifications', payload, key);
  const kycCount = async (operatorId: string = w.ops.a) =>
    Number(
      (
        await rows<{ n: string }>(
          'SELECT count(*)::text AS n FROM kyc_verification WHERE operator_id = $1',
          [operatorId],
        )
      )[0]!.n,
    );
  const nothingWritten = async (fn: () => Promise<unknown>) => {
    const before = await kycCount();
    await fn();
    expect(await kycCount()).toBe(before);
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    app = await createTestApp({ identity: w.idp });
    eventB = randomUUID();
    await withOwner(async (db) => {
      const [{ jurisdiction_id }] = (
        await db.query<{ jurisdiction_id: string }>(
          'SELECT jurisdiction_id FROM event WHERE id = $1',
          [w.ids.eventA],
        )
      ).rows as [{ jurisdiction_id: string }];
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement A2', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [eventB, w.ops.a, w.ids.organizerA, jurisdiction_id],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      ledgerB = (
        await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventB])
      ).rows[0]!.ledger;
      cashierOtherEvent = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'CASHIER', scopeType: 'EVENT', scopeId: eventB }],
      });
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('201 par le caissier : ligne DESK VERIFIED lue en base, agent = personne authentifiée, id_last4 normalisé', async () => {
    const c = await fundedCustomer(w, 0);
    const res = await post(w.cashierA, body({ wallet_id: c.walletId, id_last4: '4821' }));
    expect(res.status).toBe(201);
    expect(contractViolations('KycVerification', res.body)).toEqual([]);
    const [row] = await rows<Record<string, unknown>>(
      `SELECT method, status, agent_id, customer_id, wallet_id, id_last4, id_country, id_expires_on::text AS exp
         FROM kyc_verification WHERE id = $1`,
      [res.body.kyc_verification_id],
    );
    expect(row).toMatchObject({
      method: 'DESK',
      status: 'VERIFIED',
      agent_id: w.cashierA.userId,
      customer_id: c.customer.customerId,
      wallet_id: c.walletId,
      id_last4: '4821',
      exp: futureDate,
    });
    expect(String(row!.id_country).trim()).toBe('SN');
    expect(res.body).toMatchObject({ agent_id: w.cashierA.userId, id_expires_on: futureDate });
  });

  it('id_last4 en minuscules refusé (400), valeur majuscule gardée telle quelle', async () => {
    const c = await fundedCustomer(w, 0);
    await nothingWritten(async () => {
      expect(
        (await post(w.cashierA, body({ wallet_id: c.walletId, id_last4: 'ab12' }))).status,
      ).toBe(400);
    });
    const ok = await post(w.cashierA, body({ wallet_id: c.walletId, id_last4: 'AB12' }));
    expect([ok.status, ok.body.id_last4]).toEqual([201, 'AB12']);
  });

  it('201 par l’administrateur d’organisateur ; rejeu de la clé : même corps, Idempotency-Replayed, une seule ligne ; autre corps : 409', async () => {
    const c = await fundedCustomer(w, 0);
    const key = randomUUID();
    const first = await post(w.organizerAdminA, body({ wallet_id: c.walletId }), key);
    expect(first.status).toBe(201);
    expect(first.body.agent_id).toBe(w.organizerAdminA.userId);
    const replay = await post(w.organizerAdminA, body({ wallet_id: c.walletId }), key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(
      await rows('SELECT 1 FROM kyc_verification WHERE customer_id = $1', [c.customer.customerId]),
    ).toHaveLength(1);
    const other = await post(
      w.organizerAdminA,
      body({ wallet_id: c.walletId, id_last4: '1111' }),
      key,
    );
    expect(other.status).toBe(409);
    expect(
      await rows('SELECT 1 FROM kyc_verification WHERE customer_id = $1', [c.customer.customerId]),
    ).toHaveLength(1);
  });

  it('422 ACCOUNT_REQUIRED : portefeuille anonyme ; client sans customer_identity ; rien d’écrit', async () => {
    const noIdentity = await withOwner(async (db) => {
      const customer = await createTestCustomer(db, w.ops.a);
      const { walletId } = await createCustomerWallet(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        customerId: customer.customerId,
        funds: 0,
      });
      return { customerId: customer.customerId, walletId };
    });
    await nothingWritten(async () => {
      const anon = await post(w.cashierA, body({ wallet_id: w.ids.walletA }));
      expect([anon.status, anon.body.code]).toEqual([422, 'ACCOUNT_REQUIRED']);
      const res = await post(w.cashierA, body({ wallet_id: noIdentity.walletId }));
      expect([res.status, res.body.code]).toEqual([422, 'ACCOUNT_REQUIRED']);
      const viaCustomer = await post(w.cashierA, body({ customer_id: noIdentity.customerId }));
      expect([viaCustomer.status, viaCustomer.body.code]).toEqual([422, 'ACCOUNT_REQUIRED']);
    });
  });

  it('403 : mauvais rôle (OPERATOR_ADMIN, SUPERVISOR), caissier d’un autre événement, rien d’écrit ; 401 sans jeton', async () => {
    const c = await fundedCustomer(w, 0);
    await nothingWritten(async () => {
      for (const who of [w.operatorAdminA, w.supervisorA, cashierOtherEvent]) {
        const res = await post(who, body({ wallet_id: c.walletId }));
        expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
      }
      expect((await post(null, body({ wallet_id: c.walletId }))).status).toBe(401);
    });
  });

  it('403 : client dont les portefeuilles sont seulement sur un autre événement (chemin customer_id), rien d’écrit', async () => {
    const c = await fundedCustomer(w, 0, w.ops.a, ledgerB);
    await nothingWritten(async () => {
      const refused = await post(w.cashierA, body({ customer_id: c.customer.customerId }));
      expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
      const byWallet = await post(w.cashierA, body({ wallet_id: c.walletId }));
      expect(byWallet.status).toBe(403);
    });
    const ok = await post(cashierOtherEvent, body({ customer_id: c.customer.customerId }));
    expect(ok.status).toBe(201);
  });

  it('403 : agent titulaire (numéro égal), rien d’écrit ; limite C-005 : agent sans numéro, 201', async () => {
    const c = await fundedCustomer(w, 0);
    const holderAgent = await withOwner((db) =>
      w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'CASHIER', scopeType: 'EVENT', scopeId: w.ids.eventA }],
      }),
    );
    await withOwner((db) =>
      db.query('UPDATE app_user SET phone = $2 WHERE id = $1', [holderAgent.userId, c.phone]),
    );
    await nothingWritten(async () => {
      const res = await post(holderAgent, body({ wallet_id: c.walletId }));
      expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
      const viaCustomer = await post(holderAgent, body({ customer_id: c.customer.customerId }));
      expect(viaCustomer.status).toBe(403);
    });
    // C-005 : l'agent par défaut des fixtures n'a qu'un e-mail, aucun numéro : non détecté.
    expect((await post(w.cashierA, body({ wallet_id: c.walletId }))).status).toBe(201);
  });

  it('422 VALIDATION_FAILED : pièce expirée hier (SQL CL062)', async () => {
    const c = await fundedCustomer(w, 0);
    const [{ d }] = (await rows<{ d: string }>('SELECT (current_date - 1)::text AS d')) as [
      { d: string },
    ];
    await nothingWritten(async () => {
      const res = await post(w.cashierA, body({ wallet_id: c.walletId, id_expires_on: d }));
      expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    });
  });

  it('400 : id_last4 de cinq caractères, pays minuscule, type inconnu, date impossible, champs inconnus (agent_id), wallet_id et customer_id ensemble ou aucun', async () => {
    const c = await fundedCustomer(w, 0);
    const base = { wallet_id: c.walletId };
    const bad: Array<Record<string, unknown>> = [
      body({ ...base, id_last4: 'ABCDE' }),
      body({ ...base, id_country: 'sn' }),
      body({ ...base, id_type: 'BADGE' }),
      body({ ...base, id_expires_on: '2031-02-30' }),
      body({ ...base, agent_id: w.operatorAdminA.userId }),
      body({ ...base, operator_id: w.ops.b }),
      body({ ...base, status: 'REVOKED' }),
      body({ ...base, customer_id: c.customer.customerId }),
      body(),
    ];
    await nothingWritten(async () => {
      for (const payload of bad) {
        const res = await post(w.cashierA, payload);
        expect([res.status, JSON.stringify(payload)]).toEqual([400, JSON.stringify(payload)]);
      }
      expect((await post(w.cashierA, [])).status).toBe(400);
    });
  });

  it('201 avec customer_id seul : ligne wallet_id NULL, contrat conforme', async () => {
    const c = await fundedCustomer(w, 0);
    const res = await post(w.cashierA, body({ customer_id: c.customer.customerId }));
    expect(res.status).toBe(201);
    expect(contractViolations('KycVerification', res.body)).toEqual([]);
    expect(res.body.wallet_id).toBeNull();
    const [row] = await rows<{ wallet_id: string | null; customer_id: string }>(
      'SELECT wallet_id, customer_id FROM kyc_verification WHERE id = $1',
      [res.body.kyc_verification_id],
    );
    expect(row).toEqual({ wallet_id: null, customer_id: c.customer.customerId });
  });

  it('404 : portefeuille ou client inconnu ; portefeuille du prestataire A appelé par le caissier B', async () => {
    const c = await fundedCustomer(w, 0);
    await nothingWritten(async () => {
      expect((await post(w.cashierA, body({ wallet_id: randomUUID() }))).status).toBe(404);
      expect((await post(w.cashierA, body({ customer_id: randomUUID() }))).status).toBe(404);
      const isolated = await post(w.cashierB, body({ wallet_id: c.walletId }));
      expect([isolated.status, isolated.body.code]).toEqual([404, 'NOT_FOUND']);
      expect((await post(w.cashierB, body({ customer_id: c.customer.customerId }))).status).toBe(
        404,
      );
    });
  });

  it('audit : une ligne KYC_VERIFIED (acteur, rôle exercé, id_last4), sans numéro de téléphone ; journaux sans id_last4 ni numéro', async () => {
    const c = await fundedCustomer(w, 0);
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m),
    );
    const out = jest.spyOn(process.stdout, 'write');
    const res = await post(w.cashierA, body({ wallet_id: c.walletId }));
    expect(res.status).toBe(201);
    const logged = [
      ...spies.flatMap((s) => s.mock.calls.map((a) => JSON.stringify(a))),
      ...out.mock.calls.map((a) => String(a[0])),
    ].join('\n');
    spies.forEach((s) => s.mockRestore());
    out.mockRestore();
    expect(logged).not.toContain(RARE);
    expect(logged).not.toContain(c.phone);
    const audit = await rows<{
      actor_id: string;
      actor_role: string;
      after: Record<string, unknown>;
    }>(
      "SELECT actor_id, actor_role, after FROM audit_log WHERE action = 'KYC_VERIFIED' AND object_id = $1",
      [res.body.kyc_verification_id],
    );
    expect(audit).toHaveLength(1);
    expect([audit[0]!.actor_id, audit[0]!.actor_role]).toEqual([w.cashierA.userId, 'CASHIER']);
    expect(audit[0]!.after).toMatchObject({
      id_last4: RARE,
      customer_id: c.customer.customerId,
      wallet_id: c.walletId,
      method: 'DESK',
    });
    const text = JSON.stringify(audit[0]);
    expect(text).not.toContain(c.phone);
    expect(text).not.toContain(c.phone.replace(/^\+/, ''));
    expect(JSON.stringify(res.body)).not.toContain(c.phone);
    // Rôle réellement exercé : l'administrateur d'organisateur, pas le premier rôle tenu par défaut.
    const org = await post(w.organizerAdminA, body({ wallet_id: c.walletId }));
    const [orgAudit] = await rows<{ actor_role: string }>(
      "SELECT actor_role FROM audit_log WHERE action = 'KYC_VERIFIED' AND object_id = $1",
      [org.body.kyc_verification_id],
    );
    expect(orgAudit!.actor_role).toBe('ORGANIZER_ADMIN');
  });
});
