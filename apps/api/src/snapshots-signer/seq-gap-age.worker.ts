// Travailleur « seq-gap-age » (WP13, T055 ; R-18, R-30.11, OP-N90) : une alerte unique par trou de numérotation
// ouvert depuis plus de 24 h, et par numéro RETRY non renvoyé sous 24 h. AUCUNE action automatique (ni suspension de
// terminal, ni levée) : seulement `offline_seq_gaps_to_alert`, `offline_retries_to_alert` et les deux marqueurs.
// Ordre : alerter PUIS marquer. Un échec entre les deux = nouvelle alerte au passage suivant (préférable à une alerte
// perdue). Une alerte non marquée n'est pas comptée : le passage répété s'arrête au lieu de reboucler.
// Le journal ne porte que le prestataire, le terminal, le numéro et l'âge.
import { Injectable, Logger } from '@nestjs/common';
import { WorkerRegistry, type ProcessWorker } from '../processes/worker';
import { SnapshotSignerRepository } from './snapshot-signer.repository';

/** Constat métier : trou ou RETRY de plus de 24 h (distinct de l'alarme 3 du signataire). */
export const ALARM_BUSINESS = 2;

const ageHours = (createdAt: Date): number =>
  Math.floor((Date.now() - createdAt.getTime()) / 3_600_000);

@Injectable()
export class SeqGapAgeWorker implements ProcessWorker {
  readonly name = 'seq-gap-age';
  private readonly logger = new Logger('seq-gap-age');
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly repository: SnapshotSignerRepository,
  ) {
    registry.register(this);
  }

  async runOnce(): Promise<number> {
    let marked = 0;
    for (const gap of await this.repository.seqGapsToAlert()) {
      this.alert('SEQ_GAP_OPEN_24H', {
        operator_id: gap.operatorId,
        device_id: gap.deviceId,
        seq: gap.seq === null ? null : gap.seq.toString(),
        age_hours: ageHours(gap.createdAt),
      });
      await this.repository.markSeqGapAlerted(gap);
      marked += 1;
    }
    for (const retry of await this.repository.retriesToAlert()) {
      this.alert('RETRY_NOT_RESENT_24H', {
        operator_id: retry.operatorId,
        device_id: retry.deviceId,
        seq: retry.seq.toString(),
        age_hours: ageHours(retry.createdAt),
      });
      await this.repository.markRetryAlerted(retry);
      marked += 1;
    }
    return marked;
  }

  private alert(event: string, fields: Record<string, unknown>): void {
    this.alarmCode = ALARM_BUSINESS;
    this.logger.warn(JSON.stringify({ event, ...fields }));
  }

  alarm(): number {
    return this.alarmCode;
  }

  async describe(): Promise<string[]> {
    const lines: string[] = [];
    for (const gap of await this.repository.seqGapsToAlert())
      lines.push(
        `seq-gap-age : trou ${gap.anomalyId} (prestataire ${gap.operatorId}, terminal ` +
          `${gap.deviceId ?? '-'}, numéro ${gap.seq ?? '-'}) ouvert depuis ${ageHours(gap.createdAt)} h`,
      );
    for (const retry of await this.repository.retriesToAlert())
      lines.push(
        `seq-gap-age : RETRY lot ${retry.batchId} numéro ${retry.seq} (prestataire ` +
          `${retry.operatorId}, terminal ${retry.deviceId}) depuis ${ageHours(retry.createdAt)} h`,
      );
    return lines;
  }
}
