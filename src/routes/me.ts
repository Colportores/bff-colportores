import { Hono } from "hono";
import { EstadoCuentaError, obtenerEstadoCuenta } from "../lib/estado-cuenta";
import type { AppEnv } from "../types";

/**
 * `GET /v1/me` — identidad mínima del usuario autenticado (derivada del JWT) más `estado` de la
 * cuenta (`ACTIVA | PENDIENTE_ASIGNACION | SUSPENDIDA`, HU-AUTH-008), que sale del RPC
 * `estado_cuenta()` llamado con el JWT del usuario.
 *
 * Si el RPC falla no se devuelve una identidad sin estado: la app decidiría a ciegas. Errores:
 * 401 `unauthorized`, 404 `perfil_no_encontrado` (P0002), 502 `upstream_error`, 504 `upstream_timeout`.
 */
export const me = new Hono<AppEnv>().get("/", async (c) => {
  const { userId, role, claims } = c.get("auth");
  const jwt = c.req.header("Authorization")?.split(" ")[1] ?? "";
  try {
    const estado = await obtenerEstadoCuenta(c.env, jwt);
    return c.json({
      userId,
      role,
      expiraEn: typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null,
      estado,
    });
  } catch (err) {
    if (err instanceof EstadoCuentaError) return c.json({ error: err.codigo }, err.status);
    throw err;
  }
});
