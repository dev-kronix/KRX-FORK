import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { PlatformService } from '../platform/platform.service';
import { PaginationDto } from '../platform/platform.dto';
import { MessageDto, TicketDto } from './support.dto';
type Ticket = { id: string; userId: number; subject: string; status: string };
type Message = { id: string; body: string };
@Injectable()
export class SupportService {
  constructor(
    private readonly db: DataSource,
    private readonly platform: PlatformService,
  ) {}
  async list(userId: number, dto: PaginationDto, admin = false) {
    await this.platform.activeUser(userId, this.db.manager, admin);
    const where = admin ? '' : 'WHERE "userId"=$1';
    const values = admin ? [] : [userId];
    const rows: Ticket[] = await this.db.query(
      `SELECT * FROM support_ticket ${where} ORDER BY "updatedAt" DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, dto.limit, (dto.page - 1) * dto.limit],
    );
    const counts: { count: string }[] = await this.db.query(
      `SELECT count(*) FROM support_ticket ${where}`,
      values,
    );
    return {
      data: rows,
      total: Number(counts[0].count),
      page: dto.page,
      limit: dto.limit,
    };
  }
  async detail(userId: number, id: string, admin = false) {
    await this.platform.activeUser(userId, this.db.manager, admin);
    const rows: Ticket[] = await this.db.query(
      'SELECT * FROM support_ticket WHERE id=$1 AND ($2 OR "userId"=$3)',
      [id, admin, userId],
    );
    if (!rows[0]) throw new NotFoundException('Chamado não encontrado.');
    const messages: Message[] = await this.db.query(
      'SELECT id,"authorId","isAdmin",body,"createdAt" FROM support_message WHERE "ticketId"=$1 ORDER BY "createdAt",id',
      [id],
    );
    return { ...rows[0], messages };
  }
  async create(userId: number, dto: TicketDto) {
    return this.db.transaction(async (m) => {
      await this.platform.activeUser(userId, m);
      const rows: Ticket[] = await m.query(
        `INSERT INTO support_ticket(id,"userId","requestId",subject,status) VALUES($1,$2,$3,$4,'open') ON CONFLICT("userId","requestId") DO NOTHING RETURNING *`,
        [randomUUID(), userId, dto.requestId, dto.subject],
      );
      if (!rows[0]) {
        const previous: Ticket[] = await m.query(
          'SELECT * FROM support_ticket WHERE "userId"=$1 AND "requestId"=$2',
          [userId, dto.requestId],
        );
        const messages: Message[] = await m.query(
          'SELECT body FROM support_message WHERE "ticketId"=$1 AND "authorId"=$2 AND "requestId"=$3',
          [previous[0].id, userId, dto.requestId],
        );
        if (
          previous[0].subject !== dto.subject ||
          messages[0]?.body !== dto.body
        )
          throw new ConflictException(
            'Identificador já utilizado com outro conteúdo.',
          );
        return previous[0];
      }
      await m.query(
        'INSERT INTO support_message(id,"ticketId","authorId","isAdmin","requestId",body) VALUES($1,$2,$3,false,$4,$5)',
        [randomUUID(), rows[0].id, userId, dto.requestId, dto.body],
      );
      return rows[0];
    });
  }
  async reply(userId: number, id: string, dto: MessageDto, admin = false) {
    return this.db.transaction(async (m) => {
      await this.platform.activeUser(userId, m, admin);
      const rows: Ticket[] = await m.query(
        'SELECT * FROM support_ticket WHERE id=$1 AND ($2 OR "userId"=$3) FOR UPDATE',
        [id, admin, userId],
      );
      const ticket = rows[0];
      if (!ticket) throw new NotFoundException('Chamado não encontrado.');
      const old: Message[] = await m.query(
        'SELECT id,body FROM support_message WHERE "ticketId"=$1 AND "authorId"=$2 AND "requestId"=$3',
        [id, userId, dto.requestId],
      );
      if (old[0]) {
        if (old[0].body !== dto.body)
          throw new ConflictException(
            'Identificador já utilizado com outro conteúdo.',
          );
        return old[0];
      }
      if (ticket.status === 'closed')
        throw new ConflictException('Reabra o chamado antes de responder.');
      const result: Message[] = await m.query(
        'INSERT INTO support_message(id,"ticketId","authorId","isAdmin","requestId",body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,body',
        [randomUUID(), id, userId, admin, dto.requestId, dto.body],
      );
      await m.query('UPDATE support_ticket SET "updatedAt"=now() WHERE id=$1', [
        id,
      ]);
      if (admin && ticket.userId !== userId)
        await m.query(
          'INSERT INTO account_notification(id,"userId","ticketId",title) VALUES($1,$2,$3,$4)',
          [randomUUID(), ticket.userId, id, 'Nova resposta: ' + ticket.subject],
        );
      return result[0];
    });
  }
  async status(userId: number, id: string, status: string, admin = false) {
    return this.db.transaction(async (m) => {
      await this.platform.activeUser(userId, m, admin);
      const rows: Ticket[] = await m.query(
        'SELECT * FROM support_ticket WHERE id=$1 AND ($2 OR "userId"=$3) FOR UPDATE',
        [id, admin, userId],
      );
      const ticket = rows[0];
      if (!ticket) throw new NotFoundException('Chamado não encontrado.');
      if (ticket.status === status) return ticket;
      await m.query(
        'UPDATE support_ticket SET status=$2,"updatedAt"=now() WHERE id=$1',
        [id, status],
      );
      if (admin && ticket.userId !== userId)
        await m.query(
          'INSERT INTO account_notification(id,"userId","ticketId",title) VALUES($1,$2,$3,$4)',
          [
            randomUUID(),
            ticket.userId,
            id,
            (status === 'closed'
              ? 'Chamado encerrado: '
              : 'Chamado reaberto: ') + ticket.subject,
          ],
        );
      return { ...ticket, status };
    });
  }
  async notifications(userId: number, dto: PaginationDto) {
    await this.platform.activeUser(userId);
    const data: unknown[] = await this.db.query(
      'SELECT * FROM account_notification WHERE "userId"=$1 ORDER BY "createdAt" DESC,id DESC LIMIT $2 OFFSET $3',
      [userId, dto.limit, (dto.page - 1) * dto.limit],
    );
    const counts: { total: string; unread: string }[] = await this.db.query(
      'SELECT count(*) AS total,count(*) FILTER(WHERE "readAt" IS NULL) AS unread FROM account_notification WHERE "userId"=$1',
      [userId],
    );
    return {
      data,
      total: Number(counts[0].total),
      unread: Number(counts[0].unread),
      page: dto.page,
      limit: dto.limit,
    };
  }
  async read(userId: number, id: string) {
    await this.platform.activeUser(userId);
    const [rows]: [unknown[]] = await this.db.query(
      'UPDATE account_notification SET "readAt"=COALESCE("readAt",now()) WHERE id=$1 AND "userId"=$2 RETURNING *',
      [id, userId],
    );
    if (!rows[0]) throw new NotFoundException('Aviso não encontrado.');
    return rows[0];
  }
}
