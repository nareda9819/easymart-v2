import { FastifyInstance } from "fastify";
import { searchProducts } from "../../salesforce_adapter/products";
import { getCart } from "../../salesforce_adapter/cart";
import { logger } from '../../../modules/observability/logger';
import { salesforceClient } from '../../salesforce_adapter/client';
import { config } from '../../../config/env';
import { getProductContentVersions } from '../../salesforce_adapter/media';

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

  // GET /raw -> proxy raw Apex response for debugging
  app.get("/raw", async (req, reply) => {
    const q = (req.query as any)?.q || "";
    const limit = Number((req.query as any)?.limit || 5);
    try {
      const client = salesforceClient.getClient();
      const payload = { query: q, pageSize: limit };
      const resp = await client.post('/services/apexrest/commerce/search', payload);
      logger.info('Salesforce raw Apex response fetched', { query: q, status: resp.status });
      return reply.send({ ok: true, query: q, limit, raw: resp.data });
    } catch (err: any) {
      logger.error('Failed to fetch raw Apex response', { message: err.message, status: err?.response?.status });
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  // GET /debug-files/:productId -> check ContentDocumentLink for a product
  app.get("/debug-files/:productId", async (req, reply) => {
    const productId = (req.params as any).productId;
    try {
      const client = salesforceClient.getClient();
      const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';
      
      // Query ContentDocumentLink
      const linkSoql = `SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${productId}'`;
      const linkResp = await client.get(`/services/data/${apiVersion}/query`, {
        params: { q: linkSoql },
      });
      
      // Query ProductMedia (Commerce Cloud specific)
      let productMediaResp = null;
      try {
        const pmSoql = `SELECT Id, ProductId, ElectronicMediaId, ElectronicMediaGroupId FROM ProductMedia WHERE ProductId = '${productId}'`;
        productMediaResp = await client.get(`/services/data/${apiVersion}/query`, {
          params: { q: pmSoql },
        });
      } catch (e: any) {
        productMediaResp = { error: e.message };
      }
      
      // Describe ElectronicMedia object to see available fields
      let emDescribe = null;
      try {
        emDescribe = await client.get(`/services/data/${apiVersion}/sobjects/ElectronicMedia/describe`);
        emDescribe = { fields: (emDescribe.data?.fields || []).map((f: any) => ({ name: f.name, type: f.type })) };
      } catch (e: any) {
        emDescribe = { error: e.message };
      }
      
      // Query ElectronicMedia for the linked media - try different fields
      let electronicMediaResp = null;
      try {
        const pmRecords = productMediaResp?.data?.records || [];
        if (pmRecords.length > 0) {
          const firstEmId = pmRecords[0].ElectronicMediaId;
          // Query a single record to see what fields have values
          const emSoql = `SELECT Id, Name FROM ElectronicMedia WHERE Id = '${firstEmId}'`;
          electronicMediaResp = await client.get(`/services/data/${apiVersion}/query`, {
            params: { q: emSoql },
          });
        }
      } catch (e: any) {
        electronicMediaResp = { error: e.message };
      }
      
      // Also get ContentVersions
      const contentVersions = await getProductContentVersions(productId);
      
      return reply.send({
        ok: true,
        productId,
        contentDocumentLinks: linkResp.data,
        productMedia: productMediaResp?.data || productMediaResp,
        electronicMediaDescribe: emDescribe,
        electronicMedia: electronicMediaResp?.data || electronicMediaResp,
        contentVersions
      });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message, stack: err.stack });
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
