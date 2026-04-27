import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { assertOwned } from '../../common/utils/ownership.utils';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { MeetingProvider, Venue, VenueKind } from './entities/venue.entity';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';

/**
 * Venue Service
 *
 * Manages the instructor's catalogue of venues. Ownership is enforced
 * on every read/write — the caller passes the authenticated `userId`,
 * we resolve the owning instructor profile, and any venue whose
 * `instructorId` doesn't match throws 403/404.
 *
 * Cross-field invariants (too complex for class-validator):
 *   - kind=ONLINE ⇔ isOnline=true ⇔ meetingUrl required.
 *   - CLIENT_HOME: address fields null (client's address belongs to the booking).
 *   - Physical kinds (GYM/STUDIO/PARK/OUTDOOR/OTHER): at least city required.
 *
 * The DB also enforces the ONLINE/meetingUrl CHECK and the country-code
 * format as belt-and-suspenders — see migration 027.
 */
@Injectable()
export class VenueService {
  constructor(
    @InjectModel(Venue)
    private readonly venueModel: typeof Venue,
    @InjectModel(InstructorProfile)
    private readonly instructorProfileModel: typeof InstructorProfile,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async list(userId: string): Promise<Venue[]> {
    const instructor = await this.getInstructorOrThrow(userId);
    return this.venueModel.findAll({
      where: { instructorId: instructor.id },
      order: [
        ['displayOrder', 'ASC NULLS LAST'],
        ['createdAt', 'DESC'],
      ],
    });
  }

  async get(userId: string, venueId: string): Promise<Venue> {
    const instructor = await this.getInstructorOrThrow(userId);
    const venue = await this.venueModel.findByPk(venueId);
    this.ensureOwnership(venue, instructor.id);
    return venue;
  }

  async create(userId: string, dto: CreateVenueDto): Promise<Venue> {
    const instructor = await this.getInstructorOrThrow(userId);
    const payload = this.normalizeAndValidate(dto);

    return this.sequelize.transaction(async (tx) => {
      const row = await this.venueModel.create(
        { ...payload, instructorId: instructor.id },
        { transaction: tx },
      );
      this.logger.log(
        `Venue created id=${row.id} instructorId=${instructor.id} kind=${row.kind}`,
        'VenueService',
      );
      return row;
    });
  }

  async update(
    userId: string,
    venueId: string,
    dto: UpdateVenueDto,
  ): Promise<Venue> {
    const instructor = await this.getInstructorOrThrow(userId);

    return this.sequelize.transaction(async (tx) => {
      const venue = await this.venueModel.findByPk(venueId, {
        transaction: tx,
      });
      this.ensureOwnership(venue, instructor.id);

      // Merge current state with incoming patch so cross-field rules
      // are evaluated against the POST-update snapshot, not just the
      // fields present in the request.
      const merged: CreateVenueDto = {
        kind: dto.kind ?? venue.kind,
        isOnline: dto.isOnline ?? venue.isOnline,
        name: dto.name ?? venue.name,
        notes: dto.notes ?? venue.notes ?? undefined,
        line1: dto.line1 ?? venue.line1 ?? undefined,
        line2: dto.line2 ?? venue.line2 ?? undefined,
        city: dto.city ?? venue.city ?? undefined,
        region: dto.region ?? venue.region ?? undefined,
        postalCode: dto.postalCode ?? venue.postalCode ?? undefined,
        countryCode: dto.countryCode ?? venue.countryCode ?? undefined,
        latitude: dto.latitude ?? venue.latitude ?? undefined,
        longitude: dto.longitude ?? venue.longitude ?? undefined,
        meetingUrl: dto.meetingUrl ?? venue.meetingUrl ?? undefined,
        meetingProvider:
          dto.meetingProvider ?? venue.meetingProvider ?? undefined,
        travelRadiusKm: dto.travelRadiusKm ?? venue.travelRadiusKm ?? undefined,
        isActive: dto.isActive ?? venue.isActive,
        displayOrder: dto.displayOrder ?? venue.displayOrder ?? undefined,
      };
      const payload = this.normalizeAndValidate(merged);

      await venue.update(payload, { transaction: tx });
      this.logger.log(
        `Venue updated id=${venue.id} instructorId=${instructor.id}`,
        'VenueService',
      );
      return venue;
    });
  }

  async archive(userId: string, venueId: string): Promise<void> {
    const instructor = await this.getInstructorOrThrow(userId);
    await this.sequelize.transaction(async (tx: Transaction) => {
      const venue = await this.venueModel.findByPk(venueId, {
        transaction: tx,
      });
      this.ensureOwnership(venue, instructor.id);
      await venue.update({ isActive: false }, { transaction: tx });
    });
  }

  async remove(userId: string, venueId: string): Promise<void> {
    const instructor = await this.getInstructorOrThrow(userId);
    await this.sequelize.transaction(async (tx: Transaction) => {
      const venue = await this.venueModel.findByPk(venueId, {
        transaction: tx,
      });
      this.ensureOwnership(venue, instructor.id);
      // Paranoid soft-delete: sets deletedAt. Sessions that reference
      // it keep venueId via migration 027's ON DELETE SET NULL (only
      // triggers on hard delete, which we never do).
      await venue.destroy({ transaction: tx });
      this.logger.log(
        `Venue soft-deleted id=${venue.id} instructorId=${instructor.id}`,
        'VenueService',
      );
    });
  }

  // --- internals --------------------------------------------------------

  /**
   * Apply derived fields (isOnline from kind) and enforce cross-field
   * invariants. Returns a plain object safe to pass to `create`/`update`.
   */
  private normalizeAndValidate(
    dto: CreateVenueDto,
  ): Partial<Venue> & Pick<Venue, 'kind' | 'name' | 'isOnline'> {
    const isOnline =
      dto.kind === VenueKind.ONLINE ? true : (dto.isOnline ?? false);

    if (dto.kind === VenueKind.ONLINE && !dto.meetingUrl) {
      throw new BadRequestException(
        'meetingUrl is required for online venues.',
      );
    }

    if (isOnline && !dto.meetingUrl) {
      throw new BadRequestException(
        'meetingUrl is required when isOnline is true.',
      );
    }

    const needsAddress = ![VenueKind.ONLINE, VenueKind.CLIENT_HOME].includes(
      dto.kind,
    );
    if (needsAddress && !dto.city) {
      throw new BadRequestException(
        'city is required for physical venues (GYM, STUDIO, PARK, OUTDOOR, OTHER).',
      );
    }

    if (dto.countryCode && !/^[A-Z]{2}$/.test(dto.countryCode)) {
      throw new BadRequestException(
        'countryCode must be an ISO 3166-1 alpha-2 code (2 uppercase letters).',
      );
    }

    // Do NOT reject a lingering travelRadiusKm on kind changes. The
    // merged snapshot can legitimately carry an old radius when the
    // instructor flips a venue from CLIENT_HOME to GYM without
    // explicitly clearing the radius. The `normalized` assignment
    // below force-nulls it for non-CLIENT_HOME kinds, which is the
    // behavior we actually want.

    const normalized: Partial<Venue> &
      Pick<Venue, 'kind' | 'name' | 'isOnline'> = {
      kind: dto.kind,
      isOnline,
      name: dto.name.trim(),
      notes: dto.notes?.trim() || null,
      line1: dto.line1?.trim() || null,
      line2: dto.line2?.trim() || null,
      city: dto.city?.trim() || null,
      region: dto.region?.trim() || null,
      postalCode: dto.postalCode?.trim() || null,
      countryCode: dto.countryCode ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      meetingUrl: isOnline ? dto.meetingUrl! : null,
      meetingProvider: isOnline
        ? (dto.meetingProvider ?? MeetingProvider.OTHER)
        : null,
      travelRadiusKm:
        dto.kind === VenueKind.CLIENT_HOME
          ? (dto.travelRadiusKm ?? null)
          : null,
      isActive: dto.isActive ?? true,
      displayOrder: dto.displayOrder ?? null,
    };

    return normalized;
  }

  private async getInstructorOrThrow(
    userId: string,
  ): Promise<InstructorProfile> {
    const instructor = await this.instructorProfileModel.findOne({
      where: { userId },
    });
    if (!instructor) {
      throw new ForbiddenException(
        'Only users with an instructor profile can manage venues.',
      );
    }
    return instructor;
  }

  private ensureOwnership(
    venue: Venue | null,
    instructorId: string,
  ): asserts venue is Venue {
    // `onMismatch: 'hide'` so a cross-instructor lookup can't probe existence.
    assertOwned(venue, instructorId, (v) => v.instructorId, {
      notFoundMessage: 'Venue not found.',
      onMismatch: 'hide',
    });
  }
}
