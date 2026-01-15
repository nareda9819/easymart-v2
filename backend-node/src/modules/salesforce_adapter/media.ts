/**
 * Salesforce Commerce Cloud Media Helper
 *
 * Queries ProductMedia and ElectronicMedia to discover product images,
 * and provides helpers to build proxied image URLs served by the Node backend.
 * 
 * Salesforce Commerce Cloud uses:
 * - ProductMedia: Links products to media (ElectronicMediaId)
 * - ElectronicMedia: Stores the actual media reference with MediaAsset URL
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

export interface ElectronicMediaInfo {
  electronicMediaId: string;
  mediaUrl: string;
  alternateText?: string;
}

/**
 * Fetch ElectronicMedia URLs linked to a Product2 record via ProductMedia.
 * Returns an array of ElectronicMediaInfo objects; empty array if none found.
 */
export async function getProductElectronicMedia(productId: string): Promise<ElectronicMediaInfo[]> {
  try {
    const client = salesforceClient.getClient();
    const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';

    // Step 1: Query ProductMedia for the product's media links
    const pmSoql = `SELECT Id, ElectronicMediaId FROM ProductMedia WHERE ProductId = '${productId}'`;
    const pmResp = await client.get(`/services/data/${apiVersion}/query`, {
      params: { q: pmSoql },
    });

    const pmRecords = pmResp.data?.records || [];
    if (pmRecords.length === 0) {
      logger.info('No ProductMedia found for product', { productId });
      return [];
    }

    const emIds = pmRecords.map((r: any) => `'${r.ElectronicMediaId}'`).join(',');

    // Step 2: Query ElectronicMedia to get the actual media URLs
    const emSoql = `SELECT Id, MediaUrl, AlternateText FROM ElectronicMedia WHERE Id IN (${emIds})`;
    const emResp = await client.get(`/services/data/${apiVersion}/query`, {
      params: { q: emSoql },
    });

    const mediaRecords = (emResp.data?.records || []).map((m: any) => ({
      electronicMediaId: m.Id,
      mediaUrl: m.MediaUrl || '',
      alternateText: m.AlternateText || '',
    }));

    logger.info('Fetched ElectronicMedia for product', { productId, count: mediaRecords.length });
    return mediaRecords;
  } catch (err: any) {
    logger.error('Failed to fetch ElectronicMedia for product', { productId, message: err.message });
    return [];
  }
}

/**
 * Fetch ContentVersion IDs linked to a Product2 record (legacy method).
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
 * Fetch binary image data for an ElectronicMedia record.
 * ElectronicMedia stores a MediaUrl which can be:
 * 1. A relative path to the Salesforce CDN
 * 2. An external URL
 * 
 * We fetch the MediaUrl and download the actual image data.
 */
export async function getElectronicMediaData(electronicMediaId: string): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const client = salesforceClient.getClient();
    const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';

    // First, query ElectronicMedia to get the MediaUrl
    const emSoql = `SELECT Id, MediaUrl FROM ElectronicMedia WHERE Id = '${electronicMediaId}'`;
    const emResp = await client.get(`/services/data/${apiVersion}/query`, {
      params: { q: emSoql },
    });

    const record = emResp.data?.records?.[0];
    if (!record || !record.MediaUrl) {
      logger.warn('ElectronicMedia not found or no MediaUrl', { electronicMediaId });
      return null;
    }

    const mediaUrl = record.MediaUrl;
    logger.info('Fetching ElectronicMedia image', { electronicMediaId, mediaUrl });

    // Fetch the actual image from the MediaUrl
    // MediaUrl is typically a relative path like /cms/media/... or a full URL
    let imageResp;
    if (mediaUrl.startsWith('http')) {
      // External URL - fetch directly (rare case)
      const axios = (await import('axios')).default;
      imageResp = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
    } else {
      // Relative path - fetch via Salesforce client
      imageResp = await client.get(mediaUrl, { responseType: 'arraybuffer' });
    }

    const contentType = imageResp.headers['content-type'] || 'image/png';
    return { data: Buffer.from(imageResp.data), mimeType: contentType };
  } catch (err: any) {
    logger.error('Failed to fetch ElectronicMedia data', { electronicMediaId, message: err.message });
    return null;
  }
}

/**
 * Build a proxied image URL served by our Node backend.
 * @param mediaId Salesforce ElectronicMedia ID or ContentVersion ID
 * @param backendBaseUrl Optional base URL for the Node backend (defaults to relative path)
 */
export function buildProxyImageUrl(mediaId: string, backendBaseUrl?: string): string {
  const base = backendBaseUrl ? backendBaseUrl.replace(/\/+$/, '') : '';
  return `${base}/api/media/salesforce/${mediaId}`;
}

export default {
  getProductContentVersions,
  getProductElectronicMedia,
  getContentVersionData,
  getElectronicMediaData,
  buildProxyImageUrl,
};
