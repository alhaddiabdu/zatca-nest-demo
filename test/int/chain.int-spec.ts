import { createHash, randomUUID } from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/database.options';
import { ChainContext, ChainService } from '../../src/zatca/chain/chain.service';
import { INITIAL_PIH } from '../../src/zatca/crypto/signer';
import { resetDatabase } from './helpers';

describe('ChainService (SELECT ... FOR UPDATE)', () => {
  let ds: DataSource;
  let chain: ChainService;

  // تجزئة وهمية تعتمد على العداد والسابقة، حتى نتحقق من تسلسل PIH
  const fakeHash = (ctx: ChainContext) => createHash('sha256').update(`${ctx.icv}|${ctx.pih}`).digest('base64');
  const build = async (ctx: ChainContext) => {
    // تأخير عشوائي يزيد فرصة التداخل لو لم يكن القفل يعمل
    await sleep(Math.floor(Math.random() * 15));
    return {
      uuid: randomUUID(), category: 'simplified' as const, kind: 'invoice' as const, invoiceHash: fakeHash(ctx),
      issueDate: '2026-10-12', issueTime: '10:00:00', lines: [], signedXml: '<x/>', qr: 'q',
    };
  };
  const envRow = async (env: string) => (await ds.query('select icv, pih from environments where env = $1', [env]))[0];

  beforeAll(async () => {
    await resetDatabase();
    ds = new DataSource({ ...buildDataSourceOptions(process.env.DATABASE_URL), extra: { max: 10 } });
    await ds.initialize();
    chain = new ChainService(ds);
  });
  afterAll(() => ds?.destroy());

  it('20 concurrent issues get ICV 1..20 with no duplicates or gaps, and an unbroken PIH chain', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => chain.issueInChain('developer-portal', `C-${i + 1}`, build)),
    );
    expect(results.map((r) => r.icv).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    const rows: Array<{ icv: string; pih: string; invoice_hash: string; status: string }> = await ds.query(
      `select icv, pih, invoice_hash, status from invoices where env = 'developer-portal' order by icv`,
    );
    expect(rows).toHaveLength(20);
    let previous = INITIAL_PIH;
    for (const r of rows) {
      expect(r.pih).toBe(previous);
      expect(r.invoice_hash).toBe(fakeHash({ chainEpoch: 1, icv: Number(r.icv), pih: r.pih }));
      expect(r.status).toBe('PENDING');
      previous = r.invoice_hash;
    }
    const env = await envRow('developer-portal');
    expect(Number(env.icv)).toBe(20);
    expect(env.pih).toBe(previous);
  });

  it('first retry is scheduled ~5 minutes later', async () => {
    const inv = await chain.issueInChain('developer-portal', 'C-RETRY', build);
    const delta = inv.nextRetryAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(4 * 60_000);
    expect(delta).toBeLessThanOrEqual(5 * 60_000);
  });

  it('a duplicate invoice number → 409 and the chain does not move', async () => {
    const before = await envRow('developer-portal');
    await expect(chain.issueInChain('developer-portal', 'C-1', build)).rejects.toMatchObject({
      response: { code: 'DUPLICATE_INVOICE_NUMBER' },
    });
    expect(await envRow('developer-portal')).toEqual(before);
  });

  it('an error inside build rolls everything back', async () => {
    const before = await envRow('developer-portal');
    await expect(
      chain.issueInChain('developer-portal', 'C-FAIL', () => {
        throw new Error('signing failed');
      }),
    ).rejects.toThrow('signing failed');
    expect(await envRow('developer-portal')).toEqual(before);
    expect((await ds.query(`select count(*)::int as n from invoices where invoice_number = 'C-FAIL'`))[0].n).toBe(0);
  });

  it('each mode has its own chain', async () => {
    const sim = await chain.issueInChain('simulation', 'C-1', build);
    expect(sim.icv).toBe(1);
    expect(sim.pih).toBe(INITIAL_PIH);
  });
});
