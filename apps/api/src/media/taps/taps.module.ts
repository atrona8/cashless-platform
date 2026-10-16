// Lectures de bracelet dans l'API publique ; `TapService` sert aussi les opérations qui embarquent leur lecture.
import { Module } from '@nestjs/common';
import { TapService } from './tap.service';
import { TapsController } from './taps.controller';

@Module({ controllers: [TapsController], providers: [TapService], exports: [TapService] })
export class TapsModule {}
