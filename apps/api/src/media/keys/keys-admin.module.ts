// Clés de bracelet dans la commande d'administration : le seul module qui injecte KeyAdminPort.
import { Module } from '@nestjs/common';
import { TagKeyJobGate } from './job-gate';
import { KeyAdminWorker } from './key-admin.worker';

@Module({ providers: [TagKeyJobGate, KeyAdminWorker] })
export class KeysAdminModule {}
