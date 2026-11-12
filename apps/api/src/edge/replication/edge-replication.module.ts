// Flux de réplication central vers passerelle (WP12).
import { Module } from '@nestjs/common';
import { EdgeIdentityModule } from '../auth/edge-identity.module';
import { ReplicationFeedController } from './replication-feed.controller';
import { ReplicationFeedService } from './replication-feed.service';

@Module({
  imports: [EdgeIdentityModule],
  controllers: [ReplicationFeedController],
  providers: [ReplicationFeedService],
})
export class EdgeReplicationModule {}
