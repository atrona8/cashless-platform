// Identité des passerelles : lecture par l'empreinte, garde `edgeMtls` et transaction bornée à la passerelle.
import { Module } from '@nestjs/common';
import { EdgeTx } from '../edge-tx';
import { EdgeIdentityService } from './edge-identity.service';
import { EdgeMtlsGuard } from './edge-mtls.guard';

@Module({
  providers: [EdgeIdentityService, EdgeMtlsGuard, EdgeTx],
  exports: [EdgeIdentityService, EdgeMtlsGuard, EdgeTx],
})
export class EdgeIdentityModule {}
