// Paiement : verrous et rejeux (mission 5b, lot WP11, cycle 2 ; NFR-005, NFR-006 ; A7). Ordre global des verrous
// terminal → vendeur → session → demande QR → bracelet → portefeuille. Chaque test tient une écriture NON validée du
// propriétaire, lance la vente, attend qu'une session `cashless_app` soit réellement bloquée sur le verrou visé
// (jamais un délai), puis valide : l'issue ne dépend pas du hasard. À lancer EN SÉRIE (`--runInBand`).
//  - garde de session : `FOR SHARE` du vendeur et de la session (une fermeture concurrente attend la vente) ;
//  - ordre : la garde vient APRÈS la prise du terminal (sinon interblocage avec une fermeture qui prend le terminal
//    puis les sessions, comme `set_device_status`) ;
//  - terminal suspendu entre la garde d'identité et la prise du verrou : refus par `assert_device_active` ;
//  - rejeux : écriture du moteur déjà faite sous la même clé, numéro déjà rangé `ACCEPTED` → 409, rien de lié.
import 'reflect-metadata';
import { purchaseContent } from '../../../src/payments/device-seq-registry';
import { commitWhileWaiting, connect, OWNER_URL, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { asOperator } from '../vendors/vendor-fixtures';
import { PaymentWorld, type PayMedia, type PayTerminal } from './payments-fixtures';

jest.setTimeout(240_000);

const CLOSE_SESSION = `UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT' WHERE id = $1`;

describe('createPayment : verrous (WP11, cycle 2)', () => {
  let pw: PaymentWorld;

  beforeAll(async () => {
    pw = await PaymentWorld.create();
  });
  afterAll(async () => {
    await pw?.close();
  });

  const media = async (funds = 20_000): Promise<PayMedia> => (await pw.media(1, funds))[0]!;
  const keypad = () => pw.terminal({ mode: 'KEYPAD_TPE' });
  const nothingWritten = async (term: PayTerminal, walletId: string) => {
    expect(await pw.footprint(term.t.deviceId)).toMatchObject({
      sales: 0,
      lines: 0,
      attributions: 0,
      consumed: 0,
      accepted: 0,
      confirmed: 0,
    });
    expect(await pw.spendable(walletId)).toBe(20_000);
  };

  it('session fermée pendant que la vente attend son verrou : 409 VENDOR_SESSION_INVALID, rien d’écrit', async () => {
    const term = await keypad();
    const m = await media();
    const res = await commitWhileWaiting(
      { sql: CLOSE_SESSION, params: [term.sessionId] },
      { role: 'cashless_app', statement: 'assert_vendor_session' },
      () => pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000)),
    );
    expect([res.status, res.body.code]).toEqual([409, 'VENDOR_SESSION_INVALID']);
    expect(await pw.footprint(term.t.deviceId)).toMatchObject({
      sales: 0,
      lines: 0,
      attributions: 0,
      consumed: 0,
      accepted: 0,
    });
    expect(await pw.spendable(m.walletId)).toBe(20_000);
  });

  it('ordre des verrous terminal → session : une fermeture qui prend le terminal puis la session ne provoque aucun interblocage', async () => {
    const term = await keypad();
    const m = await media();
    const holder = await connect(OWNER_URL);
    try {
      // FOR NO KEY UPDATE comme un UPDATE de `set_device_status` : n'arrête pas la garde d'identité (FOR KEY SHARE),
      // arrête la prise du terminal de la vente (FOR UPDATE).
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM device WHERE id = $1 FOR NO KEY UPDATE', [term.t.deviceId]);
      const pending = Promise.resolve(pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000)));
      pending.catch(() => undefined);
      await waitBlocked('FOR UPDATE OF d');
      // La vente attend le terminal sans rien tenir : cette mise à jour de la session ne peut pas l'attendre.
      await holder.query('SET LOCAL lock_timeout = 5000');
      await holder.query(CLOSE_SESSION, [term.sessionId]);
      await holder.query('COMMIT');
      const res = await pending;
      expect([res.status, res.body.code]).toEqual([409, 'VENDOR_SESSION_INVALID']);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    expect(await pw.footprint(term.t.deviceId)).toMatchObject({ sales: 0, attributions: 0 });
    expect(await pw.spendable(m.walletId)).toBe(20_000);
  });

  it('terminal suspendu entre la garde d’identité et la prise du verrou : 403 DEVICE_SUSPENDED, rien d’écrit', async () => {
    const term = await keypad();
    const m = await media();
    // La session reste ouverte (seul le statut change). Moyen = QR client : la lecture d'un bracelet refait
    // elle-même `assert_device_active` (TapService) et masquerait l'appel du service.
    const token = await pw.customerQr(m.walletId);
    const res = await commitWhileWaiting(
      { sql: `UPDATE device SET status = 'SUSPENDED' WHERE id = $1`, params: [term.t.deviceId] },
      { role: 'cashless_app', statement: 'FOR UPDATE OF d' },
      () => pw.pay(term, pw.keypadBody(term, { customer_qr_token: token }, 1000)),
    );
    expect([res.status, res.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
    await nothingWritten(term, m.walletId);
  });

  it('numéro déjà rangé ACCEPTED avec ce contenu (autre transaction) : 409 IDEMPOTENCY_KEY_REUSED, ni vente ni lien', async () => {
    const term = await keypad();
    const m = await media();
    const [m2] = [await media()];
    const first = await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000));
    expect(first.status).toBe(201);
    const key = term.t.seqKey();
    const seq = Number(key.split(':')[1]);
    const token = await pw.customerQr(m2.walletId);
    const body = pw.keypadBody(term, { customer_qr_token: token }, 1000);
    // Le numéro est déjà rangé ACCEPTED avec le contenu de CE corps (posé hors idempotence de l'API).
    await withOwner((db) =>
      asOperator(db, pw.w.ops.a, () =>
        db.query(`SELECT record_device_seq($1, $2, $3, 'ACCEPTED', 'ONLINE', $4)`, [
          term.t.deviceId,
          seq,
          purchaseContent(BigInt(seq), body),
          first.body.transaction_id,
        ]),
      ),
    );
    const before = await pw.footprint(term.t.deviceId);
    const res = await pw.pay(term, body, { key });
    expect([res.status, res.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    expect(await pw.footprint(term.t.deviceId)).toEqual(before);
    expect(await pw.spendable(m2.walletId)).toBe(20_000);
  });

  it('écriture du moteur déjà faite sous la même clé, hors idempotence de l’API : 409 IDEMPOTENCY_KEY_REUSED, rien de lié', async () => {
    const term = await keypad();
    const m = await media();
    const key = term.t.seqKey();
    const token = await pw.customerQr(m.walletId);
    const body = pw.keypadBody(term, { customer_qr_token: token }, 1000);
    // Une écriture du grand livre porte déjà cette clé (rien dans `api_idempotency`, rien au registre des
    // numéros) : le moteur répond « rejeu ».
    await ownerRows(
      `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash,
                                        occurred_at, source, device_id)
       VALUES (gen_random_uuid(), $1, $2, 'PURCHASE', $3, 'empreinte', now(), 'ONLINE', $4) RETURNING id`,
      [pw.w.ops.a, pw.w.ids.ledgerA, key, term.t.deviceId],
    );
    const before = await pw.footprint(term.t.deviceId);
    const res = await pw.pay(term, body, { key });
    expect([res.status, res.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    // Rien de lié : seul le refus est rangé au registre (409 définitif), aucune vente de plus.
    expect(await pw.footprint(term.t.deviceId)).toEqual({ ...before, rejected: 1 });
    expect(await pw.spendable(m.walletId)).toBe(20_000);
    expect(await pw.registry(term.t.deviceId)).toMatchObject([
      { outcome: 'REJECTED', reason: 'IDEMPOTENCY_KEY_REUSED', transaction_id: null },
    ]);
  });
});

/** Attend (sans délai fixe) qu'une session `cashless_app` soit bloquée sur un verrou, instruction contenant `statement`. */
async function waitBlocked(statement: string): Promise<void> {
  for (let waited = 0; ; waited += 20) {
    const rows = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE usename = 'cashless_app' AND wait_event_type = 'Lock' AND position($1 in query) > 0`,
      [statement],
    );
    if (rows[0]!.n > 0) return;
    if (waited >= 10_000) throw new Error(`aucune session n'attend le verrou de « ${statement} »`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
