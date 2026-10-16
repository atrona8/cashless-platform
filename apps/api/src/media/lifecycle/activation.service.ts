// Activation d'un bracelet au guichet (SPECIFICATION §7.8 ; FR-021 ; contrat `activateMedia`) : remise et rattachement
// à un portefeuille par `activate_media`, qui pose aussi les crédits offerts du lot, une seule fois. Tout se fait dans
// la transaction de la requête : lecture du bracelet, portefeuille créé au besoin, activation, caution, audit.
// Un bracelet jamais activé répond `NOT_ACTIVATED` à `register_tap`, AVANT les contrôles d'UID et de signature : ils
// sont donc refaits ici, pour qu'une autre puce ne soit pas activée à la place de celle qui a été personnalisée.
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import { conflict, notFound } from '../../organization/platform/platform.dto';
import type { TapInput } from '../taps/taps.dto';
import { TapService } from '../taps/tap.service';
import type { CounterActor } from './counter-access';
import { DepositService } from './deposit.service';
import { counterRefusal, type ActivationInput, type DepositState } from './lifecycle.dto';

interface Target {
  status: string;
  nfc_uid: Buffer | null;
  originality_sig_sha256: Buffer | null;
  batch_status: string | null;
  batch_organizer: string | null;
  batch_event: string | null;
  deposit_amount: bigint | null;
  deposit_mode: string | null;
}

export interface WalletSummary {
  wallet_id: string;
  status: string;
  currency: string;
  spendable: number;
  paid: number;
  promo: number;
}

@Injectable()
export class ActivationService {
  constructor(
    private readonly taps: TapService,
    private readonly deposits: DepositService,
    private readonly audit: AuditService,
  ) {}

  async activate(client: TxClient, actor: CounterActor, input: ActivationInput & { tap: TapInput }, language: Language) {
    const registered = await this.taps.registerOrRefuse(client, actor.device, input.tap, ['NOT_ACTIVATED']);
    const mediaId = registered.mediaId;
    if (!mediaId) throw new ProblemException('MEDIA_UNKNOWN');
    const media = await this.target(client, mediaId);
    assertSameChip(media, input.tap);
    // Le lot doit pouvoir servir à l'événement du terminal, et être en service (§7.7 : seul un lot ACTIVE paie).
    if (media.batch_organizer !== actor.organizerId || (media.batch_event !== null && media.batch_event !== actor.eventId)) throw new ProblemException('MEDIA_WRONG_EVENT');
    if (media.batch_status !== 'ACTIVE') throw new ProblemException('MEDIA_BATCH_INACTIVE');
    if (!actor.activationModes.includes(input.channel)) throw new ProblemException('ACTIVATION_MODE_NOT_ALLOWED');
    // Pendant que la passerelle a l'autorité, une caution ne se prélève pas sur le solde (ADR-52).
    if (actor.debitAuthority === 'EDGE' && Number(media.deposit_amount ?? 0n) > 0 && media.deposit_mode === 'FROM_BALANCE') throw new ProblemException('DEBIT_AUTHORITY_EDGE');

    const walletId = await this.wallet(client, actor, input, language);
    await client.query('SELECT media_set_actor($1, $2)', [actor.userId, `ACTIVATION:${input.channel}`]);
    await client.query('SELECT activate_media($1, $2, $3, $4)', [mediaId, walletId, input.channel, actor.eventId]);
    const deposit: DepositState = (
      await this.deposits.take(client, { operatorId: actor.operatorId, cashDeskCode: actor.cashDeskCode, deviceId: actor.device.deviceId, audit: actor.audit, language }, mediaId, input.depositPayment, input.occurredAt)
    ).state;
    const wallet = await this.walletSummary(client, walletId);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_ACTIVATED',
      objectType: 'media',
      objectId: mediaId,
      after: { channel: input.channel, event_id: actor.eventId, wallet_id: walletId, wallet_created: input.walletId === null, deposit_status: deposit.status, promo: wallet.promo },
    });
    return { media_id: mediaId, media_status: 'ACTIVE' as const, wallet, deposit };
  }

  private async target(client: TxClient, mediaId: string): Promise<Target> {
    const { rows } = await client.query<Target>(
      `SELECT m.status, m.nfc_uid, m.originality_sig_sha256, b.status AS batch_status, b.organizer_id AS batch_organizer, b.event_id AS batch_event,
              b.deposit_amount, b.deposit_mode
         FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1 FOR UPDATE OF m`,
      [mediaId],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** Portefeuille donné (du grand livre de l'événement, actif) ou portefeuille neuf, anonyme si l'événement le permet. */
  private async wallet(client: TxClient, actor: CounterActor, input: ActivationInput, language: Language): Promise<string> {
    if (input.walletId !== null) {
      const { rows } = await client.query<{ ledger_id: string; status: string }>('SELECT ledger_id, status FROM wallet WHERE id = $1', [input.walletId]);
      if (!rows[0]) throw notFound();
      if (rows[0].ledger_id !== actor.ledgerId || rows[0].status !== 'ACTIVE') throw counterRefusal('activation.wallet_ledger', language);
      return input.walletId;
    }
    if (actor.identityMode === 'ACCOUNT_REQUIRED' && input.customerId === null) throw new ProblemException('ACCOUNT_REQUIRED');
    if (input.customerId !== null) {
      const customer = await client.query(`SELECT 1 FROM party WHERE id = $1 AND kind = 'CUSTOMER'`, [input.customerId]);
      if (customer.rowCount !== 1) throw counterRefusal('activation.customer_unknown', language);
    }
    const opened = await client.query<{ id: string }>('SELECT open_event_wallet($1, $2) AS id', [actor.eventId, input.customerId]);
    return opened.rows[0]!.id;
  }

  async walletSummary(client: TxClient, walletId: string): Promise<WalletSummary> {
    const { rows } = await client.query<{ wallet_id: string; status: string; currency: string; spendable: bigint; paid: bigint; promo: bigint }>(
      `SELECT w.id AS wallet_id, w.status, l.currency, wallet_spendable(w.id) AS spendable,
              coalesce((SELECT -sum(ab.balance) FROM account a JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PAID'), 0)::bigint AS paid,
              coalesce((SELECT -sum(ab.balance) FROM account a JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PROMO'), 0)::bigint AS promo
         FROM wallet w JOIN ledger l ON l.id = w.ledger_id WHERE w.id = $1`,
      [walletId],
    );
    const w = rows[0];
    if (!w) throw conflict('Portefeuille introuvable.');
    return { wallet_id: w.wallet_id, status: w.status, currency: w.currency.trim(), spendable: Number(w.spendable), paid: Number(w.paid), promo: Number(w.promo) };
  }
}

/**
 * UID et signature d'originalité de la puce présentée : ceux de la personnalisation, ou refus. À faire pour tout
 * bracelet jamais activé (activation, remplacement) : `register_tap` répond `NOT_ACTIVATED` avant ces contrôles.
 */
export function assertSameChip(media: { nfc_uid: Buffer | null; originality_sig_sha256: Buffer | null }, tap: TapInput): void {
  if (media.nfc_uid !== null && !media.nfc_uid.equals(tap.uid)) throw new ProblemException('MEDIA_UID_MISMATCH');
  if (media.originality_sig_sha256 !== null) {
    if (tap.signature === null) throw new ProblemException('MEDIA_SIGNATURE_MISSING');
    if (!createHash('sha256').update(tap.signature).digest().equals(media.originality_sig_sha256)) throw new ProblemException('MEDIA_SIGNATURE_MISMATCH');
  }
}
