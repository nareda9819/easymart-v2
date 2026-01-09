import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../../modules/observability/logger';
import * as salesforceCart from '../../salesforce_adapter/cart';
import { getProductById } from '../../salesforce_adapter/products';

export default async function salesforceCartRoutes(fastify: FastifyInstance) {
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

      // Fetch product details and enrich cart items
      const enrichedItems = await Promise.all(
        (cartResponse.lines || []).map(async (line) => {
          const product = await getProductById(line.productId);
          return {
            product_id: line.productId,
            id: line.cartItemId,
            title: product?.name || 'Unknown Product',
            price: product?.price || '0',
            quantity: line.quantity,
            image: product?.images?.[0] || null
          };
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
      const { session_id } = request.query as any;

      logger.info('Getting Salesforce cart', { session_id });

      // Get cart from Apex
      const cartResponse = await salesforceCart.getCart();

      if (!cartResponse.success) {
        return reply.send({
          success: true,
          cart: { items: [], item_count: 0, total: 0 }
        });
      }

      // Enrich with product details
      const enrichedItems = await Promise.all(
        (cartResponse.lines || []).map(async (line) => {
          const product = await getProductById(line.productId);
          return {
            product_id: line.productId,
            id: line.cartItemId,
            title: product?.name || 'Unknown Product',
            price: product?.price || '0',
            quantity: line.quantity,
            image: product?.images?.[0] || null
          };
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

      const enrichedItems = await Promise.all(
        (cartResponse.lines || []).map(async (line) => {
          const product = await getProductById(line.productId);
          return {
            product_id: line.productId,
            id: line.cartItemId,
            title: product?.name || 'Unknown Product',
            price: product?.price || '0',
            quantity: line.quantity,
            image: product?.images?.[0] || null
          };
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

      const enrichedItems = await Promise.all(
        (cartResponse.lines || []).map(async (line) => {
          const product = await getProductById(line.productId);
          return {
            product_id: line.productId,
            id: line.cartItemId,
            title: product?.name || 'Unknown Product',
            price: product?.price || '0',
            quantity: line.quantity,
            image: product?.images?.[0] || null
          };
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
