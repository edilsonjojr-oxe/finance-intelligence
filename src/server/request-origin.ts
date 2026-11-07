const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Produção pública exige APP_ORIGIN explícita. Sem configuração, apenas os
 * endereços locais conhecidos, no mesmo protocolo e porta, são autorizados.
 * Next.js pode reconstruir request.url com localhost ao receber 127.0.0.1.
 * Host e X-Forwarded-* não são usados para ampliar a lista de origens.
 */
export function isAllowedRequestOrigin(
  origin: string | null,
  requestUrl: string,
  configuredOrigin?: string,
): boolean {
  if (!origin || origin === "null") return false;
  try {
    const source = new URL(origin);
    if (
      !["http:", "https:"].includes(source.protocol) ||
      source.origin !== origin
    )
      return false;

    if (configuredOrigin) {
      const configured = new URL(configuredOrigin);
      if (
        configured.username ||
        configured.password ||
        configured.search ||
        configured.hash ||
        configured.pathname !== "/"
      )
        return false;
      return source.origin === configured.origin;
    }

    const target = new URL(requestUrl);
    return (
      loopbackHosts.has(target.hostname) &&
      loopbackHosts.has(source.hostname) &&
      source.protocol === target.protocol &&
      source.port === target.port
    );
  } catch {
    return false;
  }
}
