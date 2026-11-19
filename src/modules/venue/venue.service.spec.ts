import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { MeetingProvider, Venue, VenueKind } from './entities/venue.entity';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VenueService } from './venue.service';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke tests for VenueService — covers the load-bearing surface:
 *   - normalizeAndValidate cross-field rules
 *     (ONLINE link and platform optional since 084, ONLINE keeps no
 *     address, CLIENT_HOME keeps only the area, physical kinds
 *     need city, travelRadiusKm only on CLIENT_HOME, kind=ONLINE
 *     auto-flips isOnline)
 *   - cross-instructor reads/writes 404 (existence-hide policy)
 *   - happy-path create / list (ordering) / update / soft delete
 *   - missing instructor profile → 403
 */
describe('VenueService (smoke)', () => {
  const userId = 'user-1';
  const instructorId = 'instr-1';
  const otherInstructorId = 'instr-other';

  let service: VenueService;

  const venueModel = {
    create: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
  };
  const instructorProfileModel = {
    findOne: jest.fn(),
  };
  const sequelize = {
    transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb(fakeTx)),
    ),
  };

  // Minimal DTO factory — every test starts from a valid GYM and tweaks.
  const baseGymDto = (
    overrides: Partial<CreateVenueDto> = {},
  ): CreateVenueDto =>
    ({
      kind: VenueKind.GYM,
      name: 'FitZone Cluj',
      city: 'Cluj-Napoca',
      ...overrides,
    }) as CreateVenueDto;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: caller has an instructor profile.
    instructorProfileModel.findOne.mockResolvedValue({ id: instructorId });

    const module = await Test.createTestingModule({
      providers: [
        VenueService,
        { provide: getModelToken(Venue), useValue: venueModel },
        {
          provide: getModelToken(InstructorProfile),
          useValue: instructorProfileModel,
        },
        { provide: Sequelize, useValue: sequelize },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(VenueService);
  });

  it('constructs', () => {
    expect(service).toBeDefined();
  });

  // ───── normalizeAndValidate cross-field rules (via create) ─────────

  describe('cross-field validation', () => {
    it('takes an online place with neither a link nor a platform', async () => {
      venueModel.create.mockImplementationOnce((payload) =>
        Promise.resolve({ id: 'v-on', ...payload }),
      );

      await service.create(
        userId,
        baseGymDto({ kind: VenueKind.ONLINE, name: 'Online', city: undefined }),
      );

      const persisted = venueModel.create.mock.calls[0][0];
      expect(persisted.isOnline).toBe(true);
      expect(persisted.meetingUrl).toBeNull();
      expect(persisted.meetingProvider).toBeNull();
    });

    it('keeps the platform of an online place that has no link', async () => {
      venueModel.create.mockImplementationOnce((payload) =>
        Promise.resolve({ id: 'v-on', ...payload }),
      );

      await service.create(
        userId,
        baseGymDto({
          kind: VenueKind.ONLINE,
          name: 'Zoom',
          city: undefined,
          meetingProvider: MeetingProvider.ZOOM,
        }),
      );

      const persisted = venueModel.create.mock.calls[0][0];
      expect(persisted.meetingProvider).toBe(MeetingProvider.ZOOM);
      expect(persisted.meetingUrl).toBeNull();
    });

    it('keeps no address on an online place, whatever was sent', async () => {
      venueModel.create.mockImplementationOnce((payload) =>
        Promise.resolve({ id: 'v-on', ...payload }),
      );

      await service.create(
        userId,
        baseGymDto({
          kind: VenueKind.ONLINE,
          line1: 'Str. Memorandumului 28',
          countryCode: 'RO',
          latitude: 46.77,
          longitude: 23.62,
        }),
      );

      const persisted = venueModel.create.mock.calls[0][0];
      expect(persisted).toMatchObject({
        line1: null,
        city: null,
        countryCode: null,
        latitude: null,
        longitude: null,
      });
    });

    it('lets a physical place be online too, without a link', async () => {
      venueModel.create.mockImplementationOnce((payload) =>
        Promise.resolve({ id: 'v', ...payload }),
      );

      await service.create(userId, baseGymDto({ isOnline: true }));

      const persisted = venueModel.create.mock.calls[0][0];
      expect(persisted.isOnline).toBe(true);
      expect(persisted.city).toBe('Cluj-Napoca');
    });

    it("keeps the area of clients' homes but no street", async () => {
      venueModel.create.mockImplementationOnce((payload) =>
        Promise.resolve({ id: 'v-ch', ...payload }),
      );

      await service.create(
        userId,
        baseGymDto({
          kind: VenueKind.CLIENT_HOME,
          line1: 'Str. Memorandumului 28',
          postalCode: '400114',
          countryCode: 'RO',
        }),
      );

      const persisted = venueModel.create.mock.calls[0][0];
      expect(persisted).toMatchObject({
        city: 'Cluj-Napoca',
        countryCode: 'RO',
        line1: null,
        postalCode: null,
      });
    });

    it('rejects physical kinds without a city', async () => {
      await expect(
        service.create(userId, baseGymDto({ city: undefined })),
      ).rejects.toThrow(/add a city/i);
    });

    it('allows CLIENT_HOME with no address', async () => {
      venueModel.create.mockImplementationOnce((payload) =>
        Promise.resolve({
          id: 'v-ch',
          ...payload,
        }),
      );

      await service.create(
        userId,
        baseGymDto({ kind: VenueKind.CLIENT_HOME, city: undefined }),
      );

      const persisted = venueModel.create.mock.calls[0][0];
      expect(persisted.kind).toBe(VenueKind.CLIENT_HOME);
      expect(persisted.city).toBeNull();
      expect(persisted.line1).toBeNull();
      expect(persisted.postalCode).toBeNull();
    });

    it('keeps travelRadiusKm only when kind=CLIENT_HOME, drops it otherwise', async () => {
      venueModel.create.mockImplementation((payload) =>
        Promise.resolve({
          id: 'v',
          ...payload,
        }),
      );

      // CLIENT_HOME → kept.
      await service.create(
        userId,
        baseGymDto({
          kind: VenueKind.CLIENT_HOME,
          city: undefined,
          travelRadiusKm: 25,
        }),
      );
      expect(venueModel.create.mock.calls[0][0].travelRadiusKm).toBe(25);

      // GYM → dropped even if FE sent one.
      await service.create(userId, baseGymDto({ travelRadiusKm: 99 }));
      expect(venueModel.create.mock.calls[1][0].travelRadiusKm).toBeNull();
    });

    it('auto-flips isOnline=true when kind=ONLINE (ignoring the request flag)', async () => {
      venueModel.create.mockImplementationOnce((payload) =>
        Promise.resolve({
          id: 'v-on',
          ...payload,
        }),
      );

      await service.create(
        userId,
        baseGymDto({
          kind: VenueKind.ONLINE,
          city: undefined,
          isOnline: false, // service should override this
          meetingUrl: 'https://meet.example.com/room',
        }),
      );

      const persisted = venueModel.create.mock.calls[0][0];
      expect(persisted.isOnline).toBe(true);
      expect(persisted.meetingUrl).toBe('https://meet.example.com/room');
      // Default provider stamped when omitted.
      expect(persisted.meetingProvider).toBe(MeetingProvider.OTHER);
    });

    it('rejects a non-ISO countryCode', async () => {
      await expect(
        service.create(userId, baseGymDto({ countryCode: 'romania' })),
      ).rejects.toThrow(/valid country/i);
    });
  });

  // ───── guard: caller must have an instructor profile ──────────────

  describe('instructor-profile guard', () => {
    it('403s when the caller has no instructor profile', async () => {
      instructorProfileModel.findOne.mockResolvedValueOnce(null);
      await expect(service.list(userId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ───── happy-path create / list ───────────────────────────────────

  describe('create', () => {
    it('persists with instructorId stamped from the profile + trimmed name', async () => {
      venueModel.create.mockImplementationOnce((payload) =>
        Promise.resolve({
          id: 'v-1',
          ...payload,
        }),
      );

      const out = await service.create(
        userId,
        baseGymDto({ name: '  FitZone  ' }),
      );

      expect(out.id).toBe('v-1');
      const persisted = venueModel.create.mock.calls[0][0];
      expect(persisted.instructorId).toBe(instructorId);
      expect(persisted.name).toBe('FitZone');
      expect(persisted.kind).toBe(VenueKind.GYM);
      expect(persisted.isActive).toBe(true);
      expect(venueModel.create.mock.calls[0][1]).toEqual({
        transaction: fakeTx,
      });
    });
  });

  describe('list', () => {
    it('returns the caller-scoped venues ordered by displayOrder then createdAt', async () => {
      const rows = [{ id: 'v-1' }, { id: 'v-2' }];
      venueModel.findAll.mockResolvedValueOnce(rows);

      const out = await service.list(userId);

      expect(out).toBe(rows);
      const args = venueModel.findAll.mock.calls[0][0];
      expect(args.where).toEqual({ instructorId });
      expect(args.order).toEqual([
        ['displayOrder', 'ASC NULLS LAST'],
        ['createdAt', 'DESC'],
      ]);
    });
  });

  // ───── get / cross-instructor hide ────────────────────────────────

  describe('get', () => {
    it('returns the venue when the caller owns it', async () => {
      const venue = { id: 'v-1', instructorId };
      venueModel.findByPk.mockResolvedValueOnce(venue);

      const out = await service.get(userId, 'v-1');
      expect(out).toBe(venue);
    });

    it('404s on a cross-instructor venue (hides existence)', async () => {
      venueModel.findByPk.mockResolvedValueOnce({
        id: 'v-1',
        instructorId: otherInstructorId,
      });
      await expect(service.get(userId, 'v-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s when the venue does not exist', async () => {
      venueModel.findByPk.mockResolvedValueOnce(null);
      await expect(service.get(userId, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ───── update ─────────────────────────────────────────────────────

  describe('update', () => {
    it('applies the patch on an owned venue and re-runs cross-field validation', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const venue = {
        id: 'v-1',
        instructorId,
        kind: VenueKind.GYM,
        isOnline: false,
        name: 'Old',
        notes: null,
        line1: null,
        line2: null,
        city: 'Cluj',
        region: null,
        postalCode: null,
        countryCode: null,
        latitude: null,
        longitude: null,
        meetingUrl: null,
        meetingProvider: null,
        travelRadiusKm: null,
        isActive: true,
        displayOrder: null,
        update,
      };
      venueModel.findByPk.mockResolvedValueOnce(venue);

      const patch: UpdateVenueDto = { name: 'Renamed' };
      const out = await service.update(userId, 'v-1', patch);

      expect(out).toBe(venue);
      const updatedPayload = update.mock.calls[0][0];
      expect(updatedPayload.name).toBe('Renamed');
      expect(updatedPayload.kind).toBe(VenueKind.GYM);
      expect(update.mock.calls[0][1]).toEqual({ transaction: fakeTx });
    });

    /** A stored venue, a gym in Cluj unless told otherwise. */
    const storedVenue = (fields: Record<string, unknown> = {}) => ({
      id: 'v-1',
      instructorId,
      kind: VenueKind.GYM,
      isOnline: false,
      name: 'Old',
      notes: null,
      line1: 'Str. Memorandumului 28',
      line2: null,
      city: 'Cluj',
      region: null,
      postalCode: null,
      countryCode: null,
      latitude: null,
      longitude: null,
      meetingUrl: null,
      meetingProvider: null,
      travelRadiusKm: null,
      isActive: true,
      displayOrder: null,
      update: jest.fn().mockResolvedValue(undefined),
      ...fields,
    });

    it('turns a gym into an online place without a link, dropping its address', async () => {
      const venue = storedVenue();
      venueModel.findByPk.mockResolvedValueOnce(venue);

      await service.update(userId, 'v-1', { kind: VenueKind.ONLINE });

      const payload = venue.update.mock.calls[0][0];
      expect(payload.isOnline).toBe(true);
      expect(payload.meetingUrl).toBeNull();
      expect(payload.line1).toBeNull();
      expect(payload.city).toBeNull();
    });

    it('stops counting a place as online once it becomes a gym', async () => {
      const venue = storedVenue({
        kind: VenueKind.ONLINE,
        isOnline: true,
        city: null,
        line1: null,
        meetingUrl: 'https://zoom.us/j/1',
        meetingProvider: MeetingProvider.ZOOM,
      });
      venueModel.findByPk.mockResolvedValueOnce(venue);

      await service.update(userId, 'v-1', {
        kind: VenueKind.GYM,
        city: 'Cluj-Napoca',
      });

      const payload = venue.update.mock.calls[0][0];
      expect(payload.isOnline).toBe(false);
      expect(payload.meetingUrl).toBeNull();
      expect(payload.meetingProvider).toBeNull();
    });

    it('clears the link and the platform on an explicit null, and keeps them when left out', async () => {
      const online = {
        kind: VenueKind.ONLINE,
        isOnline: true,
        city: null,
        line1: null,
        meetingUrl: 'https://zoom.us/j/1',
        meetingProvider: MeetingProvider.ZOOM,
      };
      const cleared = storedVenue(online);
      venueModel.findByPk.mockResolvedValueOnce(cleared);
      await service.update(userId, 'v-1', {
        meetingUrl: null,
        meetingProvider: null,
      });
      expect(cleared.update.mock.calls[0][0]).toMatchObject({
        meetingUrl: null,
        meetingProvider: null,
      });

      const kept = storedVenue(online);
      venueModel.findByPk.mockResolvedValueOnce(kept);
      await service.update(userId, 'v-1', { name: 'Zoom sessions' });
      expect(kept.update.mock.calls[0][0]).toMatchObject({
        meetingUrl: 'https://zoom.us/j/1',
        meetingProvider: MeetingProvider.ZOOM,
      });
    });

    it('clears address parts sent as empty strings, and validates them as such', async () => {
      const body = { postalCode: '', countryCode: '', region: '' };
      const errors = await validate(plainToInstance(UpdateVenueDto, body));
      expect(errors).toEqual([]);

      const venue = storedVenue({ postalCode: '400114', countryCode: 'RO' });
      venueModel.findByPk.mockResolvedValueOnce(venue);
      await service.update(userId, 'v-1', body);

      expect(venue.update.mock.calls[0][0]).toMatchObject({
        postalCode: null,
        countryCode: null,
        region: null,
      });
    });

    it('still checks the format of a postcode or country that holds something', async () => {
      const errors = await validate(
        plainToInstance(UpdateVenueDto, { postalCode: '!', countryCode: 'ro' }),
      );
      expect(errors.map((e) => e.property).sort()).toEqual([
        'countryCode',
        'postalCode',
      ]);
    });

    it('still asks a city of a place moved to a physical kind', async () => {
      const update = jest.fn();
      venueModel.findByPk.mockResolvedValueOnce({
        id: 'v-1',
        instructorId,
        kind: VenueKind.GYM,
        isOnline: false,
        name: 'Old',
        notes: null,
        line1: null,
        line2: null,
        city: 'Cluj',
        region: null,
        postalCode: null,
        countryCode: null,
        latitude: null,
        longitude: null,
        meetingUrl: null,
        meetingProvider: null,
        travelRadiusKm: null,
        isActive: true,
        displayOrder: null,
        update,
      });

      await expect(
        service.update(userId, 'v-1', { kind: VenueKind.STUDIO, city: '' }),
      ).rejects.toThrow(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('404s when patching a cross-instructor venue', async () => {
      venueModel.findByPk.mockResolvedValueOnce({
        id: 'v-1',
        instructorId: otherInstructorId,
        update: jest.fn(),
      });
      await expect(
        service.update(userId, 'v-1', { name: 'Hijack' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ───── remove (paranoid soft delete) + archive ────────────────────

  describe('remove', () => {
    it('paranoid-destroys an owned venue', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      venueModel.findByPk.mockResolvedValueOnce({
        id: 'v-1',
        instructorId,
        destroy,
      });

      await service.remove(userId, 'v-1');

      expect(destroy).toHaveBeenCalledWith({ transaction: fakeTx });
    });

    it('404s on a cross-instructor delete', async () => {
      venueModel.findByPk.mockResolvedValueOnce({
        id: 'v-1',
        instructorId: otherInstructorId,
        destroy: jest.fn(),
      });
      await expect(service.remove(userId, 'v-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
