export const PAGARME_API = "https://api.pagar.me/core/v5";

export class PagarmeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PagarmeConfigError";
  }
}

/** Falha fechada: sem chave de sandbox, nenhuma cobrança sai e nada é marcado pago. */
export function requireSandboxKey(apiKey: unknown): string {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new PagarmeConfigError(
      "A chave de sandbox do Pagar.me não está configurada. Nenhum PIX foi gerado e o pedido continua pendente.",
    );
  }
  const key = apiKey.trim();
  if (!key.startsWith("sk_test_")) {
    throw new PagarmeConfigError(
      "Somente a chave de sandbox sk_test_ pode criar PIX neste incremento. O pedido não foi marcado como pago.",
    );
  }
  return key;
}

export function publicQrUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === "api.pagar.me" || host.endsWith(".pagar.me");
    if (url.protocol !== "https:" || !allowed) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface PixCustomer {
  name: string;
  email: string;
  document: string;
  phone: string;
  address: {
    zipCode: string;
    street: string;
    number: string;
    complement?: string;
    district: string;
    city: string;
    state: string;
  };
}

export interface PixChargeRequest {
  orderId: string;
  amountCents: number;
  description: string;
  customer: PixCustomer;
}

export interface PixChargeCreated {
  providerOrderId: string;
  providerChargeId: string;
  qrCode: string;
  qrCodeUrl: string | null;
  expiresAt: string | null;
  /** A criação do PIX nunca confirma o pedido. Quem marca pago é o webhook. */
  orderPaymentStatus: "pending";
}

export interface ProviderCharge {
  providerChargeId: string;
  providerOrderId: string | null;
  amountCents: number;
  status: string;
  paymentMethod: string;
  orderId: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export function mobilePhone(phone: string): {
  country_code: "55";
  area_code: string;
  number: string;
} {
  let only = digits(phone);
  if (only.startsWith("55") && only.length > 11) only = only.slice(2);
  if (only.length < 10 || only.length > 11) {
    throw new PagarmeConfigError("Telefone do aluno inválido para o PIX.");
  }
  return {
    country_code: "55",
    area_code: only.slice(0, 2),
    number: only.slice(2),
  };
}

/** Corpo de pedido PIX. Não inclui cartão, boleto, assinatura nem bloco financeiro. */
export function buildPixOrderBody(
  request: PixChargeRequest,
): Record<string, unknown> {
  if (!/^[a-f0-9]{64}$/.test(request.orderId)) {
    throw new PagarmeConfigError("Pedido inválido para o PIX.");
  }
  if (
    !Number.isSafeInteger(request.amountCents) ||
    request.amountCents <= 0
  ) {
    throw new PagarmeConfigError("Valor inválido para o PIX.");
  }
  const document = digits(request.customer.document);
  if (document.length !== 11) {
    throw new PagarmeConfigError("Documento do aluno inválido para o PIX.");
  }
  const phone = mobilePhone(request.customer.phone);
  const address = request.customer.address;
  const line1 = `${text(address.number, 15)}, ${text(address.street, 150)}, ${text(address.district, 100)}`;
  return {
    code: request.orderId.slice(0, 52),
    closed: true,
    metadata: {
      orderId: request.orderId,
      environment: "sandbox",
    },
    items: [
      {
        amount: request.amountCents,
        description: text(request.description, 150) || "Curso",
        quantity: 1,
        code: "curso",
      },
    ],
    customer: {
      name: text(request.customer.name, 120),
      email: text(request.customer.email, 180).toLowerCase(),
      document,
      document_type: "CPF",
      type: "individual",
      phones: { mobile_phone: phone },
      address: {
        country: "BR",
        state: text(address.state, 2).toUpperCase(),
        city: text(address.city, 100),
        zip_code: digits(address.zipCode),
        line_1: line1.slice(0, 256),
        line_2: text(address.complement, 100),
      },
    },
    payments: [
      {
        payment_method: "pix",
        pix: { expires_in: 3600 },
      },
    ],
  };
}

function paymentMethodOf(charge: Record<string, unknown>): string {
  const direct = text(charge["payment_method"], 40).toLowerCase();
  if (direct) return direct;
  const transaction = record(charge["last_transaction"]);
  return text(transaction?.["transaction_type"], 40).toLowerCase();
}

function metadataOrderId(value: unknown): string | null {
  const metadata = record(value);
  const orderId = metadata?.["orderId"];
  return typeof orderId === "string" && /^[a-f0-9]{64}$/.test(orderId)
    ? orderId
    : null;
}

export function parseCreatedPix(body: unknown): PixChargeCreated {
  const order = record(body);
  const charges = order?.["charges"];
  const charge = Array.isArray(charges) ? record(charges[0]) : null;
  const transaction = record(charge?.["last_transaction"]);
  const qrCode = text(transaction?.["qr_code"], 2000);
  const providerOrderId = text(order?.["id"], 80);
  const providerChargeId = text(charge?.["id"], 80);
  if (
    !providerOrderId ||
    !providerChargeId ||
    !qrCode ||
    paymentMethodOf(charge ?? {}) !== "pix"
  ) {
    throw new PagarmeConfigError(
      "O Pagar.me não devolveu um PIX utilizável. O pedido continua pendente.",
    );
  }
  const expires = text(transaction?.["expires_at"], 40);
  return {
    providerOrderId,
    providerChargeId,
    qrCode,
    qrCodeUrl: publicQrUrl(transaction?.["qr_code_url"]),
    expiresAt: expires || null,
    orderPaymentStatus: "pending",
  };
}

export function parseProviderCharge(body: unknown): ProviderCharge {
  const charge = record(body);
  const providerChargeId = text(charge?.["id"], 80);
  const amount = charge?.["amount"];
  const order = record(charge?.["order"]);
  if (!providerChargeId || typeof amount !== "number" || !Number.isSafeInteger(amount)) {
    throw new PagarmeConfigError("Cobrança do Pagar.me inválida.");
  }
  return {
    providerChargeId,
    providerOrderId: text(order?.["id"], 80) || null,
    amountCents: amount,
    status: text(charge?.["status"], 40).toLowerCase(),
    paymentMethod: paymentMethodOf(charge ?? {}),
    orderId:
      metadataOrderId(charge?.["metadata"]) ?? metadataOrderId(order?.["metadata"]),
  };
}

async function pagarmeFetch(
  apiKey: string,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const key = requireSandboxKey(apiKey);
  const response = await fetchImpl(`${PAGARME_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new PagarmeConfigError(
      "O Pagar.me recusou a chamada. O pedido não foi marcado como pago.",
    );
  }
  return response.json();
}

export async function createPagarmePixCharge(
  apiKey: string,
  request: PixChargeRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<PixChargeCreated> {
  const body = buildPixOrderBody(request);
  const json = await pagarmeFetch(
    apiKey,
    "/orders",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": request.orderId },
    },
    fetchImpl,
  );
  return parseCreatedPix(json);
}

export async function getPagarmeCharge(
  apiKey: string,
  chargeId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderCharge> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(chargeId)) {
    throw new PagarmeConfigError("Cobrança inválida.");
  }
  const json = await pagarmeFetch(
    apiKey,
    `/charges/${encodeURIComponent(chargeId)}`,
    { method: "GET" },
    fetchImpl,
  );
  return parseProviderCharge(json);
}
