// Travaux de fond d'un processus (mission bracelets-nfc, research R-04) : chaque module de fonctionnalité enregistre
// ses travailleurs ; le point d'entrée du processus les fait tourner (une fois avec `--once`, sinon à intervalle).
import { Injectable } from '@nestjs/common';

export interface ProcessWorker {
  readonly name: string;
  /** Traite ce qui attend ; rend le nombre d'unités traitées (0 : plus rien à faire pour l'instant). */
  runOnce(): Promise<number>;
  /** Décrit ce qui attend, sans rien exécuter (`--list`). */
  describe?(): Promise<string[]>;
  /** Code d'alerte (0 : rien à signaler) ; `--once` rend le plus grave comme code de sortie. */
  alarm?(): number;
}

@Injectable()
export class WorkerRegistry {
  private readonly workers: ProcessWorker[] = [];

  register(worker: ProcessWorker): void {
    if (this.workers.some((w) => w.name === worker.name)) throw new Error(`Travailleur déjà enregistré : ${worker.name}`);
    this.workers.push(worker);
  }

  names(): string[] {
    return this.workers.map((worker) => worker.name);
  }

  /** Un passage de chaque travailleur ; rend le total traité. */
  async runOnce(): Promise<number> {
    let total = 0;
    for (const worker of this.workers) total += await worker.runOnce();
    return total;
  }

  /** Repasse tant qu'il reste du travail, dans la limite de `maxPasses`. */
  async drain(maxPasses = 1000): Promise<number> {
    let total = 0;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const done = await this.runOnce();
      if (done === 0) break;
      total += done;
    }
    return total;
  }

  /** Code d'alerte le plus grave des travailleurs (0 : rien à signaler). */
  alarm(): number {
    return Math.max(0, ...this.workers.map((worker) => worker.alarm?.() ?? 0));
  }

  async describe(): Promise<string[]> {
    const lines: string[] = [];
    for (const worker of this.workers) lines.push(...((await worker.describe?.()) ?? []));
    return lines;
  }
}
