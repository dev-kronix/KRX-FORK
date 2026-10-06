import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
export class MessageDto {
  @ApiProperty({ maxLength: 4000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;
  @ApiProperty() @IsUUID() requestId: string;
}
export class TicketDto extends MessageDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  subject: string;
}
export class TicketStatusDto {
  @ApiProperty({ enum: ['open', 'closed'] }) @IsIn(['open', 'closed']) status:
    | 'open'
    | 'closed';
}
