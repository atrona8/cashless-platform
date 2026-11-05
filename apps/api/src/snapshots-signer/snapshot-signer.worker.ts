// Travailleur « snapshot-signer » (WP13, T054) : relit chaque brouillon READY, le vérifie, signe JCS(en-tête) par
// le SignPort, vérifie la signature avec la clé publique du port, puis publie. Un brouillon qui ne se vérifie pas
// n'est JAMAIS signé : il est jeté (point tranché 4) et l'alarme 3 est levée. Rien n'est publié sans clé ACTIVE, en
// cas d'échec du service de clés ou de signature invalide (alarme 3). Aucun SET statement_timeout (rôle, WP08).
// Un brouillon en échec n'empêche pas les suivants (grands livres indépendants) ; un échec n'est pas compté comme
// traité, de sorte que le passage répété (`drain`) s'arrête et que le prochain essai attend l'intervalle.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { SIGN_PORT, type SignPort } from '../kms/kms.ports';
import { WorkerRegistry, type ProcessWorker } from '../processes/worker';
import { verifyDraftCooperative, type DraftRow } from './draft-verifier';
import { PublishedKeyError, signHeader, verifyWithPublishedKey } from './header-signer';
import { SnapshotSignerRepository } from './snapshot-signer.repository';

/** Intégrité de ce qui serait signé : brouillon altéré, clé absente, service de clés ou signature en échec. */
export const ALARM_INTEGRITY = 3;
export const SNAPSHOT_SIGNER_OPTIONS = Symbol('SNAPSHOT_SIGNER_OPTIONS');

export interface SnapshotSignerOptions {
  /** Attente maximale d'un passage avant de rendre la main (les tâches longues continuent). */
  graceMs: number;
  /** `--once` : attend aussi les tâches détachées. */
  settleAll: boolean;
}

export function defaultSignerOptions(): SnapshotSignerOptions {
  return { graceMs: 1500, settleAll: process.argv.includes('--once') };
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

@Injectable()
export class SnapshotSignerWorker implements ProcessWorker {
  readonly name = 'snapshot-signer';
  private readonly logger = new Logger('snapshot-signer');
  private alarmCode = 0;
  private completed = 0;
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly options: SnapshotSignerOptions;

  constructor(
    registry: WorkerRegistry,
    private readonly repository: SnapshotSignerRepository,
    @Inject(SIGN_PORT) private readonly kms: SignPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(SNAPSHOT_SIGNER_OPTIONS) options?: SnapshotSignerOptions,
  ) {
    this.options = options ?? defaultSignerOptions();
    if (!config.snapshotSigningKeyRef)
      throw new Error('SNAPSHOT_SIGNING_KEY_REF manquant : référence de la clé de signature');
    registry.register(this);
  }

  /**
   * Un passage : publie les brouillons sains, jette les faux. Un grand livre = une tâche (ses brouillons en série,
   * dans l'ordre rendu par `readyDrafts()`) ; les grands livres sont indépendants et tournent en parallèle. Une tâche
   * rend la main au passage dès qu'elle est réglée OU qu'elle se détache (début d'un FULL, long par nature) : un FULL
   * de 50 000 bracelets ne retarde donc pas le DELTA bloquant d'un autre grand livre (NFR-005). Un grand livre déjà
   * en vol n'est pas relancé (ses brouillons attendent le passage suivant). `--once` (settleAll) attend tout.
   * Comptage : rend le nombre de brouillons réglés depuis le passage précédent, y compris ceux réglés en arrière-plan
   * par une tâche détachée (comptés au passage suivant, ce qui garde `drain` en boucle tant que de l'avancement a lieu).
   */
  async runOnce(): Promise<number> {
    // Grands livres en vol AVANT la lecture : une tâche qui se termine pendant l'attente de
    // `readyDrafts()` a déjà publié ses brouillons, mais la liste lue peut encore les contenir
    // (lecture antérieure à la publication). Sans cette capture, `inFlight` (vidé à la fin de la
    // tâche) ne les retiendrait plus et un brouillon publié serait relancé, puis rejeté comme
    // « disparu » (fausse alarme 3).
    const flying = new Set(this.inFlight.keys());
    const drafts = await this.repository.readyDrafts();
    const byLedger = new Map<string, DraftRow[]>();
    for (const draft of drafts) {
      const list = byLedger.get(draft.ledgerId);
      if (list) list.push(draft);
      else byLedger.set(draft.ledgerId, [draft]);
    }
    const started: Promise<void>[] = [];
    for (const [ledgerId, list] of byLedger) {
      if (flying.has(ledgerId) || this.inFlight.has(ledgerId)) continue;
      let detach!: () => void;
      const detached = new Promise<void>((resolve) => {
        detach = resolve;
      });
      const task = this.processLedger(list, detach).finally(() => this.inFlight.delete(ledgerId));
      this.inFlight.set(ledgerId, task);
      started.push(Promise.race([task, detached]));
    }
    const all = Promise.all(this.options.settleAll ? [...this.inFlight.values()] : started);
    await (this.options.settleAll ? all : Promise.race([all, delay(this.options.graceMs)]));
    const done = this.completed;
    this.completed = 0;
    return done;
  }

  /** Brouillons d'un même grand livre, en série et dans l'ordre ; un échec n'arrête pas la suite du grand livre. */
  private async processLedger(drafts: DraftRow[], detach: () => void): Promise<void> {
    for (const draft of drafts) {
      if (draft.kind === 'FULL') detach();
      try {
        if (await this.handle(draft)) this.completed += 1;
      } catch (error) {
        this.alarmCode = ALARM_INTEGRITY;
        this.logger.error(
          `brouillon ${draft.id} non publié : ${error instanceof Error ? error.name : 'erreur'}`,
        );
      }
    }
  }

  private async handle(draft: DraftRow): Promise<boolean> {
    const rows = await this.repository.content(draft);
    const verdict = await verifyDraftCooperative(draft, rows, new Date());
    if (!verdict.ok) {
      this.alarmCode = ALARM_INTEGRITY;
      this.logger.error(`brouillon ${draft.id} rejeté : ${verdict.reason}`);
      await this.repository.discard(draft, verdict.reason);
      return true;
    }
    const signature = await signHeader(
      this.kms,
      this.config.snapshotSigningKeyRef,
      verdict.verified,
    );
    try {
      verifyWithPublishedKey(
        verdict.verified,
        signature,
        await this.repository.publishedKeys(draft.operatorId),
      );
    } catch (error) {
      if (!(error instanceof PublishedKeyError)) throw error;
      this.alarmCode = ALARM_INTEGRITY;
      this.logger.error(`brouillon ${draft.id} rejeté : ${error.reason}`);
      await this.repository.discard(draft, error.reason);
      return true;
    }
    return this.repository.publish(draft, verdict.verified.keyId, signature);
  }

  alarm(): number {
    return this.alarmCode;
  }

  async describe(): Promise<string[]> {
    return (await this.repository.readyDrafts()).map(
      (draft) =>
        `snapshot-signer : brouillon ${draft.id} (grand livre ${draft.ledgerId}, version ` +
        `${draft.version}, ${draft.kind}) à vérifier et signer`,
    );
  }
}
