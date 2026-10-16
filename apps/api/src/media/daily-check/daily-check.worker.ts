// Travailleur du contrôle quotidien : chaque passage contrôle les prestataires qui doivent l'être
// (pas de passage OK ou en écart depuis 24 h, pas de panne depuis 15 minutes), puis rend 0 (plus
// rien à faire). Code d'alerte du processus : 2 si un écart a été trouvé, 3 si un passage a été
// interrompu (panne du service de clés ou erreur inattendue, inscrite ERROR ; ordonnanceur alerté
// dans les deux cas). Un passage interrompu n'empêche pas le contrôle des prestataires suivants.
import { Injectable } from '@nestjs/common';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import { DailyCheckService } from './daily-check.service';

export const ALARM_MISMATCH = 2;
export const ALARM_KMS_ERROR = 3;

@Injectable()
export class DailyCheckWorker implements ProcessWorker {
  readonly name = 'daily-check';
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly checks: DailyCheckService,
  ) {
    registry.register(this);
  }

  /** `operators` limite le passage à ces prestataires (tests). */
  async runOnce(operators?: readonly string[]): Promise<number> {
    let done = 0;
    for (const operatorId of await this.checks.operators()) {
      if (operators && !operators.includes(operatorId)) continue;
      if (!(await this.checks.due(operatorId))) continue;
      const outcome = await this.checks.runOnce(operatorId);
      if (outcome.status === 'MISMATCH') this.alarmCode = Math.max(this.alarmCode, ALARM_MISMATCH);
      if (outcome.status === 'ERROR') this.alarmCode = Math.max(this.alarmCode, ALARM_KMS_ERROR);
      // Une panne n'est pas comptée comme traitée : le drain s'arrête, le prochain essai attend.
      if (outcome.status !== 'ERROR') done += 1;
    }
    return done;
  }

  /** Code d'alerte le plus grave depuis le démarrage du processus (0 : rien à signaler). */
  alarm(): number {
    return this.alarmCode;
  }

  async describe(): Promise<string[]> {
    const due: string[] = [];
    for (const operatorId of await this.checks.operators()) {
      if (await this.checks.due(operatorId))
        due.push(`daily-check : prestataire ${operatorId} à contrôler`);
    }
    return due;
  }
}
