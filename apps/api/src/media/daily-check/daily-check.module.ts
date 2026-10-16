// Contrôle quotidien des mots de passe stockés (processus `tag-check`).
import { Module } from '@nestjs/common';
import { DailyCheckService } from './daily-check.service';
import { DailyCheckWorker } from './daily-check.worker';

@Module({ providers: [DailyCheckService, DailyCheckWorker], exports: [DailyCheckService] })
export class DailyCheckModule {}
