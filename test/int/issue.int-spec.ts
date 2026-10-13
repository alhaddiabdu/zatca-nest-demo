import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { decodeQr } from '../../src/zatca/crypto/qr';
import { createTestApp } from './app';
import { resetDatabase } from './helpers';

const BUYER = {
  name: 'مؤسسة العميل', vatNumber: '300000000000003',
  address: { street: 'طريق الملك فهد', buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12211' },
};
const simplified = (id: string) => ({ id, category: 'simplified', lines: [{ name: 'قهوة', quantity: 2, unitPrice: 15 }] });
const standard = (id: string) => ({ id, category: 'standard', buyer: BUYER, lines: [{ name: 'خدمة', quantity: 3, unitPrice: 500 }] });

describe('POST /zatca/invoices → PostgreSQL (fake transport)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());
  const row = async (n: string, dry = false) =>
    (await ds.query('select * from invoices where invoice_number = $1 and is_dry_run = $2', [n, dry]))[0];
  const chain = async () => (await ds.query(`select icv, pih from environments where env = 'developer-portal'`))[0];

  beforeAll(async () => {
    await resetDatabase();
    delete process.env.ZATCA_ENV;
    app = await createTestApp();
    ds = app.get(DataSource);
    await http().put('/zatca/mode').send({ mode: 'developer-portal' }).expect(200);
    await http().post('/zatca/onboard').send({}).expect(200);
  });
  afterAll(() => app?.close());

  it('simplified → ACCEPTED via reporting, stored with ICV 1', async () => {
    const res = await http().post('/zatca/invoices').send(simplified('INV-1')).expect(200);
    expect(res.body).toMatchObject({ status: 'ACCEPTED', httpStatus: 200, icv: 1 });
    expect(res.body.invoiceId).toMatch(/^[0-9a-f-]{36}$/);
    const r = await row('INV-1');
    expect(r).toMatchObject({ status: 'ACCEPTED', submission_channel: 'reporting', attempts: 1, http_status: 200, total_amount: '34.50' });
    expect(r.submitted_at).not.toBeNull();
    expect(r.next_retry_at).toBeNull();
    expect(r.zatca_response.reportingStatus).toBe('REPORTED');
  });

  it('stores UTC IssueTime (HH:mm:ssZ) and QR tag 3 = IssueDate + "T" + IssueTime', async () => {
    const r = await row('INV-1');
    expect(r.issue_time).toMatch(/^\d{2}:\d{2}:\d{2}Z$/);
    const xmlDate = r.signed_xml.match(/<cbc:IssueDate>([^<]+)</)[1];
    const xmlTime = r.signed_xml.match(/<cbc:IssueTime>([^<]+)</)[1];
    expect(xmlTime).toBe(r.issue_time);
    expect(decodeQr(r.qr)[3]).toBe(`${xmlDate}T${xmlTime}`);
  });

  it('standard → ACCEPTED via clearance, cleared_xml saved', async () => {
    const res = await http().post('/zatca/invoices').send(standard('INV-2')).expect(200);
    expect(res.body).toMatchObject({ status: 'ACCEPTED', icv: 2 });
    const r = await row('INV-2');
    expect(r.submission_channel).toBe('clearance');
    expect(r.cleared_xml).toContain('<cbc:ID>INV-2</cbc:ID>');
    expect(r.zatca_response.clearedInvoice).toBeUndefined();
  });

  it('PIH chain links invoices, environment row follows the last hash', async () => {
    const [a, b] = [await row('INV-1'), await row('INV-2')];
    expect(b.pih).toBe(a.invoice_hash);
    expect(await chain()).toEqual({ icv: '2', pih: b.invoice_hash });
  });

  it('FAIL503 → PENDING with attempts=1 and retry in ~5 minutes', async () => {
    const res = await http().post('/zatca/invoices').send(simplified('INV-FAIL503-1')).expect(200);
    expect(res.body.status).toBe('PENDING');
    const r = await row('INV-FAIL503-1');
    expect(r).toMatchObject({ status: 'PENDING', attempts: 1, http_status: 503 });
    expect(r.last_error).toContain('503');
    const delta = new Date(r.next_retry_at).getTime() - Date.now();
    expect(delta).toBeGreaterThan(4 * 60_000);
  });

  it('network timeout → PENDING with the error kept', async () => {
    await http().post('/zatca/invoices').send(simplified('INV-TIMEOUT-1')).expect(200);
    const r = await row('INV-TIMEOUT-1');
    expect(r).toMatchObject({ status: 'PENDING', http_status: null });
    expect(r.last_error).toContain('ETIMEDOUT');
  });

  it('REJECT400 → REJECTED, row kept with ZATCA errors', async () => {
    const res = await http().post('/zatca/invoices').send(simplified('INV-REJECT400-1')).expect(200);
    expect(res.body.status).toBe('REJECTED');
    const r = await row('INV-REJECT400-1');
    expect(r.status).toBe('REJECTED');
    expect(r.zatca_response.validationResults.errorMessages[0].code).toBe('FAKE-REJECTED');
  });

  it('WARN202 → ACCEPTED_WITH_WARNINGS', async () => {
    const res = await http().post('/zatca/invoices').send(standard('INV-WARN202-1')).expect(200);
    expect(res.body.status).toBe('ACCEPTED_WITH_WARNINGS');
  });

  it('duplicate number → 409 and the chain does not move', async () => {
    const before = await chain();
    const res = await http().post('/zatca/invoices').send(simplified('INV-1')).expect(409);
    expect(res.body.code).toBe('DUPLICATE_INVOICE_NUMBER');
    expect(await chain()).toEqual(before);
  });

  it('invalid invoice (credit note without reason) → 400 and the chain does not move', async () => {
    const before = await chain();
    await http().post('/zatca/invoices').send({ ...simplified('CN-1'), kind: 'credit', originalInvoiceId: 'INV-1' }).expect(400);
    expect(await chain()).toEqual(before);
  });

  describe('BR-KSA-81: buyer without VAT number', () => {
    const { vatNumber: _, ...noVat } = BUYER;
    const std = (id: string, buyer: object) => ({ ...standard(id), buyer });

    it('standard without VAT number or other id → 400 with a clear message, chain unchanged', async () => {
      const before = await chain();
      const res = await http().post('/zatca/invoices').send(std('STD-NOID', noVat)).expect(400);
      expect(res.body.message).toContain('معرّفاً بديلاً');
      expect(await chain()).toEqual(before);
    });

    it('standard with CRN as other id → ACCEPTED, schemeID in the signed XML', async () => {
      await http().post('/zatca/invoices').send(std('STD-CRN', { ...noVat, otherIdType: 'CRN', otherIdValue: '1010101010' })).expect(200);
      const r = await row('STD-CRN');
      expect(r.status).toBe('ACCEPTED');
      expect(r.signed_xml).toContain('<cbc:ID schemeID="CRN">1010101010</cbc:ID>');
      expect(r.buyer).toMatchObject({ otherIdType: 'CRN', otherIdValue: '1010101010' });
    });

    it.each([
      [{ otherIdType: 'XYZ', otherIdValue: '1' }, 'نوع معرّف المشتري'],
      [{ otherIdType: 'NAT', otherIdValue: '10-12' }, 'أحرف وأرقام فقط'],
      [{ otherIdType: 'NAT' }, 'أحرف وأرقام فقط'],
      [{ otherIdValue: '1012345678' }, 'نوع معرّف المشتري'],
    ])('DTO rejects %j', async (ids, msg) => {
      const res = await http().post('/zatca/invoices').send(std('STD-BAD', { ...noVat, ...ids })).expect(400);
      expect(JSON.stringify(res.body.message)).toContain(msg);
    });
  });

  it('dryRun stores a DRY_RUN row without touching the chain, even with a used number', async () => {
    const before = await chain();
    const res = await http().post('/zatca/invoices?dryRun=true').send(simplified('INV-1')).expect(200);
    expect(res.body).toMatchObject({ dryRun: true, icv: Number(before.icv) + 1 });
    const r = await row('INV-1', true);
    expect(r).toMatchObject({ status: 'DRY_RUN', icv: null, chain_epoch: null });
    expect(await chain()).toEqual(before);
  });

  it('ICVs are 1..N without gaps across all real invoices', async () => {
    const icvs = (await ds.query(`select icv from invoices where not is_dry_run order by icv`)).map((r: { icv: string }) => Number(r.icv));
    expect(icvs).toEqual(icvs.map((_: number, i: number) => i + 1));
  });
});
