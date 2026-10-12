import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSettingsDto } from '../src/zatca/environments/settings.dto';
import { validSettings } from './fixtures/settings';

const errorsOf = async (body: unknown, opts = { whitelist: true, forbidNonWhitelisted: true }) => {
  const dto = plainToInstance(UpdateSettingsDto, body);
  const errors = await validate(dto, opts);
  const flat: string[] = [];
  const walk = (es: typeof errors, prefix = '') =>
    es.forEach((e) => {
      Object.values(e.constraints ?? {}).forEach((m) => flat.push(`${prefix}${e.property}: ${m}`));
      walk(e.children ?? [], `${prefix}${e.property}.`);
    });
  walk(errors);
  return flat;
};

describe('UpdateSettingsDto', () => {
  it('accepts valid settings and trims spaces', async () => {
    const body = validSettings();
    body.seller.city = '  الرياض  ';
    expect(await errorsOf(body)).toEqual([]);
    expect(plainToInstance(UpdateSettingsDto, body).seller.city).toBe('الرياض');
  });

  it.each([
    ['seller.vatNumber', '31012345670000', 'الرقم الضريبي'],
    ['seller.vatNumber', '410123456700003', 'الرقم الضريبي'],
    ['seller.crn', '12345', 'السجل التجاري'],
    ['seller.buildingNumber', '12', 'رقم المبنى'],
    ['seller.postalCode', '1234', 'الرمز البريدي'],
    ['egs.invoiceType', '1111', 'نوع الفواتير'],
    ['egs.orgUnit', 'Branch\nO = Evil', 'لا يُسمح'],
    ['egs.serial', 'a|b', 'لا يُسمح'],
    ['egs.commonName', 'CN=x', 'لا يُسمح'],
    ['seller.name', 'x[y]', 'لا يُسمح'],
    ['egs.model', '', 'من 1 إلى 64'],
    ['egs.location', 'x'.repeat(65), 'من 1 إلى 64'],
  ])('rejects %s = %j', async (path, value, expected) => {
    const body = validSettings() as Record<string, Record<string, unknown>>;
    const [group, field] = path.split('.');
    body[group][field] = value;
    const errors = await errorsOf(body);
    expect(errors.some((e) => e.startsWith(`${group}.${field}`) && e.includes(expected))).toBe(true);
  });

  it('rejects unknown fields', async () => {
    const body = { ...validSettings(), extra: 1 } as Record<string, unknown>;
    (body.seller as Record<string, unknown>).hack = 'x';
    const errors = await errorsOf(body);
    expect(errors.some((e) => e.startsWith('extra'))).toBe(true);
    expect(errors.some((e) => e.startsWith('seller.hack'))).toBe(true);
  });

  it('requires both groups', async () => {
    const errors = await errorsOf({ seller: validSettings().seller });
    expect(errors.some((e) => e.startsWith('egs'))).toBe(true);
  });
});
