import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
@Entity('billing_plan')
export class BillingPlanEntity {
  @PrimaryColumn({ length: 40 }) id: string;
  @Column({ length: 80 }) name: string;
  @Column({ length: 400 }) description: string;
  @Column() priceCents: number;
  @Column() creditsPerCycle: number;
  @Column() billingPeriodDays: number;
  @Column() maxActiveKeys: number;
  @Column() apiRateLimit: number;
  @Column() normal: boolean;
  @Column() freefire: boolean;
  @Column() consultas: boolean;
  @Column({ default: false }) active: boolean;
  @Column({ default: false }) public: boolean;
}
@Entity('billing_payment')
@Index(['userId', 'requestId'], { unique: true })
export class BillingPaymentEntity {
  @PrimaryColumn('uuid') id: string;
  @Column() userId: number;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @Column('uuid') requestId: string;
  @Column({ length: 40 }) planId: string;
  @Column('jsonb') snapshot: Record<string, unknown>;
  @Column({ length: 30, default: 'creating' }) status: string;
  @Column({ type: 'varchar', length: 30, nullable: true, unique: true })
  providerPaymentId: string | null;
  @Column({ type: 'text', nullable: true }) checkoutUrl: string | null;
  @Column({ type: 'timestamptz', nullable: true }) creditedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true })
  providerUpdatedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
@Entity('billing_subscription')
export class BillingSubscriptionEntity {
  @PrimaryColumn() userId: number;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @Column('uuid') paymentId: string;
  @ManyToOne(() => BillingPaymentEntity)
  @JoinColumn({ name: 'paymentId' })
  payment: BillingPaymentEntity;
  @Column('jsonb') snapshot: Record<string, unknown>;
  @Column('timestamptz') expiresAt: Date;
  @Column({ default: false }) held: boolean;
}
@Entity('billing_audit')
export class BillingAuditEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'integer', nullable: true }) actorId: number | null;
  @Column({ type: 'uuid', nullable: true }) paymentId: string | null;
  @Column({ length: 80 }) action: string;
  @Column('jsonb') details: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
