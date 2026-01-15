/**
 * Salesforce Media Proxy Route
 *
 * GET /api/media/salesforce/:electronicMediaId
 * Streams a Salesforce Commerce Cloud ElectronicMedia image through the Node backend,
 * avoiding exposing internal Salesforce instance URLs to the frontend.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getElectronicMediaData, getContentVersionData } from '../../salesforce_adapter/media';
import { logger } from '../../observability/logger';

export default async function mediaRoute(app: FastifyInstance) {
  /**
   * GET /:mediaId
   * Proxy Salesforce ElectronicMedia or ContentVersion binary data.
   */
  app.get<{ Params: { mediaId: string } }>(
    '/:mediaId',
    async (request: FastifyRequest<{ Params: { mediaId: string } }>, reply: FastifyReply) => {
      const { mediaId } = request.params;

      if (!mediaId || !/^[a-zA-Z0-9]{15,18}$/.test(mediaId)) {
        return reply.code(400).send({ error: 'Invalid mediaId' });
      }

      try {
        // Try ElectronicMedia first (for Commerce Cloud products)
        let result = await getElectronicMediaData(mediaId);
        
        // Fallback to ContentVersion if ElectronicMedia fails
        if (!result) {
          result = await getContentVersionData(mediaId);
        }

        if (!result) {
          return reply.code(404).send({ error: 'Image not found' });
        }

        // Cache response for 1 hour (adjust as needed)
        reply.header('Cache-Control', 'public, max-age=3600');
        reply.header('Content-Type', result.mimeType);
        return reply.send(result.data);
      } catch (err: any) {
        logger.error('Media proxy error', { mediaId, message: err.message });
        return reply.code(500).send({ error: 'Failed to fetch image' });
      }
    }
  );
}
