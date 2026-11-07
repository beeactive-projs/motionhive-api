import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

/**
 * A moment in time: ISO 8601 with its offset ("…Z" or "…+02:00"). A bare
 * local time ("2026-11-07T17:42:10") is refused, because the server would
 * read it in its own zone and move it by the phone's offset. For a time an
 * app recorded and sends later (a lock screen tap), not for a calendar day.
 */
export function IsInstant(): PropertyDecorator {
  return applyDecorators(
    IsISO8601({ strict: true }),
    Matches(/(?:Z|[+-]\d{2}:?\d{2})$/),
  );
}
