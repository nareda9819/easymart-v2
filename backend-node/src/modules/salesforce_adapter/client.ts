import axios, { AxiosInstance } from 'axios';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { logger } from '../observability/logger';

class SalesforceClient {
  private client: AxiosInstance;
  private accessToken = '';
  private instanceUrl = config.SALESFORCE_BASE_URL || '';
  private expiresAt = 0;

  constructor() {
    this.client = axios.create({ baseURL: this.instanceUrl || '' });

    this.client.interceptors.request.use(async (req) => {
      await this.ensureToken();
      if (this.accessToken) {
        req.headers = req.headers || {};
        (req.headers as any).Authorization = `Bearer ${this.accessToken}`;
      }
      // if baseURL is not set yet, use instanceUrl discovered from token
      if (!this.client.defaults.baseURL && this.instanceUrl) {
        this.client.defaults.baseURL = this.instanceUrl;
      }
      return req;
    });
  }

  private normalizePrivateKey(raw: string) {
    if (!raw) return '';
    return raw.replace(/\\n/g, '\n');
  }

  private async requestTokenWithJwt(): Promise<void> {
    if (!config.SALESFORCE_TOKEN_URL) throw new Error('SALESFORCE_TOKEN_URL not configured');
    const clientId = config.SALESFORCE_JWT_CLIENT_ID || config.SALESFORCE_CLIENT_ID;
    const username = config.SALESFORCE_JWT_USERNAME || config.SALESFORCE_USERNAME;
    const privateKeyRaw = config.SALESFORCE_JWT_PRIVATE_KEY || '';
    if (!clientId || !username || !privateKeyRaw) {
      throw new Error('Salesforce JWT configuration missing');
    }

    const privateKey = this.normalizePrivateKey(privateKeyRaw);
    
    // Debug: Check if the key starts with proper header
    logger.info('Private key normalized', { 
      startsWithBegin: privateKey.startsWith('-----BEGIN'),
      length: privateKey.length,
      hasNewlines: privateKey.includes('\n')
    });
    
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: clientId, sub: username, aud: config.SALESFORCE_TOKEN_URL, exp: now + 180 };

    let assertion: string;
    try {
      assertion = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    } catch (err: any) {
      logger.error('Failed to sign JWT assertion', { message: err.message });
      throw err;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    params.append('assertion', assertion);

    const resp = await axios.post(config.SALESFORCE_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.accessToken = resp.data.access_token;
    this.instanceUrl = resp.data.instance_url || this.instanceUrl;
    this.expiresAt = Date.now() + (resp.data.expires_in || 3600) * 1000;
    this.client.defaults.baseURL = this.instanceUrl;

    // Debug: log token acquisition (do not log the full token in production)
    logger.info('Obtained Salesforce token', {
      accessTokenLength: this.accessToken ? this.accessToken.length : 0,
      instanceUrl: this.instanceUrl,
      expiresIn: resp.data.expires_in,
    });
  }

  private async requestTokenWithPassword(): Promise<void> {
    if (!config.SALESFORCE_TOKEN_URL) throw new Error('SALESFORCE_TOKEN_URL not configured');
    if (!config.SALESFORCE_CLIENT_ID || !config.SALESFORCE_CLIENT_SECRET) {
      throw new Error('Salesforce client credentials missing');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', config.SALESFORCE_CLIENT_ID);
    params.append('client_secret', config.SALESFORCE_CLIENT_SECRET || '');
    params.append('username', config.SALESFORCE_USERNAME || '');
    params.append('password', `${config.SALESFORCE_PASSWORD || ''}${config.SALESFORCE_SECURITY_TOKEN || ''}`);

    const resp = await axios.post(config.SALESFORCE_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.accessToken = resp.data.access_token;
    this.instanceUrl = resp.data.instance_url || this.instanceUrl;
    this.expiresAt = Date.now() + (resp.data.expires_in || 3600) * 1000;
    this.client.defaults.baseURL = this.instanceUrl;
  }

  private async ensureToken() {
    const refreshThreshold = 60 * 1000; // refresh 60s before expiry
    if (this.accessToken && Date.now() < this.expiresAt - refreshThreshold) return;

    try {
      if (config.SALESFORCE_JWT_PRIVATE_KEY && (config.SALESFORCE_JWT_CLIENT_ID || config.SALESFORCE_CLIENT_ID)) {
        await this.requestTokenWithJwt();
        return;
      }

      if (config.SALESFORCE_USERNAME && (config.SALESFORCE_PASSWORD || config.SALESFORCE_CLIENT_SECRET)) {
        await this.requestTokenWithPassword();
        return;
      }

      throw new Error('No Salesforce auth method configured');
    } catch (err: any) {
      logger.error('Failed to obtain Salesforce token', { message: err.message });
      throw err;
    }
  }

  getClient(): AxiosInstance {
    return this.client;
  }

  getInstanceUrl(): string {
    return this.instanceUrl || '';
  }
}

export const salesforceClient = new SalesforceClient();

export default salesforceClient;
