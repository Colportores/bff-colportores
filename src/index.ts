import { Hono } from "hono";
import { log } from "./lib/log";
import { requireAuth } from "./middleware/auth";
import { health } from "./routes/health";
import { me } from "./routes/me";
import type { AppEnv } from "./types";

/**
 * bff-colportores — adaptador sin estado entre la app móvil y Supabase (ADR-016).
 *
 * Reglas del repo:
 * - Valida el JWT y lo reenvía; la autoridad de permisos es la RLS.
 * - Sin lógica de dominio: vive en RPCs de Postgres o en los use cases de la app.
 * - Sin PII: no se persiste, no se cachea, no se loguea (Ley 18.331).
 *
 * Rutas:
 *   GET /health          público
 *   GET /v1/*            requieren JWT de Supabase Auth
 *   /v1/sync/*           (Sprint 3+) rutas del motor batch — dueño @BrunoFCapri (ADR-017)
 */
const app = new Hono<AppEnv>();

app.route("/health", health);

app.use("/v1/*", requireAuth);
app.route("/v1/me", me);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  log.error("NET", "UNHANDLED", "error no controlado", {
    metodo: c.req.method,
    path: new URL(c.req.url).pathname,
    error: err.message,
  });
  return c.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
