import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * How far back adherence is measured. Short by design: "did they train
 * this week" is the question a coach opens this screen to answer, not
 * "how was their year".
 */
export enum RosterWindow {
  OneWeek = '1w',
  FourWeeks = '4w',
}

/** Query for `GET /coach/roster`. */
export class RosterQueryDto {
  @ApiPropertyOptional({
    enum: RosterWindow,
    default: RosterWindow.FourWeeks,
  })
  @IsOptional()
  @IsEnum(RosterWindow)
  window?: RosterWindow;

  @ApiPropertyOptional({
    description:
      "Just this client's row, for a page about one person. Narrows the " +
      'roster you can already see; a person you do not coach comes back ' +
      'as an empty list.',
  })
  @IsOptional()
  @IsUUID('4')
  clientId?: string;
}
