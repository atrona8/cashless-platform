// Refus de chaque chemin de débit du central tant que l'autorité est `EDGE`, chemin par chemin (mission
// passerelle-locale, lot WP11, T050 ; FR-004, FR-013). La suite LIT `DEBIT_PATHS` : un chemin ajouté sans cas de test
// la fait échouer. Les crédits restent acceptés ; un grand livre `CENTRAL` n'est pas modifié (suites existantes).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { checkAuthority } from '../../../src/offline/batches/batch-intake';
import { ProblemException } from '../../../src/errors/problem';
import { DEBIT_PATHS, type DebitPath } from '../../../src/debit-authority/debit-paths';
import { APP_URL, connect } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { CashWorld } from '../cash-sessions/cash-session-fixtures';
import { withOwner } from '../../support/db';
import { DebitCases, HTTP_DEBIT_CASES } from './debit-cases';
import { DebitWorld } from './debit-authority-world';

jest.setTimeout(300_000);

const openapi = readFileSync(
  join(__dirname, '../../../../../packages/contracts/openapi.yaml'),
  'utf8',
);

describe('chemins de débit refusés sous EDGE (WP11, T050)', () => {
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

  const bySort = (kind: DebitPath['kind']) => DEBIT_PATHS.filter((p) => p.kind === kind);

  it('la liste est cohérente : opérations du contrat, une entrée par opération, une protection citée', () => {
    const ids = DEBIT_PATHS.map((p) => p.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const path of DEBIT_PATHS) {
      expect([path.operationId, openapi.includes(`operationId: ${path.operationId}`)]).toEqual([
        path.operationId,
        true,
      ]);
      expect(path.protection.length).toBeGreaterThan(10);
    }
    expect(bySort('DEBIT').length).toBeGreaterThanOrEqual(10);
  });

  it('chaque entrée DEBIT de couche HTTP a un cas dans debit-cases.ts, et inversement', () => {
    const http = bySort('DEBIT')
      .filter((p) => p.layer === 'HTTP')
      .map((p) => p.operationId)
      .sort();
    expect(http).toEqual([...HTTP_DEBIT_CASES].sort());
  });

  describe.each(HTTP_DEBIT_CASES)('%s', (operationId) => {
    it('sous EDGE : 409 DEBIT_AUTHORITY_EDGE, aucune écriture au grand livre', async () => {
      const prepared = await cases.prepare(operationId);
      await dw.edgeActive();
      const epoch = (await dw.authority()).authority_epoch;
      const before = await cases.footprint();
      const res = await prepared.run(epoch);
      expect([operationId, res.status, res.body.code]).toEqual([
        operationId,
        409,
        'DEBIT_AUTHORITY_EDGE',
      ]);
      expect(await cases.footprint()).toEqual(before);
    });
  });

  describe('crédits et chemins neutres acceptés sous EDGE', () => {
    it('reversePayment : l’annulation d’une vente rend le montant, acceptée', async () => {
      const prepared = await cases.prepareReversal();
      await dw.edgeActive();
      const epoch = (await dw.authority()).authority_epoch;
      const res = await prepared.run(epoch);
      expect([res.status, res.body.type]).toEqual([201, 'REVERSAL']);
    });

    it('createTap : la lecture d’un bracelet n’écrit aucune ligne, acceptée', async () => {
      const prepared = await cases.prepareTap();
      await dw.edgeActive();
      const before = await cases.footprint();
      const res = await prepared.run(0);
      expect([res.status, res.body.result]).toEqual([200, 'OK']);
      expect(await cases.footprint()).toEqual(before);
    });
  });

  describe('dernier recours SQL (CL006) pour les débits que la route ne passe pas à un test HTTP', () => {
    let app: Client;
    let owner: { wallet: string; bank: string };
    beforeAll(async () => {
      app = await connect(APP_URL);
    });
    afterAll(async () => {
      await app?.end();
    });

    const post = async (source: string, type: string, debit: 'WALLET' | 'BANK') => {
      const [accounts] = await ownerRows<{ wallet: string; bank: string }>(
        `SELECT (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'WALLET_PAID' LIMIT 1) AS wallet,
                (SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE') AS bank`,
        [dw.ledger],
      );
      owner = accounts!;
      await app.query(`SELECT set_config('app.operator_id', $1, false)`, [dw.pw.w.ops.a]);
      const lines = [
        { account_id: debit === 'WALLET' ? owner.wallet : owner.bank, amount: 1000 },
        { account_id: debit === 'WALLET' ? owner.bank : owner.wallet, amount: -1000 },
      ];
      try {
        await app.query(
          `SELECT post_transaction($1, $2, $3, now(), $4, $5::jsonb, NULL, NULL, $6, $7)`,
          [
            dw.ledger,
            type,
            `edge-guard:${randomUUID()}`,
            source,
            JSON.stringify(lines),
            dw.pw.w.operatorAdminA.userId,
            dw.operatorAdmin2.userId,
          ],
        );
        return 'OK';
      } catch (error) {
        return (error as { code?: string }).code ?? 'ERR';
      } finally {
        await app.query(`SELECT set_config('app.operator_id', '', false)`);
      }
    };

    it('receivePspWebhook (CHARGEBACK, PSP_WEBHOOK) et requestLateChargeback (BACKOFFICE) : CL006 ; crédit accepté', async () => {
      await dw.edgeActive();
      expect(await post('PSP_WEBHOOK', 'CHARGEBACK', 'WALLET')).toBe('CL006');
      expect(await post('BACKOFFICE', 'CHARGEBACK', 'WALLET')).toBe('CL006');
      // Le crédit du portefeuille (ligne créditrice) n'est pas refusé par cette garde.
      expect(await post('PSP_WEBHOOK', 'TOPUP', 'BANK')).not.toBe('CL006');
    });
  });

  describe('gardes d’admission et routes absentes', () => {
    it('submitOfflineBatch : contrôle 9, DEBIT_AUTHORITY_EDGE (ou MOVING pendant le rendu)', () => {
      for (const [moving, code] of [
        [false, 'DEBIT_AUTHORITY_EDGE'],
        [true, 'DEBIT_AUTHORITY_MOVING'],
      ] as const) {
        let caught: unknown;
        try {
          checkAuthority('EDGE', moving);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ProblemException);
        expect((caught as ProblemException).code).toBe(code);
      }
      expect(() => checkAuthority('CENTRAL', false)).not.toThrow();
    });

    it.each(bySort('DEBIT').filter((p) => p.layer === 'ABSENT'))(
      '$operationId : route non servie par l’API, aucune écriture (404)',
      async (path) => {
        expect(openapi.includes(`operationId: ${path.operationId}`)).toBe(true);
        await dw.edgeActive();
        const before = await cases.footprint();
        const url = path.route.split(' ')[1]!.replace(/\{[^}]+\}/g, randomUUID());
        const res = await dw.bo('POST', url, dw.pw.w.operatorAdminA, {});
        expect([path.operationId, res.status]).toEqual([path.operationId, 404]);
        expect(await cases.footprint()).toEqual(before);
      },
    );

    it('claimMedia et confirmMediaClaim : les gardes citées dans la liste sont en place (claims.service.ts)', () => {
      const source = readFileSync(
        join(__dirname, '../../../src/media/claims/claims.service.ts'),
        'utf8',
      );
      expect(source).toContain("target.debit_authority === 'EDGE'");
      expect(source).toContain("actor.debitAuthority === 'EDGE'");
    });
  });

  describe('closeCashSession : fermeture de caisse sous EDGE (CL029, sans changer son sens)', () => {
    let cw: CashWorld;
    beforeAll(async () => {
      cw = await CashWorld.create();
    });
    afterAll(async () => {
      await cw?.close();
    });

    it('sous EDGE : 409 CONFLICT_STATE, session toujours ouverte ; au central ou autre cause CL029 : même code qu’avant', async () => {
      const { w } = cw;
      const gatewayId = randomUUID();
      await withOwner((db) =>
        db.query(
          `INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, status, lan_url)
           VALUES ($1, $2, $3, $4, 'PRIMARY', 'ACTIVE', 'https://10.9.9.9:8443')`,
          [gatewayId, w.ops.a, cw.a.eventId, `GW-${gatewayId.slice(0, 8)}`],
        ),
      );
      const { id } = await cw.ready({ expected: 1_000, counted: 1_000 });
      const grant = (body: unknown) =>
        cw.bo('POST', `/ledgers/${cw.a.ledgerId}/debit-authority`, w.operatorAdminA, body);
      expect(
        (await grant({ target: 'EDGE', reason: 'Coupure', edge_gateway_id: gatewayId })).status,
      ).toBe(202);
      const refused = await cw.closeBo(id, cw.supervisor);
      expect([refused.status, refused.body.code]).toEqual([409, 'CONFLICT_STATE']);
      expect((await cw.session(id)).status).toBe('OPEN');
      // Sens inchangé pour une autre cause de CL029 (aucun comptage) : même code et même statut.
      const uncounted = await cw.ready({ expected: 0, counted: null });
      const other = await cw.closeBo(uncounted.id, cw.supervisor);
      expect([other.status, other.body.code]).toEqual([409, 'CONFLICT_STATE']);
      // Bascule abandonnée : la fermeture reprend son cours normal.
      expect((await grant({ target: 'CENTRAL', reason: 'Abandon' })).status).toBe(202);
      expect((await cw.closeBo(id, cw.supervisor)).status).toBe(200);
    });
  });
});
