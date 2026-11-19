import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { readChargePaid } from "./payments/charge-paid";
import { markSandboxOrderPaidFromPix } from "./payments/mark-paid";
import {
  getPagarmeCharge,
  PagarmeConfigError,
  requireSandboxKey,
} from "./payments/pagarme-pix";
import { webhookAuthorized } from "./payments/webhook-auth";

const db = getFirestore();
const pagarmeSecretKey = defineSecret("PAGARME_SECRET_KEY");
const pagarmeWebhookSecret = defineSecret("PAGARME_WEBHOOK_SECRET");

/** charge.paid autenticado é o único caminho que marca o pedido como pago. */
export const pagarmeWebhook = onRequest(
  {
    region: "southamerica-east1",
    secrets: [pagarmeSecretKey, pagarmeWebhookSecret],
    invoker: "public",
    maxInstances: 10,
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "Método não permitido." });
      return;
    }
    if (
      !webhookAuthorized(
        request.get("authorization"),
        pagarmeWebhookSecret.value(),
      )
    ) {
      response.status(401).json({ ok: false, error: "Webhook não autenticado." });
      return;
    }

    const decision = readChargePaid(request.body);
    if (decision.action === "ignore") {
      response.status(200).json({ ok: true, ignored: true });
      return;
    }
    if (decision.action === "reject") {
      response.status(400).json({ ok: false, error: decision.reason });
      return;
    }

    let apiKey: string;
    try {
      apiKey = requireSandboxKey(pagarmeSecretKey.value());
    } catch {
      response.status(503).json({
        ok: false,
        error: "Chave Pagar.me ausente. Pedido não foi marcado como pago.",
      });
      return;
    }

    let remote;
    try {
      remote = await getPagarmeCharge(apiKey, decision.chargeId);
    } catch (error) {
      const message =
        error instanceof PagarmeConfigError
          ? "Não foi possível confirmar a cobrança no Pagar.me."
          : "Não foi possível confirmar a cobrança no Pagar.me.";
      response.status(502).json({ ok: false, error: message });
      return;
    }

    if (remote.paymentMethod !== "pix" || remote.status !== "paid") {
      response.status(200).json({ ok: true, ignored: true });
      return;
    }
    if (remote.providerChargeId !== decision.chargeId) {
      response.status(409).json({ ok: false, error: "Cobrança divergente." });
      return;
    }

    const link = await db.collection("pixCharges").doc(remote.providerChargeId).get();
    const linkedOrderId = link.data()?.["orderId"];
    const orderId =
      typeof linkedOrderId === "string" ? linkedOrderId : remote.orderId;
    if (
      typeof orderId !== "string" ||
      (typeof linkedOrderId === "string" &&
        remote.orderId &&
        linkedOrderId !== remote.orderId)
    ) {
      response.status(409).json({ ok: false, error: "Cobrança sem pedido." });
      return;
    }

    try {
      const result = await markSandboxOrderPaidFromPix({
        orderId,
        chargeId: remote.providerChargeId,
        providerOrderId: remote.providerOrderId,
        amountCents: remote.amountCents,
      });
      response.status(200).json(result);
    } catch {
      response.status(409).json({
        ok: false,
        error: "Pedido não confirmado. Nenhum pagamento foi inventado.",
      });
    }
  },
);
