import { describe, expect, it } from "vitest";
import { isAllowedRequestOrigin, platformOrigin } from "../src/server/request-origin";

const requestUrl = "http://localhost:3000/api/auth";
describe("Origem das gravações", () => {
  it("aceita 127.0.0.1 quando Next reconstrói a URL com localhost", () => {
    expect(isAllowedRequestOrigin("http://127.0.0.1:3000", requestUrl)).toBe(
      true,
    );
  });
  it("aceita localhost e loopback IPv6 na mesma porta", () => {
    for (const host of ["localhost", "[::1]"]) {
      expect(isAllowedRequestOrigin(`http://${host}:3000`, requestUrl)).toBe(
        true,
      );
    }
  });
  it("preserva a porta de servidores locais de teste", () => {
    expect(
      isAllowedRequestOrigin(
        "http://127.0.0.1:3001",
        "http://localhost:3001/api/auth",
      ),
    ).toBe(true);
  });
  it("rejeita outra porta ou protocolo", () => {
    for (const origin of ["http://127.0.0.1:3001", "https://127.0.0.1:3000"]) {
      expect(isAllowedRequestOrigin(origin, requestUrl)).toBe(false);
    }
  });
  it("rejeita domínio externo, nomes parecidos e origens inválidas", () => {
    for (const origin of [
      null,
      "null",
      "",
      "https://untrusted.invalid",
      "http://localhost.untrusted.invalid:3000",
      "http://127.0.0.2:3000",
      "http://127.0.0.1:3000/path",
      "http://user@127.0.0.1:3000",
      "not-a-url",
    ]) {
      expect(isAllowedRequestOrigin(origin, requestUrl)).toBe(false);
    }
  });
  it("não autoriza endereço público sem configuração explícita", () => {
    expect(
      isAllowedRequestOrigin(
        "https://finance.example",
        "https://finance.example/api/auth",
      ),
    ).toBe(false);
  });
  it("APP_ORIGIN explícita prevalece sobre a URL interna", () => {
    expect(
      isAllowedRequestOrigin(
        "https://finance.example",
        requestUrl,
        "https://finance.example/",
      ),
    ).toBe(true);
    expect(
      isAllowedRequestOrigin(
        "http://127.0.0.1:3000",
        requestUrl,
        "https://finance.example",
      ),
    ).toBe(false);
    expect(
      isAllowedRequestOrigin(
        "https://untrusted.invalid",
        requestUrl,
        "https://finance.example",
      ),
    ).toBe(false);
  });
  it("não expande aliases quando APP_ORIGIN é explícita", () => {
    expect(
      isAllowedRequestOrigin(
        "http://localhost:3000",
        requestUrl,
        "http://127.0.0.1:3000",
      ),
    ).toBe(false);
  });
  it("rejeita configuração malformada", () => {
    for (const configured of [
      "invalid",
      "https://finance.example/path",
      "https://user@finance.example",
      "https://finance.example/#fragment",
    ]) {
      expect(
        isAllowedRequestOrigin(
          "https://finance.example",
          requestUrl,
          configured,
        ),
      ).toBe(false);
    }
  });
});

describe("Domínio de produção da Vercel", () => {
  it("usa VERCEL_PROJECT_PRODUCTION_URL somente na Vercel e com host válido", () => {
    expect(platformOrigin({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "app-8onn.vercel.app" })).toBe("https://app-8onn.vercel.app");
    expect(platformOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "app.vercel.app" })).toBeNull();
    for (const host of ["", "localhost", "app.vercel.app/path", "user@app.vercel.app", "app.vercel.app:3000"]) {
      expect(platformOrigin({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: host })).toBeNull();
    }
  });
});
