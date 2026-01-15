/**
 * Salesforce Media Proxy Route
 *
 * GET /api/media/salesforce/:contentVersionId
 * Streams a Salesforce ContentVersion binary (image) through the Node backend,
 * avoiding exposing internal Salesforce instance URLs to the frontend.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getContentVersionData } from '../../salesforce_adapter/media';
import { logger } from '../../observability/logger';

export default async function mediaRoute(app: FastifyInstance) {
  /**
   * GET /:contentVersionId
   * Proxy Salesforce ContentVersion binary data.
   */
  app.get<{ Params: { contentVersionId: string } }>(
    '/:contentVersionId',
    async (request: FastifyRequest<{ Params: { contentVersionId: string } }>, reply: FastifyReply) => {
      const { contentVersionId } = request.params;

      if (!contentVersionId || !/^[a-zA-Z0-9]{15,18}$/.test(contentVersionId)) {
        return reply.code(400).send({ error: 'Invalid contentVersionId' });
      }

      try {
        const result = await getContentVersionData(contentVersionId);

        if (!result) {
          return reply.code(404).send({ error: 'Image not found' });
        }

        // Cache response for 1 hour (adjust as needed)
        reply.header('Cache-Control', 'public, max-age=3600');
        reply.header('Content-Type', result.mimeType);
        return reply.send(result.data);
      } catch (err: any) {
        logger.error('Media proxy error', { contentVersionId, message: err.message });
        return reply.code(500).send({ error: 'Failed to fetch image' });
      }
    }
  );
}
