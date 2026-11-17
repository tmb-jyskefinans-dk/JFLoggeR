import { BrowserWindow, session, type Session, type WebContents } from 'electron';
import {
  JIRA_CLOUD_SESSION_COOKIE,
  jiraBrowserLoginOrigin,
  type JiraConnection
} from './jira-client';

// Persistent so Atlassian/IdP SSO state survives restarts and re-login is usually a single click.
// Cookies are encrypted at rest via the EnableCookieEncryption fuse.
const LOGIN_PARTITION = 'persist:jira-browser-login';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export type JiraBrowserLoginResult =
  | { ok: true; token: string; expiresAt?: number }
  | { ok: false; error: string; cancelled?: boolean };

let loginSessionConfigured = false;
let activeLoginWindow: BrowserWindow | null = null;

function loginSession(): Session {
  const ses = session.fromPartition(LOGIN_PARTITION);
  if (!loginSessionConfigured) {
    loginSessionConfigured = true;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.on('will-download', (event) => event.preventDefault());
  }
  return ses;
}

/** True for web contents hosting the Jira login page; these may navigate to external https identity providers. */
export function isJiraLoginContents(contents: WebContents): boolean {
  return contents.session === session.fromPartition(LOGIN_PARTITION);
}

export function isAllowedJiraLoginUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Returns the session cookie only if Jira accepts it, so stale cookies left in the jar are never captured. */
async function readVerifiedSessionToken(ses: Session, origin: string): Promise<{ token: string; expiresAt?: number } | null> {
  const [cookie] = await ses.cookies.get({ url: origin, name: JIRA_CLOUD_SESSION_COOKIE });
  if (!cookie?.value) return null;
  try {
    const res = await ses.fetch(`${origin}/rest/api/3/myself`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      redirect: 'error'
    });
    if (!res.ok) return null;
    const data = await res.json() as { accountId?: unknown };
    if (!String(data?.accountId ?? '').trim()) return null;
  } catch {
    return null;
  }
  return {
    token: cookie.value,
    expiresAt: cookie.expirationDate ? Math.round(cookie.expirationDate * 1000) : undefined
  };
}

/**
 * Opens an interactive Atlassian login window and resolves with the site's session cookie once the user is signed in.
 * The window runs sandboxed in its own session without preload, so the login page has no access to the app bridge.
 */
export function loginJiraViaBrowser(rawBaseUrl: unknown, parent?: BrowserWindow | null): Promise<JiraBrowserLoginResult> {
  const origin = jiraBrowserLoginOrigin(rawBaseUrl);
  if (!origin) {
    return Promise.resolve({ ok: false, error: 'Angiv en gyldig Jira Cloud URL (fx https://firma.atlassian.net) før login.' });
  }
  if (activeLoginWindow && !activeLoginWindow.isDestroyed()) {
    activeLoginWindow.focus();
    return Promise.resolve({ ok: false, error: 'Et Jira-login er allerede åbent.' });
  }

  const ses = loginSession();
  const loginWin = new BrowserWindow({
    width: 520,
    height: 720,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    title: 'Log ind på Jira Cloud',
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  activeLoginWindow = loginWin;

  return new Promise<JiraBrowserLoginResult>((resolve) => {
    let settled = false;
    let checking = false;
    let recheck = false;

    const onCookieChanged = (_e: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      if (!removed && cookie.name === JIRA_CLOUD_SESSION_COOKIE) void tryCapture();
    };

    const finish = (result: JiraBrowserLoginResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ses.cookies.removeListener('changed', onCookieChanged);
      if (activeLoginWindow === loginWin) activeLoginWindow = null;
      if (!loginWin.isDestroyed()) loginWin.close();
      resolve(result);
    };

    const tryCapture = async () => {
      if (settled) return;
      if (checking) { recheck = true; return; }
      checking = true;
      try {
        do {
          recheck = false;
          const captured = await readVerifiedSessionToken(ses, origin);
          if (captured) { finish({ ok: true, ...captured }); return; }
        } while (recheck && !settled);
      } finally {
        checking = false;
      }
    };

    const onNavigated = (_e: Electron.Event, url: string) => {
      try {
        if (new URL(url).origin === origin) void tryCapture();
      } catch { /* ignore malformed urls */ }
    };

    const timer = setTimeout(() => finish({ ok: false, error: 'Jira-login fik timeout. Prøv igen.' }), LOGIN_TIMEOUT_MS);

    ses.cookies.on('changed', onCookieChanged);
    loginWin.webContents.on('did-navigate', onNavigated);
    loginWin.webContents.on('did-navigate-in-page', onNavigated);
    loginWin.on('closed', () => finish({ ok: false, cancelled: true, error: 'Jira-login blev annulleret.' }));

    // Redirect-driven SSO flows commonly abort the initial load; failures are visible in the window itself.
    loginWin.loadURL(`${origin}/`).catch(() => { /* ignore */ });
  });
}

function cookieRequestPartition(c: JiraConnection): string {
  // In-memory (no "persist:" prefix) so the captured cookie only lives on disk in encrypted settings.
  return `jira-cookie-auth-${c.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** Session that carries the connection's stored Atlassian session cookie for REST calls to its site. */
export async function jiraCookieRequestSession(c: JiraConnection): Promise<Session> {
  const origin = jiraBrowserLoginOrigin(c.base_url);
  if (!origin) throw new Error('Jira URL understøtter ikke browser-login.');
  const ses = session.fromPartition(cookieRequestPartition(c));
  await ses.cookies.set({
    url: origin,
    name: JIRA_CLOUD_SESSION_COOKIE,
    value: c.token,
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction'
  });
  return ses;
}
