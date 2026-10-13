// Organisation d'un prestataire (mission configuration-parties-evenements, WP08) : configuration des niveaux
// prestataire et organisateur, organisateurs, commerçants, contrats prestataire–organisateur, règles de frais.
// Les services sont exportés : le module des événements les réutilise (configuration, règles de frais, accès).
import { Module } from '@nestjs/common';
import { ConfigVersionsService } from './config-versions.service';
import { ContractsService } from './contracts.service';
import { FeeRulesService } from './fee-rules.service';
import { PartiesService } from './parties.service';
import { TenantAccess } from './tenant-access';
import { TenantController } from './tenant.controller';

@Module({
  controllers: [TenantController],
  providers: [TenantAccess, PartiesService, ConfigVersionsService, ContractsService, FeeRulesService],
  exports: [TenantAccess, PartiesService, ConfigVersionsService, ContractsService, FeeRulesService],
})
export class TenantModule {}
