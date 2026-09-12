import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { RunEventBus } from "../orchestrate/events.js";
import type { Rubric } from "../rubric/load.js";
import type { RunStore } from "../store/RunStore.js";
import type { VersionStore } from "../store/VersionStore.js";
import { registerAvatarRoutes, type AvatarRouteDeps } from "./routes/avatar.js";
import { registerRunRoutes, type StartRun } from "./routes/runs.js";
import { registerVersionRoutes } from "./routes/versions.js";

export type AppDeps = {
  store: RunStore;
  rubric: Rubric;
  startRun: StartRun;
  versionStore: VersionStore;
  // Optional so every existing caller (including this file's own tests)
  // that builds an app without a bus keeps working unchanged -- a fresh one
  // is created here in that case. A real server passes its own instance so
  // the same bus that `startRun` publishes to is the one `GET
  // /runs/:id/events` subscribes to.
  bus?: RunEventBus;
  /** The Mentic-pipeline transports. Optional, and absent is a real state rather than a
   *  misconfiguration: a server with no GOOGLE_AI_KEY still grades descriptions perfectly
   *  well, it just cannot render a sheet, and `/avatar/*` says so with a 503 instead of
   *  failing somewhere deeper with a provider error. */
  avatar?: AvatarRouteDeps;
};

const DEV_ORIGIN = "http://localhost:5173";

/**
 * 12MB, against Fastify's 1MB default.
 *
 * `/avatar/describe` carries a character reference sheet as base64 JSON. Mentic renders
 * those at 2K, which is several megabytes before base64 adds its third, so on the default
 * limit every real sheet was rejected with a bare 413 and no route ever saw it. This
 * number sits above `/avatar/describe`'s own 8MB cap on the image field, so an oversized
 * image is refused by that route with a reason the caller can read, and this limit is only
 * the outer guard against a body that is not an image at all.
 */
const BODY_LIMIT_BYTES = 12 * 1024 * 1024;

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: BODY_LIMIT_BYTES });

  app.register(cors, { origin: DEV_ORIGIN });

  // A flat, minimal JSON body on every error path -- never Fastify's default
  // error payload, which can include the error's `stack`. Logged server-side
  // (so a real failure is still visible somewhere) but never handed to the
  // client.
  app.setErrorHandler((err: FastifyError, _request, reply) => {
    app.log.error(err);
    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
    const message = statusCode < 500 ? err.message : "internal server error";
    reply.code(statusCode).send({ error: message });
  });

  registerRunRoutes(app, { ...deps, bus: deps.bus ?? new RunEventBus() });
  registerVersionRoutes(app, { versionStore: deps.versionStore });
  registerAvatarRoutes(app, deps.avatar ?? {});

  return app;
}
