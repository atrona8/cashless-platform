// WP21 / T093 : createTap et la table locale edge_tap (R-18). Un passage n'est pas une décision :
// rien n'entre dans la file.
import { createHash, randomBytes } from 'node:crypto';
import { makeBench, type Bench } from './_support/harness';
import { newTill, pay, queueState, type Till } from './_support/helpers';

let b: Bench;
let till: Till;
beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
  till = await newTill(b);
});
afterAll(async () => b.close());

const tapRequest = (t: Till, body: Record<string, unknown>) =>
  b.request(t.device, { method: 'POST', path: '/v1/taps', body });

describe('lecture valide', () => {
  it('OK : tap_id local (suite à partir de 2^52), solde, aucune écriture en file', async () => {
    const bracelet = await b.newBracelet({ paid: 3_000, promo: 200 });
    const before = await queueState(b);
    const res = await tapRequest(till, bracelet.tap(7));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      result: 'OK',
      media: { media_id: bracelet.mediaId, status: 'ACTIVE' },
      wallet: {
        wallet_id: bracelet.walletId,
        spendable: 3_200,
        paid: 3_000,
        promo: 200,
        currency: 'XOF',
      },
    });
    expect(res.json!.tap_id).toBeGreaterThanOrEqual(2 ** 52);
    expect(Number.isSafeInteger(res.json!.tap_id)).toBe(true);
    expect(typeof res.json!.tap_expires_at).toBe('string');
    const after = await queueState(b);
    expect(after.head).toEqual(before.head);
    expect(after.ops).toBe(before.ops);
    // La lecture complète est gardée pour le rejeu au central (objet `tap`).
    const [row] = await b.q<{ reading: Record<string, unknown>; counter: string }>(
      'SELECT reading, counter FROM edge_tap WHERE tap_id = $1',
      [res.json!.tap_id],
    );
    expect(row!.reading).toMatchObject({ counter: 7, token_hash: bracelet.tokenHash });
    expect(row!.counter).toBe('7');
  });

  it('une même lecture renvoyée (même terminal, même compteur) rend le même tap_id', async () => {
    const bracelet = await b.newBracelet();
    const first = await tapRequest(till, bracelet.tap(4));
    const again = await tapRequest(till, bracelet.tap(4));
    expect(again.status).toBe(200);
    expect(again.json!.tap_id).toBe(first.json!.tap_id);
    expect(again.json!.result).toBe('OK');
  });
});

describe('anti-clone (compteur répliqué)', () => {
  it('compteur égal ou inférieur au compteur répliqué : CLONE_SUSPECTED, aucun passage', async () => {
    const bracelet = await b.newBracelet({ counterLast: 50 });
    for (const counter of [50, 49, 0]) {
      const res = await tapRequest(till, bracelet.tap(counter));
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ result: 'CLONE_SUSPECTED', tap_id: null });
    }
    const ok = await tapRequest(till, bracelet.tap(51));
    expect(ok.json!.result).toBe('OK');
    const rows = await b.q('SELECT 1 FROM edge_tap WHERE token_hash = $1', [
      Buffer.from(bracelet.tokenHash, 'hex'),
    ]);
    expect(rows).toHaveLength(1);
    const audit = await b.q("SELECT 1 FROM edge_audit WHERE kind = 'TAP_CLONE_SUSPECTED'");
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it('un compteur déjà vu sur un AUTRE terminal est une copie suspectée', async () => {
    const bracelet = await b.newBracelet();
    const other = await newTill(b);
    expect((await tapRequest(till, bracelet.tap(9))).json!.result).toBe('OK');
    const res = await tapRequest(other, bracelet.tap(9));
    expect(res.json).toMatchObject({ result: 'CLONE_SUSPECTED', tap_id: null });
  });

  it('un compteur plus petit que le dernier vu ici est refusé (inversion)', async () => {
    const bracelet = await b.newBracelet();
    await tapRequest(till, bracelet.tap(20));
    const res = await tapRequest(till, bracelet.tap(19));
    expect(res.json!.result).toBe('CLONE_SUSPECTED');
  });

  it('un passage consommé n’est plus rejoué hors fenêtre : copie suspectée', async () => {
    const t = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 5_000 });
    const tap = await tapRequest(t, bracelet.tap(2));
    expect((await pay(b, t, { tapId: tap.json!.tap_id as number })).status).toBe(201);
    // Dans la fenêtre : renvoi réseau accepté ; au-delà : copie suspectée.
    expect((await tapRequest(t, bracelet.tap(2))).json!.result).toBe('OK');
    b.clock.advance(121_000);
    try {
      expect(
        (await tapRequest(t, bracelet.tap(2, { occurred_at: b.clock.now().toISOString() }))).json!
          .result,
      ).toBe('CLONE_SUSPECTED');
    } finally {
      b.clock.advance(-121_000);
    }
  });
});

describe('résultats du bracelet', () => {
  it('UNKNOWN : bracelet inconnu, aucun passage ; bracelet sans media_id (WP18) non utilisable', async () => {
    const stranger = await b.newBracelet();
    const unknown = { ...stranger.tap(1), token_hash: randomBytes(32).toString('hex') };
    expect((await tapRequest(till, unknown)).json).toMatchObject({
      result: 'UNKNOWN',
      tap_id: null,
      media: null,
      wallet: null,
    });
    const unlinked = await b.newBracelet();
    await b.q('UPDATE edge_media SET media_id = NULL, wallet_id = NULL WHERE token_hash = $1', [
      Buffer.from(unlinked.tokenHash, 'hex'),
    ]);
    expect((await tapRequest(till, unlinked.tap(1))).json).toMatchObject({
      result: 'UNKNOWN',
      tap_id: null,
    });
  });

  it.each([
    ['SUSPENDED', 'BLOCKED'],
    ['BLACKLISTED', 'BLOCKED'],
    ['RETIRED', 'RETIRED'],
    ['DESTROYED', 'RETIRED'],
    ['REPLACED', 'REPLACED'],
    ['PERSONALIZED', 'NOT_ACTIVATED'],
    ['ISSUED', 'NOT_ACTIVATED'],
    ['RELEASED', 'RELEASED'],
  ])('statut %s : résultat %s', async (status, result) => {
    const bracelet = await b.newBracelet({ status });
    const res = await tapRequest(till, bracelet.tap(1));
    expect(res.status).toBe(200);
    expect(res.json!.result).toBe(result);
    // BLOCKED enregistre le passage (comme le central) ; les autres refus n'en gardent aucun.
    expect(res.json!.tap_id === null).toBe(result !== 'BLOCKED');
  });

  it('lot inactif : BATCH_INACTIVE', async () => {
    const bracelet = await b.newBracelet({ batchStatus: 'SUSPENDED' });
    expect((await tapRequest(till, bracelet.tap(1))).json!.result).toBe('BATCH_INACTIVE');
  });

  it('UID différent : UID_MISMATCH ; signature différente : SIGNATURE_MISMATCH ; absente : SIGNATURE_MISSING', async () => {
    const bracelet = await b.newBracelet();
    expect(
      (await tapRequest(till, bracelet.tap(1, { nfc_uid: randomBytes(7).toString('hex') }))).json,
    ).toMatchObject({ result: 'UID_MISMATCH', tap_id: null });
    expect(
      (
        await tapRequest(
          till,
          bracelet.tap(2, {
            originality_signature: createHash('sha256').update('x').digest('hex'),
          }),
        )
      ).json,
    ).toMatchObject({ result: 'SIGNATURE_MISMATCH', tap_id: null });
    const { originality_signature: _drop, ...without } = bracelet.tap(3) as Record<string, unknown>;
    expect((await tapRequest(till, without)).json).toMatchObject({
      result: 'SIGNATURE_MISSING',
      tap_id: null,
    });
    // Aucune lecture refusée n'a consommé le compteur : la lecture valide suivante passe.
    expect((await tapRequest(till, bracelet.tap(4))).json!.result).toBe('OK');
  });

  it('corps invalide : 400 VALIDATION_FAILED, rien d’écrit', async () => {
    const bracelet = await b.newBracelet();
    const before = await queueState(b);
    for (const bad of [
      {},
      { ...bracelet.tap(1), nfc_uid: 'zz' },
      { ...bracelet.tap(1), counter: -1 },
      { ...bracelet.tap(1), counter: 16_777_216 },
      { ...bracelet.tap(1), token_hash: 'abc' },
    ]) {
      const res = await tapRequest(till, bad);
      expect(res.status).toBe(400);
      expect(res.json!.code).toBe('VALIDATION_FAILED');
    }
    expect((await tapRequest(till, { ...bracelet.tap(1), pack_verified: false })).status).toBe(422);
    expect((await queueState(b)).head).toEqual(before.head);
  });
});

describe('tap_id : seuls les passages locaux, une fois, de ce terminal', () => {
  it('un tap_id du central (petit entier) ou inconnu : 409 TAP_UNUSABLE, VOID', async () => {
    const t = await newTill(b);
    for (const id of [1, 918_273, 2 ** 52 + 999_999]) {
      const before = await queueState(b);
      const res = await pay(b, t, { tapId: id });
      expect(res.status).toBe(409);
      expect(res.json!.code).toBe('TAP_UNUSABLE');
      expect((await queueState(b)).head.last_edge_seq).toBe(before.head.last_edge_seq + 1);
    }
  });

  it('le tap_id d’un autre terminal : TAP_UNUSABLE', async () => {
    const owner = await newTill(b);
    const thief = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 5_000 });
    const tap = await tapRequest(owner, bracelet.tap(1));
    const res = await pay(b, thief, { tapId: tap.json!.tap_id as number });
    expect(res.status).toBe(409);
    expect(res.json!.code).toBe('TAP_UNUSABLE');
    expect((await pay(b, owner, { tapId: tap.json!.tap_id as number })).status).toBe(201);
  });

  it('un passage ne sert qu’à UNE écriture ; expiré après la fenêtre', async () => {
    const t = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 5_000 });
    const tap = await tapRequest(t, bracelet.tap(1));
    expect((await pay(b, t, { tapId: tap.json!.tap_id as number })).status).toBe(201);
    const second = await pay(b, t, { tapId: tap.json!.tap_id as number });
    expect(second.status).toBe(409);
    expect(second.json!.code).toBe('TAP_UNUSABLE');

    const late = await tapRequest(t, bracelet.tap(2));
    b.clock.advance(125_000);
    try {
      const res = await pay(b, t, { tapId: late.json!.tap_id as number });
      expect(res.status).toBe(409);
      expect(res.json!.code).toBe('TAP_UNUSABLE');
    } finally {
      b.clock.advance(-125_000);
    }
  });
});

describe('états d’autorité et lectures', () => {
  it('servi dans tous les états sauf REVOKED', async () => {
    const bracelet = await b.newBracelet();
    let counter = 100;
    try {
      for (const state of ['STANDBY', 'ARMED', 'RELEASING', 'STALE', 'ACTIVE']) {
        await b.setAuthority({ state });
        counter += 1;
        const res = await tapRequest(till, bracelet.tap(counter));
        expect(res.status).toBe(200);
        expect(res.json!.result).toBe('OK');
      }
      await b.setAuthority({ state: 'REVOKED' });
      const revoked = await tapRequest(till, bracelet.tap(counter + 1));
      expect(revoked.status).toBe(409);
      expect(revoked.json!.code).toBe('STALE_AUTHORITY_EPOCH');
    } finally {
      await b.setAuthority({ state: 'ACTIVE' });
    }
  });
});
