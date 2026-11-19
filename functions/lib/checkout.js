"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmSandboxCheckout = exports.getPublicCheckout = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const db = (0, firestore_1.getFirestore)();
const options = {
    region: "southamerica-east1",
    enforceAppCheck: true,
    maxInstances: 10,
};
const hashToken = (token) => {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
        throw new https_1.HttpsError("invalid-argument", "Link inválido.");
    return (0, node_crypto_1.createHash)("sha256").update(token).digest("hex");
};
async function resolve(token) {
    const ref = db.collection("checkoutTokens").doc(hashToken(token));
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.["expiresAt"]?.toMillis?.() < Date.now())
        throw new https_1.HttpsError("not-found", "Link expirado ou indisponível.");
    const orderId = snap.data()?.["orderId"];
    if (typeof orderId !== "string")
        throw new https_1.HttpsError("not-found", "Pedido indisponível.");
    return orderId;
}
/** Exibe somente dados mínimos; o token é uma credencial bearer. */
exports.getPublicCheckout = (0, https_1.onCall)(options, async (request) => {
    const orderId = await resolve(request.data?.token);
    const [orderSnap, studentSnap] = await Promise.all([
        db.collection("orders").doc(orderId).get(),
        db.collection("students").doc(orderId).get(),
    ]);
    const order = orderSnap.data(), student = studentSnap.data();
    if (!order || !student || order["environment"] !== "sandbox")
        throw new https_1.HttpsError("not-found", "Pedido indisponível.");
    return {
        courseTitle: order["courseTitle"],
        amountCents: order["amountCents"],
        state: order["offerState"],
        environment: "sandbox",
        paymentStatus: order["paymentStatus"],
        studentName: student["fullName"],
        studentEmail: student["email"],
        studentPhoneLast4: String(student["phone"] ?? "").slice(-4),
    };
});
/**
 * O clique na página não confirma pagamento.
 * Quem marca orders.paymentStatus = paid é só o webhook charge.paid.
 */
exports.confirmSandboxCheckout = (0, https_1.onCall)(options, async () => {
    throw new https_1.HttpsError("failed-precondition", "O clique não confirma pagamento. O pedido só fica pago quando o webhook charge.paid autenticar a cobrança.");
});
