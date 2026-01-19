import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../../modules/observability/logger';
import { pythonAssistantClient } from '../../../utils/pythonClient';

interface CartRequestBody {
  product_id?: string;
  quantity?: number;
  action?: 'add' | 'remove' | 'set' | 'clear';
  session_id: string;
}

interface CartQuerystring {
  session_id: string;
}

export default async function cartRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/cart/add
   * Add/update/remove/clear items in cart
   */
  fastify.post('/api/cart/add', async (request: FastifyRequest<{ Body: CartRequestBody }>, reply: FastifyReply) => {
    try {
      const { product_id, quantity = 1, session_id, action, buyer_account_id } = request.body;

      if (!session_id) {
        return reply.code(400).send({
          success: false,
          error: 'session_id is required'
        });
      }

      if (action !== 'clear' && !product_id) {
        return reply.code(400).send({
          success: false,
          error: 'product_id is required for this action'
        });
      }

      logger.info('Adding to cart', { product_id, quantity, session_id, action });

      // Check if this is a Salesforce product (IDs start with "01t")
      if (product_id && product_id.startsWith('01t')) {
        // Handle different cart actions for Salesforce-backed products
        if (action === 'remove') {
          // Find the matching cart item in the Salesforce cart to obtain cartItemId
          const sfGet = await fastify.inject({ method: 'GET', url: `/api/salesforce-cart?session_id=${session_id}${buyer_account_id ? `&buyer_account_id=${encodeURIComponent(buyer_account_id)}` : ''}` });
          const sfData = sfGet.json() as any;
          const lines = sfData?.cart?.items || [];
          const match = lines.find((l: any) => String(l.product_id) === String(product_id) || String(l.id) === String(product_id));
          if (!match) {
            return reply.code(404).send({ success: false, error: 'Item not found in Salesforce cart' });
          }

          const removeResp = await fastify.inject({
            method: 'POST',
            url: '/api/salesforce-cart/remove',
            payload: { cartItemId: match.id, session_id, buyer_account_id }
          });

          return reply.send(removeResp.json());
        }

        if (action === 'set') {
          // Set exact quantity: map product_id -> cartItemId then call update
          const sfGet = await fastify.inject({ method: 'GET', url: `/api/salesforce-cart?session_id=${session_id}${buyer_account_id ? `&buyer_account_id=${encodeURIComponent(buyer_account_id)}` : ''}` });
          const sfData = sfGet.json() as any;
          const lines = sfData?.cart?.items || [];
          const match = lines.find((l: any) => String(l.product_id) === String(product_id) || String(l.id) === String(product_id));
          if (!match) {
            return reply.code(404).send({ success: false, error: 'Item not found in Salesforce cart' });
          }

          const updateResp = await fastify.inject({
            method: 'POST',
            url: '/api/salesforce-cart/update',
            payload: { cartItemId: match.id, quantity, session_id, buyer_account_id }
          });

          return reply.send(updateResp.json());
        }

        if (action === 'clear') {
          // No clear endpoint implemented for Salesforce cart; return empty cart response
          return reply.send({ success: true, cart: { items: [], item_count: 0, total: 0 } });
        }

        // Default: add
        const sfCartResponse = await fastify.inject({
          method: 'POST',
          url: '/api/salesforce-cart/add',
          payload: { product_id, quantity, session_id, buyer_account_id }
        });

        return reply.send(sfCartResponse.json());
      }

      // Forward to Python backend
      const response = await pythonAssistantClient.request(
        'POST',
        '/assistant/cart',
        {
          product_id,
          quantity,
          action: action || 'add',  // Use action from request, default to 'add'
          session_id
        }
      );

      return reply.send(response.data);
    } catch (error: any) {
      logger.error('Cart add error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to add to cart'
      });
    }
  });

  /**
   * GET /api/cart
   * Get cart contents
   */
  fastify.get('/api/cart', async (request: FastifyRequest<{ Querystring: CartQuerystring }>, reply: FastifyReply) => {
    try {
      const { session_id } = request.query;

      if (!session_id) {
        return reply.code(400).send({
          success: false,
          error: 'session_id is required'
        });
      }

      // Get Salesforce cart
      const sfCartResponse = await fastify.inject({
        method: 'GET',
        url: `/api/salesforce-cart?session_id=${session_id}`
      });
      const sfCart = sfCartResponse.json() as any;

      // If Salesforce cart has items, return it directly (simplifies for now)
      if (sfCart.success && sfCart.cart.items.length > 0) {
        return reply.send(sfCart);
      }

      // Otherwise, fallback to Python cart
      const response = await pythonAssistantClient.request(
        'GET',
        `/assistant/cart?session_id=${session_id}`
      );

      const cart = response.data.cart || { items: [], item_count: 0, total: 0 };
      
      logger.info('Cart received from Python', { 
        itemCount: cart.items?.length || 0,
        items: cart.items 
      });

      return reply.send({
        success: true,
        cart
      });
    } catch (error: any) {
      logger.error('Cart get error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to get cart'
      });
    }
  });
}
