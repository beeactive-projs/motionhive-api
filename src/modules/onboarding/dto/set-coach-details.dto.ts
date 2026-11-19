import { IntersectionType, PickType } from '@nestjs/swagger';

import { UpdateInstructorProfileDto } from '../../profile/dto/update-instructor-profile.dto';
import { UpdateUserDto } from '../../user/dto/update-user.dto';

/**
 * `PUT /users/me/onboarding/coach-details`: where a coach works and whether
 * they take new clients. Each field is optional; the ones sent are saved.
 * City and country live on the account, the rest on the coach profile, so
 * the fields and their rules are the account's and the profile's own.
 */
export class SetCoachDetailsDto extends IntersectionType(
  PickType(UpdateUserDto, ['city', 'countryCode'] as const),
  PickType(UpdateInstructorProfileDto, ['isAcceptingClients'] as const),
) {}
