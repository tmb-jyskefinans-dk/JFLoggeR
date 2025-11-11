import { LogService } from './log.service';

describe('LogService', () => {
  it('stores recent entries and forwards', () => {
    const svc = new LogService();
    (window as any).workApi = { logWrite: jest.fn().mockResolvedValue({ ok: true }) };
    svc.info('Test message', { a: 1 });
    expect(svc.entries().length).toBe(1);
    expect(svc.entries()[0].message).toBe('Test message');
    expect((window as any).workApi.logWrite).toHaveBeenCalledWith('info', 'Test message', { a: 1 });
  });
});
