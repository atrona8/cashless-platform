// Travailleur « snapshot-wrapping » (WP12, T051) : pour chaque (grand livre, version) publié et
// chaque
// terminal ACTIVE sans enveloppe pour sa clé d'accord courante, scelle `K_v` et l'inscrit par
// `wrap_offline_snapshot_key`. Un déchiffrement du service de clés par version, pas par terminal.
// Un terminal SUSPENDED ou REVOKED n'est jamais rendu par la file (R-30.9). La base refuse un
// terminal
// devenu inéligible ou une clé périmée : on ignore, le prochain passage relit. Idempotent.
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (règle 4 de CLAUDE.md) : orchestre des clés en clair.
// Limite connue : `content_key_wrapped` ne porte pas la référence de la clé d'emballage ; la
// réouverture
// utilise la référence COURANTE de la configuration (une rotation de cette clé rendrait les
// versions
// plus anciennes inouvrables : à consigner, pas à contourner ici).
import { Injectable, Logger } from '@nestjs/common';
import { KmsUnavailableError } from '../../kms/kms.ports';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import { ALARM_KMS_UNAVAILABLE } from '../snapshot-content.worker';
import { DeviceWrappingRepository, type KeyToWrap } from './device-wrapping.repository';
import { ContentKeyUnreadableError, SnapshotKeyWrapper } from './snapshot-key-wrapper';

/** Taille d'une lecture de la file (plafond de la fonction : 1 000). */
export const WRAP_BATCH = 500;
const MAX_ROUNDS = 100;

@Injectable()
export class DeviceWrappingWorker implements ProcessWorker {
  readonly name = 'snapshot-wrapping';
  private readonly logger = new Logger(DeviceWrappingWorker.name);
  private alarmCode = 0;
  /** Lignes déjà signalées (journal une seule fois par cause et par ligne). */
  private readonly reported = new Set<string>();

  constructor(
    registry: WorkerRegistry,
    private readonly repo: DeviceWrappingRepository,
    private readonly wrapper: SnapshotKeyWrapper,
  ) {
    registry.register(this);
  }

  alarm(): number {
    return this.alarmCode;
  }

  async describe(): Promise<string[]> {
    const waiting = await this.repo.toWrap(WRAP_BATCH);
    return [
      `snapshot-wrapping : ${waiting.length}${waiting.length === WRAP_BATCH ? '+' : ''} ` +
        'enveloppe(s) en attente',
    ];
  }

  /** Rend le nombre d'enveloppes écrites. */
  async runOnce(): Promise<number> {
    let written = 0;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const done = await this.round();
      written += done;
      if (done === 0) break;
    }
    return written;
  }

  private async round(): Promise<number> {
    const queue = await this.repo.toWrap(WRAP_BATCH);
    if (queue.length === 0) return 0;
    const operators = await this.repo.operators();
    const groups = new Map<string, KeyToWrap[]>();
    for (const item of queue) {
      const key = `${item.ledgerId}:${item.version}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    let written = 0;
    for (const [key, items] of groups) {
      const operatorId = operators.get(items[0]!.ledgerId);
      if (operatorId === undefined) continue;
      try {
        written += await this.wrapGroup(operatorId, items);
      } catch (error) {
        if (error instanceof KmsUnavailableError) {
          this.alarmCode = Math.max(this.alarmCode, ALARM_KMS_UNAVAILABLE);
          return written;
        }
        if (error instanceof ContentKeyUnreadableError) {
          this.reportOnce(`${key}:content`, `${key} ${error.message}`);
          continue;
        }
        throw error;
      }
    }
    return written;
  }

  private async wrapGroup(operatorId: string, items: KeyToWrap[]): Promise<number> {
    const first = items[0]!;
    // K_v est rouverte, utilisée et mise à zéro dans `seal` : rien n'en survit à l'écriture en
    // base.
    const outcomes = await this.wrapper.seal(
      {
        ledgerId: first.ledgerId,
        version: first.version,
        contentKeyWrapped: first.contentKeyWrapped,
      },
      items,
    );
    let written = 0;
    for (const outcome of outcomes) {
      const item = items.find((candidate) => candidate.deviceId === outcome.deviceId)!;
      if ('error' in outcome) {
        this.reportOnce(
          `${item.ledgerId}:${item.version}:${item.deviceId}:${outcome.error}`,
          `terminal ${item.deviceId} (version ${item.version}) : ${outcome.error}`,
        );
        continue;
      }
      if (await this.repo.store(operatorId, item, outcome.envelope)) written += 1;
    }
    return written;
  }

  private reportOnce(id: string, message: string): void {
    if (this.reported.has(id)) return;
    this.reported.add(id);
    this.logger.error(message);
  }
}
