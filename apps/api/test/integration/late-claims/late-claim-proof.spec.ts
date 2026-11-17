// Intégration : preuve du droit d'une réclamation tardive (mission 9b, lot WP10, T044 et T046 ;
// FR-016 ; openapi `postLateClaim`). Contrôle de l'API seule (aucune garde SQL), à la demande puis
// à l'exécution : `tap_id` d'un terminal du même prestataire pour un bracelet de ce portefeuille,
// ou portefeuille rattaché à un client. Toute preuve manquante, étrangère ou d'un autre
// portefeuille reçoit la MÊME réponse `422`, sans écriture.
import { withOwner } from '../../support/db';
import { LateWorld } from './late-claim-fixtures';

jest.setTimeout(180_000);

describe('preuve du droit (late-claim-proof)', () => {
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

  const tapProof = (tap: number) => ({ proof: { kind: 'MEDIA_TAP', tap_id: tap } });

  it('MEDIA_TAP valide : acceptée ; bracelet rattaché puis rendu (rattachement passé) : acceptée', async () => {
    const { walletId } = await lw.brokenWallet();
    const { walletId: second } = await lw.brokenWallet(2_000);
    const live = await lw.tap(walletId);
    const released = await lw.tap(second, { released: true });
    await lw.lock();
    const a = await lw.claim(lw.claimBody(walletId, { amount: 1_000, ...tapProof(live) }));
    expect(a.status).toBe(202);
    const b = await lw.claim(lw.claimBody(second, { amount: 1_000, ...tapProof(released) }));
    expect(b.status).toBe(202);
  });

  it('tap_id inconnu, d’un autre portefeuille, d’un autre prestataire, sans terminal : 422, même réponse, rien d’écrit', async () => {
    const { walletId } = await lw.brokenWallet();
    const { walletId: other } = await lw.pw.wallet({ funds: 100 });
    const foreignWallet = await lw.tap(other);
    const noDevice = await lw.tap(walletId, { device: false });
    const otherOperator = await lw.tap(walletId, { operatorId: lw.w.ops.b, assign: false });
    const unassigned = await lw.tap(walletId, { assign: false });
    await lw.lock();
    const writes = await lw.lateWrites();
    const requests = (await lw.requests('LATE_CLAIM')).length;
    const refusals = [];
    for (const tap of [999_999_999, foreignWallet, noDevice, otherOperator, unassigned])
      refusals.push(await lw.claim(lw.claimBody(walletId, tapProof(tap))));
    expect(refusals.map((r) => r.status)).toEqual([422, 422, 422, 422, 422]);
    // Aucun oracle : le même message pour chaque cause.
    expect(new Set(refusals.map((r) => r.body.detail)).size).toBe(1);
    expect(await lw.lateWrites()).toBe(writes);
    expect((await lw.requests('LATE_CLAIM')).length).toBe(requests);
  });

  it('CUSTOMER_ACCOUNT : portefeuille d’un client accepté ; portefeuille anonyme : 422, même réponse qu’une preuve étrangère', async () => {
    const { walletId } = await lw.brokenWallet();
    const anonymous = await lw.brokenWallet(3_000);
    await withOwner((db) =>
      db.query('UPDATE wallet SET customer_id = NULL WHERE id = $1', [anonymous.walletId]),
    );
    await lw.lock();
    const ok = await lw.claim(lw.claimBody(walletId, { amount: 500 }));
    expect(ok.status).toBe(202);
    const refused = await lw.claim(lw.claimBody(anonymous.walletId, { amount: 500 }));
    expect(refused.status).toBe(422);
    const foreign = await lw.claim(lw.claimBody(anonymous.walletId, tapProof(999_999_999)));
    expect(foreign.body.detail).toBe(refused.body.detail);
  });

  it('refaite à l’exécution : preuve devenue invalide entre la demande et l’approbation : FAILED, rien d’écrit', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const writes = await lw.lateWrites();
    const asked = await lw.claim(lw.claimBody(walletId));
    expect(asked.status).toBe(202);
    await withOwner((db) =>
      db.query('UPDATE wallet SET customer_id = NULL WHERE id = $1', [walletId]),
    );
    const res = await lw.approve(asked.body.approval_request_id);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.failure_reason).toEqual(expect.any(String));
    expect(await lw.lateWrites()).toBe(writes);
    expect(await lw.walletPaid(walletId)).toBe(0n);
  });
});
