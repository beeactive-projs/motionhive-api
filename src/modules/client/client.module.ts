import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { InstructorClient } from './entities/instructor-client.entity';
import { ClientRequest } from './entities/client-request.entity';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { ClientController } from './client.controller';
import { ClientImportService } from './client-import.service';
import { ClientService } from './client.service';
import { RoleModule } from '../role/role.module';

/**
 * Client Module
 *
 * Manages instructor-client relationships including:
 * - Client invitations (instructor → user)
 * - Client requests (user → instructor)
 * - Accept/decline/cancel flow
 * - Client list management (notes, archiving)
 * - Client import (a coach's list as invitations; emails on the job queue)
 *
 * Depends on RoleModule for role verification (INSTRUCTOR check).
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      InstructorClient,
      ClientRequest,
      InstructorProfile,
    ]),
    RoleModule,
  ],
  controllers: [ClientController],
  providers: [ClientService, ClientImportService],
  // ClientImportService for the notifications worker that sends its emails.
  exports: [ClientService, ClientImportService],
})
export class ClientModule {}
