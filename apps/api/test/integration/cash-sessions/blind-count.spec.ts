// Comptage à l'aveugle (mission 6, lot WP08, T038 et T042 ; FR-002 ; contracts/cash.md règle 3 ; A27).
// Un théorique reconnaissable (canari) est posé par une écriture réelle `TOPUP_CASH`, puis TOUTES les réponses,
// tous les problèmes et tous les en-têtes des routes accessibles à un `CASHIER` sont balayés : la valeur n'apparaît
// nulle part, ni celle de l'écart.
//
// Inventaire A27 (grep de `src/` sur `account_balance`, `FROM account`, `FROM posting`, `readSignedBalances`) :
//  - `src/ledger/db/ledger-queries.ts` (`readSignedBalances`) : appelé par le seul moteur d'écriture, pour des
//    comptes `WALLET_PROMO`, `WALLET_PAID`, `MERCHANT`, `CUSTOMER_CASH_DUE` ; jamais `CASH_DESK` ;
//  - `media/taps/tap.service.ts`, `media/lifecycle/activation.service.ts`, `payments/payment-read.service.ts`,
//    `reversals/reversal.service.ts` : soldes et lignes de comptes de PORTEFEUILLE (`wallet_id`) seulement ;
//  - `media/lifecycle/counter-access.ts`, `cash-due.service.ts`, `cash-sessions.service.ts` : lisent l'identifiant
//    ou le code du compte `CASH_DESK`, jamais son solde ; `cash-session-read.service.ts` : `cash_session` et
//    `cash_session_count` seulement (`expected_amount` figé à la fermeture) ;
//  - `participations.service.ts`, `sql-config-resolver.ts` : identifiants de comptes de participation / redevance.
// Conclusion : aucune route accessible à un `CASHIER` ne rend le solde d'un compte `CASH_DESK` (A27) ; ce qui
// suit le prouve sur les réponses réelles, canari à l'appui.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { CashWorld, type Res } from './cash-session-fixtures';

jest.setTimeout(240_000);

const CANARY = 123_457;
const COUNTED = 100_000;
/** Écart = compté − théorique = −23 457 : sa valeur est un canari aussi. */
const CANARY_DIFF = 23_457;

describe('comptage à l’aveugle (WP08)', () => {
  let cw: CashWorld;
  beforeAll(async () => {
    cw = await CashWorld.create();
  });
  afterAll(async () => {
    await cw?.close();
  });

  const everything = (res: Res) =>
    JSON.stringify({ s: res.status, b: res.body, h: res.headers, t: res.text });
  const sweep: Array<{ label: string; res: Res }> = [];
  const keep = (label: string, res: Res) => {
    sweep.push({ label, res });
    return res;
  };

  it('ouverture, comptages, lectures et erreurs d’un CASHIER : ni le théorique ni l’écart, nulle part', async () => {
    const t = await cw.terminal();
    const opened = keep('ouverture', await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA));
    expect(opened.status).toBe(201);
    const id = String(opened.body.cash_session_id);
    await cw.seedCash(t, CANARY);
    expect(await cw.deskBalance(t)).toBe(CANARY);

    const counted = keep('comptage', await cw.count(t, id, cw.w.cashierA, COUNTED));
    expect(counted.status).toBe(200);
    expect(contractViolations('CashSession', counted.body)).toEqual([]);
    expect(counted.body).toMatchObject({ expected_amount: null, difference: null });
    expect(counted.body.last_count).toMatchObject({ counted_amount: COUNTED });

    // Lectures du CASHIER : au terminal, puis avec son seul jeton de personne.
    const readTerminal = keep(
      'lecture terminal',
      await cw.term(t, 'GET', `/cash-sessions/${id}`, cw.w.cashierA),
    );
    const readPerson = keep(
      'lecture personne',
      await cw.bo('GET', `/cash-sessions/${id}`, cw.w.cashierA),
    );
    for (const read of [readTerminal, readPerson]) {
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ expected_amount: null, difference: null });
    }

    // Erreurs provoquées : champ inconnu, montant invalide, session inconnue, autre terminal, 11e comptage,
    // liste et fermeture refusées au CASHIER, ouverture en double.
    const other = await cw.terminal();
    keep(
      'champ inconnu',
      await cw.count(t, id, cw.w.cashierA, COUNTED, { device_id: randomUUID() }),
    );
    keep('montant négatif', await cw.count(t, id, cw.w.cashierA, -1));
    keep('session inconnue', await cw.count(t, randomUUID(), cw.w.cashierA, 5));
    keep('autre terminal', await cw.count(other, id, cw.w.cashierA, 5));
    keep(
      'lecture autre terminal',
      await cw.term(other, 'GET', `/cash-sessions/${id}`, cw.w.cashierA),
    );
    keep('lecture inconnue', await cw.bo('GET', `/cash-sessions/${randomUUID()}`, cw.w.cashierA));
    keep('liste', await cw.bo('GET', `/events/${cw.a.eventId}/cash-sessions`, cw.w.cashierA));
    keep('fermeture CASHIER', await cw.closeBo(id, cw.w.cashierA));
    keep('fermeture CASHIER au terminal', await cw.closeTerm(t, id, cw.w.cashierA));
    keep('double ouverture', await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA));
    for (let i = 0; i < 9; i += 1) await cw.count(t, id, cw.w.cashierA, COUNTED + i);
    const eleventh = keep('11e comptage', await cw.count(t, id, cw.w.cashierA, COUNTED));
    expect(eleventh.status).toBe(409);

    // Après fermeture par un SUPERVISOR : le CASHIER relit sa session, toujours sans théorique ni écart.
    const closed = await cw.closeBo(id, cw.supervisor);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({
      expected_amount: CANARY,
      difference: COUNTED + 8 - CANARY,
    });
    const after = keep(
      'lecture après fermeture',
      await cw.bo('GET', `/cash-sessions/${id}`, cw.w.cashierA),
    );
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ status: 'CLOSED', expected_amount: null, difference: null });
    keep('comptage après fermeture', await cw.count(t, id, cw.w.cashierA, 1));

    expect(sweep.length).toBeGreaterThanOrEqual(15);
    for (const { label, res } of sweep) {
      const text = everything(res);
      for (const needle of [String(CANARY), '123 457', '123457', String(CANARY_DIFF)])
        expect([label, text.includes(needle)]).toEqual([label, false]);
    }
  });

  it('vue AGENT : les clés du théorique et de l’écart sont présentes et nulles, jamais absentes ni renseignées', async () => {
    const { t, id } = await cw.ready({ expected: CANARY, counted: COUNTED });
    const read = await cw.term(t, 'GET', `/cash-sessions/${id}`, cw.w.cashierA);
    expect(Object.keys(read.body)).toEqual(
      expect.arrayContaining(['expected_amount', 'difference']),
    );
    expect(read.body.expected_amount).toBeNull();
    expect(read.body.difference).toBeNull();
    // Le SUPERVISOR ne voit pas non plus le théorique tant que la session est ouverte.
    const manager = await cw.bo('GET', `/cash-sessions/${id}`, cw.supervisor);
    expect(manager.status).toBe(200);
    expect(manager.body).toMatchObject({ status: 'OPEN', expected_amount: null, difference: null });
    expect(everything(manager)).not.toContain(String(CANARY));
  });

  it('une erreur de la base ne transmet jamais son texte : le canari planté dans un message SQL n’est pas renvoyé', async () => {
    const { t, id } = await cw.ready({ expected: CANARY, counted: COUNTED });
    // Dixième comptage atteint, puis le 11e : la base refuse (CL029) ; le problème vient du catalogue.
    for (let i = 0; i < 9; i += 1) await cw.count(t, id, cw.w.cashierA, COUNTED);
    const refused = await cw.count(t, id, cw.w.cashierA, COUNTED);
    expect(refused.status).toBe(409);
    expect(everything(refused)).not.toMatch(/comptages? au plus|123457/);
    expect(refused.body.code).toBe('CONFLICT_STATE');
  });
});
