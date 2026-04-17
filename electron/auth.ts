import { AccountInfo, PublicClientApplication } from '@azure/msal-node';
import { getSettings } from './db';

export type AuthStatus = {
  configured: boolean;
  signedIn: boolean;
  method: 'device-code';
  username?: string;
  name?: string;
  tenantId?: string;
  clientId?: string;
  error?: string;
};

function readAuthConfig() {
  let tenantId = '';
  let clientId = '';
  try {
    const s = getSettings();
    tenantId = (s.azure_tenant_id ?? '').trim();
    clientId = (s.azure_client_id ?? '').trim();
  } catch {
    // DB may not be initialized yet (e.g. tests); fall back to env vars
    tenantId = (process.env['AZURE_TENANT_ID'] ?? '').trim();
    clientId = (process.env['AZURE_CLIENT_ID'] ?? '').trim();
  }
  const configured = !!tenantId && !!clientId;
  return { tenantId, clientId, configured };
}

class AzureAuthManager {
  private pca: PublicClientApplication | null = null;
  private pcaTenantId = '';
  private pcaClientId = '';
  private account: AccountInfo | null = null;
  private readonly scopes = ['User.Read', 'offline_access', 'openid', 'profile'];

  private ensureClient(): { ok: boolean; error?: string } {
    const cfg = readAuthConfig();
    if (!cfg.configured) {
      return { ok: false, error: 'Angiv Azure Tenant ID og Client ID i Indstillinger → Microsoft Entra login' };
    }
    // Rebuild PCA when config changes (settings updated since last call)
    if (!this.pca || this.pcaTenantId !== cfg.tenantId || this.pcaClientId !== cfg.clientId) {
      this.pca = new PublicClientApplication({
        auth: {
          authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
          clientId: cfg.clientId,
        },
      });
      this.pcaTenantId = cfg.tenantId;
      this.pcaClientId = cfg.clientId;
      // Clear any cached account when credentials change
      this.account = null;
    }
    return { ok: true };
  }

  getStatus(): AuthStatus {
    const cfg = readAuthConfig();
    return {
      configured: cfg.configured,
      signedIn: !!this.account,
      method: 'device-code',
      username: this.account?.username,
      name: this.account?.name,
      tenantId: cfg.tenantId || undefined,
      clientId: cfg.clientId || undefined,
      error: cfg.configured ? undefined : 'Azure auth not configured',
    };
  }

  async signInInteractive() {
    const ready = this.ensureClient();
    if (!ready.ok || !this.pca) {
      return { ok: false, error: ready.error ?? 'Auth client not initialized', status: this.getStatus() };
    }

    try {
      const result = await this.pca.acquireTokenByDeviceCode({
        scopes: this.scopes,
        deviceCodeCallback: (response) => {
          const msg = response.message || `Open ${response.verificationUri} and use code ${response.userCode}`;
          console.log('[auth] device-code', msg);
        },
      });

      if (!result?.account) {
        return { ok: false, error: 'Sign-in completed without account result', status: this.getStatus() };
      }

      this.account = result.account;
      return { ok: true, status: this.getStatus() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, status: this.getStatus() };
    }
  }

  async signOut() {
    this.account = null;
    return { ok: true, status: this.getStatus() };
  }
}

export const azureAuth = new AzureAuthManager();
