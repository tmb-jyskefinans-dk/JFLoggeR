import * as fs from 'node:fs';
import * as path from 'node:path';

// Minimal electron app mock for tests.
export const app = {
  getPath(name: string) {
    if (name === 'userData') {
      const dir = path.join(process.cwd(), 'tmp-test-userData');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    return process.cwd();
  },
  setAppUserModelId(_id: string) { /* no-op */ }
};

export const BrowserWindow = class {} as any;
export const Notification = class {} as any;
export const ipcMain = { handle: () => {} } as any;
