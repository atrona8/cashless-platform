// Gestion des personnes du personnel et de leurs rôles (mission identite-roles, WP06).
import { Module } from '@nestjs/common';
import { PlatformAdminsController } from './platform-admins.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ controllers: [UsersController, PlatformAdminsController], providers: [UsersService] })
export class UsersModule {}
