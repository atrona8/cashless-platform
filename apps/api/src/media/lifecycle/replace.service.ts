// Remplacement d'un bracelet perdu ou abîmé (SPECIFICATION §7.8 ; FR-027 ; contrat `replaceMedia`)
// : `replace_media` passe l'ancien en `REPLACED` ; le neuf reprend tous les portefeuilles et la
// caution `HELD` ou `DUE`, sans écriture comptable ni préchargement. Le neuf est présenté par sa
// lecture embarquée : `register_tap` répond `NOT_ACTIVATED` avant les contrôles d'UID et de
// signature, refaits ici comme à l'activation. Les refus de `replace_media` (`CL020`) sont lus
// avant l'appel pour nommer la règle ; la base refuse de toute façon.
// L'ancien comme le neuf doivent servir l'événement du terminal : l'ancien par `media_event`
// (événement de son lot, sinon du grand livre de son portefeuille), contrôle que `replace_media` ne
// fait pas.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import type { TapInput } from '../taps/taps.dto';
import { TapService } from '../taps/tap.service';
import { assertSameChip } from './activation.service';
import type { CounterActor } from './counter-access';
import { counterRefusal } from './lifecycle.dto';

export interface ReplaceInput {
  tap: TapInput;
  reason: string;
}

interface MediaRow {
  status: string;
  wallet_id: string | null;
  deposit_status: string;
  nfc_uid: Buffer | null;
  originality_sig_sha256: Buffer | null;
  batch_status: string | null;
  batch_organizer: string | null;
  batch_event: string | null;
  deposit_mode: string | null;
  /** `media_event(m.id)` : événement du lot, sinon celui du grand livre du portefeuille. */
  event_id: string | null;
}

@Injectable()
export class ReplaceService {
  constructor(
    private readonly taps: TapService,
    private readonly audit: AuditService,
  ) {}

  async replace(
    client: TxClient,
    actor: CounterActor,
    oldId: string,
    input: ReplaceInput,
    language: Language,
  ) {
    const old = await this.lock(client, oldId);
    if (!old || old.batch_organizer !== actor.organizerId) throw new ProblemException('NOT_FOUND');
    const registered = await this.taps.registerOrRefuse(client, actor.device, input.tap, [
      'NOT_ACTIVATED',
    ]);
    const newId = registered.mediaId;
    if (!newId) throw new ProblemException('MEDIA_UNKNOWN');
    if (newId === oldId) throw counterRefusal('replace.same_media', language);
    const fresh = (await this.lock(client, newId))!;
    assertSameChip(fresh, input.tap);

    if (fresh.batch_organizer !== actor.organizerId)
      throw counterRefusal('replace.other_organizer', language, 'MEDIA_STATE_INVALID', 409);
    // Le neuf doit pouvoir servir à l'événement du terminal, et son lot être en service, comme à
    // l'activation (§7.7).
    if (fresh.batch_event !== null && fresh.batch_event !== actor.eventId)
      throw new ProblemException('MEDIA_WRONG_EVENT');
    // L'ancien aussi (événement de son lot, sinon du grand livre de son portefeuille).
    if (old.event_id !== actor.eventId)
      throw counterRefusal('replace.old_wrong_event', language, 'MEDIA_WRONG_EVENT', 422);
    if (fresh.batch_status !== 'ACTIVE') throw new ProblemException('MEDIA_BATCH_INACTIVE');
    if (old.status !== 'ACTIVE' && old.status !== 'SUSPENDED')
      throw counterRefusal('replace.old_state', language, 'MEDIA_STATE_INVALID', 409, {
        media_status: old.status,
      });
    if (
      (fresh.status !== 'PERSONALIZED' && fresh.status !== 'ISSUED') ||
      fresh.wallet_id !== null
    ) {
      throw counterRefusal('replace.new_not_fresh', language, 'MEDIA_STATE_INVALID', 409, {
        new_media_status: fresh.status,
      });
    }
    if (fresh.deposit_status !== 'NONE')
      throw counterRefusal('replace.new_deposit', language, 'MEDIA_STATE_INVALID', 409);
    if (old.deposit_status === 'HELD' && fresh.deposit_mode !== old.deposit_mode)
      throw counterRefusal('replace.deposit_mode', language, 'MEDIA_STATE_INVALID', 409);

    const wallets = await client.query<{ wallet_id: string }>(
      'SELECT wallet_id FROM media_assignment WHERE media_id = $1 AND released_at IS NULL ORDER BY currency',
      [oldId],
    );
    await client.query('SELECT media_set_actor($1, $2)', [actor.userId, input.reason]);
    await client.query('SELECT replace_media($1, $2)', [oldId, newId]);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_REPLACED',
      objectType: 'media',
      objectId: oldId,
      before: { status: old.status, deposit_status: old.deposit_status },
      after: {
        status: 'REPLACED',
        reason: input.reason,
        new_media_id: newId,
        wallets: wallets.rows.map((w) => w.wallet_id),
        deposit_status: old.deposit_status,
      },
    });
    return { old_media_id: oldId, new_media_id: newId, wallet_id: old.wallet_id! };
  }

  private async lock(client: TxClient, mediaId: string): Promise<MediaRow | undefined> {
    const { rows } = await client.query<MediaRow>(
      `SELECT m.status, m.wallet_id, m.deposit_status, m.nfc_uid, m.originality_sig_sha256, b.status AS batch_status,
              b.organizer_id AS batch_organizer, b.event_id AS batch_event, b.deposit_mode,
              media_event(m.id) AS event_id
         FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1 FOR UPDATE OF m`,
      [mediaId],
    );
    return rows[0];
  }
}
