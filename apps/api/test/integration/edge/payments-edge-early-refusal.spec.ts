// Refus d'autorité `EDGE` avant le travail de la vente (NFR-001, mission passerelle-locale). `createPayment`
// lit l'autorité du grand livre avec le terminal (étape 1) et refuse `409 DEBIT_AUTHORITY_EDGE` dès l'étape 2 :
// ni session, ni `register_tap`, ni écriture. La garde SQL `CL006` reste le dernier recours.
// La transaction refusée est annulée : les lignes de passage n'en disent rien ; la preuve de l'absence de
// `register_tap` est la séquence `media_tap_id_seq` (une séquence n'est jamais annulée).
import 'reflect-metadata';
import { ownerRows } from '../../support/media-fixtures';
import type { PayMedia } from '../payments/payments-fixtures';
import { DebitCases } from '../debit-authority/debit-cases';
import { DebitWorld } from '../debit-authority/debit-authority-world';

jest.setTimeout(300_000);

describe('POST /payments : refus EDGE avant le travail de la vente (NFR-001)', () => {
  let dw: DebitWorld;
  let cases: DebitCases;
  beforeAll(async () => {
    dw = await DebitWorld.create();
    cases = new DebitCases(dw);
    await cases.init();
  });
  afterAll(async () => {
    await dw?.close();
  });
  beforeEach(async () => {
    await dw.reset();
  });

  /** Prochain numéro de passage que la base attribuerait : bouge à chaque `register_tap`, même annulé. */
  const tapSeq = async (): Promise<string> =>
    (
      await ownerRows<{ v: string }>(
        'SELECT last_value::text || is_called::text AS v FROM media_tap_id_seq',
      )
    )[0]!.v;

  const registry = async (): Promise<number> =>
    (
      await ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_seq_registry WHERE device_id = $1',
        [cases.keypad.t.deviceId],
      )
    )[0]!.n;

  it('sous EDGE : même 409 et même corps, aucun register_tap, aucune écriture, aucun numéro', async () => {
    const { pw } = dw;
    const [m] = (await pw.media(1)) as [PayMedia];
    const { gateway } = await dw.edgeActive();
    const { authority_epoch: epoch } = await dw.authority();
    const taps = await tapSeq();
    const numbers = await registry();
    const footprint = await cases.footprint();

    const res = await pw.pay(cases.keypad, pw.keypadBody(cases.keypad, { tap: pw.tap(m) }, 1000), {
      epoch: String(epoch),
    });

    expect([res.status, res.body.code]).toEqual([409, 'DEBIT_AUTHORITY_EDGE']);
    expect(res.body).toMatchObject({
      edge_base_url: gateway.lanUrl,
      authority_epoch: epoch,
      retryable: true,
    });
    expect(res.headers['content-type']).toContain('application/problem+json');
    // (b) aucun register_tap, aucune écriture, aucun numéro consommé.
    expect(await tapSeq()).toBe(taps);
    expect(await registry()).toBe(numbers);
    expect(await cases.footprint()).toEqual(footprint);
  });

  it('la clé est relâchée : rejouée après le retour au central, la vente passe', async () => {
    const { pw } = dw;
    const [m] = (await pw.media(1)) as [PayMedia];
    await dw.edgeActive();
    const key = cases.keypad.t.seqKey();
    const body = pw.keypadBody(cases.keypad, { tap: pw.tap(m) }, 1000);
    const epoch = (await dw.authority()).authority_epoch;
    const refused = await pw.pay(cases.keypad, body, { key, epoch: String(epoch) });
    expect([refused.status, refused.body.code]).toEqual([409, 'DEBIT_AUTHORITY_EDGE']);

    await dw.reset();
    const back = (await dw.authority()).authority_epoch;
    const sold = await pw.pay(cases.keypad, body, { key, epoch: String(back) });
    expect([sold.status, sold.body.type]).toEqual([201, 'PURCHASE']);
  });

  it('priorités inchangées : session de vendeur invalide ou terminal suspendu sous EDGE, refus d’avant', async () => {
    const { pw } = dw;
    const [m] = (await pw.media(1)) as [PayMedia];
    const outcome = async (vendorSession: string | null) => {
      const epoch = (await dw.authority()).authority_epoch;
      const body = pw.keypadBody(cases.keypad, { tap: pw.tap(m) }, 1000, {
        vendor_session_id: vendorSession ?? undefined,
      });
      const res = await pw.pay(cases.keypad, body, { epoch: String(epoch) });
      return { status: res.status, code: res.body.code, edge: 'edge_base_url' in res.body };
    };
    // Session de vendeur invalide.
    const before = await outcome(null);
    expect(before).toMatchObject({ status: 409, code: 'VENDOR_SESSION_INVALID' });
    await dw.edgeActive();
    expect(await outcome(null)).toEqual(before);
    // Terminal suspendu : même refus sous EDGE que sous CENTRAL, jamais le 409 EDGE.
    const id = cases.keypad.t.deviceId;
    await ownerRows("UPDATE device SET status = 'SUSPENDED' WHERE id = $1 RETURNING id", [id]);
    try {
      const sus = await outcome(cases.keypad.sessionId);
      expect(sus.code).not.toBe('DEBIT_AUTHORITY_EDGE');
      expect(sus.edge).toBe(false);
      await dw.reset();
      expect(await outcome(cases.keypad.sessionId)).toEqual(sus);
    } finally {
      await ownerRows("UPDATE device SET status = 'ACTIVE' WHERE id = $1 RETURNING id", [id]);
    }
  });
});
