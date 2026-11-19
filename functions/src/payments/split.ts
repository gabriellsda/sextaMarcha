/** Divisão registrada no evento de pagamento. Não envia split ao provedor. */
export interface PaymentSplit {
  partner: number;
  sextaMarcha: number;
  icetran: number;
}

/** 10% parceiro, 20% Sexta Marcha, o restante ICETRAN. A soma fecha o valor em centavos. */
export function splitAmount(amountCents: number): PaymentSplit {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("Valor inválido para o split.");
  }
  const partner = Math.round(amountCents * 0.1);
  const sextaMarcha = Math.round(amountCents * 0.2);
  const icetran = amountCents - partner - sextaMarcha;
  return { partner, sextaMarcha, icetran };
}
