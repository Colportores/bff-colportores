# bff-colportores

> **Implementación futura:** diferido por tiempo (decisión 02/10). En la Fase 1 los clientes hablan directo con Supabase; ver [ADR-013](https://github.com/Colportores/docs-organizacion/blob/feature/adr-013-rpc-directo/docs/decisiones/ADR-013-clientes-directo-a-rpc-de-supabase.md) ([docs-organizacion#22](https://github.com/Colportores/docs-organizacion/pull/22)).

BFF de la app móvil de colportores ([front-colportores-mobile](https://github.com/Colportores/front-colportores-mobile)), como Worker de Cloudflare.

**Estado: esqueleto (Sprint 1)** — Worker con Hono, validación de JWT de Supabase Auth, tests dentro de workerd y CI. Las rutas de negocio llegan con las HU de cada sprint.

## Contexto

Parte del sistema [Colportaje App](https://github.com/Colportores). La arquitectura, los flujos y las decisiones viven en la [documentación de la organización](https://github.com/Colportores/docs-organizacion).

- Es un **adaptador sin estado** ([ADR-016](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-016-bff-por-aplicacion.md)): valida el JWT de Supabase Auth, lo reenvía a RPCs o vistas de Postgres y da forma a la respuesta. No tiene base propia y no contiene lógica de dominio.
- **La autoridad de permisos es la RLS**, no este Worker.
- Stack: Cloudflare Workers + TypeScript + [Hono](https://hono.dev) + [jose](https://github.com/panva/jose). Tests con `@cloudflare/vitest-pool-workers` (corren en workerd, no en Node).
- Backend: [backend-supabase](https://github.com/Colportores/backend-supabase) ([ADR-002](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-002-proveedor-cloud.md)).

### Alcance

Recibe los lotes del motor batch de sincronización ([ADR-006](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-006-arquitectura-sync.md)) y sirve catálogos, estructura territorial y estado de ubicaciones.

**Fuera de este BFF:** las suscripciones de Supabase Realtime, el backup cifrado a Google Drive ([ADR-003](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-003-backup-y-cifrado.md)) y la descarga de PMTiles ([ADR-004](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-004-osm-offline.md)) van directo, sin pasar por acá.

## Rutas

| Ruta | Auth | Qué hace |
|---|---|---|
| `GET /health` | no | Liveness: `{ status, servicio, entorno }` |
| `GET /v1/me` | JWT | Identidad mínima (`userId`, `role`, `expiraEn`) más `estado` de la cuenta: `ACTIVA`, `PENDIENTE_ASIGNACION` o `SUSPENDIDA` (RPC `estado_cuenta()` con el JWT del usuario, HU-AUTH-008). Errores: `401 unauthorized`, `404 perfil_no_encontrado`, `502 upstream_error`, `504 upstream_timeout`. Requiere `SUPABASE_ANON_KEY` (clave pública, header `apikey` de PostgREST) en `.dev.vars` o `wrangler secret put`. |
| `/v1/sync/*` | JWT | *(Sprint 3+)* rutas del motor batch — dueño `@BrunoFCapri` ([ADR-017](https://github.com/Colportores/docs-organizacion/blob/main/docs/decisiones/ADR-017-sync-engine-paquete.md)) |

Todo `/v1/*` pasa por `requireAuth` (`src/middleware/auth.ts`): exige `Authorization: Bearer <jwt>` emitido por Supabase Auth del proyecto configurado en `SUPABASE_URL`. Verifica firma (JWKS del proyecto, o HS256 si se define `SUPABASE_JWT_SECRET` en proyectos legacy), emisor, audiencia `authenticated` y expiración. Nada más: los permisos los decide la RLS con ese mismo JWT.

## Desarrollo

Todo corre en Docker; no hace falta Node en el host.

```sh
docker compose -f compose.dev.yml build                       # una vez, y al cambiar package.json
docker compose -f compose.dev.yml up                          # wrangler dev → http://localhost:8787
docker compose -f compose.dev.yml run --rm bff npm run check  # lint + typecheck + tests con coverage
docker compose -f compose.dev.yml run --rm bff npm test       # solo tests
docker compose -f compose.dev.yml run --rm bff npm run types  # regenerar worker-configuration.d.ts
```

- **Imagen y cachés compartidas.** `-p <nombre>` propio está bien para aislar contenedores y `node_modules`; la imagen (`bff-colportores-dev:latest`) es compartida por todos los proyectos.
  `docker compose build` solo cuando cambia `dockerfile.dev`.
- `dockerfile.dev` define la imagen; `node_modules` vive en un volumen nombrado (no en el host).
- Secretos locales en `.dev.vars` (copiar de `.dev.vars.example`; ignorado por git). Config no secreta en `wrangler.jsonc → vars`.
- `worker-configuration.d.ts` lo genera `wrangler types` y **se commitea**; CI verifica que esté al día. Nunca escribir la interfaz `Env` a mano.
- Formato y lint: Biome (`npm run lint:fix`). Línea de 100, comillas dobles, `noFloatingPromises` como error.

### Estructura

```
src/
├── index.ts            ← app Hono, montaje de rutas, manejo de errores
├── types.ts            ← AppEnv (Bindings = Env generado, Variables = contexto de auth)
├── middleware/auth.ts  ← requireAuth + verificarJwtSupabase
├── routes/             ← un archivo por recurso (health, me, …)
└── lib/log.ts          ← logger JSON [NIVEL][MÓDULO][OPERACIÓN] (convenciones §7)
test/                   ← integración vía SELF.fetch; naming "cuando … → responde …"
```

## CI/CD

- `ci.yml` (PR y push a `develop`/`staging`/`production`): `wrangler types --check`, lint, typecheck, tests con umbral de cobertura, `wrangler deploy --dry-run`.
- `deploy.yml` (push a `staging`/`production`): `wrangler deploy --env <rama>`. Requiere los secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el *environment* de GitHub homónimo, y reemplazar las `SUPABASE_URL` de `wrangler.jsonc → env.*`.

## Privacidad

Los datos personales de clientes (`persona.nombre`, `persona.apellido`, `persona.telefono`, `nota.texto`) son **local-only**: viven solo en el dispositivo del colportor y nunca llegan al cloud, por la Ley 18.331 de Uruguay. Ver [`02-restricciones.md`](https://github.com/Colportores/docs-organizacion/blob/main/docs/02-restricciones.md). Este repositorio no puede almacenarlos, transportarlos ni loguearlos: el logger solo admite UUIDs y metadatos, y ningún handler debe volcar un payload completo a los logs.

## Licencia

Uso propio — todos los derechos reservados. Ver [LICENSE](./LICENSE).
