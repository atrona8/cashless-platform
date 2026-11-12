// Intégration à connexion RÉELLE : la source EDGE_SYNC est refusée à l'API publique (garde de post_transaction, WP05,
// 0060) et les droits de la passerelle tiennent (WP09, FR-031, NFR-011). Un `SET ROLE` ne change pas `session_user`,
// seule une vraie connexion `cashless_app` prouve la garde. Données posées par le propriétaire, prestataire propre à la
// suite, nettoyage à la fin ; la suite ne lance pas resetDatabase.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { APP_URL, connect, EDGE_URL, OWNER_URL } from '../../support/db';

const edgeUrl = (): string => EDGE_URL;

interface World {
  operatorId: string;
  edgeLedger: string;
  centralLedger: string;
  gatewayId: string;
  revokedGatewayId: string;
  accounts: Record<string, { bank: string; wallet: string }>;
}

describe('garde EDGE_SYNC et droits de la passerelle (connexions réelles)', () => {
  const w: World = {
    operatorId: randomUUID(),
    edgeLedger: '',
    centralLedger: '',
    gatewayId: randomUUID(),
    revokedGatewayId: randomUUID(),
    accounts: {},
  };
  let owner: Client;
  let app: Client;
  let edge: Client;
  let seq = 0;

  const lines = (ledger: string) => [
    { account_id: w.accounts[ledger]!.wallet, amount: -1000 },
    { account_id: w.accounts[ledger]!.bank, amount: 1000 },
  ];
  /** Appel de post_transaction (14 paramètres de la signature, les derniers par défaut). */
  const post = (db: Client, ledger: string, source: string) =>
    db.query(`SELECT post_transaction($1::uuid, 'TOPUP', $2, now(), $3, $4::jsonb)`, [
      ledger,
      `guard:${w.operatorId}:${++seq}`,
      source,
      JSON.stringify(lines(ledger)),
    ]);
  const sqlstate = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return 'OK';
    } catch (e) {
      return (e as { code?: string }).code ?? 'ERR';
    }
  };
  const tenant = (db: Client) =>
    db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.operatorId]);

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    app = await connect(APP_URL);
    edge = await connect(edgeUrl());
    const organizer = randomUUID();
    const jurisdiction = randomUUID();
    await owner.query(
      `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
        WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
    );
    await owner.query(
      `INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', 'Garde EDGE_SYNC', 'SN')`,
      [w.operatorId],
    );
    await owner.query(
      `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Org garde')`,
      [organizer, w.operatorId],
    );
    await owner.query(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
       VALUES ($1, 'SN', $2, '2026-01-01', 'ORGANIZER')`,
      [jurisdiction, 1_000_000 + Math.floor(Math.random() * 1_000_000_000)],
    );
    await tenant(owner);
    const eventOf = async (): Promise<string> => {
      const id = randomUUID();
      await owner.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
         VALUES ($1, $2, $3, 'Garde', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER', 'LIVE')`,
        [id, w.operatorId, organizer, jurisdiction],
      );
      const r = await owner.query<{ open_event_ledger: string }>(`SELECT open_event_ledger($1)`, [
        id,
      ]);
      const ledger = r.rows[0]!.open_event_ledger;
      const wallet = randomUUID();
      await owner.query(`INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)`, [
        wallet,
        w.operatorId,
        ledger,
      ]);
      const acc = await owner.query<{ id: string }>(
        `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
         VALUES ($1, $2, 'L-WAL-G-P', 'CLAIM', 'WALLET_PAID', $3, 'C') RETURNING id`,
        [w.operatorId, ledger, wallet],
      );
      const bank = await owner.query<{ id: string }>(
        `SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'`,
        [ledger],
      );
      w.accounts[ledger] = { bank: bank.rows[0]!.id, wallet: acc.rows[0]!.id };
      return ledger;
    };
    w.centralLedger = await eventOf();
    w.edgeLedger = await eventOf();
    const ev = await owner.query<{ scope_id: string }>(
      `SELECT scope_id FROM ledger WHERE id = $1`,
      [w.edgeLedger],
    );
    await owner.query(
      `INSERT INTO edge_gateway (id, operator_id, event_id, serial, role) VALUES ($1, $2, $3, $4, 'PRIMARY')`,
      [w.gatewayId, w.operatorId, ev.rows[0]!.scope_id, `GG-${w.gatewayId.slice(0, 8)}`],
    );
    await owner.query(
      `INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, status)
       VALUES ($1, $2, $3, $4, 'STANDBY', 'REVOKED')`,
      [
        w.revokedGatewayId,
        w.operatorId,
        ev.rows[0]!.scope_id,
        `GR-${w.revokedGatewayId.slice(0, 8)}`,
      ],
    );
    await owner.query(
      `UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = $2, authority_epoch = 1 WHERE id = $1`,
      [w.edgeLedger, w.gatewayId],
    );
    await tenant(app);
  });

  afterAll(async () => {
    // Le grand livre est en ajout seul : on ne purge pas ses lignes ; seules les connexions sont fermées.
    await Promise.all([owner?.end(), app?.end(), edge?.end()]);
  });

  it('connexions : chacune porte bien le rôle attendu (session_user)', async () => {
    expect((await app.query(`SELECT session_user AS u`)).rows[0].u).toBe('cashless_app');
    expect((await edge.query(`SELECT session_user AS u`)).rows[0].u).toBe('cashless_edge');
  });

  it('(a) cashless_app : post_transaction en EDGE_SYNC sur un grand livre sous EDGE est refusé', async () => {
    expect(await sqlstate(post(app, w.edgeLedger, 'EDGE_SYNC'))).toBe('42501');
  });

  it("(b) la même écriture sur un grand livre CENTRAL est refusée aussi (la garde ne dépend pas de l'autorité)", async () => {
    expect(await sqlstate(post(app, w.centralLedger, 'EDGE_SYNC'))).toBe('42501');
  });

  it('(c) contrôles positifs : ONLINE sous cashless_app passe ; EDGE_SYNC sous le propriétaire passe', async () => {
    expect(await sqlstate(post(app, w.centralLedger, 'ONLINE'))).toBe('OK');
    await tenant(owner);
    expect(await sqlstate(post(owner, w.edgeLedger, 'EDGE_SYNC'))).toBe('OK');
  });

  it('(d) cashless_edge : post_transaction refusé (42501), même en EDGE_SYNC', async () => {
    await tenant(edge);
    expect(await sqlstate(post(edge, w.edgeLedger, 'EDGE_SYNC'))).toBe('42501');
    expect(await sqlstate(post(edge, w.centralLedger, 'ONLINE'))).toBe('42501');
  });

  it('(e) cashless_app : aucune écriture directe sur edge_gateway', async () => {
    expect(
      await sqlstate(
        app.query(`UPDATE edge_gateway SET status = 'ACTIVE' WHERE id = $1`, [w.revokedGatewayId]),
      ),
    ).toBe('42501');
    expect(
      await sqlstate(
        app.query(`UPDATE edge_gateway SET contiguous_edge_seq = 0 WHERE id = $1`, [w.gatewayId]),
      ),
    ).toBe('42501');
    const row = await owner.query(`SELECT status FROM edge_gateway WHERE id = $1`, [
      w.revokedGatewayId,
    ]);
    expect(row.rows[0].status).toBe('REVOKED');
    // Contrôle positif : la lecture sous RLS reste permise.
    const seen = await app.query(`SELECT count(*)::int AS n FROM edge_gateway WHERE id = $1`, [
      w.gatewayId,
    ]);
    expect(seen.rows[0].n).toBe(1);
  });

  it('(f) cashless_app : edge_record_seq refusé (fonction réservée aux enveloppes de la passerelle)', async () => {
    expect(
      await sqlstate(
        app.query(`SELECT edge_record_seq($1, 1, 'k', '\\x00'::bytea, 'ACCEPTED', NULL, NULL)`, [
          w.gatewayId,
        ]),
      ),
    ).toBe('42501');
  });
});
