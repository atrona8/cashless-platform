// Authentification (mission identite-roles) : vérifieur OIDC, garde globale, contexte de prestataire de production.
// Global : tout module métier injecte TENANT_CONTEXT (et le vérifieur pour les jetons d'approbation).
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { TENANT_CONTEXT } from '../tenancy/tenant-context';
import { AuthenticationGuard } from './authentication.guard';
import { IdentityTenantContext } from './identity-tenant-context';
import { createIdentityVerifier, IDENTITY_VERIFIER } from './oidc-verifier';

@Global()
@Module({
  providers: [
    { provide: IDENTITY_VERIFIER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createIdentityVerifier(config.oidc) },
    AuthenticationGuard,
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    { provide: TENANT_CONTEXT, useClass: IdentityTenantContext },
  ],
  exports: [IDENTITY_VERIFIER, TENANT_CONTEXT],
})
export class IdentityModule {}
