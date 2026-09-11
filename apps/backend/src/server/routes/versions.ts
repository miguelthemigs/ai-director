import type { FastifyInstance } from "fastify";
import type { VersionStore } from "../../store/VersionStore.js";

export type VersionRouteDeps = {
  versionStore: VersionStore;
};

export function registerVersionRoutes(app: FastifyInstance, deps: VersionRouteDeps): void {
  app.get("/versions", async () => {
    return deps.versionStore.list();
  });

  app.get<{ Querystring: { a?: string; b?: string } }>("/versions/compare", async (request, reply) => {
    const { a, b } = request.query;
    if (!a || !b) {
      return reply.code(400).send({ error: 'both "a" and "b" query parameters are required' });
    }

    try {
      return await deps.versionStore.compare(a, b);
    } catch (err) {
      // Only a "not found" from the store becomes a 404 -- anything else
      // (e.g. a corrupt notes.json) is a real failure and must surface as a
      // 500 through the app's error handler, not be masked as "unknown id".
      if (err instanceof Error && /not found/.test(err.message)) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });
}
