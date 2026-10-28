// Intégration : demande de recharge PSP (`initiatePspTopup`, lot WP11, T054 ; FR-012, FR-013, FR-016 ; A13, A20,
// A25). HTTPS réel : guichet (terminal `TOPUP_DESK` ET personne `X-Staff-Authorization`) et festivalier. Trois
// temps : aucun appel de l'adaptateur sous transaction ; une reprise de la même clé ne crée jamais deux recharges.
import { randomUUID } from 'node:crypto';
import type { TestTerminal } from '../../support/test-terminal';
import { ownerRows } from '../../support/media-fixtures';
import { PspWorld } from './psp-fixtures';

describe('demande de recharge PSP', () => {
  let p: PspWorld;
  let t: TestTerminal;

  beforeAll(async () => {
    p = await PspWorld.create();
    t = await p.sw.terminal();
  }, 180_000);
  afterAll(async () => {
    await p.close();
  });
  afterEach(() => jest.restoreAllMocks());

  const rows = (sql: string, params: unknown[] = []) =>
    ownerRows<Record<string, unknown>>(sql, params);
  const topupsOf = (walletId: string) =>
    rows('SELECT * FROM psp_topup WHERE wallet_id = $1 ORDER BY created_at', [walletId]);
  const desk = (body: unknown, key?: string, term: TestTerminal = t) =>
    p.desk(term, 'POST', '/topups/psp', p.w.cashierA, body, key);

  describe('guichet', () => {
    it('201 : recharge PENDING, configuration figée, adresse de paiement, aucun écrit comptable ni secret', async () => {
      const { walletId } = await p.wallet();
      const journal = await p.count('SELECT 1 FROM journal_transaction WHERE ledger_id = $1', [
        p.ev.ledgerId,
      ]);
      const res = await desk(p.body(walletId));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'PENDING',
        provider: 'WAVE',
        psp_config_id: p.configs.WAVE,
        amount: 10000,
        currency: 'XOF',
        wallet_id: walletId,
        transaction_id: null,
      });
      expect(res.body.checkout_url).toMatch(/^https:\/\/fake-psp\.invalid\//);
      expect(res.body.provider_reference).toMatch(/^fake_/);
      expect(res.body).not.toHaveProperty('estimated_fee');
      const [row] = await topupsOf(walletId);
      expect(row).toMatchObject({
        status: 'PENDING',
        requested_by_kind: 'DESK',
        device_id: t.deviceId,
        person_id: p.w.cashierA.userId,
        psp_configuration_id: p.configs.WAVE,
        topup_tx_id: null,
      });
      expect(row!.provider_payment_ref).toBe(res.body.provider_reference);
      expect(
        await p.count('SELECT 1 FROM journal_transaction WHERE ledger_id = $1', [p.ev.ledgerId]),
      ).toBe(journal);
      // La référence marchande transmise au PSP est l'identifiant de la recharge ; aucun secret ne sort.
      expect(p.adapter('WAVE').initiated.at(-1)).toMatchObject({
        pspTopupId: res.body.topup_id,
        method: 'WAVE',
        amount: 10000n,
      });
      expect(res.text).not.toMatch(/secret|psp\/[0-9a-f-]{36}|test-adapter-key/i);
      const audit = await rows(
        `SELECT actor_id, after::text AS after FROM audit_log
          WHERE action = 'PSP_TOPUP_REQUESTED' AND object_id = $1`,
        [res.body.topup_id],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor_id).toBe(p.w.cashierA.userId);
      expect(String(audit[0]!.after)).not.toMatch(/secret|test-adapter-key/i);
    });

    it('même clé deux fois : une seule recharge, même réponse rejouée', async () => {
      const { walletId } = await p.wallet();
      const key = t.seqKey();
      const first = await desk(p.body(walletId), key);
      const again = await desk(p.body(walletId), key);
      expect(again.status).toBe(201);
      expect(again.headers['idempotency-replayed']).toBe('true');
      expect(again.body).toEqual(first.body);
      expect(await topupsOf(walletId)).toHaveLength(1);
    });

    it('reprise après échec de l’adaptateur : 503, recharge PENDING gardée, même clé = même recharge', async () => {
      const { walletId } = await p.wallet();
      const key = t.seqKey();
      p.adapter('WAVE').failNextInitiate('UNAVAILABLE');
      const failed = await desk(p.body(walletId), key);
      expect(failed.status).toBe(503);
      expect(failed.body.code).toBe('PSP_UNAVAILABLE');
      const [pending] = await topupsOf(walletId);
      expect(pending).toMatchObject({ status: 'PENDING', provider_payment_ref: null });
      const retry = await desk(p.body(walletId), key);
      expect(retry.status).toBe(201);
      expect(retry.body.topup_id).toBe(pending!.psp_topup_id);
      expect(await topupsOf(walletId)).toHaveLength(1);
    });

    it('refus du PSP : 422 PSP_REJECTED sans message brut, recharge restée PENDING', async () => {
      const { walletId } = await p.wallet();
      p.adapter('WAVE').failNextInitiate('REJECTED');
      const res = await desk(p.body(walletId));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PSP_REJECTED');
      expect(res.text).not.toMatch(/faux PSP/);
      expect((await topupsOf(walletId))[0]).toMatchObject({ status: 'PENDING' });
    });

    it('erreur inattendue de l’adaptateur : 503 normalisé, message brut jamais rendu, recharge PENDING', async () => {
      const { walletId } = await p.wallet();
      jest
        .spyOn(p.adapter('WAVE'), 'initiate')
        .mockRejectedValueOnce(new Error('clé sk_live_TRES_SECRETE refusée'));
      const res = await desk(p.body(walletId));
      expect(res.status).toBe(503);
      expect(res.text).not.toMatch(/sk_live|SECRETE/);
      expect((await topupsOf(walletId))[0]).toMatchObject({ status: 'PENDING' });
    });

    it('aucun appel de l’adaptateur pendant une transaction (profondeur suivie)', async () => {
      const { walletId } = await p.wallet();
      let depth = 0;
      const depths: number[] = [];
      const run = p.tx.run.bind(p.tx);
      jest.spyOn(p.tx, 'run').mockImplementation(async (operatorId, fn) => {
        depth += 1;
        try {
          return await run(operatorId, fn);
        } finally {
          depth -= 1;
        }
      });
      const adapter = p.adapter('WAVE');
      const initiate = adapter.initiate.bind(adapter);
      jest.spyOn(adapter, 'initiate').mockImplementation((...args) => {
        depths.push(depth);
        return initiate(...args);
      });
      const forProvider = p.registry.forProvider.bind(p.registry);
      jest.spyOn(p.registry, 'forProvider').mockImplementation((provider) => {
        depths.push(depth);
        return forProvider(provider);
      });
      expect((await desk(p.body(walletId))).status).toBe(201);
      expect(depths.length).toBeGreaterThanOrEqual(2);
      expect(depths.every((d) => d === 0)).toBe(true);
    });

    it('au plus 3 recharges PENDING par portefeuille (4e : 409), 20 par terminal (21e : 409)', async () => {
      const { walletId } = await p.wallet();
      for (let i = 0; i < 3; i += 1) expect((await desk(p.body(walletId))).status).toBe(201);
      const fourth = await desk(p.body(walletId));
      expect(fourth.status).toBe(409);
      expect(fourth.body.code).toBe('CONFLICT_STATE');
      const crowded = await p.sw.terminal();
      for (let i = 0; i < 20; i += 1) {
        const w = await p.wallet();
        const res = await desk(p.body(w.walletId), undefined, crowded);
        expect(res.status).toBe(201);
      }
      const extra = await p.wallet();
      const over = await desk(p.body(extra.walletId), undefined, crowded);
      expect(over.status).toBe(409);
      expect(over.body.code).toBe('CONFLICT_STATE');
    }, 120_000);

    it('refus de contexte : autre événement 404, tap inconnu 409, bloqué 422, devise 422, montant 422', async () => {
      const draft = await p.sw.draftEvent();
      const foreign = await p.wallet({ ledgerId: draft.ledgerId });
      expect((await desk(p.body(foreign.walletId))).status).toBe(404);
      expect(
        (await desk({ tap_id: 999999999, amount: 1000, currency: 'XOF', provider: 'WAVE' })).status,
      ).toBe(409);
      const blocked = await p.wallet({ status: 'BLOCKED' });
      const b = await desk(p.body(blocked.walletId));
      expect(b.status).toBe(422);
      expect(b.body.code).toBe('WALLET_BLOCKED');
      const { walletId } = await p.wallet();
      const eur = await desk(p.body(walletId, { currency: 'EUR' }));
      expect([eur.status, eur.body.code]).toEqual([422, 'CURRENCY_MISMATCH']);
      for (const amount of [0, -5, 1.5, 'abc'])
        expect((await desk(p.body(walletId, { amount }))).status).toBe(422);
      expect((await desk(p.body(walletId, { extra: true }))).status).toBe(422);
      expect((await desk({ amount: 1000, currency: 'XOF', provider: 'WAVE' })).status).toBe(422);
      expect(await topupsOf(walletId)).toEqual([]);
    });

    it('plafond de solde estimé : refus anticipé 422', async () => {
      const w = await p.wallet({ funds: 4000 });
      const [old] = await rows('SELECT jurisdiction_id AS id FROM event WHERE id = $1', [
        p.ev.eventId,
      ]);
      const profile = randomUUID();
      await rows(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination,
                                           unidentified_max_balance, unidentified_monthly_limit)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER', 10000, NULL)`,
        [profile],
      );
      await rows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [p.ev.eventId, profile]);
      try {
        const res = await desk(p.body(w.walletId, { amount: 9000 }));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('WALLET_LIMIT_EXCEEDED');
        expect((await desk(p.body(w.walletId, { amount: 6000 }))).status).toBe(201);
      } finally {
        await rows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [p.ev.eventId, old!.id]);
      }
    });

    it('moyen sans configuration utilisable : 409 PSP_NOT_CONFIGURED', async () => {
      const { walletId } = await p.wallet();
      await rows(
        `UPDATE psp_configuration SET status = 'SUSPENDED' WHERE psp_configuration_id = $1`,
        [p.configs.CARD],
      );
      try {
        const res = await desk(p.body(walletId, { provider: 'CARD' }));
        expect([res.status, res.body.code]).toEqual([409, 'PSP_NOT_CONFIGURED']);
      } finally {
        await rows(
          `UPDATE psp_configuration SET status = 'ACTIVE' WHERE psp_configuration_id = $1`,
          [p.configs.CARD],
        );
      }
    });
  });

  describe('festivalier', () => {
    it('201 pour son propre portefeuille ; recharge rattachée au festivalier, sans terminal ni personne', async () => {
      const w = await p.wallet();
      const res = await p.cust(w.customer, 'POST', '/topups/psp', p.body(w.walletId));
      expect(res.status).toBe(201);
      expect((await topupsOf(w.walletId))[0]).toMatchObject({
        requested_by_kind: 'CUSTOMER',
        customer_id: w.customer.customerId,
        device_id: null,
        person_id: null,
      });
    });

    it('portefeuille d’un autre festivalier : 404 ; tap_id : 422 ; clé non UUID : 422 ; sans clé : refus', async () => {
      const mine = await p.wallet();
      const other = await p.wallet();
      const stranger = await p.cust(mine.customer, 'POST', '/topups/psp', p.body(other.walletId));
      expect(stranger.status).toBe(404);
      expect(await topupsOf(other.walletId)).toEqual([]);
      const tap = await p.cust(mine.customer, 'POST', '/topups/psp', {
        tap_id: 1,
        amount: 1000,
        currency: 'XOF',
        provider: 'WAVE',
      });
      expect(tap.status).toBe(422);
      const bad = await p.cust(
        mine.customer,
        'POST',
        '/topups/psp',
        p.body(mine.walletId),
        'pas-un-uuid',
      );
      expect(bad.status).toBe(422);
      const none = await p.cust(mine.customer, 'POST', '/topups/psp', p.body(mine.walletId), null);
      expect(none.status).toBeGreaterThanOrEqual(400);
      expect(await topupsOf(mine.walletId)).toEqual([]);
    });

    it('grand livre non en service : 409 EVENT_CLOSING', async () => {
      const draft = await p.sw.draftEvent();
      const w = await p.wallet({ ledgerId: draft.ledgerId });
      const res = await p.cust(w.customer, 'POST', '/topups/psp', p.body(w.walletId));
      expect([res.status, res.body.code]).toEqual([409, 'EVENT_CLOSING']);
    });

    it('même clé deux fois : une seule recharge', async () => {
      const w = await p.wallet();
      const key = randomUUID();
      const a = await p.cust(w.customer, 'POST', '/topups/psp', p.body(w.walletId), key);
      const b = await p.cust(w.customer, 'POST', '/topups/psp', p.body(w.walletId), key);
      expect(b.body).toEqual(a.body);
      expect(await topupsOf(w.walletId)).toHaveLength(1);
    });
  });

  describe('garde composée : chaque combinaison d’identifiants', () => {
    it('terminal sans personne, personne sans terminal, festivalier + personne, aucun : 401', async () => {
      const w = await p.wallet();
      const path = '/topups/psp';
      // Terminal sans jeton de personne.
      expect((await p.desk(t, 'POST', path, null, p.body(w.walletId))).status).toBe(401);
      // Personne seule (jeton d'accès), sans terminal ni festivalier.
      const person = await p.sw.bo('POST', path, p.w.cashierA, p.body(w.walletId));
      expect(person.status).toBe(401);
      // Festivalier avec un en-tête de personne.
      const mixed = await p.cust(w.customer, 'POST', path, p.body(w.walletId), randomUUID(), {
        'x-staff-authorization': `Bearer ${p.w.cashierA.token}`,
      });
      expect(mixed.status).toBe(401);
      // Aucun identifiant.
      const none = await p.cust(
        { ...w.customer, headers: {} },
        'POST',
        path,
        p.body(w.walletId),
        randomUUID(),
      );
      expect(none.status).toBe(401);
      expect(await topupsOf(w.walletId)).toEqual([]);
    });

    it('un caissier d’un autre prestataire sur un terminal du prestataire A : refusé, rien créé', async () => {
      const w = await p.wallet();
      const res = await p.desk(t, 'POST', '/topups/psp', p.w.cashierB, p.body(w.walletId));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await topupsOf(w.walletId)).toEqual([]);
    });
  });
});
