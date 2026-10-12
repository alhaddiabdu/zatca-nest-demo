import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * جدولا الأوضاع:
 * - environments: صف لكل وضع (بيانات البائع و EGS، المفتاح والشهادات مشفرة، سلسلة ICV/PIH)
 * - app_settings: صف واحد يحفظ الوضع النشط (NULL = لم يُختر بعد)
 */
export class CreateEnvironments1791834883000 implements MigrationInterface {
  name = 'CreateEnvironments1791834883000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE environments (
        env                       varchar(20)  PRIMARY KEY
                                  CHECK (env IN ('developer-portal', 'simulation', 'core')),

        seller_name               varchar(200),
        seller_vat_number         char(15)     CHECK (seller_vat_number ~ '^3[0-9]{13}3$'),
        seller_crn                varchar(10)  CHECK (seller_crn ~ '^[0-9]{10}$'),
        seller_street             varchar(200),
        seller_building_number    char(4)      CHECK (seller_building_number ~ '^[0-9]{4}$'),
        seller_district           varchar(100),
        seller_city               varchar(100),
        seller_postal_code        char(5)      CHECK (seller_postal_code ~ '^[0-9]{5}$'),

        egs_common_name           varchar(64),
        egs_org_unit              varchar(64),
        egs_solution_name         varchar(64),
        egs_model                 varchar(64),
        egs_serial                varchar(64),
        egs_invoice_type          char(4)      CHECK (egs_invoice_type IN ('1100', '1000', '0100')),
        egs_location              varchar(64),
        egs_industry              varchar(64),

        private_key_enc           text,
        csr_pem                   text,
        compliance_token_enc      text,
        compliance_secret_enc     text,
        compliance_request_id     varchar(64),
        production_token_enc      text,
        production_secret_enc     text,
        production_request_id     varchar(64),
        production_cert_not_after timestamptz,
        onboarded_at              timestamptz,

        chain_epoch               integer      NOT NULL DEFAULT 1,
        icv                       bigint       NOT NULL DEFAULT 0 CHECK (icv >= 0),
        -- قيمة INITIAL_PIH من src/zatca/crypto/signer.ts
        pih                       text         NOT NULL
                                  DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',

        local_test_key_enc        text,
        local_test_cert_pem       text,

        created_at                timestamptz  NOT NULL DEFAULT now(),
        updated_at                timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE app_settings (
        id                smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        active_env        varchar(20)  REFERENCES environments (env),
        core_confirmed_at timestamptz,
        updated_at        timestamptz  NOT NULL DEFAULT now()
      )
    `);

    // بوابة المطورين معبّأة بالقيم التجريبية الحالية، والمحاكاة والإنتاج فارغان
    await queryRunner.query(`
      INSERT INTO environments (
        env,
        seller_name, seller_vat_number, seller_crn, seller_street, seller_building_number,
        seller_district, seller_city, seller_postal_code,
        egs_common_name, egs_org_unit, egs_solution_name, egs_model, egs_serial,
        egs_invoice_type, egs_location, egs_industry
      ) VALUES (
        'developer-portal',
        'شركة التجربة المحدودة', '399999999900003', '1010010000', 'الأمير سلطان', '2322',
        'المربع', 'الرياض', '23333',
        'TST-886431145-399999999900003', 'Riyadh Branch', 'MyERP', 'NestDemo',
        'ed22f1d8-e6a2-1118-9b58-d9a8f11e445f',
        '1100', 'RRRD2929', 'Supply activities'
      )
    `);
    await queryRunner.query(`INSERT INTO environments (env) VALUES ('simulation'), ('core')`);

    // لا وضع نشط عند أول تشغيل، فتظهر شاشة اختيار الوضع
    await queryRunner.query(`INSERT INTO app_settings (id, active_env) VALUES (1, NULL)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE app_settings`);
    await queryRunner.query(`DROP TABLE environments`);
  }
}
