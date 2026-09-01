import { Hono } from "hono";
import type { AppEnv } from "../types";

/**
 * `GET /v1/me` — identidad mínima del usuario autenticado, derivada del JWT.
 *
 * Es la ruta de referencia para las que vienen: muestra cómo se lee `c.get("auth")` después de
 * `requireAuth`. No consulta Supabase; los datos de perfil (nombre, roles) llegan en Sprint 3 con
 * las HU de auth.
 */
export const me = new Hono<AppEnv>().get("/", (c) => {
  const { userId, role, claims } = c.get("auth");
  return c.json({
    userId,
    role,
    expiraEn: typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null,
  });
});
