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

@Entity('credit_account')
export class CreditAccountEntity {
  @PrimaryColumn() userId: number;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @Column({ default: 0 }) balance: number;
}

@Entity('api_key')
export class ApiKeyEntity {
  @PrimaryColumn('uuid') id: string;
  @Index() @Column() userId: number;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @Column({ length: 80 }) name: string;
  @Column({ length: 24 }) prefix: string;
  @Column({ length: 64, unique: true, select: false }) hash: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) lastUsedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
}

@Entity('credit_ledger')
@Index(['userId', 'requestId'], { unique: true })
export class CreditLedgerEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: number;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @Column('uuid') requestId: string;
  @Column() delta: number;
  @Column() balanceAfter: number;
  @Column({ length: 240 }) reason: string;
  @Column({ type: 'integer', nullable: true }) actorId: number | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('api_usage')
@Index(['userId', 'requestId'], { unique: true })
export class ApiUsageEntity {
  @PrimaryColumn('uuid') id: string;
  @Column() userId: number;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @Column('uuid') requestId: string;
  @Column('uuid') keyId: string;
  @Column({ length: 160 }) route: string;
  @Column({ length: 10 }) method: string;
  @Column() status: number;
  @Column() cost: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
