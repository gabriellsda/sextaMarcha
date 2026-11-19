"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pagarmeWebhook = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const charge_paid_1 = require("./payments/charge-paid");
const mark_paid_1 = require("./payments/mark-paid");
const pagarme_pix_1 = require("./payments/pagarme-pix");
const webhook_auth_1 = require("./payments/webhook-auth");
const db = (0, firestore_1.getFirestore)();
const pagarmeSecretKey = (0, params_1.defineSecret)("PAGARME_SECRET_KEY");
const pagarmeWebhookSecret = (0, params_1.defineSecret)("PAGARME_WEBHOOK_SECRET");
/** charge.paid autenticado é o único caminho que marca o pedido como pago. */
exports.pagarmeWebhook = (0, https_1.onRequest)({
    region: "southamerica-east1",
    secrets: [pagarmeSecretKey, pagarmeWebhookSecret],
    invoker: "public",
    maxInstances: 10,
}, async (request, response) => {
    if (request.method !== "POST") {
        response.status(405).json({ ok: false, error: "Método não permitido." });
        return;
    }
    if (!(0, webhook_auth_1.webhookAuthorized)(request.get("authorization"), pagarmeWebhookSecret.value())) {
        response.status(401).json({ ok: false, error: "Webhook não autenticado." });
        return;
    }
    const decision = (0, charge_paid_1.readChargePaid)(request.body);
    if (decision.action === "ignore") {
        response.status(200).json({ ok: true, ignored: true });
        return;
    }
    if (decision.action === "reject") {
        response.status(400).json({ ok: false, error: decision.reason });
        return;
    }
    let apiKey;
    try {
        apiKey = (0, pagarme_pix_1.requireSandboxKey)(pagarmeSecretKey.value());
    }
    catch {
        response.status(503).json({
            ok: false,
            error: "Chave Pagar.me ausente. Pedido não foi marcado como pago.",
        });
        return;
    }
    let remote;
    try {
        remote = await (0, pagarme_pix_1.getPagarmeCharge)(apiKey, decision.chargeId);
    }
    catch (error) {
        const message = error instanceof pagarme_pix_1.PagarmeConfigError
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
    const orderId = typeof linkedOrderId === "string" ? linkedOrderId : remote.orderId;
    if (typeof orderId !== "string" ||
        (typeof linkedOrderId === "string" &&
            remote.orderId &&
            linkedOrderId !== remote.orderId)) {
        response.status(409).json({ ok: false, error: "Cobrança sem pedido." });
        return;
    }
    try {
        const result = await (0, mark_paid_1.markSandboxOrderPaidFromPix)({
            orderId,
            chargeId: remote.providerChargeId,
            providerOrderId: remote.providerOrderId,
            amountCents: remote.amountCents,
        });
        response.status(200).json(result);
    }
    catch {
        response.status(409).json({
            ok: false,
            error: "Pedido não confirmado. Nenhum pagamento foi inventado.",
        });
    }
});
