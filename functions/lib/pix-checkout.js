"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPixCharge = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const checkout_1 = require("./checkout");
const payment_provider_1 = require("./payments/payment-provider");
const pagarme_pix_1 = require("./payments/pagarme-pix");
const db = (0, firestore_1.getFirestore)();
const pagarmeSecretKey = (0, params_1.defineSecret)("PAGARME_SECRET_KEY");
const options = {
    region: "southamerica-east1",
    enforceAppCheck: true,
    maxInstances: 10,
    secrets: [pagarmeSecretKey],
};
function pixStillValid(order) {
    if (order["paymentMethod"] !== "pix" ||
        typeof order["pixQrCode"] !== "string" ||
        typeof order["gatewayChargeId"] !== "string") {
        return false;
    }
    if (typeof order["pixExpiresAt"] !== "string" || !order["pixExpiresAt"]) {
        return true;
    }
    const expires = Date.parse(order["pixExpiresAt"]);
    return Number.isFinite(expires) && expires > Date.now() + 30_000;
}
function publicPix(order) {
    return {
        paymentStatus: order["paymentStatus"],
        pixQrCode: typeof order["pixQrCode"] === "string" ? order["pixQrCode"] : null,
        pixQrCodeUrl: (0, pagarme_pix_1.publicQrUrl)(order["pixQrCodeUrl"]),
        pixExpiresAt: typeof order["pixExpiresAt"] === "string" ? order["pixExpiresAt"] : null,
    };
}
/** Cria a cobrança PIX. Não altera paymentStatus para paid. */
exports.createPixCharge = (0, https_1.onCall)(options, async (request) => {
    const orderId = await (0, checkout_1.resolveCheckoutToken)(request.data?.token);
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    const studentSnap = await db.collection("students").doc(orderId).get();
    const order = orderSnap.data();
    const student = studentSnap.data();
    if (!order || !student || order["environment"] !== "sandbox") {
        throw new https_1.HttpsError("not-found", "Pedido indisponível.");
    }
    if (order["paymentStatus"] === "paid") {
        return { ...publicPix(order), paymentStatus: "paid" };
    }
    if (order["paymentStatus"] !== "pending") {
        throw new https_1.HttpsError("failed-precondition", "Pedido não está pendente.");
    }
    if (pixStillValid(order)) {
        return publicPix(order);
    }
    let apiKey;
    try {
        apiKey = (0, pagarme_pix_1.requireSandboxKey)(pagarmeSecretKey.value());
    }
    catch (error) {
        const message = error instanceof pagarme_pix_1.PagarmeConfigError
            ? error.message
            : "A chave de sandbox do Pagar.me não está configurada. Nenhum PIX foi gerado e o pedido continua pendente.";
        throw new https_1.HttpsError("failed-precondition", message);
    }
    const address = student["address"];
    let created;
    try {
        created = await new payment_provider_1.PagarmePaymentProvider(apiKey).createPixCharge({
            orderId,
            amountCents: order["amountCents"],
            description: String(order["courseTitle"] ?? "Curso"),
            customer: {
                name: String(student["fullName"] ?? ""),
                email: String(student["email"] ?? ""),
                document: String(student["document"] ?? ""),
                phone: String(student["phone"] ?? ""),
                address: {
                    zipCode: String(address?.["zipCode"] ?? ""),
                    street: String(address?.["street"] ?? ""),
                    number: String(address?.["number"] ?? ""),
                    complement: String(address?.["complement"] ?? ""),
                    district: String(address?.["district"] ?? ""),
                    city: String(address?.["city"] ?? ""),
                    state: String(address?.["state"] ?? ""),
                },
            },
        });
    }
    catch (error) {
        const message = error instanceof pagarme_pix_1.PagarmeConfigError
            ? error.message
            : "Não foi possível gerar o PIX. O pedido continua pendente.";
        throw new https_1.HttpsError("failed-precondition", message);
    }
    await db.runTransaction(async (tx) => {
        const fresh = await tx.get(orderRef);
        const current = fresh.data();
        if (!current || current["paymentStatus"] !== "pending") {
            throw new https_1.HttpsError("failed-precondition", "Pedido não está pendente.");
        }
        tx.update(orderRef, {
            gateway: "pagarme",
            gatewayOrderId: created.providerOrderId,
            gatewayChargeId: created.providerChargeId,
            paymentMethod: "pix",
            paymentStatus: "pending",
            pixQrCode: created.qrCode,
            pixQrCodeUrl: created.qrCodeUrl,
            pixExpiresAt: created.expiresAt,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(db.collection("pixCharges").doc(created.providerChargeId), {
            orderId,
            providerOrderId: created.providerOrderId,
            environment: "sandbox",
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
    return {
        paymentStatus: created.orderPaymentStatus,
        pixQrCode: created.qrCode,
        pixQrCodeUrl: created.qrCodeUrl,
        pixExpiresAt: created.expiresAt,
    };
});
