// Intégration : réclamation tardive `LATE_CLAIM` (mission 9b, lot WP10, T044 et T046 ; FR-016,
// FR-024 ; ADR-67, ADR-74, ADR-75). Deux personnes du back-office, annulation de casse puis
// remboursement sous le même point de sauvegarde, bornes de la base (CL024) précontrôlées par
// l'API.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LATE_CLAIM_ROLES } from '../../../src/late-claims/late-claim-action';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { FUNDS, LateWorld, ORGANIZER_SHARE } from './late-claim-fixtures';

jest.setTimeout(180_000);

describe('réclamation tardive (LATE_CLAIM)', () => {
  let lw: LateWorld;
  beforeAll(async () => {
    lw = await LateWorld.create();
  }, 240_000);
  afterEach(async () => {
    await lw.reset();
  });
  afterAll(async () => {
    await lw.close();
  });

  it('les rôles de la demande sont bornés : ORGANIZER_ADMIN et OPERATOR_ADMIN, aucun autre', () => {
    expect([...LATE_CLAIM_ROLES].sort()).toEqual(['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
  });

  it('FR-016 : demande (rien d’écrit) puis approbation par une autre personne : deux transactions, solde à 0, droits au prorata', async () => {
    const { walletId } = await lw.brokenWallet();
    const tap = await lw.tap(walletId);
    await lw.lock();
    const writes = await lw.lateWrites();
    const orgBefore = await lw.casse('ORG_CASSE');
    const opeBefore = await lw.casse('OPE_CASSE');
    const key = randomUUID();
    const asked = await lw.claim(
      lw.claimBody(walletId, { proof: { kind: 'MEDIA_TAP', tap_id: tap } }),
      lw.author(),
      key,
    );
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({
      action: 'LATE_CLAIM',
      status: 'PENDING',
      target_id: walletId,
    });
    expect(await lw.lateWrites()).toBe(writes);
    expect(await lw.walletPaid(walletId)).toBe(0n);

    const done = await lw.approve(asked.body.approval_request_id);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('EXECUTED');
    const result = done.body.result as Record<string, unknown>;
    expect(result).toMatchObject({
      ledger_id: lw.ledgerId,
      wallet_id: walletId,
      amount: FUNDS,
      currency: 'XOF',
      approved_by: lw.validator().userId,
    });
    const reversal = await lw.transactions(['BREAKAGE_REVERSAL'], `bo:${key}:reversal`);
    const refund = await lw.transactions(['WALLET_REFUND'], `bo:${key}:refund`);
    expect(reversal).toHaveLength(1);
    expect(refund).toHaveLength(1);
    expect(result.breakage_reversal_transaction_id).toBe(reversal[0]!.id);
    expect(result.wallet_refund_transaction_id).toBe(refund[0]!.id);
    for (const tx of [reversal[0]!, refund[0]!]) {
      expect(tx).toMatchObject({
        source: 'BACKOFFICE',
        created_by: lw.author().userId,
        approved_by: lw.validator().userId,
      });
      expect(tx.metadata).toMatchObject({ approval_request_id: asked.body.approval_request_id });
    }
    // Annulation de casse : chaque bénéficiaire est débité au prorata de sa part d'origine.
    expect(await lw.lines(reversal[0]!.id)).toMatchObject({
      WALLET_PAID: -FUNDS,
      'L-ORG-CASSE': ORGANIZER_SHARE,
      'L-OPE-CASSE': FUNDS - ORGANIZER_SHARE,
    });
    // Remboursement tardif : sans frais, du portefeuille vers le compte d'argent du canal.
    expect(await lw.lines(refund[0]!.id)).toEqual({ WALLET_PAID: FUNDS, 'A-PSP-WAVE': -FUNDS });
    expect(await lw.walletPaid(walletId)).toBe(0n);
    expect(await lw.casse('ORG_CASSE')).toBe(orgBefore - BigInt(ORGANIZER_SHARE));
    expect(await lw.casse('OPE_CASSE')).toBe(opeBefore - BigInt(FUNDS - ORGANIZER_SHARE));

    // FR-024 : une ligne d'audit par demande, une par exécution.
    const audit = await ownerRows<{ action: string }>(
      `SELECT action FROM audit_log WHERE object_id = $1 OR object_id = $2`,
      [walletId, asked.body.approval_request_id],
    );
    expect(audit.filter((row) => row.action === 'LATE_CLAIM_REQUESTED')).toHaveLength(1);
    expect(audit.filter((row) => row.action === 'APPROVAL_EXECUTED')).toHaveLength(1);
  });

  it('FR-016 : annulation au-delà de la casse prise, ou deux fois la même : 409 LATE_CLAIM_INVALID, rien d’écrit', async () => {
    const { walletId } = await lw.brokenWallet();
    const { walletId: intact } = await lw.pw.wallet({ funds: 500 });
    await lw.lock();
    const writes = await lw.lateWrites();
    const over = await lw.claim(lw.claimBody(walletId, { amount: FUNDS + 1 }));
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('LATE_CLAIM_INVALID');
    // Une première réclamation de 4 000 est exécutée ; 7 000 dépassent alors les 6 000 restants.
    const first = await lw.claim(lw.claimBody(walletId, { amount: 4_000 }));
    expect((await lw.approve(first.body.approval_request_id)).body.status).toBe('EXECUTED');
    const again = await lw.claim(lw.claimBody(walletId, { amount: 7_000 }));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('LATE_CLAIM_INVALID');
    // Une réclamation sur un portefeuille sans casse : même refus.
    const none = await lw.claim(lw.claimBody(intact, { amount: 100 }));
    expect([none.status, none.body.code]).toEqual([409, 'LATE_CLAIM_INVALID']);
    expect(await lw.lateWrites()).toBe(writes + 2);
    // Le solde restant se réclame, puis plus rien.
    const rest = await lw.claim(lw.claimBody(walletId, { amount: 6_000 }));
    expect((await lw.approve(rest.body.approval_request_id)).body.status).toBe('EXECUTED');
    const extra = await lw.claim(lw.claimBody(walletId, { amount: 1 }));
    expect(extra.body.code).toBe('LATE_CLAIM_INVALID');
  });

  it('FR-016 : grand livre non verrouillé, délai dépassé, sous EDGE : refusés avant toute écriture', async () => {
    const { walletId } = await lw.brokenWallet();
    const writes = await lw.lateWrites();
    const requests = (await lw.requests('LATE_CLAIM')).length;
    const open = await lw.claim(lw.claimBody(walletId));
    expect([open.status, open.body.code]).toEqual([409, 'CONFLICT_STATE']);
    await withOwner((db) =>
      db.query(`UPDATE ledger SET status = 'CLOSING' WHERE id = $1`, [lw.ledgerId]),
    );
    expect((await lw.claim(lw.claimBody(walletId))).body.code).toBe('CONFLICT_STATE');
    await lw.lock("clock_timestamp() - interval '1 minute'");
    const late = await lw.claim(lw.claimBody(walletId));
    expect([late.status, late.body.code]).toEqual([409, 'LEDGER_LOCKED']);
    await lw.lock('NULL');
    expect((await lw.claim(lw.claimBody(walletId))).body.code).toBe('LEDGER_LOCKED');
    await lw.lock();
    await withOwner(async (db) => {
      const gateway = await db.query<{ id: string }>(
        `INSERT INTO edge_gateway (operator_id, event_id, serial, role, status, lan_url)
         VALUES ($1, $2, $3, 'PRIMARY', 'ACTIVE', 'https://10.9.9.9:8443') RETURNING id`,
        [lw.operatorId, lw.eventId, `GW-${randomUUID().slice(0, 8)}`],
      );
      await db.query(
        `UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = $2 WHERE id = $1`,
        [lw.ledgerId, gateway.rows[0]!.id],
      );
    });
    const edge = await lw.claim(lw.claimBody(walletId));
    expect([edge.status, edge.body.code]).toEqual([409, 'DEBIT_AUTHORITY_EDGE']);
    expect(await lw.lateWrites()).toBe(writes);
    expect((await lw.requests('LATE_CLAIM')).length).toBe(requests);
  });

  it('exécution : délai dépassé ou autorité EDGE entre la demande et l’approbation : FAILED, rien d’écrit', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const writes = await lw.lateWrites();
    const asked = await lw.claim(lw.claimBody(walletId));
    await lw.lock("clock_timestamp() - interval '1 minute'");
    const res = await lw.approve(asked.body.approval_request_id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'FAILED', failure_code: 'LEDGER_LOCKED' });
    expect(res.body.failure_reason).toEqual(expect.any(String));
    expect(await lw.lateWrites()).toBe(writes);
    expect(await lw.walletPaid(walletId)).toBe(BigInt(0));
  });

  it('deux personnes : l’auteur ne valide pas sa demande ; SUPERVISOR et CASHIER refusés ; autre organisateur et autre prestataire refusés', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const writes = await lw.lateWrites();
    const asked = await lw.claim(lw.claimBody(walletId));
    const self = await lw.approve(asked.body.approval_request_id, lw.author());
    expect(self.status).toBeGreaterThanOrEqual(400);
    const bySupervisor = await lw.approve(asked.body.approval_request_id, lw.cw.supervisor);
    expect(bySupervisor.status).toBe(403);
    expect(await lw.lateWrites()).toBe(writes);
    const [state] = await lw.requests('LATE_CLAIM', walletId);
    expect(state!.status).toBe('PENDING');
    // La base refuse aussi : created_by = approved_by.
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [lw.operatorId]);
      await expect(
        db.query(
          `SELECT post_transaction($1, 'ADJUSTMENT', $2, clock_timestamp(), 'BACKOFFICE', jsonb_build_array(
             jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'), 'amount', 1::bigint),
             jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'ORG_CASSE'), 'amount', -1::bigint)),
             NULL, NULL, $3, $3)`,
          [lw.ledgerId, `test-self:${randomUUID()}`, lw.author().userId],
        ),
      ).rejects.toThrow();
    });
    for (const who of [lw.cw.cashier2, lw.cw.supervisor, lw.w.platformAdmin])
      expect((await lw.claim(lw.claimBody(walletId), who)).status).toBe(403);
    expect([404, 403]).toContain(
      (await lw.claim(lw.claimBody(walletId), lw.cw.organizerAdminOp2)).status,
    );
    expect((await lw.requests('LATE_CLAIM', walletId)).length).toBe(1);
    // Les deux rôles du lot peuvent demander ; l'autre valide.
    const byOrganizer = await lw.claim(lw.claimBody(walletId, { amount: 100 }), lw.validator());
    expect(byOrganizer.status).toBe(409); // une demande est déjà ouverte pour ce portefeuille
    const done = await lw.approve(asked.body.approval_request_id, lw.cw.operatorAdmin2);
    expect(done.body.status).toBe('EXECUTED');
  });

  it('une seconde demande PENDING du même portefeuille : 409 ; après exécution, une demande de reste est permise', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const first = await lw.claim(lw.claimBody(walletId, { amount: 3_000 }));
    expect(first.status).toBe(202);
    const second = await lw.claim(lw.claimBody(walletId, { amount: 1_000 }));
    expect([second.status, second.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect((await lw.approve(first.body.approval_request_id)).body.status).toBe('EXECUTED');
    expect((await lw.claim(lw.claimBody(walletId, { amount: 1_000 }))).status).toBe(202);
  });

  it('tout ou rien : l’échec du remboursement annule l’annulation de casse, la demande passe FAILED', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const writes = await lw.lateWrites();
    const asked = await lw.claim(lw.claimBody(walletId));
    // Compte d'argent absent à l'exécution (renommé après la demande) : échec APRÈS l'annulation de
    // casse.
    await withOwner((db) =>
      db.query(
        `UPDATE account SET code = 'A-PSP-WAVE-X' WHERE ledger_id = $1 AND code = 'A-PSP-WAVE'`,
        [lw.ledgerId],
      ),
    );
    const res = await lw.approve(asked.body.approval_request_id);
    await withOwner((db) =>
      db.query(
        `UPDATE account SET code = 'A-PSP-WAVE' WHERE ledger_id = $1 AND code = 'A-PSP-WAVE-X'`,
        [lw.ledgerId],
      ),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.failure_reason).toMatch(/A-PSP-WAVE/);
    expect(await lw.lateWrites()).toBe(writes);
    expect(await lw.walletPaid(walletId)).toBe(0n);
    expect(await lw.casse('ORG_CASSE')).toBeGreaterThanOrEqual(BigInt(ORGANIZER_SHARE));
    const reversals = await ownerRows(
      `SELECT 1 FROM journal_transaction WHERE ledger_id = $1
          AND metadata->>'approval_request_id' = $2`,
      [lw.ledgerId, asked.body.approval_request_id],
    );
    expect(reversals).toHaveLength(0);
  });

  it('charge modifiée par la base (propriétaire) puis approbation : refus, rien d’écrit', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const writes = await lw.lateWrites();
    const asked = await lw.claim(lw.claimBody(walletId));
    // La base interdit de modifier une demande : le propriétaire neutralise ses gardes le temps de
    // l'essai.
    await withOwner(async (db) => {
      await db.query(`SET session_replication_role = replica`);
      await db.query(
        `UPDATE approval_request SET payload = payload || '{"account": "A-BANQUE"}'::jsonb WHERE id = $1`,
        [asked.body.approval_request_id],
      );
      await db.query(`SET session_replication_role = DEFAULT`);
    });
    const res = await lw.approve(asked.body.approval_request_id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
    expect(await lw.lateWrites()).toBe(writes);
    expect(await lw.walletPaid(walletId)).toBe(0n);
  });

  it('corps : champ étranger, devise ou montant invalides, IBAN faux, motif court : 422, rien d’écrit', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const requests = (await lw.requests('LATE_CLAIM')).length;
    const bad: Record<string, unknown>[] = [
      { extra: 1 },
      { amount: 0 },
      { amount: 1.5 },
      { currency: 'EUR' },
      { reason: 'court' },
      { destination: { method: 'BANK_TRANSFER', iban: 'SN00INVALID' } },
      { destination: { method: 'WAVE' } },
      { destination: { method: 'CASH', msisdn: '+221770000002' } },
      { proof: { kind: 'MEDIA_TAP' } },
      { proof: { kind: 'CUSTOMER_ACCOUNT', tap_id: 3 } },
    ];
    for (const over of bad) {
      const res = await lw.claim(lw.claimBody(walletId, over));
      expect([JSON.stringify(over), res.status]).toEqual([JSON.stringify(over), 422]);
    }
    expect((await lw.requests('LATE_CLAIM')).length).toBe(requests);
  });

  it('concurrence : 20 approbations simultanées, une seule paire d’écritures ; 20 rejeux de la même clé, une seule demande', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const writes = await lw.lateWrites();
    const key = randomUUID();
    const replays = await Promise.all(
      Array.from({ length: 20 }, () => lw.claim(lw.claimBody(walletId), lw.author(), key)),
    );
    // Une clé en cours de traitement reçoit 409 ; les autres rejeux reçoivent la réponse d'origine.
    expect(replays.every((r) => r.status === 202 || r.status === 409)).toBe(true);
    const accepted = replays.filter((r) => r.status === 202);
    expect(accepted.length).toBeGreaterThan(0);
    expect(new Set(accepted.map((r) => r.body.approval_request_id)).size).toBe(1);
    expect(await lw.requests('LATE_CLAIM', walletId)).toHaveLength(1);
    const id = accepted[0]!.body.approval_request_id;
    const approvals = await Promise.all(Array.from({ length: 20 }, () => lw.approve(id)));
    expect(approvals.filter((r) => r.status === 200 && r.body.status === 'EXECUTED')).toHaveLength(
      1,
    );
    expect(await lw.lateWrites()).toBe(writes + 2);
    expect(await lw.transactions(['BREAKAGE_REVERSAL'], `bo:${key}:reversal`)).toHaveLength(1);
    expect(await lw.transactions(['WALLET_REFUND'], `bo:${key}:refund`)).toHaveLength(1);
  });

  it('concurrence : deux demandes simultanées pour le même portefeuille : une seule acceptée, l’autre 409', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const results = await Promise.all([
      lw.claim(lw.claimBody(walletId, { amount: 1_000 })),
      lw.claim(lw.claimBody(walletId, { amount: 2_000 })),
      lw.claim(lw.claimBody(walletId, { amount: 3_000 })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409, 409]);
    expect(await lw.requests('LATE_CLAIM', walletId)).toHaveLength(1);
  });

  // Le masque générique des charges (`approval/approval.mapper.ts`) est posé par WP08, pas par ce
  // lot : tant qu'il n'est pas dans la base de la lane, l'essai est suspendu ; il est rejoué tel
  // quel à la consolidation.
  const masked = readFileSync(
    join(__dirname, '../../../src/approval/approval.mapper.ts'),
    'utf8',
  ).includes('iban');
  (masked ? it : it.skip)(
    'FR-024 : ni IBAN ni numéro dans l’audit ni dans GET /approval-requests (masque de WP08)',
    async () => {
      const { walletId } = await lw.brokenWallet();
      await lw.lock();
      const iban = 'SN08SN0100152000048500003035';
      const msisdn = '+221770000099';
      const bank = await lw.claim(
        lw.claimBody(walletId, { amount: 4_000, destination: { method: 'BANK_TRANSFER', iban } }),
      );
      expect((await lw.approve(bank.body.approval_request_id)).body.status).toBe('EXECUTED');
      const wave = await lw.claim(
        lw.claimBody(walletId, { amount: 1_000, destination: { method: 'WAVE', msisdn } }),
      );
      expect(wave.status).toBe(202);
      const audit = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE (before::text LIKE ANY($1) OR after::text LIKE ANY($1))
            AND (after->>'target_id' = $2 OR before->>'target_id' = $2)`,
        [[`%${iban}%`, `%${msisdn}%`], walletId],
      );
      expect(audit[0]!.n).toBe(0);
      const list = await lw.cw.bo('GET', '/approval-requests', lw.validator());
      expect(JSON.stringify(list.body)).not.toContain(iban);
      expect(JSON.stringify(list.body)).not.toContain(msisdn);
    },
  );
});
