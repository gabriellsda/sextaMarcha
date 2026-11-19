"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readChargePaid = readChargePaid;
function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
/**
 * Lê o POST do webhook. Não marca pedido como pago.
 * charge.paid de PIX segue para confirmação na API. Outros eventos são ignorados.
 */
function readChargePaid(body) {
    const event = record(body);
    if (!event)
        return { action: "reject", reason: "Evento ausente." };
    const rawType = event["type"];
    const type = typeof rawType === "string" ? rawType : "";
    if (!type)
        return { action: "reject", reason: "Evento ausente." };
    if (type !== "charge.paid")
        return { action: "ignore" };
    const data = record(event["data"]);
    if (!data)
        return { action: "reject", reason: "Cobrança ausente." };
    const chargeId = typeof data["id"] === "string" ? data["id"].trim() : "";
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(chargeId)) {
        return { action: "reject", reason: "Cobrança ausente." };
    }
    const method = typeof data["payment_method"] === "string"
        ? data["payment_method"].toLowerCase()
        : "";
    if (method && method !== "pix") {
        return { action: "reject", reason: "Somente PIX confirma o pedido." };
    }
    const status = typeof data["status"] === "string" ? data["status"].toLowerCase() : "";
    if (status && status !== "paid")
        return { action: "ignore" };
    return { action: "confirm_with_provider", chargeId };
}
