import { PartialType } from '@nestjs/swagger';
import { CreateVenueDto } from './create-venue.dto';

/**
 * Update Venue DTO
 *
 * Every field optional. The `kind` field IS included — the
 * service re-runs cross-field consistency on update (e.g. switching
 * a venue from ONLINE to GYM needs a `city`). `meetingUrl: null` and
 * `meetingProvider: null` clear those two.
 */
export class UpdateVenueDto extends PartialType(CreateVenueDto) {}
