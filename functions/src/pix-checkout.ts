import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { resolveCheckoutToken } from "./checkout";
import { PagarmePaymentProvider } from "./payments/payment-provider";
import {
  PagarmeConfigError,
  publicQrUrl,
  requireSandboxKey,
} from "./payments/pagarme-pix";

const db = getFirestore();
const pagarmeSecretKey = defineSecret("PAGARME_SECRET_KEY");
const options = {
  region: "southamerica-east1" as const,
  enforceAppCheck: true,
  maxInstances: 10,
  secrets: [pagarmeSecretKey],
};

function pixStillValid(order: Record<string, unknown>): boolean {
  if (
    order["paymentMethod"] !== "pix" ||
    typeof order["pixQrCode"] !== "string" ||
    typeof order["gatewayChargeId"] !== "string"
  ) {
    return false;
  }
  if (typeof order["pixExpiresAt"] !== "string" || !order["pixExpiresAt"]) {
    return true;
  }
  const expires = Date.parse(order["pixExpiresAt"]);
  return Number.isFinite(expires) && expires > Date.now() + 30_000;
}

function publicPix(order: Record<string, unknown>) {
  return {
    paymentStatus: order["paymentStatus"],
    pixQrCode: typeof order["pixQrCode"] === "string" ? order["pixQrCode"] : null,
    pixQrCodeUrl: publicQrUrl(order["pixQrCodeUrl"]),
    pixExpiresAt:
      typeof order["pixExpiresAt"] === "string" ? order["pixExpiresAt"] : null,
  };
}

/** Cria a cobrança PIX. Não altera paymentStatus para paid. */
export const createPixCharge = onCall(options, async (request) => {
  const orderId = await resolveCheckoutToken(request.data?.token);
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();
  const studentSnap = await db.collection("students").doc(orderId).get();
  const order = orderSnap.data();
  const student = studentSnap.data();
  if (!order || !student || order["environment"] !== "sandbox") {
    throw new HttpsError("not-found", "Pedido indisponível.");
  }
  if (order["paymentStatus"] === "paid") {
    return { ...publicPix(order), paymentStatus: "paid" };
  }
  if (order["paymentStatus"] !== "pending") {
    throw new HttpsError("failed-precondition", "Pedido não está pendente.");
  }
  if (pixStillValid(order)) {
    return publicPix(order);
  }

  let apiKey: string;
  try {
    apiKey = requireSandboxKey(pagarmeSecretKey.value());
  } catch (error) {
    const message =
      error instanceof PagarmeConfigError
        ? error.message
        : "A chave de sandbox do Pagar.me não está configurada. Nenhum PIX foi gerado e o pedido continua pendente.";
    throw new HttpsError("failed-precondition", message);
  }

  const address = student["address"] as Record<string, unknown> | undefined;
  let created;
  try {
    created = await new PagarmePaymentProvider(apiKey).createPixCharge({
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
  } catch (error) {
    const message =
      error instanceof PagarmeConfigError
        ? error.message
        : "Não foi possível gerar o PIX. O pedido continua pendente.";
    throw new HttpsError("failed-precondition", message);
  }

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(orderRef);
    const current = fresh.data();
    if (!current || current["paymentStatus"] !== "pending") {
      throw new HttpsError("failed-precondition", "Pedido não está pendente.");
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
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection("pixCharges").doc(created.providerChargeId), {
      orderId,
      providerOrderId: created.providerOrderId,
      environment: "sandbox",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    paymentStatus: created.orderPaymentStatus,
    pixQrCode: created.qrCode,
    pixQrCodeUrl: created.qrCodeUrl,
    pixExpiresAt: created.expiresAt,
  };
});
