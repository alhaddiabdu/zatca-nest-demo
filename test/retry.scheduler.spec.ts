import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { RetryScheduler } from '../src/zatca/submission/retry.scheduler';
import { RetryService } from '../src/zatca/submission/retry.service';

const MIN = 60_000;
const empty = { attempted: 0, accepted: 0, rejected: 0, stillPending: 0, results: [] };

describe('RetryScheduler (fake timers)', () => {
  let app: INestApplication;
  const retryDue = jest.fn();

  beforeEach(async () => {
    jest.useFakeTimers();
    retryDue.mockReset().mockResolvedValue(empty);
    delete process.env.RETRY_SCHEDULER_ENABLED;
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [RetryScheduler, { provide: RetryService, useValue: { retryDue } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init(); // يسجّل @Interval على المؤقتات الوهمية
  });

  afterEach(async () => {
    await app.close();
    jest.useRealTimers();
    delete process.env.RETRY_SCHEDULER_ENABLED;
  });

  it('runs every 5 minutes for the three modes', async () => {
    await jest.advanceTimersByTimeAsync(5 * MIN - 1);
    expect(retryDue).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(retryDue.mock.calls.map((c) => c[0])).toEqual(['developer-portal', 'simulation', 'core']);
    await jest.advanceTimersByTimeAsync(5 * MIN);
    expect(retryDue).toHaveBeenCalledTimes(6);
    await jest.advanceTimersByTimeAsync(10 * MIN);
    expect(retryDue).toHaveBeenCalledTimes(12);
  });

  it('a long cycle does not start another one on top of it', async () => {
    let finish!: () => void;
    retryDue.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(empty))));
    await jest.advanceTimersByTimeAsync(5 * MIN); // تبدأ الدورة الأولى وتعلق في developer-portal
    expect(retryDue).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10 * MIN); // دورتان مستحقتان، تُتخطيان
    expect(retryDue).toHaveBeenCalledTimes(1);
    finish();
    await jest.advanceTimersByTimeAsync(0); // تكمل الدورة الأولى باقي الأوضاع
    expect(retryDue).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(5 * MIN); // الدورة التالية تعمل طبيعياً
    expect(retryDue).toHaveBeenCalledTimes(6);
  });

  it('an error in one mode does not stop the others', async () => {
    retryDue.mockRejectedValueOnce(new Error('db down'));
    await jest.advanceTimersByTimeAsync(5 * MIN);
    expect(retryDue).toHaveBeenCalledTimes(3);
  });

  it('RETRY_SCHEDULER_ENABLED=false disables it', async () => {
    process.env.RETRY_SCHEDULER_ENABLED = 'false';
    await jest.advanceTimersByTimeAsync(15 * MIN);
    expect(retryDue).not.toHaveBeenCalled();
  });
});
