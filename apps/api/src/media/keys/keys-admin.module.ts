// Clés de bracelet dans la commande d'administration : le seul module qui injecte KeyAdminPort.
import { Module } from '@nestjs/common';
import { KeyAdminWorker } from './key-admin.worker';

@Module({ providers: [KeyAdminWorker] })
export class KeysAdminModule {}
