import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
export class PlanDto {
  @ApiProperty() @IsString() @Matches(/^[a-z][a-z0-9-]{1,39}$/) id: string;
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
  @ApiProperty() @IsString() @MaxLength(400) description: string;
  @ApiProperty() @IsInt() @Min(100) @Max(100000000) priceCents: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100000000) creditsPerCycle: number;
  @ApiProperty() @IsInt() @Min(1) @Max(366) billingPeriodDays: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100) maxActiveKeys: number;
  @ApiProperty() @IsInt() @Min(1) @Max(10000) apiRateLimit: number;
  @ApiProperty() @IsBoolean() normal: boolean;
  @ApiProperty() @IsBoolean() freefire: boolean;
  @ApiProperty() @IsBoolean() consultas: boolean;
  @ApiProperty() @IsBoolean() active: boolean;
  @ApiProperty() @IsBoolean() public: boolean;
}
export class CheckoutDto {
  @ApiProperty() @IsString() @Matches(/^[a-z][a-z0-9-]{1,39}$/) planId: string;
  @ApiProperty() @IsUUID() requestId: string;
}
export class ReconcileDto {
  @ApiProperty() @IsString() @Matches(/^\d{1,30}$/) providerPaymentId: string;
}
export class ReviewDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  reason: string;
}
