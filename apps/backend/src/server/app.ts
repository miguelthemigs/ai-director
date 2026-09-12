import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { RunEventBus } from "../orchestrate/events.js";
import type { Rubric } from "../rubric/load.js";
import type { RunStore } from "../store/RunStore.js";
import type { VersionStore } from "../store/VersionStore.js";
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
};

const DEV_ORIGIN = "http://localhost:5173";

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();

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

  return app;
}
