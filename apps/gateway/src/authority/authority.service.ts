// Autorité de la passerelle (T076, T078 ; data-model.md B.1, B.7, B.8 ; research R-16).
//
// Une seule autorité débite. L'état vit dans `edge_authority` (une ligne). RÈGLE : chaque ligne du
// tableau B.8 est COMMITÉE avant d'agir (aucun débit, aucun refus de lot, aucun accusé ne précède
// l'écriture). Les transitions viennent de `authority-transitions.ts` ; la base les refuse aussi
// (déclencheur, `edge_authority_transition`), ainsi que tout recul de `epoch` et de
// `highest_epoch_seen` (edge-0002).
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GATEWAY_CLOCK, TOKEN_TOLERANCE_MS, type GatewayClock } from '../clock/gateway-clock';
import { CentralClient } from '../central-client/central-client';
import type { DebitAuthorityStateBody, HandoverBody } from '../central-client/central-client';
import { CentralError } from '../central-client/central-errors';
import { GatewayTx, type TxClient } from '../db/gateway-tx';
import { requestFullCopy } from '../standby/standby.service';
import { failpoint } from '../testing/failpoints';
import { assertTransition, type AuthorityState } from './authority-transitions';
import { DRAIN_SIGNAL, type DrainSignal } from './ports';
import {
  consumeOrderNonce,
  loadSiteOrderKeys,
  parseOrderPayload,
  parseSignatures,
  SiteOrderError,
  verifyTwoPersonOrder,
  type OrderPayload,
  type OrderSignature,
} from './site-order';

export const AUTHORITY = Symbol('AUTHORITY');

/** Fenêtre de plausibilité d'une époque vue dans une requête de terminal (OP-N110, A12). */
export const PLAUSIBLE_EPOCH_WINDOW = 2;
const UNCONFIRMED_AUDIT_INTERVAL_MS = 10_000;
/** Au démarrage, un central injoignable ne retient pas la passerelle plus de 3 s. */
const RECOVER_TIMEOUT_MS = 3_000;

export interface AuthorityRow {
  state: AuthorityState;
  linkState: 'CONNECTED' | 'ISOLATED' | 'CATCHING_UP';
  epoch: number;
  handoverId: string | null;
  watermarkPostingId: bigint | null;
  activatedAt: Date | null;
  edgeSeqAtActivation: bigint | null;
  tokenToleranceUntil: Date | null;
  releasingSince: Date | null;
  highestEpochSeen: number;
  unconfirmedEpochSeen: number | null;
  handoverFailedEpoch: number | null;
  centralConfirmedEpoch: number | null;
  updatedAt: Date;
}

/** Vue d'un handover du central, avec l'heure centrale de la lecture (en-tête `Date`). */
export interface HandoverView {
  handoverId: string;
  direction: 'TO_EDGE' | 'TO_CENTRAL';
  state: HandoverBody['state'];
  epoch: number;
  centralWatermarkPostingId: bigint | null;
  finalEdgeSeq: number | null;
  missingEdgeSeqs: number[];
  edgeSeqAtActivation: number | null;
  centralTime: Date;
}

export function toHandoverView(body: HandoverBody, centralTime: Date): HandoverView {
  const watermark = body.central_watermark_posting_id;
  return {
    handoverId: body.handover_id,
    direction: body.direction,
    state: body.state,
    epoch: Number(body.epoch),
    centralWatermarkPostingId:
      watermark === null || watermark === undefined ? null : BigInt(watermark),
    finalEdgeSeq: body.final_edge_seq ?? null,
    missingEdgeSeqs: body.missing_edge_seqs ?? [],
    edgeSeqAtActivation:
      body.edge_seq_at_activation === null || body.edge_seq_at_activation === undefined
        ? null
        : Number(body.edge_seq_at_activation),
    centralTime,
  };
}

/** Refus de débit levé par `assertCanDebit` ; WP21 et WP22 le traduisent en `409`. */
export type AuthorityRefusalCode =
  | 'DEBIT_AUTHORITY_MOVING'
  | 'STALE_AUTHORITY_EPOCH'
  | 'CONFLICT_STATE';
export class AuthorityRefusal extends Error {
  readonly httpStatus = 409;
  constructor(
    readonly code: AuthorityRefusalCode,
    readonly state: AuthorityState,
    readonly authorityEpoch: number,
    /** `GATEWAY_NOT_AUTHORITY` pour `CONFLICT_STATE`. */
    readonly detail?: 'GATEWAY_NOT_AUTHORITY',
  ) {
    super(`débit refusé : ${code} (${state})`);
    this.name = 'AuthorityRefusal';
  }
}

type Patch = Partial<{
  link_state: AuthorityRow['linkState'];
  epoch: number;
  handover_id: string | null;
  watermark_posting_id: bigint | null;
  activated_at: Date | null;
  edge_seq_at_activation: bigint | null;
  token_tolerance_until: Date | null;
  releasing_since: Date | null;
  highest_epoch_seen: number;
  unconfirmed_epoch_seen: number | null;
  handover_failed_epoch: number | null;
  central_confirmed_epoch: number | null;
}>;

interface RawRow {
  state: AuthorityState;
  link_state: AuthorityRow['linkState'];
  epoch: string;
  handover_id: string | null;
  watermark_posting_id: string | null;
  activated_at: Date | null;
  edge_seq_at_activation: string | null;
  token_tolerance_until: Date | null;
  releasing_since: Date | null;
  highest_epoch_seen: string;
  unconfirmed_epoch_seen: string | null;
  handover_failed_epoch: string | null;
  central_confirmed_epoch: string | null;
  updated_at: Date;
}

const num = (value: string | null): number | null => (value === null ? null : Number(value));
const big = (value: string | null): bigint | null => (value === null ? null : BigInt(value));

function mapRow(raw: RawRow): AuthorityRow {
  return {
    state: raw.state,
    linkState: raw.link_state,
    epoch: Number(raw.epoch),
    handoverId: raw.handover_id,
    watermarkPostingId: big(raw.watermark_posting_id),
    activatedAt: raw.activated_at,
    edgeSeqAtActivation: big(raw.edge_seq_at_activation),
    tokenToleranceUntil: raw.token_tolerance_until,
    releasingSince: raw.releasing_since,
    highestEpochSeen: Number(raw.highest_epoch_seen),
    unconfirmedEpochSeen: num(raw.unconfirmed_epoch_seen),
    handoverFailedEpoch: num(raw.handover_failed_epoch),
    centralConfirmedEpoch: num(raw.central_confirmed_epoch),
    updatedAt: raw.updated_at,
  };
}

const SELECT_ROW = `SELECT state, link_state, epoch, handover_id, watermark_posting_id,
  activated_at, edge_seq_at_activation, token_tolerance_until, releasing_since,
  highest_epoch_seen, unconfirmed_epoch_seen, handover_failed_epoch, central_confirmed_epoch,
  updated_at FROM edge_authority`;

const OPEN_TO_CENTRAL = new Set<string>(['RELEASE_REQUESTED', 'RELEASING']);

@Injectable()
export class AuthorityService {
  private readonly logger = new Logger('Authority');
  private lastUnconfirmedAuditMs = -Infinity;
  private lastUnconfirmedEpoch = -1;
  private lastAnomalyKey = '';
  private lastAckRefusalFor = '';

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(CentralClient) private readonly central: CentralClient,
    @Optional() @Inject(DRAIN_SIGNAL) private readonly drain?: DrainSignal,
  ) {}

  // ----- lecture ------------------------------------------------------------------------------

  async state(): Promise<AuthorityRow> {
    return this.gatewayTx.run((tx) => this.readRow(tx, false));
  }

  private async readRow(tx: TxClient, lock: 'update' | 'share' | false): Promise<AuthorityRow> {
    const suffix = lock === 'update' ? ' FOR UPDATE' : lock === 'share' ? ' FOR SHARE' : '';
    const { rows } = await tx.query<RawRow>(`${SELECT_ROW}${suffix}`);
    if (!rows[0]) throw new Error('edge_authority : ligne absente (passerelle non enrôlée)');
    return mapRow(rows[0]);
  }

  /**
   * À appeler DANS la transaction de l'opération (`tx`). Lit `edge_authority` `FOR SHARE` : une
   * transition qui écrit la ligne attend la fin des opérations en cours, et inversement. Ne
   * modifie rien. Sans `tx`, ouvre sa propre transaction (lecture seule, sans garantie pour
   * l'appelant).
   */
  async assertCanDebit(requestEpoch: number | null, tx?: TxClient): Promise<AuthorityRow> {
    const check = async (t: TxClient): Promise<AuthorityRow> => {
      const row = await this.readRow(t, 'share');
      switch (row.state) {
        case 'ACTIVE':
          if (row.epoch < row.highestEpochSeen) {
            throw new AuthorityRefusal('STALE_AUTHORITY_EPOCH', row.state, row.epoch);
          }
          if (requestEpoch !== null && requestEpoch !== row.epoch) {
            throw new AuthorityRefusal('STALE_AUTHORITY_EPOCH', row.state, row.epoch);
          }
          return row;
        case 'GRANTED_PENDING':
        case 'RELEASING':
          throw new AuthorityRefusal('DEBIT_AUTHORITY_MOVING', row.state, row.epoch);
        case 'STALE':
        case 'REVOKED':
          throw new AuthorityRefusal('STALE_AUTHORITY_EPOCH', row.state, row.epoch);
        case 'ARMED':
        case 'STANDBY':
        case 'RELEASED':
          throw new AuthorityRefusal(
            'CONFLICT_STATE',
            row.state,
            row.epoch,
            'GATEWAY_NOT_AUTHORITY',
          );
      }
    };
    return tx ? check(tx) : this.gatewayTx.run(check);
  }

  // ----- écriture -----------------------------------------------------------------------------

  private async audit(tx: TxClient, kind: string, detail: Record<string, unknown>): Promise<void> {
    await tx.query(`INSERT INTO edge_audit (kind, actor, detail) VALUES ($1, 'gateway', $2)`, [
      kind,
      JSON.stringify(detail),
    ]);
  }

  private async patch(tx: TxClient, to: AuthorityState | null, patch: Patch): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (to !== null) {
      values.push(to);
      sets.push(`state = $${values.length}`);
    }
    for (const [column, value] of Object.entries(patch)) {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    await tx.query(`UPDATE edge_authority SET ${sets.join(', ')}, updated_at = now()`, values);
  }

  private async move(
    tx: TxClient,
    row: AuthorityRow,
    to: AuthorityState,
    patch: Patch,
    why: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    assertTransition(row.state, to);
    await this.patch(tx, to, patch);
    await this.audit(tx, 'AUTHORITY_TRANSITION', {
      from: row.state,
      to,
      why,
      epoch: patch.epoch ?? row.epoch,
      ...extra,
    });
  }

  private anomaly(kind: string, key: string, detail: Record<string, unknown>): Promise<void> {
    if (this.lastAnomalyKey === `${kind}:${key}`) return Promise.resolve();
    this.lastAnomalyKey = `${kind}:${key}`;
    this.logger.warn(`${kind} ${key}`);
    return this.gatewayTx.run((tx) => this.audit(tx, kind, detail));
  }

  // ----- machine à états : handovers du central -------------------------------------------------

  /**
   * Entrée du canal de contrôle (et de la reprise) : état complet rendu par le central. Rien
   * n'est déduit de l'état de ce dernier sans passer par `onHandover`/`observeEpoch`, sauf le
   * retour de l'autorité au central pendant `RELEASING` (COMPLETED déjà publié).
   */
  async handleCentralState(res: DebitAuthorityStateBody, centralTime: Date): Promise<void> {
    let row = await this.state();
    if (row.state === 'RELEASED') {
      await this.armAfterRelease();
      row = await this.state();
    }
    if (row.state === 'ACTIVE' || row.state === 'STALE') {
      await this.observeEpoch(Number(res.epoch), 'central');
    }
    if (res.handover) {
      await this.onHandover(toHandoverView(res.handover, centralTime));
      return;
    }
    row = await this.state();
    if (row.state === 'RELEASING' && res.authority === 'CENTRAL' && Number(res.epoch) > row.epoch) {
      // L'autorité est revenue au central (rendu terminé ou reprise forcée).
      await this.releaseCompleted(row.epoch, row.handoverId);
    } else if (row.state === 'RELEASING') {
      await this.anomaly('AUTHORITY_RECOVERY_UNKNOWN', `releasing:${row.handoverId}`, {
        state: row.state,
        epoch: row.epoch,
        central_authority: res.authority,
        central_epoch: res.epoch,
      });
    }
  }

  async onHandover(h: HandoverView): Promise<void> {
    const pendingRelease = await this.gatewayTx.run(async (tx) => {
      const row = await this.readRow(tx, 'update');
      return this.applyHandover(tx, row, h);
    });
    if (pendingRelease) {
      // RELEASING est COMMITÉ : le point d'arrêt simule un arrêt brutal juste après.
      await failpoint('after-releasing-persisted');
      await this.drain?.requestDrain();
    }
    // Rendu terminé : `RELEASED` est commité, puis `ARMED` (deux commits, B.8).
    if ((await this.state()).state === 'RELEASED') await this.armAfterRelease();
  }

  /** Rend `true` quand la transaction a persisté `RELEASING`. */
  private async applyHandover(tx: TxClient, row: AuthorityRow, h: HandoverView): Promise<boolean> {
    if (row.state === 'STANDBY' || row.state === 'REVOKED') return false; // jamais d'accord
    switch (row.state) {
      case 'ARMED':
      case 'STALE':
        await this.onGrantSeen(tx, row, h);
        return false;
      case 'GRANTED_PENDING':
        await this.onGrantPending(tx, row, h);
        return false;
      case 'ACTIVE':
        return this.onActive(tx, row, h);
      case 'RELEASING':
        await this.onReleasing(tx, row, h);
        return false;
      case 'RELEASED':
        await this.move(tx, row, 'ARMED', {}, 'RELEASED -> ARMED');
        return false;
    }
  }

  private async onGrantSeen(tx: TxClient, row: AuthorityRow, h: HandoverView): Promise<void> {
    if (h.direction !== 'TO_EDGE') return;
    if (h.state !== 'GRANTED') {
      if (h.epoch > row.highestEpochSeen) {
        await this.patch(tx, null, {
          highest_epoch_seen: h.epoch,
          central_confirmed_epoch: h.epoch,
        });
      }
      return;
    }
    // STALE n'accepte qu'un accord sur une époque STRICTEMENT supérieure à celle vue ; ARMED, au
    // moins égale (le rendu pose `highest_epoch_seen = e + 2`, le prochain accord vaut e + 2).
    const acceptable =
      row.state === 'STALE' ? h.epoch > row.highestEpochSeen : h.epoch >= row.highestEpochSeen;
    if (!acceptable) {
      await this.audit(tx, 'GRANT_REFUSED_EPOCH', {
        handover: h.handoverId,
        epoch: h.epoch,
        highest_epoch_seen: row.highestEpochSeen,
      });
      return;
    }
    if (this.clock.refusesAck()) {
      // A14 : écart d'horloge de plus de 24 h, l'accusé n'est pas envoyé et l'état reste.
      if (this.lastAckRefusalFor !== h.handoverId) {
        this.lastAckRefusalFor = h.handoverId;
        this.logger.warn('accord ignoré : horloge de la passerelle incohérente avec le central');
        await this.audit(tx, 'ACK_REFUSED_CLOCK', { handover: h.handoverId, epoch: h.epoch });
      }
      return;
    }
    await this.move(
      tx,
      row,
      'GRANTED_PENDING',
      {
        handover_id: h.handoverId,
        epoch: h.epoch,
        watermark_posting_id: h.centralWatermarkPostingId,
        highest_epoch_seen: Math.max(row.highestEpochSeen, h.epoch),
        central_confirmed_epoch: Math.max(row.centralConfirmedEpoch ?? 0, h.epoch),
        handover_failed_epoch: null,
        releasing_since: null,
      },
      'handover GRANTED vu',
      { handover: h.handoverId },
    );
  }

  private async onGrantPending(tx: TxClient, row: AuthorityRow, h: HandoverView): Promise<void> {
    if (h.direction !== 'TO_EDGE') return;
    if (h.handoverId === row.handoverId && h.epoch === row.epoch) {
      if (h.state === 'FAILED' || h.state === 'FORCED') {
        await this.move(tx, row, 'ARMED', {}, `handover ${h.state}`, { handover: h.handoverId });
      } else if (h.state === 'ACTIVE') {
        // L'accusé a été reçu mais ACTIVE n'a pas été écrit (arrêt entre le 200 et l'écriture) :
        // ACTIVE sans nouvel accusé, si le curseur est au filigrane.
        const cursor = await tx.query<{ last_replicated_posting_id: string }>(
          'SELECT last_replicated_posting_id FROM edge_replication_cursor',
        );
        const reached = BigInt(cursor.rows[0]?.last_replicated_posting_id ?? '0');
        if (row.watermarkPostingId !== null && reached >= row.watermarkPostingId) {
          await this.activate(
            tx,
            row,
            h.centralTime,
            h.edgeSeqAtActivation,
            'ACTIVE vu au central',
          );
        }
      }
      return;
    }
    if (h.state === 'GRANTED' && h.epoch > row.epoch) {
      // Un autre accord, d'une époque supérieure : on repart de ARMED.
      await this.move(tx, row, 'ARMED', {}, 'accord remplacé', { handover: h.handoverId });
      await this.onGrantSeen(tx, { ...row, state: 'ARMED' }, h);
    }
  }

  private async activate(
    tx: TxClient,
    row: AuthorityRow,
    centralTime: Date,
    edgeSeqAtActivation: number | null,
    why: string,
  ): Promise<void> {
    let seq: bigint;
    if (edgeSeqAtActivation !== null) {
      seq = BigInt(edgeSeqAtActivation);
    } else {
      // Le central ne publie pas le champ : dernier numéro du cycle précédent, acquitté (la file
      // est vide à chaque rendu, `ARMED` ne débite pas).
      const head = await tx.query<{ acked_edge_seq: string }>(
        'SELECT acked_edge_seq FROM edge_chain_head',
      );
      seq = BigInt(head.rows[0]?.acked_edge_seq ?? '0');
    }
    await this.move(
      tx,
      row,
      'ACTIVE',
      {
        activated_at: centralTime,
        edge_seq_at_activation: seq,
        token_tolerance_until: new Date(centralTime.getTime() + TOKEN_TOLERANCE_MS),
        releasing_since: null,
        handover_failed_epoch: null,
      },
      why,
      { handover: row.handoverId, edge_seq_at_activation: seq.toString() },
    );
  }

  /** Accusé `200` reçu (ou répété, A17) : écrit `ACTIVE`. Idempotent. */
  async markActive(args: {
    handoverId: string;
    epoch: number;
    centralTime: Date;
    edgeSeqAtActivation: number | null;
  }): Promise<AuthorityRow> {
    return this.gatewayTx.run(async (tx) => {
      const row = await this.readRow(tx, 'update');
      if (
        row.state === 'ACTIVE' &&
        row.handoverId === args.handoverId &&
        row.epoch === args.epoch
      ) {
        return row; // accusé répété
      }
      if (
        row.state !== 'GRANTED_PENDING' ||
        row.handoverId !== args.handoverId ||
        row.epoch !== args.epoch
      ) {
        return row; // l'accord a changé entre-temps : le prochain passage du canal décide
      }
      await this.activate(tx, row, args.centralTime, args.edgeSeqAtActivation, 'accusé 200');
      return this.readRow(tx, false);
    });
  }

  /** Horloge incohérente avant l'envoi de l'accusé : on retourne à `ARMED`, alerte. */
  async abandonGrant(reason: string): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      const row = await this.readRow(tx, 'update');
      if (row.state !== 'GRANTED_PENDING') return;
      await this.move(tx, row, 'ARMED', {}, reason);
    });
  }

  private async onActive(tx: TxClient, row: AuthorityRow, h: HandoverView): Promise<boolean> {
    if (h.epoch > row.epoch) {
      await this.stale(tx, row, h.epoch, 'central', 'handover d’une époque supérieure');
      return false;
    }
    if (h.direction === 'TO_CENTRAL' && OPEN_TO_CENTRAL.has(h.state) && h.epoch === row.epoch) {
      // `RELEASING` est écrit AVANT de cesser de débiter et de refuser les lots (B.7-4).
      await this.move(
        tx,
        row,
        'RELEASING',
        {
          releasing_since: this.clock.now(),
          handover_id: h.handoverId,
          handover_failed_epoch: null,
        },
        'RELEASE_REQUESTED vu',
        { handover: h.handoverId },
      );
      return true;
    }
    return false;
  }

  private async onReleasing(tx: TxClient, row: AuthorityRow, h: HandoverView): Promise<void> {
    // Seul le handover TO_CENTRAL que NOUS avons persisté compte : un TO_EDGE `ACTIVE` de la même
    // époque (deux handovers sont ouverts pendant le rendu, A13) ne ramène jamais à `ACTIVE`.
    if (h.direction !== 'TO_CENTRAL') return;
    if (h.handoverId !== row.handoverId) {
      if (OPEN_TO_CENTRAL.has(h.state)) {
        this.logger.warn('rendu : autre demande ouverte, reste RELEASING');
        await this.audit(tx, 'AUTHORITY_UNEXPECTED_HANDOVER', {
          state: row.state,
          seen: h.handoverId,
          held: row.handoverId,
        });
      }
      return;
    }
    if (h.epoch !== row.epoch) return; // FAILED pour une autre époque : jamais ACTIVE
    if (h.state === 'FAILED') {
      await this.move(
        tx,
        row,
        'ACTIVE',
        { handover_failed_epoch: row.epoch, releasing_since: null },
        'rendu FAILED, même époque',
        { handover: h.handoverId },
      );
    } else if (h.state === 'COMPLETED' || h.state === 'FORCED') {
      await this.move(
        tx,
        row,
        'RELEASED',
        { highest_epoch_seen: Math.max(row.highestEpochSeen, row.epoch + 2) },
        `rendu ${h.state}`,
        { handover: h.handoverId },
      );
    }
  }

  /** Autorité revenue au central pendant `RELEASING` (publication seule de l'état). */
  private async releaseCompleted(epoch: number, handoverId: string | null): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      const row = await this.readRow(tx, 'update');
      if (row.state !== 'RELEASING' || row.epoch !== epoch) return;
      await this.move(
        tx,
        row,
        'RELEASED',
        { highest_epoch_seen: Math.max(row.highestEpochSeen, row.epoch + 2) },
        'autorité revenue au central',
        { handover: handoverId },
      );
    });
    await this.armAfterRelease();
  }

  /** Rendu `200` : `RELEASED` (`highest_epoch_seen = e + 2`) puis `ARMED` (deux commits). */
  async markReleased(): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      const row = await this.readRow(tx, 'update');
      if (row.state !== 'RELEASING') return;
      await this.move(
        tx,
        row,
        'RELEASED',
        { highest_epoch_seen: Math.max(row.highestEpochSeen, row.epoch + 2) },
        'rendu 200',
        { handover: row.handoverId },
      );
    });
    await this.armAfterRelease();
  }

  private async armAfterRelease(): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      const row = await this.readRow(tx, 'update');
      if (row.state === 'RELEASED') await this.move(tx, row, 'ARMED', {}, 'RELEASED -> ARMED');
    });
  }

  // ----- époques (A12) --------------------------------------------------------------------------

  private async stale(
    tx: TxClient,
    row: AuthorityRow,
    epoch: number,
    source: 'central' | 'request',
    why: string,
  ): Promise<void> {
    await this.move(
      tx,
      row,
      'STALE',
      {
        highest_epoch_seen: Math.max(row.highestEpochSeen, epoch),
        ...(source === 'central'
          ? { central_confirmed_epoch: Math.max(row.centralConfirmedEpoch ?? 0, epoch) }
          : {}),
        unconfirmed_epoch_seen: null,
      },
      why,
      { seen_epoch: epoch, source },
    );
  }

  /**
   * A12. `central` (long-polling, source fiable) : époque supérieure à celle détenue : `STALE`.
   * `request` (en-tête d'un terminal, NON vérifiable hors du central) : `STALE` seulement si
   * l'époque est déjà retenue (confirmée par le canal) ou plausible (`<= epoch + 2`) ; sinon elle
   * est consignée (`unconfirmed_epoch_seen`, audit `STALE_EPOCH_UNCONFIRMED`, alerte) SANS arrêt
   * du débit : la requête seule reçoit `409` (`assertCanDebit`, en-tête différent de l'époque).
   */
  async observeEpoch(epoch: number, source: 'central' | 'request'): Promise<void> {
    if (!Number.isSafeInteger(epoch) || epoch < 0) return;
    if (source === 'request') {
      // Même époque forgée revue : aucune lecture de la base (mille requêtes à 9999).
      if (
        epoch === this.lastUnconfirmedEpoch &&
        Date.now() - this.lastUnconfirmedAuditMs < UNCONFIRMED_AUDIT_INTERVAL_MS
      ) {
        return;
      }
      // Lecture sans verrou d'abord : mille requêtes à l'époque 9999 ne verrouillent rien.
      const peek = await this.state();
      if (peek.state !== 'ACTIVE' || epoch <= peek.epoch) return;
      if (!this.isPlausible(peek, epoch)) {
        await this.noteUnconfirmed(peek, epoch);
        return;
      }
    }
    await this.gatewayTx.run(async (tx) => {
      const row = await this.readRow(tx, 'update');
      if (source === 'request') {
        if (row.state !== 'ACTIVE' || epoch <= row.epoch || !this.isPlausible(row, epoch)) return;
        await this.stale(tx, row, epoch, 'request', 'époque vue dans une requête (plausible)');
        return;
      }
      if (epoch <= row.epoch) return;
      if (row.state === 'ACTIVE') {
        await this.stale(tx, row, epoch, 'central', 'époque supérieure vue au central');
      } else if (row.state === 'STALE') {
        // Le central confirme : la levée locale devient impossible (`central_confirmed_epoch`).
        await this.patch(tx, null, {
          highest_epoch_seen: Math.max(row.highestEpochSeen, epoch),
          central_confirmed_epoch: Math.max(row.centralConfirmedEpoch ?? 0, epoch),
        });
      }
    });
  }

  /** Plausible : au plus `epoch + 2` (protocole `e + 2` du rendu), ou déjà retenue par le canal. */
  private isPlausible(row: AuthorityRow, epoch: number): boolean {
    return epoch <= row.epoch + PLAUSIBLE_EPOCH_WINDOW || epoch <= row.highestEpochSeen;
  }

  private async noteUnconfirmed(row: AuthorityRow, epoch: number): Promise<void> {
    const nowMs = Date.now();
    if (nowMs - this.lastUnconfirmedAuditMs < UNCONFIRMED_AUDIT_INTERVAL_MS) return;
    this.lastUnconfirmedAuditMs = nowMs;
    this.lastUnconfirmedEpoch = epoch;
    this.logger.warn('époque implausible vue dans une requête de terminal : ignorée (A12)');
    await this.gatewayTx.run(async (tx) => {
      await this.patch(tx, null, { unconfirmed_epoch_seen: epoch });
      await this.audit(tx, 'STALE_EPOCH_UNCONFIRMED', {
        seen_epoch: epoch,
        held_epoch: row.epoch,
        highest_epoch_seen: row.highestEpochSeen,
      });
    });
  }

  // ----- rôle, lien, révocation ---------------------------------------------------------------

  /** `reference.gateway.role` relu à chaque passe du flux (WP18). Promotion seule. */
  async onRoleChanged(role: 'PRIMARY' | 'STANDBY'): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      const row = await this.readRow(tx, 'update');
      await tx.query('UPDATE edge_meta SET role = $1', [role]);
      if (role === 'PRIMARY' && row.state === 'STANDBY') {
        await this.move(tx, row, 'ARMED', {}, 'promotion');
        await requestFullCopy(tx);
      }
    });
  }

  async setLinkState(next: AuthorityRow['linkState']): Promise<void> {
    const current = await this.state();
    if (current.linkState === next) return;
    await this.gatewayTx.run((tx) => this.patch(tx, null, { link_state: next }));
  }

  /** Certificat refusé par le central : `REVOKED`, persistant, alerte locale. */
  async markRevoked(): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      let row = await this.readRow(tx, 'update');
      if (row.state === 'REVOKED') return;
      this.logger.error('certificat refusé par le central : passerelle révoquée');
      if (row.state === 'GRANTED_PENDING') {
        await this.move(tx, row, 'ARMED', {}, 'certificat refusé');
        row = { ...row, state: 'ARMED' };
      }
      if (row.state === 'ACTIVE' || row.state === 'ARMED') {
        await this.move(tx, row, 'REVOKED', {}, 'certificat refusé');
      } else {
        // B.8 ne prévoit pas REVOKED depuis ces états (aucun débit n'y est permis de toute façon).
        await this.audit(tx, 'REVOKED_SEEN', { state: row.state });
      }
    });
  }

  // ----- reprise après redémarrage (A13) ------------------------------------------------------

  /**
   * Relit `edge_authority` et le handover courant du central et rejoue les cas de B.8. Aucune
   * décision n'est tirée de l'état seul : `RELEASING` ne sort jamais vers `ACTIVE` sans un `FAILED`
   * de la MÊME époque pour le handover TO_CENTRAL persisté. Central injoignable : l'état persisté
   * reste, sans débit hors `ACTIVE`. Cas inconnu : état sûr + alerte.
   */
  async recover(): Promise<{ contacted: boolean }> {
    const row = await this.state();
    if (row.state === 'RELEASED') await this.armAfterRelease();
    let res: Awaited<ReturnType<CentralClient['getCurrentEdgeHandover']>>;
    try {
      res = await this.central.getCurrentEdgeHandover(0, { timeoutMs: RECOVER_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof CentralError && error.isCertificateRejected) await this.markRevoked();
      return { contacted: false };
    }
    await this.handleCentralState(res.body, res.centralDate ?? this.clock.now());
    return { contacted: true };
  }

  // ----- levée locale de STALE à deux personnes (T078, § 12.13) --------------------------------

  /**
   * Ordre `{ kind: 'LOCAL_UNSTALE', gateway_id, epoch, issued_at, nonce }` signé par deux
   * responsables du site. Refusé : une seule signature, deux fois la même clé, ordre périmé,
   * nonce rejoué, passerelle autre qu'`STALE`, époque différente de l'époque détenue, lien non
   * coupé, époque supérieure confirmée par le central. Effet : `ACTIVE`, `highest_epoch_seen`
   * ramenée à `epoch`, audit `LOCAL_UNSTALE` avec les deux auteurs.
   */
  async localUnstale(body: { order: unknown; signatures: unknown }): Promise<AuthorityRow> {
    const order = parseOrderPayload(body.order);
    const signatures = parseSignatures(body.signatures);
    try {
      return await this.gatewayTx.run(async (tx) => {
        const row = await this.readRow(tx, 'update');
        const meta = await tx.query<{ gateway_id: string }>('SELECT gateway_id FROM edge_meta');
        const keys = await loadSiteOrderKeys(tx);
        const verified = verifyTwoPersonOrder(
          'LOCAL_UNSTALE',
          order,
          signatures as OrderSignature[],
          keys,
          this.clock.now(),
          meta.rows[0]?.gateway_id ?? '',
        );
        const exact = Object.keys(order).sort().join(',');
        if (exact !== 'epoch,gateway_id,issued_at,kind,nonce') {
          throw new SiteOrderError('MALFORMED', 'ordre : champs de LOCAL_UNSTALE attendus');
        }
        if (order.gateway_id !== meta.rows[0]?.gateway_id) {
          throw new SiteOrderError('WRONG_GATEWAY', 'ordre : autre passerelle');
        }
        if (row.state !== 'STALE') {
          throw new SiteOrderError('REFUSED', 'levée refusée : la passerelle n’est pas STALE');
        }
        if (order.epoch !== row.epoch) {
          throw new SiteOrderError('REFUSED', 'levée refusée : époque différente de celle détenue');
        }
        if (row.centralConfirmedEpoch !== null && row.centralConfirmedEpoch > row.epoch) {
          throw new SiteOrderError(
            'REFUSED',
            'levée refusée : le central a confirmé l’époque supérieure',
          );
        }
        if (row.linkState !== 'ISOLATED') {
          throw new SiteOrderError('REFUSED', 'levée refusée : le lien avec le central est sain');
        }
        await consumeOrderNonce(tx, order, verified);
        await this.move(
          tx,
          row,
          'ACTIVE',
          { highest_epoch_seen: row.epoch, unconfirmed_epoch_seen: null, releasing_since: null },
          'levée locale à deux personnes',
        );
        await this.audit(tx, 'LOCAL_UNSTALE', {
          epoch: row.epoch,
          nonce: order.nonce,
          holders: verified.holders,
          key_ids: verified.keyIds,
          order_sha256: verified.orderSha256,
          issued_at: order.issued_at,
          previous_highest_epoch_seen: row.highestEpochSeen,
        });
        return this.readRow(tx, false);
      });
    } catch (error) {
      if (error instanceof SiteOrderError) {
        await this.refusedOrder('LOCAL_UNSTALE', error, order);
      } else if ((error as { code?: string }).code === '23505') {
        const replay = new SiteOrderError('NONCE_REPLAYED', 'ordre : nonce déjà utilisé');
        await this.refusedOrder('LOCAL_UNSTALE', replay, order);
        throw replay;
      }
      throw error;
    }
  }

  /** Consigne un refus d'ordre (sans signature ni clé) ; ne lève jamais. */
  async refusedOrder(kind: string, error: SiteOrderError, order: OrderPayload): Promise<void> {
    await this.gatewayTx
      .run((tx) =>
        this.audit(tx, 'SITE_ORDER_REFUSED', {
          order_kind: kind,
          reason: error.code,
          nonce: typeof order.nonce === 'string' ? order.nonce : null,
        }),
      )
      .catch(() => undefined);
  }
}
