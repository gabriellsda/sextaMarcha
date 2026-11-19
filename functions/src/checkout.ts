import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
const db = getFirestore();
const options = {
  region: "southamerica-east1" as const,
  enforceAppCheck: true,
  maxInstances: 10,
};
const hashToken = (token: unknown) => {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new HttpsError("invalid-argument", "Link inválido.");
  return createHash("sha256").update(token).digest("hex");
};
async function resolve(token: unknown) {
  const ref = db.collection("checkoutTokens").doc(hashToken(token));
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.["expiresAt"]?.toMillis?.() < Date.now())
    throw new HttpsError("not-found", "Link expirado ou indisponível.");
  const orderId = snap.data()?.["orderId"];
  if (typeof orderId !== "string")
    throw new HttpsError("not-found", "Pedido indisponível.");
  return orderId;
}
/** Exibe somente dados mínimos; o token é uma credencial bearer. */
export const getPublicCheckout = onCall(options, async (request) => {
  const orderId = await resolve(request.data?.token);
  const [orderSnap, studentSnap] = await Promise.all([
    db.collection("orders").doc(orderId).get(),
    db.collection("students").doc(orderId).get(),
  ]);
  const order = orderSnap.data(),
    student = studentSnap.data();
  if (!order || !student || order["environment"] !== "sandbox")
    throw new HttpsError("not-found", "Pedido indisponível.");
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
export const confirmSandboxCheckout = onCall(options, async () => {
  throw new HttpsError(
    "failed-precondition",
    "O clique não confirma pagamento. O pedido só fica pago quando o webhook charge.paid autenticar a cobrança.",
  );
});
