"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ipcMain = exports.Notification = exports.BrowserWindow = exports.app = void 0;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("node:fs"));
const path = tslib_1.__importStar(require("node:path"));
// Minimal electron app mock for tests.
exports.app = {
    getPath(name) {
        if (name === 'userData') {
            const dir = path.join(process.cwd(), 'tmp-test-userData');
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            return dir;
        }
        return process.cwd();
    },
    setAppUserModelId(_id) { }
};
exports.BrowserWindow = class {
};
exports.Notification = class {
};
exports.ipcMain = { handle: () => { } };
//# sourceMappingURL=electron.js.map