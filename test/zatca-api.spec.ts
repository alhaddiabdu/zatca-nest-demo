import { ServiceUnavailableException } from '@nestjs/common';
import { ZatcaApiService } from '../src/zatca/api/zatca-api.service';

/** لا طلبات شبكة حقيقية: fetch وهمي يسجّل ما أُرسل */
describe('ZatcaApiService (fetch mocked)', () => {
  const api = new ZatcaApiService();
  const creds = { binarySecurityToken: 'VE9LRU4=', secret: 'test-secret', requestId: '42' };
  const body = { invoiceHash: 'h', uuid: 'u', invoice: 'eA==' };
  const basic = 'Basic ' + Buffer.from('VE9LRU4=:test-secret').toString('base64');
  let fetchSpy: jest.SpyInstance;

  const lastCall = () => {
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    return { url, init, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
  };

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });
  afterEach(() => fetchSpy.mockRestore());

  it.each([
    ['developer-portal', 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance'],
    ['simulation', 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance'],
    ['core', 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/compliance'],
  ] as const)('builds the URL per mode: %s', async (env, url) => {
    await api.requestComplianceCsid(env, 'Q1NS', '123345');
    expect(lastCall().url).toBe(url);
  });

  it('sends OTP and V2 headers when requesting the compliance CSID', async () => {
    await api.requestComplianceCsid('simulation', 'Q1NS', '654321');
    const { init, headers, body: sent } = lastCall();
    expect(init.method).toBe('POST');
    expect(headers).toMatchObject({ OTP: '654321', 'Accept-Version': 'V2', 'Accept-Language': 'en', 'Content-Type': 'application/json' });
    expect(headers.Authorization).toBeUndefined();
    expect(sent).toEqual({ csr: 'Q1NS' });
  });

  it('compliance check uses Basic auth', async () => {
    await api.complianceCheck('developer-portal', creds, body);
    const { url, headers } = lastCall();
    expect(url).toMatch(/\/developer-portal\/compliance\/invoices$/);
    expect(headers.Authorization).toBe(basic);
  });

  it('production CSID sends compliance_request_id', async () => {
    await api.requestProductionCsid('core', creds);
    const { url, body: sent, headers } = lastCall();
    expect(url).toMatch(/\/core\/production\/csids$/);
    expect(sent).toEqual({ compliance_request_id: '42' });
    expect(headers.Authorization).toBe(basic);
  });

  it('renewal uses PATCH with OTP and Basic auth', async () => {
    await api.renewProductionCsid('core', creds, 'Q1NS', '111222');
    const { init, headers } = lastCall();
    expect(init.method).toBe('PATCH');
    expect(headers).toMatchObject({ OTP: '111222', Authorization: basic });
  });

  it('reporting sends Clearance-Status 0, clearance sends 1', async () => {
    await api.report('simulation', creds, body);
    expect(lastCall().url).toMatch(/\/simulation\/invoices\/reporting\/single$/);
    expect(lastCall().headers['Clearance-Status']).toBe('0');
    await api.clear('simulation', creds, body);
    expect(lastCall().url).toMatch(/\/simulation\/invoices\/clearance\/single$/);
    expect(lastCall().headers['Clearance-Status']).toBe('1');
    expect(lastCall().body).toEqual(body);
  });

  it('maps 202 to ok and 400 to not ok', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 202 }));
    expect((await api.report('core', creds, body)).ok).toBe(true);
    fetchSpy.mockResolvedValueOnce(new Response('{"errors":1}', { status: 400 }));
    const res = await api.report('core', creds, body);
    expect(res).toMatchObject({ ok: false, status: 400, body: { errors: 1 } });
  });

  it('turns network errors into ServiceUnavailableException', async () => {
    fetchSpy.mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    await expect(api.report('core', creds, body)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
