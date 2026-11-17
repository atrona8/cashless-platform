// Relevés des parties, relevé CSV du festivalier, correspondance comptable et export comptable (mission 9b, WP13).
// Importé par AppModule (une ligne d'import hors carte). Lecture seule sur le grand livre.
import { Module } from '@nestjs/common';
import { TenantModule } from '../organization/tenant/tenant.module';
import { AccountMappingsController } from './account-mappings.controller';
import { AccountMappingsService } from './account-mappings.service';
import { AccountingExportService } from './accounting-export.service';
import { MyWalletStatementController } from './my-wallet-statement.controller';
import { MyWalletStatementService } from './my-wallet-statement.service';
import { PartyStatementController } from './party-statement.controller';
import { PartyStatementService } from './party-statement.service';

@Module({
  imports: [TenantModule],
  controllers: [PartyStatementController, MyWalletStatementController, AccountMappingsController],
  providers: [
    PartyStatementService,
    MyWalletStatementService,
    AccountMappingsService,
    AccountingExportService,
  ],
})
export class StatementsModule {}
