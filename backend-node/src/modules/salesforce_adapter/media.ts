/**
 * Salesforce Files/Media Helper
 *
 * Queries ContentDocumentLink and ContentVersion to discover product images,
 * and provides helpers to build proxied image URLs served by the Node backend.
 */
import { salesforceClient } from './client';
import { config } from '../../config/env';
import { logger } from '../observability/logger';

export interface ContentVersionInfo {
  contentVersionId: string;
  contentDocumentId: string;
  title: string;
  fileExtension?: string;
}

/**
 * Fetch ContentVersion IDs linked to a Product2 record.
 * Returns an array of ContentVersionInfo objects; empty array if none found.
 */
export async function getProductContentVersions(productId: string): Promise<ContentVersionInfo[]> {
  try {
    const client = salesforceClient.getClient();
    const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';

    // Step 1: Query ContentDocumentLink for the product
    const linkSoql = `SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${productId}'`;
    const linkResp = await client.get(`/services/data/${apiVersion}/query`, {
      params: { q: linkSoql },
    });

    const records = linkResp.data?.records || [];
    if (records.length === 0) {
      logger.info('No ContentDocumentLinks found for product', { productId });
      return [];
    }

    const docIds = records.map((r: any) => `'${r.ContentDocumentId}'`).join(',');

    // Step 2: Query ContentVersion for latest versions
    const versionSoql = `SELECT Id, ContentDocumentId, Title, FileExtension FROM ContentVersion WHERE ContentDocumentId IN (${docIds}) AND IsLatest = true`;
    const versionResp = await client.get(`/services/data/${apiVersion}/query`, {
      params: { q: versionSoql },
    });

    const versions = (versionResp.data?.records || []).map((v: any) => ({
      contentVersionId: v.Id,
      contentDocumentId: v.ContentDocumentId,
      title: v.Title || '',
      fileExtension: v.FileExtension || '',
    }));

    logger.info('Fetched ContentVersions for product', { productId, count: versions.length });
    return versions;
  } catch (err: any) {
    logger.error('Failed to fetch ContentVersions for product', { productId, message: err.message });
    return [];
  }
}

/**
 * Fetch binary image data for a ContentVersion.
 * Returns Buffer and mime type (guessed from extension).
 */
export async function getContentVersionData(contentVersionId: string): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const client = salesforceClient.getClient();
    const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';

    const resp = await client.get(`/services/data/${apiVersion}/sobjects/ContentVersion/${contentVersionId}/VersionData`, {
      responseType: 'arraybuffer',
    });

    // Guess mime type from content-type header or default to image/png
    const contentType = resp.headers['content-type'] || 'image/png';
    return { data: Buffer.from(resp.data), mimeType: contentType };
  } catch (err: any) {
    logger.error('Failed to fetch ContentVersion VersionData', { contentVersionId, message: err.message });
    return null;
  }
}

/**
 * Build a proxied image URL served by our Node backend.
 * @param contentVersionId Salesforce ContentVersion ID
 * @param backendBaseUrl Optional base URL for the Node backend (defaults to relative path)
 */
export function buildProxyImageUrl(contentVersionId: string, backendBaseUrl?: string): string {
  const base = backendBaseUrl ? backendBaseUrl.replace(/\/+$/, '') : '';
  return `${base}/api/media/salesforce/${contentVersionId}`;
}

export default {
  getProductContentVersions,
  getContentVersionData,
  buildProxyImageUrl,
};
