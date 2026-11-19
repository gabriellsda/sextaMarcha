import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { splitAmount } = require("../lib/payments/split.js");
const {
  requireSandboxKey,
  buildPixOrderBody,
  parseCreatedPix,
  PagarmeConfigError,
  createPagarmePixCharge,
} = require("../lib/payments/pagarme-pix.js");
const { webhookAuthorized, WEBHOOK_BASIC_USER } = require(
  "../lib/payments/webhook-auth.js",
);
const { readChargePaid } = require("../lib/payments/charge-paid.js");

const orderId = "a".repeat(64);
const secret = "webhook-segredo-de-teste";

function basic(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

const request = {
  orderId,
  amountCents: 12000,
  description: "Reciclagem",
  customer: {
    name: "Aluno Exemplo",
    email: "aluno.exemplo@example.com",
    document: "529.982.247-25",
    phone: "48999990000",
    address: {
      zipCode: "88000000",
      street: "Rua Exemplo",
      number: "100",
      district: "Centro",
      city: "Florianópolis",
      state: "SC",
    },
  },
};

test("split 10/20/70 fecha o valor", () => {
  const split = splitAmount(12000);
  assert.deepEqual(split, { partner: 1200, sextaMarcha: 2400, icetran: 8400 });
  assert.equal(split.partner + split.sextaMarcha + split.icetran, 12000);
});

test("sem chave de sandbox a cobrança não sai", () => {
  assert.throws(() => requireSandboxKey(""), PagarmeConfigError);
  assert.throws(() => requireSandboxKey("sk_live_nao_usar"), PagarmeConfigError);
  assert.equal(requireSandboxKey("sk_test_sandbox"), "sk_test_sandbox");
});

test("o corpo do PIX não leva cartão nem financeiro", () => {
  const body = buildPixOrderBody(request);
  assert.equal(body.payments.length, 1);
  assert.equal(body.payments[0].payment_method, "pix");
  assert.equal(body.code.length <= 52, true);
  assert.equal(body.metadata.orderId, orderId);
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "credit_card",
    "boleto",
    "financeiro",
    "cartao",
    "cvv",
    "card_token",
    "card_id",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("criar PIX devolve pendente mesmo se a API disser pago", async () => {
  const created = await createPagarmePixCharge(
    "sk_test_sandbox",
    request,
    async () => ({
      ok: true,
      json: async () => ({
        id: "or_123",
        charges: [
          {
            id: "ch_123",
            status: "paid",
            payment_method: "pix",
            amount: 12000,
            last_transaction: {
              transaction_type: "pix",
              qr_code: "000201",
              qr_code_url: "https://api.pagar.me/core/v5/transactions/ch_123/qrcode",
              expires_at: "2030-01-01T00:00:00Z",
            },
          },
        ],
      }),
    }),
  );
  assert.equal(created.orderPaymentStatus, "pending");
  assert.equal(created.qrCode, "000201");
  assert.throws(() => parseCreatedPix({ id: "or_1" }), PagarmeConfigError);
});

test("webhook sem segredo não autentica", () => {
  assert.equal(webhookAuthorized(basic(WEBHOOK_BASIC_USER, secret), ""), false);
  assert.equal(webhookAuthorized(undefined, secret), false);
  assert.equal(
    webhookAuthorized(basic("outro", secret), secret),
    false,
  );
  assert.equal(
    webhookAuthorized(basic(WEBHOOK_BASIC_USER, secret), secret),
    true,
  );
});

test("só charge.paid de PIX segue para confirmação", () => {
  assert.deepEqual(
    readChargePaid({
      type: "charge.paid",
      data: { id: "ch_123", payment_method: "pix", status: "paid" },
    }),
    { action: "confirm_with_provider", chargeId: "ch_123" },
  );
  assert.equal(readChargePaid({ type: "charge.refunded", data: { id: "ch_1" } }).action, "ignore");
  assert.equal(
    readChargePaid({
      type: "charge.paid",
      data: { id: "ch_1", payment_method: "credit_card", status: "paid" },
    }).action,
    "reject",
  );
});
