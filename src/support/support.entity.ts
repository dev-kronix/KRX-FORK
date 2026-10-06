import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
@Entity('support_ticket')
@Index(['userId', 'requestId'], { unique: true })
export class SupportTicketEntity {
  @PrimaryColumn('uuid') id: string;
  @Column() userId: number;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @Column('uuid') requestId: string;
  @Column({ length: 120 }) subject: string;
  @Column({ length: 10, default: 'open' }) status: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
}
@Entity('support_message')
@Index(['ticketId', 'authorId', 'requestId'], { unique: true })
export class SupportMessageEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') ticketId: string;
  @ManyToOne(() => SupportTicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: SupportTicketEntity;
  @Column() authorId: number;
  @Column() isAdmin: boolean;
  @Column('uuid') requestId: string;
  @Column('text') body: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
@Entity('account_notification')
export class AccountNotificationEntity {
  @PrimaryColumn('uuid') id: string;
  @Column() userId: number;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @Column('uuid') ticketId: string;
  @ManyToOne(() => SupportTicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: SupportTicketEntity;
  @Column({ length: 160 }) title: string;
  @Column({ type: 'timestamptz', nullable: true }) readAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
