/**
 * MoolreService — sandbox integration layer for the Moolre payment/payout gateway.
 *
 * Wraps HTTP calls to Moolre's REST API for:
 *   - Initiating MoMo collection (incoming payments from businesses)
 *   - Disbursing MoMo payouts (outgoing payments to riders)
 *   - Verifying webhook signatures
 *
 * All amounts are handled in minor units (pesewas for GHS).
 */

export interface MoolreConfig {
  apiKey: string;
  baseUrl: string;
  webhookSecret: string;
}

export interface MoolreInitiatePaymentParams {
  amountMinor: number;
  currency: string;
  momoNetwork: 'MTN' | 'TELECEL' | 'AIRTELTIGO';
  momoNumber: string;
  referenceId: string;
  description: string;
}

export interface MoolreInitiatePayoutParams {
  amountMinor: number;
  currency: string;
  recipientNetwork: string;
  recipientPhone: string;
  referenceId: string;
  description: string;
}

export interface MoolreProviderResponse {
  providerReference: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  message?: string;
}

export class MoolreService {
  private readonly config: MoolreConfig;

  constructor(config: MoolreConfig) {
    this.config = config;
  }

  /**
   * Initiate a MoMo collection request (business funding their wallet).
   * Returns a provider reference for async status polling / webhook matching.
   */
  async initiatePayment(params: MoolreInitiatePaymentParams): Promise<MoolreProviderResponse> {
    // TODO: Replace with live HTTP call when Moolre sandbox credentials are available.
    // Sandbox stub — returns an immediate PENDING response with a generated reference.
    return {
      providerReference: `MOOLRE-PAY-${params.referenceId}-${Date.now()}`,
      status: 'PENDING',
      message: 'Payment initiated (sandbox stub)',
    };
  }

  /**
   * Initiate a MoMo disbursement (paying out a rider's earnings).
   * Returns a provider reference for async status polling / webhook matching.
   */
  async initiatePayout(params: MoolreInitiatePayoutParams): Promise<MoolreProviderResponse> {
    // TODO: Replace with live HTTP call when Moolre sandbox credentials are available.
    return {
      providerReference: `MOOLRE-OUT-${params.referenceId}-${Date.now()}`,
      status: 'PENDING',
      message: 'Payout initiated (sandbox stub)',
    };
  }

  /**
   * Verify a webhook payload signature using the shared webhook secret.
   * Returns true if the signature is valid.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // TODO: Replace with HMAC-SHA256 comparison once Moolre webhook spec is confirmed.
    // Uses this.config.webhookSecret for the HMAC key.
    // Sandbox stub — always valid during development.
    void payload;
    void signature;
    void this.config.webhookSecret;
    return true;
  }
}
