import { FastifyInstance } from "fastify";
import { searchProducts } from "../../salesforce_adapter/products";
import { getCart } from "../../salesforce_adapter/cart";
import { logger } from '../../../modules/observability/logger';
import { salesforceClient } from '../../salesforce_adapter/client';
import { config } from '../../../config/env';
import { getCmsChannelId, getProductImageUrls } from '../../salesforce_adapter/media';

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
      
      // Query ProductMedia with ALL fields
      let productMediaResp = null;
      try {
        // First describe ProductMedia to get all fields
        const pmDescResp = await client.get(`/services/data/${apiVersion}/sobjects/ProductMedia/describe`);
        const pmFields = (pmDescResp.data?.fields || []).map((f: any) => f.name).join(', ');
        
        // Query with all fields
        const pmSoql = `SELECT ${pmFields} FROM ProductMedia WHERE ProductId = '${productId}' LIMIT 1`;
        productMediaResp = await client.get(`/services/data/${apiVersion}/query`, {
          params: { q: pmSoql },
        });
        productMediaResp = { allFields: pmFields, record: productMediaResp.data?.records?.[0] };
      } catch (e: any) {
        productMediaResp = { error: e.message };
      }
      
      // Get the ElectronicMediaId and try to fetch it directly via sobject API
      let emSobjectResp = null;
      try {
        const pmRecord = productMediaResp?.record;
        if (pmRecord?.ElectronicMediaId) {
          const emId = pmRecord.ElectronicMediaId;
          // Try to get the sobject directly
          emSobjectResp = await client.get(`/services/data/${apiVersion}/sobjects/ElectronicMedia/${emId}`);
          emSobjectResp = emSobjectResp.data;
        }
      } catch (e: any) {
        emSobjectResp = { error: e.message };
      }
      
      // Try describing ElectronicMedia using different object type prefix
      // 20Y prefix is ManagedContentVariant
      let mcvResp = null;
      try {
        const pmRecord = productMediaResp?.record;
        if (pmRecord?.ElectronicMediaId) {
          const emId = pmRecord.ElectronicMediaId;
          // Try ManagedContentVariant
          mcvResp = await client.get(`/services/data/${apiVersion}/sobjects/ManagedContentVariant/${emId}`);
          mcvResp = mcvResp.data;
        }
      } catch (e: any) {
        mcvResp = { error: e.message };
      }
      
      // List all sobjects to find what 20Y prefix is
      let sobjectList = null;
      try {
        const resp = await client.get(`/services/data/${apiVersion}/sobjects`);
        // Find objects that might be related to media
        const mediaRelated = (resp.data?.sobjects || []).filter((s: any) => 
          s.name.toLowerCase().includes('media') || 
          s.name.toLowerCase().includes('content') ||
          s.keyPrefix === '20Y'
        ).map((s: any) => ({ name: s.name, keyPrefix: s.keyPrefix }));
        sobjectList = mediaRelated;
      } catch (e: any) {
        sobjectList = { error: e.message };
      }
      
      // Try CMS channel and getProductImageUrls
        // Also gather ManagedContent Name(s) for ProductMedia entries (Shopify path may be stored in Name)
        let managedContentNames: any = null;
        try {
          const pmListSoql = `SELECT ElectronicMediaId FROM ProductMedia WHERE ProductId = '${productId}'`;
          const pmListResp = await client.get(`/services/data/${apiVersion}/query`, { params: { q: pmListSoql } });
          const pmList = pmListResp.data?.records || [];
          const emIds = pmList.map((r: any) => r.ElectronicMediaId).filter(Boolean);
          if (emIds.length > 0) {
            managedContentNames = [];
            for (const emId of emIds) {
              try {
                const mcSobj = await client.get(`/services/data/${apiVersion}/sobjects/ManagedContent/${emId}`);
                managedContentNames.push(mcSobj.data || null);
              } catch (e: any) {
                managedContentNames.push({ id: emId, error: e.message, status: e.response?.status });
              }
            }
          } else {
            managedContentNames = [];
          }
        } catch (e: any) {
          managedContentNames = { error: e.message };
        }

        let cmsInfo = null;
      try {
        const channelId = await getCmsChannelId();
        const imageUrls = await getProductImageUrls(productId);
        
        // Also try direct CMS API call for debugging
        let directCmsTest: any = {};
        if (channelId && productMediaResp?.record?.ElectronicMediaId) {
          const emId = productMediaResp.record.ElectronicMediaId;
          
          // Try the CMS Delivery API directly
          try {
            const cmsResp = await client.get(
              `/services/data/${apiVersion}/connect/cms/delivery/channels/${channelId}/media/${emId}`
            );
            directCmsTest.cmsDeliveryApi = { status: 'success', data: cmsResp.data };
          } catch (cmsErr: any) {
            directCmsTest.cmsDeliveryApi = { 
              status: 'error', 
              error: cmsErr.message, 
              responseStatus: cmsErr.response?.status,
              responseData: cmsErr.response?.data 
            };
          }
          
          // Try querying ManagedContent sobject by ID
          try {
            const mcResp = await client.get(`/services/data/${apiVersion}/sobjects/ManagedContent/${emId}`);
            directCmsTest.managedContentSobject = mcResp.data;
          } catch (mcErr: any) {
            directCmsTest.managedContentSobjectError = { error: mcErr.message, status: mcErr.response?.status };
          }

            // Also explicitly query ManagedContent with SOQL to fetch the Name field (useful for Shopify path fallback)
            try {
              const mcSoql = `SELECT Id, ContentKey, PrimaryLanguage FROM ManagedContent WHERE Id = '${emId}' LIMIT 1`;
              const mcQueryResp = await client.get(`/services/data/${apiVersion}/query`, { params: { q: mcSoql } });
              directCmsTest.managedContentQuery = mcQueryResp.data?.records?.[0] || null;
            } catch (mcQErr: any) {
              directCmsTest.managedContentQueryError = { error: mcQErr.message, status: mcQErr.response?.status };
            }
          
          // Try querying ManagedContentInfo  
          try {
            const mciResp = await client.get(`/services/data/${apiVersion}/sobjects/ManagedContentInfo/${emId}`);
            directCmsTest.managedContentInfo = mciResp.data;
          } catch (mciErr: any) {
            directCmsTest.managedContentInfoError = { error: mciErr.message, status: mciErr.response?.status };
          }
          
          // Try listing all content in the channel
          try {
            const contentListResp = await client.get(
              `/services/data/${apiVersion}/connect/cms/delivery/channels/${channelId}/contents?pageSize=5`
            );
            directCmsTest.channelContents = contentListResp.data;
          } catch (clErr: any) {
            directCmsTest.channelContentsError = { error: clErr.message, status: clErr.response?.status };
          }
          
          // Try describing ManagedContent
          try {
            const descResp = await client.get(`/services/data/${apiVersion}/sobjects/ManagedContent/describe`);
            const fields = (descResp.data?.fields || []).map((f: any) => f.name);
            directCmsTest.managedContentFields = fields;
          } catch (dErr: any) {
            directCmsTest.managedContentDescribeError = dErr.message;
          }
        }
        
        cmsInfo = { channelId, imageUrls, directCmsTest };
      } catch (e: any) {
        cmsInfo = { error: e.message };
      }
      
        return reply.send({
        ok: true,
        productId,
        productMedia: productMediaResp,
        electronicMediaSobject: emSobjectResp,
        managedContentVariant: mcvResp,
        mediaRelatedObjects: sobjectList,
          managedContentNames,
          cmsInfo
      });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message, stack: err.stack });
    }
  });

  // GET /debug-managed-content/:productId -> return ManagedContent Id + Name for ProductMedia
  app.get('/debug-managed-content/:productId', async (req, reply) => {
    const productId = (req.params as any).productId;
    try {
      const client = salesforceClient.getClient();
      const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';

      const pmListSoql = `SELECT ElectronicMediaId FROM ProductMedia WHERE ProductId = '${productId}'`;
      const pmListResp = await client.get(`/services/data/${apiVersion}/query`, { params: { q: pmListSoql } });
      const pmList = pmListResp.data?.records || [];
      const emIds = pmList.map((r: any) => r.ElectronicMediaId).filter(Boolean);

      if (emIds.length === 0) {
        return reply.send({ ok: true, productId, managedContent: [] });
      }

      const idList = emIds.map((id: string) => `'${id}'`).join(',');
      const mcSoql = `SELECT Id, Name FROM ManagedContent WHERE Id IN (${idList})`;
      const mcResp = await client.get(`/services/data/${apiVersion}/query`, { params: { q: mcSoql } });
      const mcRecords = mcResp.data?.records || [];

      return reply.send({ ok: true, productId, managedContent: mcRecords });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message, status: err.response?.status, data: err.response?.data });
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
