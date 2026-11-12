import { Module } from '@nestjs/common';
import { CentralClient } from './central-client';

@Module({ providers: [CentralClient], exports: [CentralClient] })
export class CentralClientModule {}
