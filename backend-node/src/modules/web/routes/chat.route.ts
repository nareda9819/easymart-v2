import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { pythonAssistantClient } from "../../../utils/pythonClient";
import { logger } from "../../observability/logger";
import { searchProducts } from "../../salesforce_adapter/products";

interface ChatRequestBody {
  message: string;
  sessionId?: string;
}

export default async function chatRoute(app: FastifyInstance) {
  app.post("/", async (req: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
    const { message, sessionId } = req.body;

    // Validate request
    if (!message || typeof message !== "string") {
      return reply.status(400).send({ error: "message is required and must be a string" });
    }

    // Generate session ID if not provided
    const session = sessionId || `guest-${Date.now()}`;

    logger.info("Chat request received", { sessionId: session, messageLength: message.length });

    try {
      // Quick search intent detection for Salesforce
      const lowerMsg = message.toLowerCase();
      const searchKeywords = ['search', 'find', 'show', 'alpine', 'product'];
      const isSearchQuery = searchKeywords.some(kw => lowerMsg.includes(kw));

      if (isSearchQuery) {
        // Extract search term (simple approach: use the message or key words)
        const searchTerm = lowerMsg.replace(/search|find|show|me|for|products?/gi, '').trim() || 'alpine';
        
        logger.info("Detected search intent, calling Salesforce", { searchTerm });
        
        const products = await searchProducts(searchTerm, 10);
        
        if (products && products.length > 0) {
          // Transform Salesforce products to frontend format
          const formattedProducts = products.map(p => ({
            id: p.id,
            title: p.name,
            price: p.price || '0',
            image: p.images && p.images[0] ? p.images[0] : undefined,
            url: p.url,
            inventory_quantity: p.inStock !== undefined ? (p.inStock ? 100 : 0) : undefined,
            description: p.description
          }));

          return reply.send({
            message: `Found ${products.length} products matching "${searchTerm}":`,
            actions: [{
              type: 'search_results',
              data: {
                results: formattedProducts
              }
            }]
          });
        } else {
          return reply.send({
            message: `No products found for "${searchTerm}". Try a different search term.`,
            actions: []
          });
        }
      }

      // Forward to Python assistant for non-search queries
      const response = await pythonAssistantClient.sendMessage({
        message,
        sessionId: session,
      });

      logger.info("Chat response sent", { sessionId: session });
      return reply.send(response);
    } catch (error: any) {
      logger.error("Error calling Python assistant", { 
        error: error.message, 
        sessionId: session 
      });
      
      return reply.status(500).send({ 
        error: "Failed to process message",
        message: "Our assistant is temporarily unavailable. Please try again."
      });
    }
  });
}
