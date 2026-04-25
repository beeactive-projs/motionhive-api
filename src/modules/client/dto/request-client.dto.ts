import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body of `POST /clients/request/:instructorId`. Kept as a real DTO
 * (not an inline type) so the global ValidationPipe's `whitelist` +
 * `forbidNonWhitelisted` can strip or reject extra fields — an
 * inline `{ message?: string }` accepts anything the client sends.
 */
export class RequestClientDto {
  @ApiPropertyOptional({
    example: "I'd love to train with you.",
    description: 'Optional free-text note shown to the instructor.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
