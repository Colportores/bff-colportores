import { log } from "./log";

export const ESTADOS_CUENTA = ["ACTIVA", "PENDIENTE_ASIGNACION", "SUSPENDIDA"] as const;
export type EstadoCuenta = (typeof ESTADOS_CUENTA)[number];

/** Falla tipada: `status` y `codigo` son lo que `GET /v1/me` le devuelve a la app. */
export class EstadoCuentaError extends Error {
  constructor(
    readonly status: 401 | 404 | 502 | 504,
    readonly codigo:
      | "unauthorized"
      | "perfil_no_encontrado"
      | "upstream_error"
      | "upstream_timeout",
  ) {
    super(codigo);
  }
}

const TIMEOUT_MS = 5000;

/**
 * Llama al RPC `public.estado_cuenta()` (backend-supabase#18) con el JWT del usuario, que se reenvía
 * tal cual: la autoridad es la RLS/`SECURITY INVOKER`, no el BFF. `apikey` es la anon key pública del
 * proyecto (PostgREST la exige; sin JWT del usuario `anon` no tiene EXECUTE).
 */
export async function obtenerEstadoCuenta(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_ANON_KEY">,
  jwt: string,
): Promise<EstadoCuenta> {
  // Un secret olvidado en un entorno no debe parecer un JWT vencido (desloguearía a todos).
  if (!env.SUPABASE_ANON_KEY) {
    log.error("NET", "ANON_KEY_FALTANTE", "falta el binding SUPABASE_ANON_KEY");
    throw new EstadoCuentaError(502, "upstream_error");
  }
  let res: Response;
  try {
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/estado_cuenta`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    log.error("NET", "ESTADO_CUENTA_RED", "no se pudo llamar a estado_cuenta", {
      motivo: timeout ? "timeout" : "red",
    });
    throw new EstadoCuentaError(
      timeout ? 504 : 502,
      timeout ? "upstream_timeout" : "upstream_error",
    );
  }

  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof cuerpo?.code === "string" ? cuerpo.code : undefined;
    // Solo es "JWT del usuario inválido" si PostgREST lo dice con su code (PGRST301/303 = JWT,
    // 42501 = sin permiso). Un 401 sin code lo devuelve el gateway por una API key inválida:
    // es un problema de configuración nuestro, no del usuario.
    if (code === "42501" || code === "PGRST301" || code === "PGRST303") {
      throw new EstadoCuentaError(401, "unauthorized");
    }
    if (code === "P0002") throw new EstadoCuentaError(404, "perfil_no_encontrado");
    log.error("NET", "ESTADO_CUENTA_HTTP", "estado_cuenta respondió error", {
      status: res.status,
      code: code ?? null,
    });
    throw new EstadoCuentaError(502, "upstream_error");
  }

  const valor = await res.json().catch(() => null);
  if (!(ESTADOS_CUENTA as readonly unknown[]).includes(valor)) {
    log.error("NET", "ESTADO_CUENTA_VALOR", "valor de estado desconocido");
    throw new EstadoCuentaError(502, "upstream_error");
  }
  return valor as EstadoCuenta;
}
