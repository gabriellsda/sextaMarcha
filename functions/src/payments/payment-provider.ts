import {
  createPagarmePixCharge,
  getPagarmeCharge,
  PixChargeCreated,
  PixChargeRequest,
} from "./pagarme-pix";

/** Contrato de cobrança. Cartão, boleto e link hospedado continuam desligados. */
export type PaymentEnvironment = "sandbox" | "production";
export type PaymentState =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "canceled";

export interface PaymentCheckoutRequest {
  orderId: string;
  amountCents: number;
  currency: "BRL";
  customerReference: string;
  idempotencyKey: string;
}
export interface PaymentCheckoutResult {
  provider: string;
  providerOrderId: string;
  checkoutUrl: string;
  status: PaymentState;
}
export interface PaymentProvider {
  readonly name: string;
  createCheckout(
    request: PaymentCheckoutRequest,
  ): Promise<PaymentCheckoutResult>;
  getPayment(providerOrderId: string): Promise<PaymentState>;
}

export class PagarmePaymentProvider implements PaymentProvider {
  readonly name = "pagarme";
  constructor(private readonly apiKey: string) {}

  async createCheckout(
    _request: PaymentCheckoutRequest,
  ): Promise<PaymentCheckoutResult> {
    throw new Error(
      "Checkout de cartão, boleto e link hospedado não está habilitado. Use o PIX.",
    );
  }

  async createPixCharge(request: PixChargeRequest): Promise<PixChargeCreated> {
    return createPagarmePixCharge(this.apiKey, request);
  }

  async getPayment(providerChargeId: string): Promise<PaymentState> {
    const charge = await getPagarmeCharge(this.apiKey, providerChargeId);
    if (
      charge.status === "paid" ||
      charge.status === "pending" ||
      charge.status === "failed" ||
      charge.status === "canceled"
    ) {
      return charge.status;
    }
    return "pending";
  }
}
