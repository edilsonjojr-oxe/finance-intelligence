const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Domínio de produção informado pela própria Vercel (variável de sistema, não controlada
 * pelo visitante). Aceito além de APP_ORIGIN para que um erro de digitação na configuração
 * não bloqueie o acesso; previews e outros domínios continuam exigindo APP_ORIGIN.
 */
export function platformOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const host = env.VERCEL === "1" ? env.VERCEL_PROJECT_PRODUCTION_URL?.trim() : "";
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;
  return `https://${host.toLowerCase()}`;
}

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
