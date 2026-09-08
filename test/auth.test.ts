import { env, SELF } from "cloudflare:test";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

const USER_ID = "01920000-0000-7000-8000-000000000001"; // UUID v7 de prueba

interface OpcionesToken {
  secreto?: string;
  issuer?: string;
  audience?: string;
  expiracion?: string | number;
  sub?: string | null;
}

async function tokenDePrueba(opts: OpcionesToken = {}): Promise<string> {
  const clave = new TextEncoder().encode(opts.secreto ?? env.SUPABASE_JWT_SECRET);
  const jwt = new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(opts.issuer ?? `${env.SUPABASE_URL}/auth/v1`)
    .setAudience(opts.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.expiracion ?? "1h");
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? USER_ID);
  return jwt.sign(clave);
}

function get(path: string, token?: string): Promise<Response> {
  return SELF.fetch(`https://bff.test${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /v1/me", () => {
  describe("cuando no hay header Authorization", () => {
    it("responde 401", async () => {
      const res = await get("/v1/me");
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "unauthorized" });
    });
  });

  describe("cuando el header no es Bearer", () => {
    it("responde 401", async () => {
      const res = await SELF.fetch("https://bff.test/v1/me", {
        headers: { Authorization: "Basic abc" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("cuando el token está firmado con otra clave", () => {
    it("responde 401", async () => {
      const token = await tokenDePrueba({
        secreto: "otra-clave-que-no-es-la-del-proyecto-xxxxxxxx",
      });
      const res = await get("/v1/me", token);
      expect(res.status).toBe(401);
    });
  });

  describe("cuando el token expiró", () => {
    it("responde 401", async () => {
      const token = await tokenDePrueba({ expiracion: Math.floor(Date.now() / 1000) - 60 });
      const res = await get("/v1/me", token);
      expect(res.status).toBe(401);
    });
  });

  describe("cuando el emisor no es el proyecto Supabase configurado", () => {
    it("responde 401", async () => {
      const token = await tokenDePrueba({ issuer: "https://otro.supabase.co/auth/v1" });
      const res = await get("/v1/me", token);
      expect(res.status).toBe(401);
    });
  });

  describe("cuando el token no trae sub", () => {
    it("responde 401", async () => {
      const token = await tokenDePrueba({ sub: null });
      const res = await get("/v1/me", token);
      expect(res.status).toBe(401);
    });
  });

  describe("cuando el token es válido", () => {
    it("responde 200 con el userId del sub y el rol", async () => {
      const token = await tokenDePrueba();
      const res = await get("/v1/me", token);

      expect(res.status).toBe(200);
      const body = await res.json<{ userId: string; role: string; expiraEn: string | null }>();
      expect(body.userId).toBe(USER_ID);
      expect(body.role).toBe("authenticated");
      expect(body.expiraEn).not.toBeNull();
    });
  });
});
