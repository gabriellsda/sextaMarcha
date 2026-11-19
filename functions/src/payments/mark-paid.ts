import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { mapOraculoMatriculas } from "../oraculo/matricula";
import { splitAmount } from "./split";

const db = getFirestore();

export class PaymentConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfirmError";
  }
}

/**
 * Único escritor de paymentStatus = paid.
 * Só roda depois que a API do Pagar.me confirmou um PIX pago.
 */
export async function markSandboxOrderPaidFromPix(input: {
  orderId: string;
  chargeId: string;
  providerOrderId: string | null;
  amountCents: number;
}): Promise<{ ok: true; alreadyProcessed: boolean }> {
  if (!/^[a-f0-9]{64}$/.test(input.orderId)) {
    throw new PaymentConfirmError("Pedido inválido.");
  }
  const orderRef = db.collection("orders").doc(input.orderId);
  const saleRef = db.collection("sales").doc(input.orderId);
  const commissionRef = db.collection("commissions").doc(input.orderId);
  const enrollmentRef = db.collection("enrollments").doc(input.orderId);
  const eventRef = db.collection("paymentEvents").doc(input.orderId);
  const studentRef = db.collection("students").doc(input.orderId);

  return db.runTransaction(async (tx) => {
    const [orderSnap, saleSnap, studentSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(saleRef),
      tx.get(studentRef),
    ]);
    const order = orderSnap.data();
    if (!order || order["environment"] !== "sandbox") {
      throw new PaymentConfirmError("Pedido indisponível.");
    }
    if (order["paymentStatus"] === "paid") {
      return { ok: true, alreadyProcessed: true };
    }
    if (
      order["paymentStatus"] !== "pending" ||
      order["gateway"] !== "pagarme" ||
      order["paymentMethod"] !== "pix" ||
      order["gatewayChargeId"] !== input.chargeId ||
      saleSnap.exists
    ) {
      throw new PaymentConfirmError("Pedido não está pendente neste PIX.");
    }
    const amount = order["amountCents"];
    const partnerId = order["partnerId"];
    const studentId = order["studentId"];
    if (
      amount !== input.amountCents ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      typeof partnerId !== "string" ||
      typeof studentId !== "string"
    ) {
      throw new PaymentConfirmError("Valor do PIX não confere com o pedido.");
    }
    const split = splitAmount(amount);
    const student = studentSnap.data();
    let oraculoPayload: unknown = null;
    if (student && order["integration"]) {
      try {
        const address = student["address"] as Record<string, unknown>;
        oraculoPayload = mapOraculoMatriculas({
          integration: order["integration"],
          valorContratoCents: amount,
          nome: String(student["fullName"] ?? ""),
          documentoAluno: String(student["document"] ?? ""),
          email: String(student["email"] ?? ""),
          celular: String(student["phone"] ?? ""),
          cep: String(address?.["zipCode"] ?? ""),
          endereco: String(address?.["street"] ?? ""),
          numero: String(address?.["number"] ?? ""),
          bairro: String(address?.["district"] ?? ""),
          estado: String(address?.["state"] ?? ""),
          cidade: String(address?.["city"] ?? ""),
          complemento: String(address?.["complement"] ?? ""),
          dataNasc: String(student["dateOfBirth"] ?? ""),
          cnh: String(student["cnh"] ?? ""),
          categoria: String(student["cnhCategory"] ?? ""),
          rg: typeof student["rg"] === "string" ? student["rg"] : "",
          renach: typeof student["renach"] === "string" ? student["renach"] : "",
        }).matriculas[0];
      } catch {
        oraculoPayload = null;
      }
    }
    tx.update(orderRef, {
      paymentStatus: "paid",
      paymentConfirmedAt: FieldValue.serverTimestamp(),
      commissionStatus: "recorded",
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(saleRef, {
      partnerId,
      courseId: order["courseId"],
      orderId: input.orderId,
      amount: amount / 100,
      commissionAmount: split.partner / 100,
      status: "paid",
      environment: "sandbox",
      simulated: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(commissionRef, {
      orderId: input.orderId,
      partnerId,
      amountCents: split.partner,
      percentage: 10,
      status: "sandbox",
      environment: "sandbox",
      payable: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(enrollmentRef, {
      orderId: input.orderId,
      studentId,
      partnerId,
      courseId: order["courseId"],
      referenceCode: order["referenceCode"],
      integration: order["integration"],
      status: "draft",
      externalEnrollmentId: null,
      submittedToIcetran: false,
      oraculoSubmitted: false,
      oraculoPayload,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(eventRef, {
      orderId: input.orderId,
      type: "charge.paid",
      environment: "sandbox",
      gateway: "pagarme",
      chargeId: input.chargeId,
      providerOrderId: input.providerOrderId,
      amountCents: amount,
      split,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, alreadyProcessed: false };
  });
}
