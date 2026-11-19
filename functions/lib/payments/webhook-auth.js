"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBHOOK_BASIC_USER = void 0;
exports.webhookAuthorized = webhookAuthorized;
const node_crypto_1 = require("node:crypto");
/**
 * Usuário Basic que deve ser configurado no hook do Pagar.me.
 * A senha é o segredo PAGARME_WEBHOOK_SECRET, nunca um valor fixo neste arquivo.
 */
exports.WEBHOOK_BASIC_USER = "sexta-marcha";
function same(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(a, b);
}
/** Sem segredo, ou com senha diferente, a resposta é não autenticado. */
function webhookAuthorized(authorization, secret) {
    const password = typeof secret === "string" ? secret.trim() : "";
    if (!password || !authorization?.startsWith("Basic "))
        return false;
    let decoded = "";
    try {
        decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
    }
    catch {
        return false;
    }
    const separator = decoded.indexOf(":");
    if (separator < 0)
        return false;
    const user = decoded.slice(0, separator);
    const given = decoded.slice(separator + 1);
    return same(user, exports.WEBHOOK_BASIC_USER) && same(given, password);
}
