import { MigrationInterface, QueryRunner } from 'typeorm';

/** issue_time صار HH:mm:ssZ بتوقيت UTC (9 أحرف). الصفوف القديمة HH:mm:ss تبقى كما هي. */
export class WidenIssueTime1791900000000 implements MigrationInterface {
  name = 'WidenIssueTime1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE invoices ALTER COLUMN issue_time TYPE varchar(9)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE invoices ALTER COLUMN issue_time TYPE varchar(8) USING left(issue_time, 8)`);
  }
}
