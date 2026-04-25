import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { Venue } from './entities/venue.entity';
import { VenueService } from './venue.service';
import { VenueController } from './venue.controller';
import { RoleModule } from '../role/role.module';

/**
 * Venue Module
 *
 * CRUD over the instructor's venue catalogue. Reuses InstructorProfile
 * via SequelizeModule.forFeature for ownership lookups in the service
 * (no cross-module service dependency — all we need is the model).
 *
 * Exports VenueService so SessionModule can validate `venueId` when
 * creating or updating sessions.
 */
@Module({
  imports: [SequelizeModule.forFeature([Venue, InstructorProfile]), RoleModule],
  controllers: [VenueController],
  providers: [VenueService],
  exports: [VenueService],
})
export class VenueModule {}
