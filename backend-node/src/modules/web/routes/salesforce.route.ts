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
      
      // Try to get webstoreId from WebStore object
      let webstoreId = null;
      try {
        const wsSoql = `SELECT Id, Name FROM WebStore LIMIT 1`;
        const webstoreResp = await client.get(`/services/data/${apiVersion}/query`, {
          params: { q: wsSoql },
        });
        webstoreId = webstoreResp.data?.records?.[0]?.Id;
      } catch (e: any) {
        // ignore
      }
      
      // Query ManagedContentVariant - this is what CMS uses for media
      let managedContentResp = null;
      try {
        const pmRecords = productMediaResp?.data?.records || [];
        if (pmRecords.length > 0) {
          const firstEmId = pmRecords[0].ElectronicMediaId;
          // Try querying ManagedContentVariant
          const mcSoql = `SELECT Id, Name, ManagedContentId, ContentKey FROM ManagedContentVariant WHERE Id = '${firstEmId}'`;
          managedContentResp = await client.get(`/services/data/${apiVersion}/query`, {
            params: { q: mcSoql },
          });
        }
      } catch (e: any) {
        managedContentResp = { error: e.message };
      }
      
      // Try to get direct CMS content endpoint  
      let cmsContentResp = null;
      if (webstoreId) {
        try {
          const pmRecords = productMediaResp?.data?.records || [];
          if (pmRecords.length > 0) {
            const firstEmId = pmRecords[0].ElectronicMediaId;
            // Try the CMS endpoint for managed content
            cmsContentResp = await client.get(`/services/data/${apiVersion}/connect/cms/contents/${firstEmId}`);
          }
        } catch (e: any) {
          cmsContentResp = { error: e.message };
        }
      }
      
      // Query Product2 fields directly to see if image URL is in a field
      let product2Resp = null;
      try {
        const p2Soql = `SELECT Id, Name, Description, (SELECT Id, ElectronicMediaId FROM ProductMedia) FROM Product2 WHERE Id = '${productId}'`;
        product2Resp = await client.get(`/services/data/${apiVersion}/query`, {
          params: { q: p2Soql },
        });
      } catch (e: any) {
        product2Resp = { error: e.message };
      }
      
      return reply.send({
        ok: true,
        productId,
        webstoreId,
        productMedia: productMediaResp?.data || productMediaResp,
        managedContent: managedContentResp?.data || managedContentResp,
        cmsContent: cmsContentResp?.data || cmsContentResp,
        product2: product2Resp?.data || product2Resp
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
