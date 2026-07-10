import axios, { AxiosInstance } from 'axios';

export interface MoolreConfig {
  apiKey: string;
  baseUrl: string;
  webhookSecret: string;
}

export interface FundWalletPayload {
  amountMinor: number;
  paymentMethod: 'MOMO' | 'CARD' | 'BANK';
  network?: 'MTN' | 'TELECEL' | 'AIRTELTIGO';
  phoneNumber?: string;
  referenceId: string;
}

export interface DisbursePayoutPayload {
  amountMinor: number;
  recipientPhone: string;
  recipientNetwork: 'MTN' | 'TELECEL' | 'AIRTELTIGO';
  referenceId: string;
}

export class MoolreService {
  private client: AxiosInstance;
  private webhookSecret: string;

  constructor(config: MoolreConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 10000, // 10-second timeout as designed
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    this.webhookSecret = config.webhookSecret;
  }

  /**
   * Helper to perform HTTP POST with exponential backoff & jitter retry.
   * Retries are only done on transient 5xx errors or network drops.
   */
  private async postWithRetry<T>(url: string, data: any, headers?: any, attempt = 1): Promise<T> {
    try {
      const response = await this.client.post<T>(url, data, { headers });
      return response.data;
    } catch (err: any) {
      if (this.isTransientError(err) && attempt <= 3) {
        const baseDelay = 1000; // 1 second
        const backoff = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 500; // up to 500ms jitter
        const delay = backoff + jitter;

        console.warn(`[Moolre API] Request to ${url} failed (Attempt ${attempt}/3). Retrying in ${Math.round(delay)}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.postWithRetry<T>(url, data, headers, attempt + 1);
      }
      throw this.handleAxiosError(err);
    }
  }

  /**
   * Helper to perform HTTP GET with retry.
   */
  private async getWithRetry<T>(url: string, attempt = 1): Promise<T> {
    try {
      const response = await this.client.get<T>(url);
      return response.data;
    } catch (err: any) {
      if (this.isTransientError(err) && attempt <= 3) {
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.getWithRetry<T>(url, attempt + 1);
      }
      throw this.handleAxiosError(err);
    }
  }

  private isTransientError(err: any): boolean {
    // Retry on network errors, timeouts, or 5xx Server Errors
    if (!err.response) return true; // Network errors
    const status = err.response.status;
    return status >= 500 && status <= 599;
  }

  private handleAxiosError(err: any): Error {
    if (axios.isAxiosError(err)) {
      const errorData = err.response?.data;
      const status = err.response?.status;
      const message = errorData?.message || err.message;
      return new Error(`Moolre API error (Status ${status}): ${message}`);
    }
    return err;
  }

  /**
   * 1. Payments API: Initiate mobile money collections / wallet funding.
   */
  async fundWallet(payload: FundWalletPayload): Promise<{ providerReference: string; status: 'PENDING' | 'SUCCESS' | 'FAILED' }> {
    // Converts minor units to major units for Moolre API if needed (e.g. 5000 pesewas = 50.00 GHS)
    const amountMajor = payload.amountMinor / 100;

    const response = await this.postWithRetry<any>('/v1/payments/collect', {
      amount: amountMajor,
      currency: 'GHS',
      method: payload.paymentMethod,
      channel: payload.network,
      phoneNumber: payload.phoneNumber,
      reference: payload.referenceId,
    });

    return {
      providerReference: response.id || response.reference || payload.referenceId,
      status: response.status === 'success' ? 'SUCCESS' : 'PENDING',
    };
  }

  /**
   * 2. Transfers API: Trigger instant outward payouts to rider wallets.
   * Leverages Idempotency-Key header to prevent duplicate payout transactions.
   */
  async disbursePayout(payload: DisbursePayoutPayload, idempotencyKey: string): Promise<{ providerReference: string; status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' }> {
    const amountMajor = payload.amountMinor / 100;

    const response = await this.postWithRetry<any>(
      '/v1/transfers/disburse',
      {
        amount: amountMajor,
        currency: 'GHS',
        recipientPhone: payload.recipientPhone,
        recipientNetwork: payload.recipientNetwork,
        reference: payload.referenceId,
      },
      {
        'Idempotency-Key': idempotencyKey,
      }
    );

    return {
      providerReference: response.id || response.reference || payload.referenceId,
      status: response.status === 'success' ? 'SUCCESS' : 'PROCESSING',
    };
  }

  /**
   * 3. Account API: Get Moolre platform account balance.
   */
  async getAccountBalance(): Promise<{ balance: number; currency: string }> {
    const response = await this.getWithRetry<any>('/v1/accounts/balance');
    return {
      balance: response.balance || 0,
      currency: response.currency || 'GHS',
    };
  }

  /**
   * 4. SMS API: Send verification OTP codes or rider dispatch notifications.
   */
  async sendSms(phoneNumber: string, message: string): Promise<{ providerReference: string }> {
    const response = await this.postWithRetry<any>('/v1/sms/send', {
      to: phoneNumber,
      message: message,
    });
    return {
      providerReference: response.id || response.sid || crypto.randomUUID(),
    };
  }

  /**
   * Verify HMAC-SHA256 signature from Moolre webhooks
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const computedSignature = hmac.update(payload).digest('hex');
    
    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, 'hex'),
      Buffer.from(signature, 'hex')
    );
  }
}

import crypto from 'crypto';
