import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Rubric } from "../rubric/load.js";
import type { RunStore } from "../store/RunStore.js";
import { registerRunRoutes, type StartRun } from "./routes/runs.js";

export type AppDeps = {
  store: RunStore;
  rubric: Rubric;
  startRun: StartRun;
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

  registerRunRoutes(app, deps);

  return app;
}
