import { startAutoUpdate, UPDATE_REPO, type UpdateElectronAppModule, type UpdateLog } from '../auto-update';

describe('auto-update', () => {
  const packagedArgv = ['C:\\app\\JF LoggR.exe'];

  function fakeModule(impl: UpdateElectronAppModule['updateElectronApp'] = () => ({})) {
    const updateElectronApp = jest.fn(impl);
    const mod = { updateElectronApp, UpdateSourceType: { ElectronPublicUpdateService: 0, StaticStorage: 1 } };
    return { mod: mod as unknown as UpdateElectronAppModule, updateElectronApp };
  }

  test('uses the explicit GitHub repo so init no longer depends on package.json', () => {
    const { mod, updateElectronApp } = fakeModule();
    const log = jest.fn<void, Parameters<UpdateLog>>();

    expect(startAutoUpdate({ isPackaged: true, argv: packagedArgv, log, load: () => mod })).toBe(true);
    expect(updateElectronApp.mock.calls[0][0].updateSource).toEqual({ type: 0, repo: UPDATE_REPO });
  });

  test('installs silently on next launch instead of prompting for a restart', () => {
    const { mod, updateElectronApp } = fakeModule();
    startAutoUpdate({ isPackaged: true, argv: packagedArgv, log: jest.fn(), load: () => mod });

    expect(updateElectronApp.mock.calls[0][0].notifyUser).toBe(false);
  });

  test('init failures are written to the log instead of escaping', () => {
    const { mod } = fakeModule(() => { throw new Error('repo not found'); });
    const log = jest.fn<void, Parameters<UpdateLog>>();

    expect(() => startAutoUpdate({ isPackaged: true, argv: packagedArgv, log, load: () => mod })).not.toThrow();
    expect(log).toHaveBeenCalledWith('error', 'Auto-update init failed', expect.objectContaining({ message: 'repo not found' }));
  });

  test('updater runtime errors reach the log at error level', () => {
    const { mod, updateElectronApp } = fakeModule();
    const log = jest.fn<void, Parameters<UpdateLog>>();
    startAutoUpdate({ isPackaged: true, argv: packagedArgv, log, load: () => mod });

    const logger = updateElectronApp.mock.calls[0][0].logger!;
    logger.log('updater error');
    logger.log(new Error('network down'));

    expect(log).toHaveBeenCalledWith('info', '[update] updater error');
    expect(log).toHaveBeenCalledWith('error', 'Auto-update error', expect.objectContaining({ message: 'network down' }));
  });

  test('does not start in development or during Squirrel lifecycle events', () => {
    const { mod, updateElectronApp } = fakeModule();
    const log = jest.fn<void, Parameters<UpdateLog>>();

    expect(startAutoUpdate({ isPackaged: false, argv: packagedArgv, log, load: () => mod })).toBe(false);
    expect(startAutoUpdate({ isPackaged: true, argv: [...packagedArgv, '--squirrel-firstrun'], log, load: () => mod })).toBe(false);
    expect(updateElectronApp).not.toHaveBeenCalled();
  });
});
