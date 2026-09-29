import { env, SELF } from "cloudflare:test";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function token(): Promise<string> {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(`${env.SUPABASE_URL}/auth/v1`)
    .setAudience("authenticated")
    .setSubject("01920000-0000-7000-8000-000000000001")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.SUPABASE_JWT_SECRET));
}

async function me(jwt: string) {
  const res = await SELF.fetch("https://bff.test/v1/me", {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  return { status: res.status, body: await res.json<Record<string, unknown>>() };
}

describe("GET /v1/me — estado de la cuenta", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["ACTIVA", "PENDIENTE_ASIGNACION", "SUSPENDIDA"])(
    "devuelve estado %s",
    async (estado) => {
      fetchMock.mockImplementation(async () => Response.json(estado));
      const { status, body } = await me(await token());
      expect(status).toBe(200);
      expect(body.estado).toBe(estado);
      expect(body.userId).toBe("01920000-0000-7000-8000-000000000001");
    },
  );

  it("llama al RPC con POST {}, la anon key y el JWT del usuario reenviado", async () => {
    fetchMock.mockImplementation(async () => Response.json("ACTIVA"));
    const jwt = await token();
    await me(jwt);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${env.SUPABASE_URL}/rest/v1/rpc/estado_cuenta`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${jwt}`);
    expect(headers.apikey).toBe(env.SUPABASE_ANON_KEY);
  });

  it("42501 (403) -> 401 unauthorized", async () => {
    fetchMock.mockImplementation(async () => Response.json({ code: "42501" }, { status: 403 }));
    expect(await me(await token())).toEqual({ status: 401, body: { error: "unauthorized" } });
  });

  it("P0002 (sin perfil) -> 404 perfil_no_encontrado", async () => {
    fetchMock.mockImplementation(async () => Response.json({ code: "P0002" }, { status: 404 }));
    expect(await me(await token())).toEqual({
      status: 404,
      body: { error: "perfil_no_encontrado" },
    });
  });

  it("5xx -> 502 upstream_error", async () => {
    fetchMock.mockImplementation(async () => new Response("boom", { status: 503 }));
    expect(await me(await token())).toEqual({ status: 502, body: { error: "upstream_error" } });
  });

  it("error de red -> 502 upstream_error", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    expect(await me(await token())).toEqual({ status: 502, body: { error: "upstream_error" } });
  });

  it("timeout -> 504 upstream_timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect(await me(await token())).toEqual({ status: 504, body: { error: "upstream_timeout" } });
  });

  it("valor desconocido -> 502 upstream_error", async () => {
    fetchMock.mockImplementation(async () => Response.json("OTRA"));
    expect(await me(await token())).toEqual({ status: 502, body: { error: "upstream_error" } });
  });
});
