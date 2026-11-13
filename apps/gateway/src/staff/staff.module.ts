// Module du jeton de personne au guichet (WP22). Branché dans `processes/gateway.module.ts`.
import { Module } from '@nestjs/common';
import { IdentityKeys } from './identity-keys.service';
import { StaffAuthorizer, StaffTokenGuard } from './staff-token.guard';

@Module({
  providers: [IdentityKeys, StaffAuthorizer, StaffTokenGuard],
  exports: [IdentityKeys, StaffAuthorizer, StaffTokenGuard],
})
export class StaffModule {}
