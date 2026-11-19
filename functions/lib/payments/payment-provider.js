"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagarmePaymentProvider = void 0;
const pagarme_pix_1 = require("./pagarme-pix");
class PagarmePaymentProvider {
    apiKey;
    name = "pagarme";
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async createCheckout(_request) {
        throw new Error("Checkout de cartão, boleto e link hospedado não está habilitado. Use o PIX.");
    }
    async createPixCharge(request) {
        return (0, pagarme_pix_1.createPagarmePixCharge)(this.apiKey, request);
    }
    async getPayment(providerChargeId) {
        const charge = await (0, pagarme_pix_1.getPagarmeCharge)(this.apiKey, providerChargeId);
        if (charge.status === "paid" ||
            charge.status === "pending" ||
            charge.status === "failed" ||
            charge.status === "canceled") {
            return charge.status;
        }
        return "pending";
    }
}
exports.PagarmePaymentProvider = PagarmePaymentProvider;
