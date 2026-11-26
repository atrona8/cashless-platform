// Recherches du back-office (mission routes-backoffice, WP08). Inscrit dans `MediaPublicModule`.
import { Module } from '@nestjs/common';
import { ClaimHasher } from '../kms/claim-hash';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController],
  providers: [ClaimHasher, SearchService],
})
export class SearchModule {}
