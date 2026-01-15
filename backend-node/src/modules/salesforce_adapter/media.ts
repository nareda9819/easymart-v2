/**
 * Salesforce CMS Media Helper
 *
 * Resolves product images from Salesforce Experience Cloud CMS.
 * 
 * Architecture:
 * - ProductMedia links Product2 to ElectronicMediaId (CMS content)
 * - ElectronicMediaId (20Y prefix) is a ManagedContentVariant
 * - We use Connect CMS Delivery API to get public URLs
 * 
 * API: GET /connect/cms/delivery/channels/{channelId}/media/{mediaId}
 * Returns: { unauthenticatedUrl: "https://..." } - public CDN URL
 */
import { salesforceClient } from './client';
import { config } from '../../config/env';
import { logger } from '../observability/logger';

// Cache for CMS channel ID
let cachedChannelId: string | null = null;

/**
 * Discover the CMS Channel ID for the Experience Site.
 * The channel is required for the CMS Delivery API.
 * 
 * We try to find a channel linked to the commerce site,
 * or fall back to any available channel.
 */
export async function getCmsChannelId(): Promise<string | null> {
  if (cachedChannelId) return cachedChannelId;
  
  try {
    const client = salesforceClient.getClient();
    const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';
    
    // Query all available CMS channels with more fields
    const resp = await client.get(`/services/data/${apiVersion}/query`, {
      params: { q: `SELECT Id, Name, Domain, DomainHostName, Type FROM ManagedContentChannel` }
    });
    
    const channels = resp.data?.records || [];
    logger.info('Available CMS channels', { 
      count: channels.length,
      channels: channels.map((c: any) => ({ id: c.Id, name: c.Name, domain: c.Domain, type: c.Type })) 
    });
    
    // Prefer a channel linked to the commerce site domain
    const siteDomain = config.SALESFORCE_SITE_BASE_URL || '';
    const commerceChannel = channels.find((c: any) => 
      c.DomainHostName && siteDomain.includes(c.DomainHostName)
    );
    
    if (commerceChannel) {
      cachedChannelId = commerceChannel.Id;
      logger.info('Using commerce site CMS channel', { channelId: cachedChannelId, name: commerceChannel.Name });
      return cachedChannelId;
    }
    
    // Fall back to first available channel
    if (channels.length > 0) {
      cachedChannelId = channels[0].Id;
      logger.info('Using first available CMS channel', { channelId: cachedChannelId, name: channels[0].Name });
      return cachedChannelId;
    }
    
    return null;
  } catch (err: any) {
    logger.error('Failed to get CMS channel ID', { message: err.message, status: err.response?.status });
    return null;
  }
}

/**
 * Fetch a single CMS media URL via Connect Delivery API.
 * 
 * The ElectronicMediaId is a ManagedContent record ID.
 * We need to:
 * 1. Get the ContentKey from ManagedContent sobject
 * 2. Use ContentKey with CMS Delivery API to get the public URL
 * 
 * Returns the unauthenticatedUrl (public CDN URL) or null.
 */
async function fetchCmsMediaUrl(channelId: string, electronicMediaId: string): Promise<string | null> {
  try {
    const client = salesforceClient.getClient();
    const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';

    // Step 1: Query ManagedContent explicitly to ensure we get the `Name` field
    const mcSoql = `SELECT Id, Name, ContentKey FROM ManagedContent WHERE Id = '${electronicMediaId}' LIMIT 1`;
    const mcQueryResp = await client.get(`/services/data/${apiVersion}/query`, { params: { q: mcSoql } });
    const mcRecord = (mcQueryResp.data?.records || [])[0] || {};
    const mcData = mcRecord || {};
    const contentKey = mcData.ContentKey;

    // Helper: shallow recursive scan of an object/array for the first HTTP(S) URL string
    function findFirstUrl(obj: any, depth = 0): string | null {
      if (!obj || depth > 4) return null;
      if (typeof obj === 'string') {
        const s = obj.trim();
        if (/^https?:\/\//i.test(s)) return s;
        return null;
      }
      if (Array.isArray(obj)) {
        for (const v of obj) {
          const found = findFirstUrl(v, depth + 1);
          if (found) return found;
        }
        return null;
      }
      if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          const found = findFirstUrl(v, depth + 1);
          if (found) return found;
        }
      }
      return null;
    }

    // Step 2: If we have a ContentKey, try the CMS Delivery API first (preferred - returns unauthenticatedUrl)
    if (contentKey) {
      try {
        const cmsResp = await client.get(
          `/services/data/${apiVersion}/connect/cms/delivery/channels/${channelId}/media/${contentKey}`
        );

        const publicUrl = cmsResp.data?.unauthenticatedUrl || cmsResp.data?.url;
        if (publicUrl) {
          logger.debug('Got CMS media URL via delivery API', { contentKey, publicUrl });
          return publicUrl;
        }

        logger.debug('CMS delivery returned no URL', { contentKey, responseKeys: Object.keys(cmsResp.data || {}) });
      } catch (err: any) {
        // Keep going to fallback - delivery API may return 404 for unpublished content
        logger.debug('CMS delivery API failed or returned 404; will attempt ManagedContent fallback', { electronicMediaId, status: err.response?.status, data: err.response?.data });
      }
    } else {
      logger.debug('ManagedContent record has no ContentKey; will attempt to locate URL fields', { electronicMediaId });
    }

    // Step 3: Fallback - inspect the ManagedContent record for any public URL fields (some orgs store absolute URLs already)
    const candidate = findFirstUrl(mcData);
    if (candidate) {
      logger.info('Using URL found in ManagedContent record as fallback', { electronicMediaId, url: candidate });
      return candidate;
    }

    // Step 4: Specific fallback for Shopify CDN paths stored in the ManagedContent `Name` field.
    // Some ManagedContent records store a relative path like `/s/files/1/0255/8191/2144/products/FILE.jpg`.
    // The public CDN URL can be constructed by prefixing `https://cdn.shopify.com`.
    const nameField = mcData.Name || mcData.name || '';
    if (typeof nameField === 'string' && /(?:^\/)?s\/files\//i.test(nameField)) {
      const path = nameField.startsWith('/') ? nameField : `/${nameField}`;
      const shopifyUrl = `https://cdn.shopify.com${path}`;
      logger.info('Constructed Shopify CDN URL from ManagedContent Name', { electronicMediaId, url: shopifyUrl });
      return shopifyUrl;
    }

    logger.warn('No public URL found for ManagedContent', { electronicMediaId });
    return null;
  } catch (err: any) {
    logger.warn('Failed to fetch CMS media', { 
      electronicMediaId, 
      error: err.message,
      status: err.response?.status,
      data: err.response?.data
    });
    return null;
  }
}

/**
 * Resolve product images from Salesforce CMS.
 * 
 * Flow:
 * 1. Query ProductMedia to get ElectronicMediaId references
 * 2. Get CMS channel ID
 * 3. Fetch each media item via Connect CMS Delivery API
 * 4. Return public CDN URLs
 * 
 * @param productId - Salesforce Product2 ID
 * @returns Array of public image URLs
 */
export async function getProductImageUrls(productId: string): Promise<string[]> {
  try {
    const client = salesforceClient.getClient();
    const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';

    // Step 1: Query ProductMedia for the product's CMS media references
    const pmSoql = `SELECT Id, ElectronicMediaId FROM ProductMedia WHERE ProductId = '${productId}' ORDER BY SortOrder ASC NULLS LAST LIMIT 5`;
    const pmResp = await client.get(`/services/data/${apiVersion}/query`, {
      params: { q: pmSoql },
    });

    const pmRecords = pmResp.data?.records || [];
    if (pmRecords.length === 0) {
      logger.debug('No ProductMedia found', { productId });
      return [];
    }

    // Step 2: Get CMS channel ID
    const channelId = await getCmsChannelId();
    if (!channelId) {
      logger.warn('No CMS channel available for media resolution');
      return [];
    }

    // Step 3: Fetch each media item via CMS Delivery API
    const urls: string[] = [];
    
    for (const pm of pmRecords) {
      const mediaId = pm.ElectronicMediaId;
      if (!mediaId) continue;
      
      const url = await fetchCmsMediaUrl(channelId, mediaId);
      if (url) {
        urls.push(url);
      }
    }

    logger.info('Resolved product CMS images', { productId, count: urls.length });
    return urls;
  } catch (err: any) {
    logger.error('Failed to resolve product images', { productId, message: err.message });
    return [];
  }
}

/**
 * Batch resolve images for multiple products.
 * More efficient than calling getProductImageUrls for each product.
 */
export async function batchGetProductImageUrls(productIds: string[]): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();
  
  if (productIds.length === 0) return results;
  
  try {
    const client = salesforceClient.getClient();
    const apiVersion = config.SALESFORCE_API_VERSION || 'v57.0';
    
    // Step 1: Get channel ID first
    const channelId = await getCmsChannelId();
    if (!channelId) {
      logger.warn('No CMS channel available for batch media resolution');
      return results;
    }

    // Step 2: Query all ProductMedia for the given products in one query
    const productIdList = productIds.map(id => `'${id}'`).join(',');
    const pmSoql = `SELECT ProductId, ElectronicMediaId FROM ProductMedia WHERE ProductId IN (${productIdList}) ORDER BY ProductId, SortOrder ASC NULLS LAST`;
    
    const pmResp = await client.get(`/services/data/${apiVersion}/query`, {
      params: { q: pmSoql },
    });

    const pmRecords = pmResp.data?.records || [];
    
    // Group by ProductId
    const mediaByProduct = new Map<string, string[]>();
    for (const pm of pmRecords) {
      const pid = pm.ProductId;
      const emId = pm.ElectronicMediaId;
      if (!pid || !emId) continue;
      
      if (!mediaByProduct.has(pid)) {
        mediaByProduct.set(pid, []);
      }
      mediaByProduct.get(pid)!.push(emId);
    }

    // Step 3: Fetch CMS URLs (limit to first image per product for performance)
    for (const [productId, mediaIds] of mediaByProduct) {
      const urls: string[] = [];
      
      // Only fetch first image to reduce API calls
      const firstMediaId = mediaIds[0];
      if (firstMediaId) {
        const url = await fetchCmsMediaUrl(channelId, firstMediaId);
        if (url) {
          urls.push(url);
        }
      }
      
      results.set(productId, urls);
    }

    logger.info('Batch resolved product images', { 
      requestedProducts: productIds.length, 
      resolvedProducts: results.size 
    });
    
    return results;
  } catch (err: any) {
    logger.error('Batch image resolution failed', { message: err.message });
    return results;
  }
}

// Legacy exports for backward compatibility
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

export async function getProductElectronicMedia(productId: string): Promise<ElectronicMediaInfo[]> {
  const urls = await getProductImageUrls(productId);
  return urls.map((url, i) => ({
    electronicMediaId: `media-${i}`,
    mediaUrl: url,
    alternateText: '',
  }));
}

export async function getProductContentVersions(_productId: string): Promise<ContentVersionInfo[]> {
  // Not used for CMS-based images
  return [];
}

export async function getContentVersionData(_contentVersionId: string): Promise<{ data: Buffer; mimeType: string } | null> {
  // Not used for CMS-based images - they're served via public CDN URLs
  return null;
}

export async function getElectronicMediaData(_electronicMediaId: string): Promise<{ data: Buffer; mimeType: string } | null> {
  // Not used for CMS-based images - they're served via public CDN URLs
  return null;
}

export function buildProxyImageUrl(mediaId: string, backendBaseUrl?: string): string {
  // Not needed - CMS images are public CDN URLs
  const base = backendBaseUrl ? backendBaseUrl.replace(/\/+$/, '') : '';
  return `${base}/api/media/salesforce/${mediaId}`;
}

export default {
  getCmsChannelId,
  getProductImageUrls,
  batchGetProductImageUrls,
  getProductElectronicMedia,
  getProductContentVersions,
  getContentVersionData,
  getElectronicMediaData,
  buildProxyImageUrl,
};
