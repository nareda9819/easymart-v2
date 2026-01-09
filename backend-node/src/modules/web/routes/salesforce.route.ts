import { FastifyInstance } from "fastify";
import { searchProducts } from "../../salesforce_adapter/products";
import { getCart } from "../../salesforce_adapter/cart";
import { logger } from '../../../modules/observability/logger';

export default async function salesforceTestRoute(app: FastifyInstance) {
  // GET / -> search products: ?q=term&limit=5
  app.get("/", async (req, reply) => {
    const q = (req.query as any)?.q || "";
    const limit = Number((req.query as any)?.limit || 5);
    try {
      const results = await searchProducts(q, limit);
      logger.info('Salesforce test search results', { query: q, limit, count: results?.length });
      if (Array.isArray(results) && results.length > 0) {
        logger.info('Salesforce sample product', { sample: results[0] });
      }
      return reply.send({ ok: true, query: q, limit, results });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  // GET /cart -> get current cart
  app.get("/cart", async (_req, reply) => {
    try {
      const cart = await getCart();
      return reply.send({ ok: true, cart });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });
}
