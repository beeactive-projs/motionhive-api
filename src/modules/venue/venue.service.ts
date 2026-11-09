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
import { apiError } from '../../common/i18n';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { MeetingProvider, Venue, VenueKind } from './entities/venue.entity';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';

/** The street side of an address: never on an online place or clients' homes. */
const NO_ADDRESS = {
  line1: null,
  line2: null,
  postalCode: null,
  latitude: null,
  longitude: null,
} as const;

/** The area: kept for clients' homes (where the coach travels), not online. */
const NO_AREA = { city: null, region: null, countryCode: null } as const;

/**
 * A patched field that an explicit null clears: null clears, a value
 * replaces, a key left out keeps the stored value.
 */
function keptOrCleared<T>(
  patched: T | null | undefined,
  stored: T | null,
): T | undefined {
  if (patched === undefined) {
    if (stored === null) {
      return undefined;
    }
    return stored;
  }
  if (patched === null) {
    return undefined;
  }
  return patched;
}

/**
 * Venue Service
 *
 * Manages the instructor's catalogue of venues. Ownership is enforced
 * on every read/write — the caller passes the authenticated `userId`,
 * we resolve the owning instructor profile, and any venue whose
 * `instructorId` doesn't match throws 403/404.
 *
 * Cross-field invariants (too complex for class-validator):
 *   - kind=ONLINE ⇒ isOnline=true. The meeting link and the platform are
 *     optional (migration 084): "I coach online, on Zoom" is enough to be
 *     a place, and the link is never shown publicly anyway. An online
 *     place keeps no address.
 *   - CLIENT_HOME: no street, postcode or coordinates (the client's address
 *     belongs to the booking); city / region / country may say the area.
 *   - Physical kinds (GYM/STUDIO/PARK/OUTDOOR/OTHER): at least city required.
 *
 * The DB also enforces the country-code format as belt-and-suspenders —
 * see migration 027.
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

  /**
   * Public, safe venue list for the `/@handle` profile page. Takes the
   * `instructor_profile` id directly (the profile is already loaded by the
   * caller) and returns only ACTIVE venues, ordered for display. No ownership
   * check — this is a public read; the caller maps to safe fields.
   */
  async listPublicForProfile(instructorProfileId: string): Promise<Venue[]> {
    return this.venueModel.findAll({
      where: { instructorId: instructorProfileId, isActive: true },
      order: [
        ['displayOrder', 'ASC NULLS LAST'],
        ['name', 'ASC'],
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
      // A new kind without an explicit isOnline decides it: a place moved
      // from online to a gym must stop counting as online on Discover.
      let isOnline = venue.isOnline;
      if (dto.isOnline !== undefined) {
        isOnline = dto.isOnline;
      } else if (dto.kind !== undefined) {
        isOnline = dto.kind === VenueKind.ONLINE;
      }

      const merged: CreateVenueDto = {
        kind: dto.kind ?? venue.kind,
        isOnline,
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
        // An explicit null clears these two (both optional since 084);
        // a key left out keeps what is stored.
        meetingUrl: keptOrCleared(dto.meetingUrl, venue.meetingUrl),
        meetingProvider: keptOrCleared(
          dto.meetingProvider,
          venue.meetingProvider,
        ),
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
    const isOnline = dto.kind === VenueKind.ONLINE || dto.isOnline === true;

    const needsAddress = ![VenueKind.ONLINE, VenueKind.CLIENT_HOME].includes(
      dto.kind,
    );
    if (needsAddress && !dto.city) {
      throw new BadRequestException(apiError('venue.cityRequired'));
    }

    if (dto.countryCode && !/^[A-Z]{2}$/.test(dto.countryCode)) {
      throw new BadRequestException(apiError('venue.invalidCountry'));
    }

    // Do NOT reject a lingering travelRadiusKm on kind changes. The
    // merged snapshot can legitimately carry an old radius when the
    // instructor flips a venue from CLIENT_HOME to GYM without
    // explicitly clearing the radius. The `normalized` assignment
    // below force-nulls it for non-CLIENT_HOME kinds, which is the
    // behavior we actually want.

    let meetingUrl: string | null = null;
    let meetingProvider: MeetingProvider | null = null;
    if (isOnline) {
      meetingUrl = dto.meetingUrl?.trim() || null;
      if (dto.meetingProvider) {
        meetingProvider = dto.meetingProvider;
      } else if (meetingUrl) {
        meetingProvider = MeetingProvider.OTHER;
      }
    }

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
      // An empty string clears it (the column only takes two letters or null).
      countryCode: dto.countryCode || null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      meetingUrl,
      meetingProvider,
      travelRadiusKm:
        dto.kind === VenueKind.CLIENT_HOME
          ? (dto.travelRadiusKm ?? null)
          : null,
      isActive: dto.isActive ?? true,
      displayOrder: dto.displayOrder ?? null,
    };

    // What does not belong to the kind is not kept, so a place switched
    // from a gym to online or to clients' homes shows no stale street.
    if (dto.kind === VenueKind.ONLINE) {
      Object.assign(normalized, NO_ADDRESS, NO_AREA);
    } else if (dto.kind === VenueKind.CLIENT_HOME) {
      Object.assign(normalized, NO_ADDRESS);
    }

    return normalized;
  }

  private async getInstructorOrThrow(
    userId: string,
  ): Promise<InstructorProfile> {
    const instructor = await this.instructorProfileModel.findOne({
      where: { userId },
    });
    if (!instructor) {
      throw new ForbiddenException(apiError('venue.coachesOnly'));
    }
    return instructor;
  }

  private ensureOwnership(
    venue: Venue | null,
    instructorId: string,
  ): asserts venue is Venue {
    // `onMismatch: 'hide'` so a cross-instructor lookup can't probe existence.
    assertOwned(venue, instructorId, (v) => v.instructorId, {
      notFoundMessage: apiError('venue.notFound'),
      onMismatch: 'hide',
    });
  }
}
