# WorkLogger

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.3.8.

## Development (Angular only)

To start just the Angular development server (renderer) run:

```bash
npm run serve:renderer
```

Navigate to `http://localhost:4200/`.

## Electron Development (Full App)

For an integrated Electron + Angular dev workflow with auto-reload of the main process:

```bash
npm run dev
```

This does the following:

1. Compiles the Electron main/preload code once (`build:main`).
2. Starts TypeScript watch for Electron (`watch:main`).
3. Serves Angular in dev mode (`serve:renderer`).
4. Starts Electron via `nodemon` watching the compiled output (`watch:electron`).

When running in dev, the environment variable `VITE_DEV_SERVER_URL` is set so the Electron main process loads the Angular dev server instead of static files.

If you need to manually run Electron against the dev server without watchers:

```bash
npm run electron:run:dev
```

To run Electron against a production build (after building):

```bash
npm run electron:run:prod
```

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building (Renderer + Main)

To build both the Angular renderer and the Electron main process:

```bash
npm run build
```

This produces:

- Angular production assets in `dist/work-logger/browser`.
- Compiled Electron JS in `electron/.dist`.

You can clean build artifacts with:

```bash
npm run clean
```

## Release Packaging

To generate a distributable installer / DMG using `electron-builder`:

```bash
npm run release
```

This runs: clean → production builds → `electron-builder` using the config in `package.json` (`build` field). Output installers will appear in `dist/` (e.g. `dist/Work Logger Setup.exe` on Windows, `.dmg` on macOS) along with unpacked folders.

### Quick Test of Production Build

```bash
npm run electron:run:prod
```

This launches Electron pointing at the freshly built assets without producing installers.

## Troubleshooting Builds

If Angular production build fails with exit code 1 and no visible error output:

1. Reinstall dependencies: `rm -rf node_modules package-lock.json` (or on Windows: delete folder) then `npm install`.
2. Run a verbose build: `ng build --configuration production --verbose`.
3. Try a development build: `ng build --configuration development` to see if optimization plugins are the cause.
4. Ensure Node version matches Angular requirements (Node 18+ recommended for Angular 20). You are on Node 22 which is generally fine.
5. Check for TypeScript strict errors in `electron/` or `src/` – production build may fail on types depending on configuration.
6. Run `ng doctor` for environment diagnostics.

If Electron does not auto-reload:

- Confirm `nodemon` installed (network issues can block install). Retry `npm install` when online.
- Ensure the compiled output folder `electron/.dist` exists and contains `main.js`.
- Verify `watch:electron` script still includes `--watch electron/.dist`.

If notifications don't appear on Windows:

- Ensure `app.setAppUserModelId(...)` matches a stable identifier (already set in `main.ts`).
- Test with `ipcMain.handle('debug:notify', ...)` via a renderer IPC call.

## Script Overview

| Script | Purpose |
| ------ | ------- |
| `serve:renderer` | Angular dev server only |
| `build:renderer` | Angular production build |
| `build:main` | Compile Electron TypeScript |
| `watch:main` | Watch & recompile Electron TS |
| `watch:electron` | Start Electron and reload on main/preload changes |
| `dev` | Full integrated dev (renderer + main + electron) |
| `build` | Production build (renderer + main) |
| `release` | Build & package installers via electron-builder |
| `electron:run:dev` | Launch Electron pointing at dev server |
| `electron:run:prod` | Launch Electron pointing at production assets |
| `clean` | Remove build output folders |

## Notes

The Electron entry point is defined as `electron/main.js` (compiled from `electron/main.ts`). The production renderer assets resolve to `dist/work-logger/browser/index.html` which the main process loads when `VITE_DEV_SERVER_URL` is not set.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

Angular CLI docs: [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli)
Electron docs: [https://www.electronjs.org/docs/latest](https://www.electronjs.org/docs/latest)
electron-builder config: See the `build` section in `package.json`.
