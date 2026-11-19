import { timingSafeEqual } from "node:crypto";

/**
 * Usuário Basic que deve ser configurado no hook do Pagar.me.
 * A senha é o segredo PAGARME_WEBHOOK_SECRET, nunca um valor fixo neste arquivo.
 */
export const WEBHOOK_BASIC_USER = "sexta-marcha";

function same(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Sem segredo, ou com senha diferente, a resposta é não autenticado. */
export function webhookAuthorized(
  authorization: string | undefined,
  secret: string | undefined,
): boolean {
  const password = typeof secret === "string" ? secret.trim() : "";
  if (!password || !authorization?.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString(
      "utf8",
    );
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const user = decoded.slice(0, separator);
  const given = decoded.slice(separator + 1);
  return same(user, WEBHOOK_BASIC_USER) && same(given, password);
}
