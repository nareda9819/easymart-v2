import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../../modules/observability/logger';
import * as salesforceCart from '../../salesforce_adapter/cart';
import { getProductById, searchProducts } from '../../salesforce_adapter/products';
import { salesforceClient } from '../../salesforce_adapter/client';
import { config } from '../../../config/env';

export default async function salesforceCartRoutes(fastify: FastifyInstance) {
  // Simple in-memory cache for product snapshots to reduce repeated Apex calls
  // Key: productId, Value: { product, expires }
  const productCache = new Map<string, { product: any; expires: number }>();
  const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

  /**
   * Fetch Product2 record + PricebookEntry price via standard Salesforce sObject REST API.
   * This does NOT require custom Apex — it uses the platform's built-in REST endpoints.
   */
  async function getProduct2BySObjectRest(productId: string): Promise<{ name: string; price: string; image?: string } | null> {
    try {
      const client = salesforceClient.getClient();
      const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';

      // Fetch Product2 Name
      const prodResp = await client.get(`/services/data/${apiVersion}/sobjects/Product2/${productId}?fields=Id,Name,Description`);
      const productName = prodResp.data?.Name || 'Unknown Product';

      // Fetch first active PricebookEntry for this product to get price
      let price = '0';
      try {
        const pbeResp = await client.get(
          `/services/data/${apiVersion}/query?q=${encodeURIComponent(`SELECT UnitPrice FROM PricebookEntry WHERE Product2Id='${productId}' AND IsActive=true LIMIT 1`)}`
        );
        if (pbeResp.data?.records?.length > 0) {
          price = String(pbeResp.data.records[0].UnitPrice ?? '0');
        }
      } catch (pbeErr) {
        // Price lookup failed, keep default 0
        logger.debug('PricebookEntry lookup failed', { productId });
      }

      logger.info('Product2 fetched via sObject REST', { productId, productName, price });
      return { name: productName, price };
    } catch (err: any) {
      logger.debug('getProduct2BySObjectRest failed', { productId, message: err?.message });
      return null;
    }
  }

  async function resolveProductSnapshot(productId: string) {
    if (!productId) return null;
    const now = Date.now();
    const cached = productCache.get(productId);
    if (cached && cached.expires > now) return cached.product;

    // 1) Try direct Apex product endpoint
    let prod = await getProductById(productId);

    // 2) Fallback: standard Salesforce sObject REST API (Product2 + PricebookEntry)
    if (!prod) {
      const sobjectResult = await getProduct2BySObjectRest(productId);
      if (sobjectResult) {
        prod = {
          id: productId,
          name: sobjectResult.name,
          price: sobjectResult.price,
          images: [],
          image: sobjectResult.image || undefined,
        };
      }
    }

    // 3) Last-resort fallback: search endpoint (unlikely to match by ID but try anyway)
    if (!prod) {
      try {
        const results = await searchProducts(productId, 5);
        prod = results.find((p: any) => p.id === productId) || null;
      } catch (e) {
        prod = null;
      }
    }

    if (prod) {
      productCache.set(productId, { product: prod, expires: now + CACHE_TTL_MS });
    }
    return prod;
  }

  // Helper: extract display fields from a cart line, supporting several possible shapes
  function extractLineDisplayFields(line: any) {
    // try a variety of common field names and nested shapes
    const title = line?.productName || line?.name || line?.title || line?.label || (line?.product && (line.product.name || line.product.title || line.product.productName)) || 'Unknown Product';

    const priceRaw = line?.unitPrice ?? line?.price ?? line?.amount ?? (line?.product && (line.product.price || line.product.unitPrice)) ?? '0';
    const price = typeof priceRaw === 'number' ? String(priceRaw) : String(priceRaw || '0');

    const image = line?.imageUrl || line?.image || (line?.product && (line.product.image || (Array.isArray(line.product.images) ? line.product.images[0] : undefined))) || null;

    return { title, price, image };
  }

  /**
   * POST /api/salesforce-cart/add
   * Add item to Salesforce cart (calls real Apex)
   */
  fastify.post('/add', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { product_id, quantity = 1, session_id } = request.body as any;
        logger.info('Adding to real Salesforce cart', { product_id, quantity, session_id });

      if (!product_id) {
        return reply.code(400).send({
          success: false,
          error: 'product_id is required'
        });
      }

      logger.info('Adding to real Salesforce cart', { product_id, quantity });

      // Call Apex CartApi to add to cart
      const apexResponse = await salesforceCart.addToCart(product_id, quantity);

      if (!apexResponse.success) {
        return reply.code(500).send({
          success: false,
          error: apexResponse.message || 'Failed to add to Salesforce cart'
        });
      }

      // Get updated cart from Salesforce
      const cartResponse = await salesforceCart.getCart();
      try {
        logger.info('Raw cartResponse.lines (add)', { lines: cartResponse.lines });
        logger.info('Raw cartResponse.lines (add)-string', { lines: JSON.stringify(cartResponse.lines || []) });
      } catch (e) {}

      // Fetch product details and enrich cart items
      const enrichedItems = await Promise.all(
        (cartResponse.lines || []).map(async (line) => {
          const product = await resolveProductSnapshot(line.productId);
          const fallback = extractLineDisplayFields(line as any);

          const title = product?.name || fallback.title;
          const price = product?.price ?? fallback.price;
          const image = product?.images?.[0] || fallback.image || null;

          return {
            product_id: line.productId,
            id: line.cartItemId,
            title,
            price,
            quantity: line.quantity,
            image,
            // Include raw line for debugging (temporary)
            raw_line: line
          } as any;
        })
      );

      const cart = {
        items: enrichedItems,
        item_count: enrichedItems.reduce((sum, item) => sum + item.quantity, 0),
        total: enrichedItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0)
      };

      logger.info('Salesforce cart updated', { cartId: cartResponse.cartId, item_count: cart.item_count });

      return reply.send({
        success: true,
        cart
      });
    } catch (error: any) {
      logger.error('Salesforce cart add error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to add to cart'
      });
    }
  });

  /**
   * GET /api/salesforce-cart
   * Get cart contents from Salesforce
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { session_id, buyer_account_id } = request.query as any;

      logger.info('Getting Salesforce cart', { session_id, buyer_account_id });

      // Get cart from Apex with buyerAccountId
      const cartResponse = await salesforceCart.getCart(buyer_account_id);
      logger.info('Raw cartResponse.lines (get)', { lines: cartResponse.lines, buyerAccountId: buyer_account_id });


      if (!cartResponse.success) {
        return reply.send({
          success: true,
          cart: { items: [], item_count: 0, total: 0 }
        });
      }

      // Enrich with product details
      const enrichedItems = await Promise.all(
        (cartResponse.lines || []).map(async (line) => {
          const product = await resolveProductSnapshot(line.productId);
          const fallback = extractLineDisplayFields(line as any);

          const title = product?.name || fallback.title;
          const price = product?.price ?? fallback.price;
          const image = product?.images?.[0] || fallback.image || null;

          return {
            product_id: line.productId,
            id: line.cartItemId,
            title,
            price,
            quantity: line.quantity,
            image
          } as any;
        })
      );

      const cart = {
        items: enrichedItems,
        item_count: enrichedItems.reduce((sum, item) => sum + item.quantity, 0),
        total: enrichedItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0)
      };

      return reply.send({
        success: true,
        cart
      });
    } catch (error: any) {
      logger.error('Salesforce cart get error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to get cart'
      });
    }
  });

  /**
   * GET /api/salesforce-cart/count
   * Return only the total item count (sum of quantities) for quick widget updates.
   */
  fastify.get('/count', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { buyer_account_id } = request.query as any;
      
      const cartResponse = await salesforceCart.getCart(buyer_account_id);
      if (!cartResponse.success) {
        return reply.send({ success: true, item_count: 0 });
      }

      const total = (cartResponse.lines || []).reduce((sum, l) => sum + (l.quantity || 0), 0);
      return reply.send({ success: true, item_count: total });
    } catch (err: any) {
      logger.error('Failed to fetch cart count', { message: err.message });
      return reply.code(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/salesforce-cart/update
   * Update item quantity in Salesforce
   */
  fastify.post('/update', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { cartItemId, quantity, session_id } = request.body as any;
       logger.info('Adding to real Salesforce cart', { cartItemId, quantity, session_id });

      if (!cartItemId || quantity === undefined) {
        return reply.code(400).send({
          success: false,
          error: 'cartItemId and quantity are required'
        });
      }

      logger.info('Updating Salesforce cart item', { cartItemId, quantity });

      // Call Apex to update quantity
      const apexResponse = await salesforceCart.updateCartItem(cartItemId, quantity);

      if (!apexResponse.success) {
        return reply.code(500).send({
          success: false,
          error: apexResponse.message || 'Failed to update cart item'
        });
      }

      // Get updated cart
      const cartResponse = await salesforceCart.getCart();
      logger.info('Raw cartResponse.lines (update)', { lines: cartResponse.lines });

      const enrichedItems = await Promise.all(
        (cartResponse.lines || []).map(async (line) => {
          const product = await resolveProductSnapshot(line.productId);
          const fallback = extractLineDisplayFields(line as any);

          const title = product?.name || fallback.title;
          const price = product?.price ?? fallback.price;
          const image = product?.images?.[0] || fallback.image || null;

          return {
            product_id: line.productId,
            id: line.cartItemId,
            title,
            price,
            quantity: line.quantity,
            image
          } as any;
        })
      );

      const cart = {
        items: enrichedItems,
        item_count: enrichedItems.reduce((sum, item) => sum + item.quantity, 0),
        total: enrichedItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0)
      };

      return reply.send({
        success: true,
        cart
      });
    } catch (error: any) {
      logger.error('Salesforce cart update error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to update cart'
      });
    }
  });

  /**
   * POST /api/salesforce-cart/remove
   * Remove item from Salesforce cart
   */
  fastify.post('/remove', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { cartItemId, session_id } = request.body as any;
        logger.info('Adding to real Salesforce cart', { cartItemId, session_id });

      if (!cartItemId) {
        return reply.code(400).send({
          success: false,
          error: 'cartItemId is required'
        });
      }

      logger.info('Removing from Salesforce cart', { cartItemId });

      // Call Apex to delete item
      const apexResponse = await salesforceCart.removeFromCart(cartItemId);

      if (!apexResponse.success) {
        return reply.code(500).send({
          success: false,
          error: apexResponse.message || 'Failed to remove cart item'
        });
      }

      // Get updated cart
      const cartResponse = await salesforceCart.getCart();
      logger.info('Raw cartResponse.lines (remove)', { lines: cartResponse.lines });

      const enrichedItems = await Promise.all(
        (cartResponse.lines || []).map(async (line) => {
          const product = await resolveProductSnapshot(line.productId);
          const fallback = extractLineDisplayFields(line as any);

          const title = product?.name || fallback.title;
          const price = product?.price ?? fallback.price;
          const image = product?.images?.[0] || fallback.image || null;

          return {
            product_id: line.productId,
            id: line.cartItemId,
            title,
            price,
            quantity: line.quantity,
            image
          } as any;
        })
      );

      const cart = {
        items: enrichedItems,
        item_count: enrichedItems.reduce((sum, item) => sum + item.quantity, 0),
        total: enrichedItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0)
      };

      return reply.send({
        success: true,
        cart
      });
    } catch (error: any) {
      logger.error('Salesforce cart remove error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to remove cart item'
      });
    }
  });
}
