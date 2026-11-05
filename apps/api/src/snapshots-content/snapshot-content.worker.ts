// Travailleur « snapshot-content » (WP11, T046 et T048) : par grand livre, détecte les changements,
// décide de la
// prochaine version (snapshot-cadence.ts), la construit (snapshot-builder.ts) et l'inscrit en
// brouillon scellé.
// Il ne signe jamais. Un grand livre = une tâche (un seul FULL à la fois par grand livre) : un FULL
// de 50 000
// bracelets tourne détaché et ne retarde pas le DELTA bloquant d'un autre grand livre ; `--once`
// attend tout.
// Alarmes (ordonnanceur) : 3 service de clés indisponible ; 2 grand livre en échec trois passages
// de suite, ou
// brouillon non signé depuis plus de cinq minutes.
// Brouillons orphelins (OPEN laissé par un passage planté, READY jeté ou jamais signé) :
// `discard_open_offline_snapshot_drafts` les jette (a) au premier passage de chaque grand livre,
// (b) quand la réservation d'une version attend depuis plus de `orphanDelayMs` (10 min par défaut,
// toujours au-delà de l'alarme de 5 min du signataire). Un brouillon que ce processus vient de
// sceller n'est jamais jeté avant ce délai.
// Exclusivité : une seule instance traite un grand livre, par verrou consultatif de session
// (`tryLock`) pris avant tout passage, balayage de démarrage compris ; sans verrou, on n'y touche pas.
// Limite connue : au démarrage, le balayage jette un brouillon scellé par l'instance précédente,
// même récent ; le signataire l'écarte proprement (DRAFT_NOT_READY) et une version neuve est produite.
import { Inject, Injectable } from '@nestjs/common';
import { KmsUnavailableError } from '../kms/kms.ports';
import { WorkerRegistry, type ProcessWorker } from '../processes/worker';
import type { AppConfig } from '../config/config';
import { ENTRY_ENCRYPTOR, type EntryEncryptor } from './entry-encryptor';
import { buildSnapshot, diffRows, type Diff, type SourceRow } from './snapshot-builder';
import { decideNext, type Change, type Decision } from './snapshot-cadence';
import { dbDetail, SnapshotDraftRepository, type Target } from './snapshot-draft.repository';

export const ALARM_LEDGER_FAILING = 2;
export const ALARM_KMS_UNAVAILABLE = 3;
export const SNAPSHOT_CONTENT_OPTIONS = Symbol('SNAPSHOT_CONTENT_OPTIONS');

const BUSY_RETRY_MS = 30_000;
/** Temporisation après un échec : 1 s, 2 s, 4 s… plafonnée. */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60_000;
const FAILURES_BEFORE_ALARM = 3;

export interface SnapshotContentOptions {
  now: () => Date;
  fullEveryMs: number;
  /** Attente d'une publication avant de lever la réservation et de jeter le brouillon resté là. */
  orphanDelayMs: number;
  /** Attente maximale d'un passage avant de rendre la main (les tâches longues continuent). */
  graceMs: number;
  /** `--once` : attend aussi les tâches détachées. */
  settleAll: boolean;
}

export function defaultOptions(
  config: Pick<AppConfig, 'snapshotFullEverySeconds' | 'snapshotOrphanDiscardSeconds'>,
): SnapshotContentOptions {
  return {
    now: () => new Date(),
    fullEveryMs: config.snapshotFullEverySeconds * 1000,
    orphanDelayMs: config.snapshotOrphanDiscardSeconds * 1000,
    graceMs: 1500,
    settleAll: process.argv.includes('--once'),
  };
}

interface LedgerMemory {
  lastFullAt: Date | null;
  eligibleSeen: number;
  purgedFull: number;
  failures: number;
  /** Désaccords de version consécutifs (publication passée entre la lecture et l'écriture). */
  races: number;
  /** Les brouillons orphelins ont été jetés une fois depuis le démarrage. */
  swept: boolean;
  blockedUntil: Date | null;
  reserved: { version: number; at: Date } | null;
}

interface Plan {
  decision: Decision;
  readAt: Date;
  diff: Diff | null;
  changes: number;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

@Injectable()
export class SnapshotContentWorker implements ProcessWorker {
  readonly name = 'snapshot-content';
  private alarmCode = 0;
  private completed = 0;
  private readonly memory = new Map<string, LedgerMemory>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    registry: WorkerRegistry,
    private readonly repo: SnapshotDraftRepository,
    @Inject(ENTRY_ENCRYPTOR) private readonly encryptor: EntryEncryptor,
    @Inject(SNAPSHOT_CONTENT_OPTIONS) private readonly options: SnapshotContentOptions,
  ) {
    registry.register(this);
  }

  alarm(): number {
    return this.alarmCode;
  }

  private raise(code: number): void {
    this.alarmCode = Math.max(this.alarmCode, code);
  }

  private memoryOf(target: Target): LedgerMemory {
    let mem = this.memory.get(target.ledgerId);
    if (!mem) {
      mem = {
        // Date du dernier FULL inconnue après un redémarrage : traitée comme « maintenant ».
        lastFullAt: target.lastFullVersion > 0 ? this.options.now() : null,
        eligibleSeen: target.eligibleDevices,
        purgedFull: 0,
        failures: 0,
        races: 0,
        swept: false,
        blockedUntil: null,
        reserved: null,
      };
      this.memory.set(target.ledgerId, mem);
    }
    return mem;
  }

  async runOnce(): Promise<number> {
    const targets = await this.repo.targets();
    await this.repo.releaseExcept(new Set(targets.map((target) => target.ledgerId)));
    // Une tâche rend la main au passage dès qu'elle est réglée OU qu'elle se détache (début d'un FULL, long par
    // nature) : le passage n'attend donc pas la période de grâce derrière un FULL, et la boucle revient vite aux
    // autres grands livres, DELTA bloquant compris (NFR-005). `--once` attend toujours tout.
    const started: Promise<void>[] = [];
    for (const target of targets) {
      if (this.inFlight.has(target.ledgerId)) continue;
      let detach!: () => void;
      const detached = new Promise<void>((resolve) => {
        detach = resolve;
      });
      const task = this.process(target, detach).finally(() => this.inFlight.delete(target.ledgerId));
      this.inFlight.set(target.ledgerId, task);
      started.push(Promise.race([task, detached]));
    }
    const all = Promise.all(this.options.settleAll ? [...this.inFlight.values()] : started);
    await (this.options.settleAll ? all : Promise.race([all, delay(this.options.graceMs)]));
    const done = this.completed;
    this.completed = 0;
    return done;
  }

  async describe(): Promise<string[]> {
    const lines: string[] = [];
    for (const target of await this.repo.targets()) {
      try {
        const plan = await this.plan(target);
        const next = plan.decision === 'none' ? 'aucune' : plan.decision;
        lines.push(
          `snapshot-content : grand livre ${target.ledgerId} (v${target.lastVersion}) : ` +
            `prochaine version ${next} (${plan.changes} changement(s))`,
        );
      } catch (error) {
        lines.push(
          `snapshot-content : grand livre ${target.ledgerId} : ${this.describeError(error)}`,
        );
      }
    }
    return lines;
  }

  private describeError(error: unknown): string {
    if (error instanceof KmsUnavailableError) return 'service de clés indisponible';
    const detail = dbDetail(error);
    const message = error instanceof Error ? error.message : 'erreur inconnue';
    const name = error instanceof Error ? error.name : 'Error';
    return `${name} : ${message.slice(0, 200)}${detail ? ` (${detail})` : ''}`;
  }

  /** Décide sans rien écrire. */
  private async plan(target: Target): Promise<Plan> {
    const mem = this.memoryOf(target);
    const readAt = this.options.now();
    const base = {
      lastVersion: target.lastVersion,
      lastGeneratedAt: target.lastGeneratedAt,
      lastFullAt: mem.lastFullAt,
      eligibleDevices: target.eligibleDevices,
      eligibleIncreased: target.eligibleDevices > mem.eligibleSeen,
      totalEntries: 0,
    };
    const opts = { fullEveryMs: this.options.fullEveryMs, validityMs: target.maxSnapshotAgeMs };
    // FULL certain sans lire la source (première version, ou FULL horaire) : rien à comparer.
    if (target.eligibleDevices > 0 && (target.lastVersion === 0 || this.fullDue(base, readAt))) {
      return { decision: 'FULL', readAt, diff: null, changes: 0 };
    }
    const raw = await this.repo.sourceDelta(
      target.operatorId,
      target.ledgerId,
      target.lastGeneratedAt!,
    );
    let diff: Diff = { live: [], removed: [], unchanged: 0 };
    let totalEntries = 0;
    if (raw.length > 0) {
      const state = await this.repo.stateHashes(target.operatorId, target.ledgerId);
      totalEntries = [...state.values()].filter((s) => !s.removed).length;
      diff = diffRows(raw, await this.repo.entryShas(raw), state);
    }
    const changes: Change[] = [
      ...diff.live.map((row: SourceRow) => ({ entry: row.entry })),
      ...diff.removed.map(() => ({ entry: null })),
    ];
    const decision = decideNext({ ...base, totalEntries }, changes, readAt, opts);
    return { decision, readAt, diff, changes: changes.length };
  }

  private fullDue(state: { lastFullAt: Date | null }, now: Date): boolean {
    return (
      state.lastFullAt !== null &&
      Math.max(0, now.getTime() - state.lastFullAt.getTime()) > this.options.fullEveryMs
    );
  }

  private async process(target: Target, detach: () => void = () => undefined): Promise<void> {
    const mem = this.memoryOf(target);
    const now = this.options.now();
    try {
      // Exclusivité : sans le verrou du grand livre, une autre instance le traite.
      if (!(await this.repo.tryLock(target.ledgerId))) return;
      if (mem.reserved && target.lastVersion >= mem.reserved.version) mem.reserved = null;
      if (mem.reserved) {
        if (now.getTime() - mem.reserved.at.getTime() <= this.options.orphanDelayMs) return;
        // Pas de publication au-delà du délai : le brouillon est jeté (ou l'était déjà) et la
        // réservation levée ; la base refuserait par `DRAFT_ALREADY_OPEN` s'il en restait un.
        const n = await this.repo.discardOrphans(target.operatorId, target.ledgerId);
        if (n > 0) {
          console.error(
            `[snapshot-content] grand livre ${target.ledgerId} : ${n} brouillon(s) ` +
              `v${mem.reserved.version} non signé(s) depuis plus de ${Math.round(this.options.orphanDelayMs / 60_000)} min, jeté(s)`,
          );
          this.raise(ALARM_LEDGER_FAILING);
        }
        mem.reserved = null;
        mem.blockedUntil = null;
      }
      if (mem.blockedUntil && now < mem.blockedUntil) return;
      if (!mem.swept) {
        // Démarrage : un brouillon OPEN/READY d'un processus précédent bloquerait `save_`.
        await this.repo.discardOrphans(target.operatorId, target.ledgerId);
        mem.swept = true;
      }
      if (target.eligibleDevices < mem.eligibleSeen) mem.eligibleSeen = target.eligibleDevices;
      // Purge hors construction d'un DELTA de ce grand livre : même tâche, avant le plan.
      if (target.lastFullVersion > mem.purgedFull) {
        await this.repo.purge(target.operatorId, target.ledgerId);
        mem.purgedFull = target.lastFullVersion;
      }
      const plan = await this.plan(target);
      if (plan.decision === 'none') return;
      await this.execute(target, plan, mem, detach);
      mem.failures = 0;
      mem.races = 0;
      this.completed += 1;
    } catch (error) {
      this.onFailure(target, mem, error);
    }
  }

  private async execute(
    target: Target,
    plan: Plan,
    mem: LedgerMemory,
    detach: () => void,
  ): Promise<void> {
    const full = plan.decision === 'FULL';
    if (full) detach();
    let live: SourceRow[];
    let removed: SourceRow[];
    if (full) {
      const rows = await this.repo.sourceFull(target.operatorId, target.ledgerId);
      live = rows.filter((row) => !row.removed);
      removed = rows.filter((row) => row.removed);
    } else {
      live = plan.diff?.live ?? [];
      removed = plan.diff?.removed ?? [];
    }
    const built = await buildSnapshot({
      kind: full ? 'FULL' : 'DELTA',
      operatorId: target.operatorId,
      ledgerId: target.ledgerId,
      expectedVersion: target.lastVersion + 1,
      baseVersion: full ? null : target.lastVersion,
      live,
      removed,
      generatedAt: plan.readAt,
      validityMs: target.maxSnapshotAgeMs,
      encryptor: this.encryptor,
    });
    await this.repo.writeDraft(
      target.operatorId,
      target.ledgerId,
      built.header,
      built.contentKeyWrapped,
      built.items,
    );
    mem.reserved = { version: target.lastVersion + 1, at: this.options.now() };
    mem.eligibleSeen = target.eligibleDevices;
    if (full) mem.lastFullAt = plan.readAt;
  }

  private onFailure(target: Target, mem: LedgerMemory, error: unknown): void {
    const detail = dbDetail(error);
    // Un brouillon est déjà en cours (en attente de signature, ou laissé OPEN par un passage
    // planté) : réessai
    // plus tard, sans compter d'échec ; le brouillon non signé trop longtemps est signalé par
    // `process`.
    if (detail === 'DRAFT_ALREADY_OPEN') {
      mem.blockedUntil = new Date(this.options.now().getTime() + BUSY_RETRY_MS);
      mem.reserved ??= { version: target.lastVersion + 1, at: this.options.now() };
      return;
    }
    // Une publication est passée entre la lecture et l'inscription : la version attendue a changé,
    // on recommence.
    // Un désaccord qui se répète n'est plus une course : il compte comme un échec.
    if (detail === 'OWNED_FIELD_MISMATCH') {
      mem.races += 1;
      if (mem.races < FAILURES_BEFORE_ALARM) return;
      this.raise(ALARM_LEDGER_FAILING);
    }
    if (error instanceof KmsUnavailableError) this.raise(ALARM_KMS_UNAVAILABLE);
    mem.failures += 1;
    const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (mem.failures - 1));
    mem.blockedUntil = new Date(this.options.now().getTime() + wait);
    console.error(
      `[snapshot-content] grand livre ${target.ledgerId} : ${this.describeError(error)} ` +
        `(échec ${mem.failures}, nouvel essai dans ${Math.round(wait / 1000)} s)`,
    );
    if (mem.failures >= FAILURES_BEFORE_ALARM) this.raise(ALARM_LEDGER_FAILING);
  }
}
