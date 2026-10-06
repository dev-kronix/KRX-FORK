import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Meu bot', maxLength: 80 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}
export class PaginationDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
export class AdjustCreditsDto {
  @ApiProperty({
    example: 100,
    description: 'Positivo adiciona; negativo retira.',
  })
  @IsInt()
  @Min(-2147483647)
  @Max(2147483647)
  @NotEquals(0)
  delta: number;
  @ApiProperty({ example: 'Crédito inicial', maxLength: 240 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  reason: string;
  @ApiProperty({ description: 'UUID único para repetição segura da operação.' })
  @IsUUID()
  requestId: string;
}
