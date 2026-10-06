import { MigrationInterface, QueryRunner } from 'typeorm';
export class Support1791327000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
 CREATE TABLE support_ticket(id uuid PRIMARY KEY,"userId" integer NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,"requestId" uuid NOT NULL,subject varchar(120) NOT NULL,status varchar(10) NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),UNIQUE("userId","requestId"));
 CREATE INDEX "IDX_support_ticket_user" ON support_ticket("userId","updatedAt");
 CREATE TABLE support_message(id uuid PRIMARY KEY,"ticketId" uuid NOT NULL REFERENCES support_ticket(id) ON DELETE CASCADE,"authorId" integer NOT NULL,"isAdmin" boolean NOT NULL,"requestId" uuid NOT NULL,body text NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),UNIQUE("ticketId","authorId","requestId"));
 CREATE TABLE account_notification(id uuid PRIMARY KEY,"userId" integer NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,"ticketId" uuid NOT NULL REFERENCES support_ticket(id) ON DELETE CASCADE,title varchar(160) NOT NULL,"readAt" timestamptz,"createdAt" timestamptz NOT NULL DEFAULT now());
 CREATE INDEX "IDX_account_notification_user" ON account_notification("userId","createdAt");
 `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP TABLE account_notification,support_message,support_ticket',
    );
  }
}
