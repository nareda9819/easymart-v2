import { FastifyInstance } from "fastify";
import chatRoute from "./routes/chat.route";
import healthRoute from "./routes/health.route";
import catalogRoute from "./routes/catalog.route";
import cartRoute from "./routes/cart.route";
import salesforceTestRoute from "./routes/salesforce.route";
import salesforceCartRoute from "./routes/salesforce-cart.route";
import mediaRoute from "./routes/media.route";

export async function registerWebModule(app: FastifyInstance) {
  await app.register(chatRoute, { prefix: "/api/chat" });
  await app.register(healthRoute, { prefix: "/api" });
  await app.register(catalogRoute); // Internal catalog endpoints
  await app.register(cartRoute); // Cart endpoints
  await app.register(salesforceTestRoute, { prefix: "/api/internal/test/salesforce" });
  await app.register(salesforceCartRoute, { prefix: "/api/salesforce-cart" });
  await app.register(mediaRoute, { prefix: "/api/media/salesforce" }); // Salesforce media proxy
  // Widget static files are served by @fastify/static in server.ts
}
