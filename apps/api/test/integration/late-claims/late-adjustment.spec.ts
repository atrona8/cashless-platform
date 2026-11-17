// Intégration : apport d'un bénéficiaire de la casse `ADJUSTMENT` (mission 9b, lot WP10, T045 et
// T046 ; FR-016, FR-024 ; ADR-75 ; route 14 `postLateAdjustment`). Écriture bornée par la base
// (CL024) : au plus ce qui a été annulé sur le compte de casse depuis le verrouillage ;
// précontrôlée par l'API. Deux personnes du back-office.
import { randomUUID } from 'node:crypto';
import { LATE_ADJUSTMENT_ROLES } from '../../../src/late-claims/late-adjustment-action';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { LateWorld } from './late-claim-fixtures';

jest.setTimeout(180_000);

describe('apport tardif (ADJUSTMENT)', () => {
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

  const body = (over: Record<string, unknown> = {}) => ({
    beneficiary_party_id: lw.organizerId,
    amount: 1_000,
    currency: 'XOF',
    reason: 'Apport de l’organisateur après réclamation tardive.',
    ...over,
  });

  /**
   * Casse prise, grand livre verrouillé, réclamation tardive exécutée : de quoi alimenter l'apport.
   */
  async function claimed(): Promise<string> {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const asked = await lw.claim(lw.claimBody(walletId));
    expect((await lw.approve(asked.body.approval_request_id)).body.status).toBe('EXECUTED');
    return walletId;
  }

  it('sans casse annulée (premier essai du fichier, grand livre sans réclamation) : 409 LATE_CLAIM_INVALID, rien d’écrit', async () => {
    await lw.brokenWallet();
    await lw.lock();
    const writes = await lw.lateWrites();
    const none = await lw.adjust(body());
    expect([none.status, none.body.code]).toEqual([409, 'LATE_CLAIM_INVALID']);
    expect(await lw.lateWrites()).toBe(writes);
  });

  it('les rôles de la demande sont bornés : ORGANIZER_ADMIN et OPERATOR_ADMIN, aucun autre', () => {
    expect([...LATE_ADJUSTMENT_ROLES].sort()).toEqual(['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
  });

  it('FR-016 : apport de l’organisateur à deux : A-BANQUE débité, compte de casse crédité, source BACKOFFICE', async () => {
    await claimed();
    const before = await lw.casse('ORG_CASSE');
    const writes = await lw.lateWrites();
    const key = randomUUID();
    const amount = Number(await lw.room('ORG_CASSE'));
    const asked = await lw.adjust(body({ amount }), lw.author(), key);
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({ action: 'ADJUSTMENT', status: 'PENDING' });
    expect(await lw.lateWrites()).toBe(writes);
    const done = await lw.approve(asked.body.approval_request_id);
    expect(done.body.status).toBe('EXECUTED');
    const [tx] = await lw.transactions(['ADJUSTMENT'], `bo:${key}`);
    expect(tx).toMatchObject({
      source: 'BACKOFFICE',
      created_by: lw.author().userId,
      approved_by: lw.validator().userId,
    });
    expect(tx!.metadata).toMatchObject({
      approval_request_id: asked.body.approval_request_id,
      reason: expect.any(String),
    });
    expect(await lw.lines(tx!.id)).toEqual({ 'A-BANQUE': amount, 'L-ORG-CASSE': -amount });
    expect(await lw.casse('ORG_CASSE')).toBe(before + BigInt(amount));
    expect((done.body.result as { transaction_id: string }).transaction_id).toBe(tx!.id);
    // FR-024 : une ligne d'audit par demande et par exécution.
    const audit = await ownerRows<{ action: string }>(
      `SELECT action FROM audit_log WHERE object_id = $1 OR object_id = $2`,
      [lw.ledgerId, asked.body.approval_request_id],
    );
    expect(audit.filter((a) => a.action === 'LATE_ADJUSTMENT_REQUESTED')).toHaveLength(1);
    expect(audit.filter((a) => a.action === 'APPROVAL_EXECUTED')).toHaveLength(1);
  });

  it('apport du prestataire : compte OPE_CASSE', async () => {
    await claimed();
    const asked = await lw.adjust(body({ beneficiary_party_id: lw.operatorId, amount: 4_000 }));
    expect(asked.status).toBe(202);
    const done = await lw.approve(asked.body.approval_request_id);
    expect(done.body.status).toBe('EXECUTED');
    const id = (done.body.result as { transaction_id: string }).transaction_id;
    expect(await lw.lines(id)).toEqual({ 'A-BANQUE': 4_000, 'L-OPE-CASSE': -4_000 });
  });

  it('borné par l’annulation de casse déjà faite : au-delà, ou après un apport déjà fait : 409 LATE_CLAIM_INVALID', async () => {
    const walletId = await claimed();
    void walletId;
    const room = await lw.room('ORG_CASSE');
    expect(room).toBeGreaterThan(0n);
    const over = await lw.adjust(body({ amount: Number(room) + 1 }));
    expect([over.status, over.body.code]).toEqual([409, 'LATE_CLAIM_INVALID']);
    const writes = await lw.lateWrites();
    const first = await lw.adjust(body({ amount: Number(room) - 1 }));
    expect((await lw.approve(first.body.approval_request_id)).body.status).toBe('EXECUTED');
    expect(await lw.room('ORG_CASSE')).toBe(1n);
    const rest = await lw.adjust(body({ amount: 2 }));
    expect([rest.status, rest.body.code]).toEqual([409, 'LATE_CLAIM_INVALID']);
    expect((await lw.adjust(body({ amount: 1 }))).status).toBe(202);
    expect(await lw.lateWrites()).toBe(writes + 1);
  });

  it('la base refuse d’elle-même : apport au-delà, vers un compte de portefeuille ou hors casse (CL024)', async () => {
    const walletId = await claimed();
    const room = Number(await lw.room('ORG_CASSE'));
    const post = (credit: 'ORG_CASSE' | 'WALLET' | 'ORG_FFEST', amount: number) =>
      withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [lw.operatorId]);
        const id = async (sql: string, ...params: unknown[]) =>
          (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
        const bank = await id(
          `SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'`,
          lw.ledgerId,
        );
        const target =
          credit === 'WALLET'
            ? await id(
                `SELECT id FROM account WHERE wallet_id = $1 AND purpose = 'WALLET_PAID'`,
                walletId,
              )
            : await id(
                `SELECT id FROM account WHERE ledger_id = $1 AND purpose = $2`,
                lw.ledgerId,
                credit,
              );
        return db.query(
          `SELECT post_transaction($1, 'ADJUSTMENT', $2, clock_timestamp(), 'BACKOFFICE', $3::jsonb,
                                   NULL, NULL, $4, $5)`,
          [
            lw.ledgerId,
            `test-db-bound:${randomUUID()}`,
            JSON.stringify([
              { account_id: bank, amount },
              { account_id: target, amount: -amount },
            ]),
            lw.author().userId,
            lw.validator().userId,
          ],
        );
      });
    await expect(post('ORG_CASSE', room + 1)).rejects.toMatchObject({ code: 'CL024' });
    await expect(post('WALLET', 100)).rejects.toMatchObject({ code: 'CL024' });
    await expect(post('ORG_FFEST', 100)).rejects.toMatchObject({ code: 'CL024' });
  });

  it('bénéficiaire hors casse (ni organisateur ni prestataire) ou casse versée à un compte légal : 422, rien d’écrit', async () => {
    await claimed();
    const writes = await lw.lateWrites();
    const stranger = await lw.adjust(body({ beneficiary_party_id: randomUUID() }));
    expect(stranger.status).toBe(422);
    const platform = await ownerRows<{ id: string }>(
      `SELECT id FROM party WHERE kind = 'PLATFORM' LIMIT 1`,
    );
    await withOwner((db) =>
      db.query(
        `INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side)
         VALUES ($1, $2, 'L-LEGAL-BREAKAGE-T', 'CLAIM', 'LEGAL_BREAKAGE', $3, 'C')
         ON CONFLICT DO NOTHING`,
        [lw.operatorId, lw.ledgerId, platform[0]!.id],
      ),
    );
    const legal = await lw.adjust(body({ beneficiary_party_id: platform[0]!.id }));
    expect(legal.status).toBe(422);
    expect(legal.body.detail).toMatch(/légal/);
    expect(await lw.lateWrites()).toBe(writes);
  });

  it('portée : grand livre non verrouillé, délai dépassé : 409 ; corps : champ étranger, motif court : 422', async () => {
    await lw.brokenWallet();
    const open = await lw.adjust(body());
    expect([open.status, open.body.code]).toEqual([409, 'CONFLICT_STATE']);
    await lw.lock("clock_timestamp() - interval '1 minute'");
    const late = await lw.adjust(body());
    expect([late.status, late.body.code]).toEqual([409, 'LEDGER_LOCKED']);
    await lw.lock();
    for (const over of [{ extra: 1 }, { reason: 'court' }, { amount: 0 }, { currency: 'EUR' }])
      expect((await lw.adjust(body(over))).status).toBe(422);
  });

  it('deux personnes : l’auteur ne valide pas ; SUPERVISOR, CASHIER refusés ; l’autre personne valide ; 20 approbations : une écriture', async () => {
    await claimed();
    const writes = await lw.lateWrites();
    const asked = await lw.adjust(body({ amount: 500 }));
    expect(
      (await lw.approve(asked.body.approval_request_id, lw.author())).status,
    ).toBeGreaterThanOrEqual(400);
    for (const who of [lw.cw.supervisor, lw.cw.cashier2])
      expect((await lw.adjust(body(), who)).status).toBe(403);
    expect(await lw.lateWrites()).toBe(writes);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => lw.approve(asked.body.approval_request_id)),
    );
    expect(results.filter((r) => r.status === 200 && r.body.status === 'EXECUTED')).toHaveLength(1);
    expect(await lw.lateWrites()).toBe(writes + 1);
  });

  it('charge modifiée par la base puis approbation : refus, rien d’écrit', async () => {
    await claimed();
    const writes = await lw.lateWrites();
    const asked = await lw.adjust(body({ amount: 500 }));
    await withOwner(async (db) => {
      await db.query(`SET session_replication_role = replica`);
      await db.query(
        `UPDATE approval_request SET payload = payload || '{"account": "A-CAISSE-1"}'::jsonb WHERE id = $1`,
        [asked.body.approval_request_id],
      );
      await db.query(`SET session_replication_role = DEFAULT`);
    });
    const res = await lw.approve(asked.body.approval_request_id);
    expect(res.body.status).toBe('FAILED');
    expect(await lw.lateWrites()).toBe(writes);
  });
});
