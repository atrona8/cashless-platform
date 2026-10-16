// Lectures de bracelet (SPECIFICATION §7.6 ; FR-019, FR-020 ; contracts/media-lifecycle.md « Frontières de
// transaction »). `register_tap` fait toutes les règles ; ce service tient les frontières de transaction :
//   1. `POST /taps` : `register_tap` seul, validé ;
//   2. opération avec lecture embarquée : `register_tap`, le travail métier et `consume_tap` dans la même
//      transaction — un refus annule tout, et la même lecture reste utilisable ;
//   3. lecture suspecte (UID ou signature différents, copie) dans une opération : la transaction est annulée, puis
//      `register_tap` est rejoué SEUL et validé — liste noire et anomalie restent, même si l'opération a échoué.
import { Injectable } from '@nestjs/common';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import type { DeviceContext } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { DURABLE_RESULTS, tapProblem, type TapInput, type TapResult } from './taps.dto';

export interface RegisteredTap {
  result: TapResult;
  tapId: string | null;
  /** Bracelet désigné par l'identité lue, s'il existe chez ce prestataire. */
  mediaId: string | null;
}

/** Lecture refusée dans une opération : porte le résultat jusqu'à la frontière de transaction. */
export class TapRefused extends Error {
  constructor(
    readonly result: Exclude<TapResult, 'OK'>,
    /** La lecture était valide (`OK`) mais l'opération attendait un bracelet jamais activé. */
    readonly alreadyActive = false,
  ) {
    super(result);
  }
}

@Injectable()
export class TapService {
  constructor(private readonly tx: TenantTx) {}

  /** `register_tap` en ligne, dans la transaction de l'appelant. */
  async registerEmbedded(client: TxClient, device: DeviceContext, tap: TapInput): Promise<RegisteredTap> {
    const { rows } = await client.query<{ result: TapResult; tap_id: bigint | null }>(
      `SELECT result, tap_id FROM register_tap($1, $2, $3, $4, $5, $6, 'ONLINE', NULL, NULL, $7)`,
      [device.operatorId, tap.tokenHash, tap.uid, tap.counter, tap.occurredAt, device.deviceId, tap.signature],
    );
    const media = await client.query<{ id: string }>('SELECT id FROM media WHERE token_hash = $1', [tap.tokenHash]);
    return { result: rows[0]!.result, tapId: rows[0]!.tap_id === null ? null : String(rows[0]!.tap_id), mediaId: media.rows[0]?.id ?? null };
  }

  /** Relie une lecture à l'écriture qu'elle a servie : une lecture ne sert qu'à une écriture (`CL022` sinon). */
  async consume(client: TxClient, tapId: string, transactionId: string): Promise<void> {
    await client.query('SELECT consume_tap($1, $2)', [tapId, transactionId]);
  }

  /** `POST /taps` : la lecture seule, validée ; rend le résultat tel quel. */
  async register(device: DeviceContext, tap: TapInput) {
    return this.tx.run(device.operatorId, async (client) => {
      const registered = await this.registerEmbedded(client, device, tap);
      if (registered.result !== 'OK' || !registered.mediaId) {
        return { tap_id: registered.tapId === null ? null : Number(registered.tapId), result: registered.result, tap_expires_at: null, media: null, wallet: null };
      }
      const media = await client.query<{ media_id: string; status: string; batch_kind: string | null; deposit_status: string; deposit_held: bigint }>(
        'SELECT media_id, status, batch_kind, deposit_status, deposit_held FROM media_summary($1)',
        [registered.mediaId],
      );
      const wallet = await client.query<{ wallet_id: string; status: string; currency: string; spendable: bigint; paid: bigint; promo: bigint }>(
        `SELECT w.id AS wallet_id, w.status, l.currency, wallet_spendable(w.id) AS spendable,
                coalesce((SELECT -sum(ab.balance) FROM account a JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PAID'), 0)::bigint AS paid,
                coalesce((SELECT -sum(ab.balance) FROM account a JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PROMO'), 0)::bigint AS promo
           FROM media m JOIN wallet w ON w.id = m.wallet_id JOIN ledger l ON l.id = w.ledger_id WHERE m.id = $1`,
        [registered.mediaId],
      );
      const expires = await client.query<{ expires_at: Date }>(
        `SELECT t.received_at + make_interval(secs => coalesce(e.tap_replay_window_seconds, 120)) AS expires_at
           FROM media_tap t LEFT JOIN device d ON d.id = t.device_id LEFT JOIN event e ON e.id = d.event_id WHERE t.id = $1`,
        [registered.tapId],
      );
      const m = media.rows[0]!;
      const w = wallet.rows[0];
      return {
        tap_id: Number(registered.tapId),
        result: registered.result,
        tap_expires_at: expires.rows[0]?.expires_at.toISOString() ?? null,
        media: { media_id: m.media_id, status: m.status, batch_kind: m.batch_kind, deposit_status: m.deposit_status, deposit_held: Number(m.deposit_held) },
        wallet: w ? { wallet_id: w.wallet_id, status: w.status, currency: w.currency.trim(), spendable: Number(w.spendable), paid: Number(w.paid), promo: Number(w.promo) } : null,
      };
    });
  }

  /**
   * Opération qui embarque sa lecture : `fn` s'exécute dans la transaction de la lecture si son résultat est admis
   * (`OK` par défaut ; l'activation admet aussi `NOT_ACTIVATED`). Sinon tout est annulé et l'erreur `MEDIA_*`
   * correspondante est levée — après avoir rendu durables les effets d'une lecture suspecte.
   */
  async withEmbeddedTap<T>(device: DeviceContext, tap: TapInput, fn: (client: TxClient, registered: RegisteredTap) => Promise<T>, accept: readonly TapResult[] = ['OK']): Promise<T> {
    try {
      return await this.tx.run(device.operatorId, async (client) => fn(client, await this.registerOrRefuse(client, device, tap, accept)));
    } catch (error) {
      return this.settleRefusal(error, device, tap);
    }
  }

  /**
   * Lecture embarquée dans une transaction que l'appelant tient déjà (route idempotente) : rend la lecture si son
   * résultat est admis, lève `TapRefused` sinon. L'appelant DOIT passer l'erreur de sa transaction à `settleRefusal`.
   */
  async registerOrRefuse(client: TxClient, device: DeviceContext, tap: TapInput, accept: readonly TapResult[] = ['OK']): Promise<RegisteredTap> {
    const registered = await this.registerEmbedded(client, device, tap);
    if (!accept.includes(registered.result)) throw new TapRefused(registered.result === 'OK' ? 'BLOCKED' : registered.result, registered.result === 'OK');
    return registered;
  }

  /**
   * Après l'annulation de la transaction qui portait la lecture : rend durables les effets d'une lecture suspecte
   * (la lecture est rejouée seule, et validée), puis lève l'erreur `MEDIA_*`. Toute autre erreur repart telle quelle.
   */
  async settleRefusal(error: unknown, device: DeviceContext, tap: TapInput | null): Promise<never> {
    if (!(error instanceof TapRefused)) throw error;
    if (error.alreadyActive) throw new ProblemException('MEDIA_STATE_INVALID', { status: 409, detail: 'Ce bracelet est déjà actif.' });
    if (tap && DURABLE_RESULTS.includes(error.result)) {
      await this.tx.run(device.operatorId, (client) => this.registerEmbedded(client, device, tap));
    }
    throw tapProblem(error.result);
  }

  /** Lecture déjà enregistrée par CE terminal, citée par son identifiant ; inconnue ou d'un autre terminal : `TAP_UNUSABLE`. */
  async byId(client: TxClient, device: DeviceContext, tapId: number): Promise<RegisteredTap> {
    const { rows } = await client.query<{ media_id: string }>('SELECT media_id FROM media_tap WHERE id = $1 AND device_id = $2', [tapId, device.deviceId]);
    if (!rows[0]) throw new ProblemException('TAP_UNUSABLE');
    return { result: 'OK', tapId: String(tapId), mediaId: rows[0].media_id };
  }
}
