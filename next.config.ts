import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "*": ["./.data/**/*", "./artifacts/**/*", "./test-results/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      // Exceções só para arquivos do app instalável (sem dados). Entradas posteriores
      // sobrescrevem a mesma chave; todo o resto continua no-store.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      { source: "/manifest.webmanifest", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }] },
      { source: "/icons/:file", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
    ];
  },
};
export default config;
