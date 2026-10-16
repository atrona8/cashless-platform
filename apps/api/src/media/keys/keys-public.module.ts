// Clés de bracelet dans l'API publique : lecture et demandes à deux. Aucun port du service de clés.
import { Module } from '@nestjs/common';
import { TenantAccess } from '../../organization/tenant/tenant-access';
import { KeyApprovalActions } from './key-approval-actions';
import { KeysController } from './keys.controller';
import { KeysService } from './keys.service';

@Module({ controllers: [KeysController], providers: [TenantAccess, KeysService, KeyApprovalActions], exports: [KeysService] })
export class KeysPublicModule {}
