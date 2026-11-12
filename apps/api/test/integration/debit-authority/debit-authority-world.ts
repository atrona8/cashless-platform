// Jeu d'essai de l'autorité de débit côté humains (mission passerelle-locale, lot WP11) : le monde des paiements
// (HTTPS réel, terminaux, bracelets crédités) plus des personnes du prestataire A et des passerelles posées par le
// propriétaire (amorçage seulement). Toute bascule passe par la ROUTE ; l'accusé de la passerelle (WP12) est rejoué
// par la fonction de la base sous le propriétaire, le temps de ce lot.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import { send, type TerminalResponse } from '../../support/test-terminal';
import { PaymentWorld } from '../payments/payments-fixtures';
import { QrWorld } from '../payment-requests/qr-fixtures';

export interface Gateway {
  id: string;
  serial: string;
  lanUrl: string;
}

export class DebitWorld {
  qr!: QrWorld;
  pw!: PaymentWorld;
  operatorAdmin2!: TestPerson;
  operatorAdmin3!: TestPerson;
  operatorAdminB!: TestPerson;
  organizerAdminB!: TestPerson;
  private seq = 0;

  static async create(): Promise<DebitWorld> {
    const world = new DebitWorld();
    world.qr = await QrWorld.create();
    world.pw = world.qr.pw;
    const { w } = world.pw;
    await withOwner(async (db) => {
      const op = (
        operatorId: string,
        role: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN',
        scopeId: string,
      ) =>
        w.idp.createPerson(db, {
          operatorId,
          roles: [
            { role, scopeType: role === 'OPERATOR_ADMIN' ? 'OPERATOR' : 'ORGANIZER', scopeId },
          ],
        });
      world.operatorAdmin2 = await op(w.ops.a, 'OPERATOR_ADMIN', w.ops.a);
      world.operatorAdmin3 = await op(w.ops.a, 'OPERATOR_ADMIN', w.ops.a);
      world.operatorAdminB = await op(w.ops.b, 'OPERATOR_ADMIN', w.ops.b);
      world.organizerAdminB = await op(w.ops.b, 'ORGANIZER_ADMIN', w.ids.organizerB);
    });
    return world;
  }

  close(): Promise<void> {
    return this.qr.close();
  }

  get ledger(): string {
    return this.pw.w.ids.ledgerA;
  }

  /** Passerelle posée par le propriétaire (amorçage) pour l'événement A (défaut), `ACTIVE` et `PRIMARY` (défaut). */
  async gateway(
    options: {
      role?: 'PRIMARY' | 'STANDBY';
      status?: string;
      eventId?: string;
      operatorId?: string;
    } = {},
  ): Promise<Gateway> {
    const { w } = this.pw;
    const id = randomUUID();
    const serial = `GW-${randomUUID().slice(0, 8)}`;
    const lanUrl = `https://10.0.0.${(this.seq += 1)}:8443`;
    await withOwner((db) =>
      db.query(
        `INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, status, lan_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          options.operatorId ?? w.ops.a,
          options.eventId ?? w.ids.eventA,
          serial,
          options.role ?? 'PRIMARY',
          options.status ?? 'ACTIVE',
          lanUrl,
        ],
      ),
    );
    return { id, serial, lanUrl };
  }

  /** Autre événement du prestataire A (sans grand livre) : pour une passerelle « d'un autre événement ». */
  async otherEvent(): Promise<string> {
    const { w } = this.pw;
    const eventId = randomUUID();
    await withOwner((db) =>
      db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                            funds_holder)
         SELECT $2::uuid, operator_id, organizer_id, 'Autre événement', currency, timezone,
                jurisdiction_id, funds_holder FROM event WHERE id = $1`,
        [w.ids.eventA, eventId],
      ),
    );
    return eventId;
  }

  /** Événement du prestataire B (pour une passerelle étrangère). */
  async foreignEvent(): Promise<string> {
    const { w } = this.pw;
    const eventId = randomUUID();
    await withOwner((db) =>
      db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                            funds_holder)
         SELECT $2::uuid, $3::uuid, $4::uuid, 'Événement B', currency, timezone,
                jurisdiction_id, funds_holder FROM event WHERE id = $1`,
        [w.ids.eventA, eventId, w.ops.b, w.ids.organizerB],
      ),
    );
    return eventId;
  }

  /** Requête d'une personne seule (jeton d'accès dans `Authorization`). */
  bo(
    method: 'GET' | 'POST',
    path: string,
    who: TestPerson,
    body?: unknown,
    key: string | null = method === 'POST' ? randomUUID() : null,
    extra: Record<string, string> = {},
  ): Promise<TerminalResponse> {
    return send(
      {
        url: new URL(`${this.pw.api.baseUrl}${path}`),
        method,
        headers: {
          authorization: `Bearer ${who.token}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...(key !== null ? { 'idempotency-key': key } : {}),
          ...extra,
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : '',
        cert: null,
        key: null,
      },
      this.pw.api.tls.serverCaPem,
    );
  }

  change(who: TestPerson, body: unknown, key?: string, ledger = this.ledger) {
    return this.bo('POST', `/ledgers/${ledger}/debit-authority`, who, body, key ?? randomUUID());
  }

  read(who: TestPerson, ledger = this.ledger) {
    return this.bo('GET', `/ledgers/${ledger}/debit-authority`, who);
  }

  /** Bascule vers la passerelle par la route (202, `GRANTED`) ; rend l'identifiant du handover. */
  async grant(gateway: Gateway, who = this.pw.w.operatorAdminA): Promise<string> {
    const res = await this.change(who, {
      target: 'EDGE',
      reason: 'Panne de réseau prévue',
      edge_gateway_id: gateway.id,
    });
    if (res.status !== 202) throw new Error(`bascule refusée : ${res.status} ${res.text}`);
    return String((res.body.handover as { handover_id: string }).handover_id);
  }

  /** Accusé de la passerelle (WP12 le fera par `/edge/*`) : la fonction de la base, sous le propriétaire. */
  async ack(gateway: Gateway, handoverId: string): Promise<void> {
    await withOwner(async (db) => {
      const { rows } = await db.query<{
        epoch: number;
        reference_watermark_seq: string;
        watermark_posting_id: string;
      }>(
        'SELECT epoch, reference_watermark_seq, watermark_posting_id FROM debit_authority_handover WHERE id = $1',
        [handoverId],
      );
      await db.query('UPDATE edge_gateway SET reference_applied_seq = $2 WHERE id = $1', [
        gateway.id,
        rows[0]!.reference_watermark_seq,
      ]);
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [this.pw.w.ops.a]);
      await db.query(`SELECT set_config('app.gateway_id', $1, false)`, [gateway.id]);
      // La position de réplication accusée est le filigrane de lignes du central (rien de plus à rattraper).
      await db.query('SELECT edge_ack_handover($1, $2, $3, $4)', [
        gateway.id,
        handoverId,
        rows[0]!.epoch,
        rows[0]!.watermark_posting_id,
      ]);
      await db.query(`SELECT set_config('app.gateway_id', '', false)`);
    });
  }

  /** Grand livre `EDGE` accusé (`ACTIVE`) : passerelle, bascule et accusé. */
  async edgeActive(): Promise<{ gateway: Gateway; handoverId: string }> {
    const gateway = await this.gateway();
    const handoverId = await this.grant(gateway);
    await this.ack(gateway, handoverId);
    return { gateway, handoverId };
  }

  authority(ledger = this.ledger) {
    return ownerRows<{
      debit_authority: string;
      authority_epoch: number;
      edge_gateway_id: string | null;
    }>('SELECT debit_authority, authority_epoch, edge_gateway_id FROM ledger WHERE id = $1', [
      ledger,
    ]).then((r) => r[0]!);
  }

  handovers(ledger = this.ledger) {
    return ownerRows<{ id: string; direction: string; status: string; epoch: number }>(
      `SELECT id, direction, status, epoch FROM debit_authority_handover WHERE ledger_id = $1
        ORDER BY requested_at, direction DESC`,
      [ledger],
    );
  }

  /** Remet le grand livre en `CENTRAL` (propriétaire, entre deux cas) : clôt les bascules ouvertes par les états permis. */
  async reset(): Promise<void> {
    await withOwner(async (db) => {
      await db.query(
        `UPDATE debit_authority_handover SET status = 'FAILED' WHERE ledger_id = $1
          AND direction = 'TO_CENTRAL' AND status IN ('RELEASE_REQUESTED','RELEASING')`,
        [this.ledger],
      );
      await db.query(
        `UPDATE debit_authority_handover SET status = 'FAILED' WHERE ledger_id = $1
          AND direction = 'TO_EDGE' AND status = 'GRANTED'`,
        [this.ledger],
      );
      await db.query(
        `UPDATE debit_authority_handover SET status = 'COMPLETED', completed_at = now()
          WHERE ledger_id = $1 AND direction = 'TO_EDGE' AND status = 'ACTIVE'`,
        [this.ledger],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [this.pw.w.ops.a]);
      await db.query(`SELECT set_debit_authority($1, 'CENTRAL')`, [this.ledger]);
    });
  }
}
