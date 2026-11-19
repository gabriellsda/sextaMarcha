"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitAmount = splitAmount;
/** 10% parceiro, 20% Sexta Marcha, o restante ICETRAN. A soma fecha o valor em centavos. */
function splitAmount(amountCents) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error("Valor inválido para o split.");
    }
    const partner = Math.round(amountCents * 0.1);
    const sextaMarcha = Math.round(amountCents * 0.2);
    const icetran = amountCents - partner - sextaMarcha;
    return { partner, sextaMarcha, icetran };
}
