// Refus d'autorité `EDGE` avant le travail de la vente (NFR-001, mission passerelle-locale). `createPayment`
// lit l'autorité du grand livre avec le terminal (étape 1) et refuse `409 DEBIT_AUTHORITY_EDGE` juste après
// l'étape 3 (terminal actif, session de vendeur) : ni lecture du bracelet, ni `register_tap`, ni écriture.
// La garde SQL `CL006` reste le dernier recours.
// Preuve de l'absence de l'étape 4 (lecture du bracelet, `register_tap`) : une lecture que cette étape refuse
// (bracelet inconnu) rend sous CENTRAL l'erreur de l'étape 4, et sous EDGE le 409 EDGE ; la séquence globale
// `media_tap_id_seq` n'est pas lue (d'autres suites la font avancer en parallèle).
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

  /** Lecture que l'étape 4 refuse : bracelet inconnu de la base. */
  const unknownTap = (pw: DebitWorld['pw'], m: PayMedia): Record<string, unknown> => ({
    ...pw.tap(m),
    nfc_uid: '04deadbeefcafe',
  });

  const registry = async (): Promise<number> =>
    (
      await ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_seq_registry WHERE device_id = $1',
        [cases.keypad.t.deviceId],
      )
    )[0]!.n;

  it('sous EDGE : même 409 et même corps, étape 4 non atteinte, aucune écriture, aucun numéro', async () => {
    const { pw } = dw;
    const [m] = (await pw.media(1)) as [PayMedia];
    const body = pw.keypadBody(cases.keypad, { tap: unknownTap(pw, m) }, 1000);
    // Contrôle sous CENTRAL : la lecture du bracelet inconnu est refusée par l'étape 4, autrement que par le 409 EDGE.
    const central = (await dw.authority()).authority_epoch;
    const control = await pw.pay(cases.keypad, body, { epoch: String(central) });
    expect([control.status, control.body.code]).toEqual([422, 'MEDIA_UID_MISMATCH']);

    const { gateway } = await dw.edgeActive();
    const { authority_epoch: epoch } = await dw.authority();
    const numbers = await registry();
    const footprint = await cases.footprint();
    const res = await pw.pay(cases.keypad, body, { epoch: String(epoch) });

    expect([res.status, res.body.code]).toEqual([409, 'DEBIT_AUTHORITY_EDGE']);
    expect(res.body).toMatchObject({
      edge_base_url: gateway.lanUrl,
      authority_epoch: epoch,
      retryable: true,
    });
    expect(res.headers['content-type']).toContain('application/problem+json');
    // L'étape 4 n'a pas été atteinte (sinon l'erreur de la lecture inconnue l'aurait emporté) ; aucune écriture,
    // aucun numéro consommé.
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
