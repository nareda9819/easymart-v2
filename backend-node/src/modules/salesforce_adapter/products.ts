import { salesforceClient } from './client';
import { logger } from '../observability/logger';
import { config } from '../../config/env';

export interface ProductDTO {
  id: string;
  name: string;
  handle?: string;
  description?: string;
  price?: string;
  images?: string[];
  url?: string;
  inStock?: boolean;
  variants?: any[];
}

export async function searchProducts(query: string, limit = 10): Promise<ProductDTO[]> {
  try {
    const client = salesforceClient.getClient();
    // Call the Apex REST POST search endpoint defined at @RestResource(urlMapping='/commerce/search')
    const payload = { query, pageSize: limit };
    const resp = await client.post('/services/apexrest/commerce/search', payload);
    logger.info('Salesforce Apex REST search response', { status: resp.status, hasData: !!resp.data });
    // Apex returns { products: [...], totalSize: N } according to CommerceSearchRest
    const items = resp.data?.products || [];
    return (items as any[]).map(normalizeProductFromApex);
  } catch (err) {
    const e = err as any;
    const status = e?.response?.status;
    logger.error('Salesforce Apex REST search failed', { message: e?.message, status });
    // Apex-only mode: do not fallback to SOQL. Return empty array when Apex endpoint missing.
    return [];
  }
}

export async function getProductById(id: string): Promise<ProductDTO | null> {
  try {
    const client = salesforceClient.getClient();
    const resp = await client.get(`/services/apexrest/catalog/product/${id}`);
    return normalizeProduct(resp.data);
  } catch (err) {
    const e = err as any;
    logger.error('Salesforce Apex REST getProductById failed', { id, message: e?.message, status: e?.response?.status });
    // Apex-only mode: do not attempt SOQL fallback
    return null;
  }
}

function normalizeProduct(raw: any): ProductDTO {
  const price = raw.price || raw.listPrice || raw.price_string || '';
  return {
    id: raw.productId || raw.Id || raw.id || String(raw.id || ''),
    name: raw.productName || raw.Name || raw.title || raw.name || '',
    handle: raw.handle || raw.slug || undefined,
    description: raw.description || raw.Description || undefined,
    price: String(price),
    images: (raw.images || raw.imageUrls || []).map((i: any) => (typeof i === 'string' ? i : i.url)),
    url: raw.url || undefined,
    inStock: raw.inStock === undefined ? undefined : Boolean(raw.inStock),
    variants: raw.variants || [],
  };
}

// Normalize product objects returned by the CommerceSearchRest Apex class
function normalizeProductFromApex(raw: any): ProductDTO {
  const id = raw.productId || raw.Id || raw.id || String(raw.id || '');

  // Prefer a handle from Apex if provided; otherwise build from product name
  const handleFromApex = raw.handle || raw.slug || raw.productHandle;
  const handle = handleFromApex || (raw.productName || raw.Name || raw.title || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/(^-|-$)/g, '');

  // Prefer explicit SITE base env, then runtime instanceUrl, then SALESFORCE_BASE_URL
  const runtimeBase = salesforceClient.getInstanceUrl ? salesforceClient.getInstanceUrl() : '';
  const siteBase = (config.SALESFORCE_SITE_BASE_URL || runtimeBase || config.SALESFORCE_BASE_URL || '').replace(/\/+$/, '');

  // Pattern used by your site: /FantasticEcomm/product/{handle}/{id}
  const siteUrl = siteBase ? `${siteBase}/FantasticEcomm/product/${handle}/${id}` : undefined;

  return {
    id,
    name: raw.productName || raw.Name || raw.title || raw.name || '',
    handle: handle || undefined,
    description: raw.description || raw.Description || undefined,
    price: raw.unitPrice != null ? String(raw.unitPrice) : '0',
    images: raw.imageUrl ? [raw.imageUrl] : [],
    url: raw.url || siteUrl,
    inStock: raw.inStock === undefined ? undefined : Boolean(raw.inStock),
    variants: []
  };
}

export async function getAllProducts(limit = 100): Promise<ProductDTO[]> {
  try {
    const client = salesforceClient.getClient();
    const resp = await client.get(`/services/apexrest/catalog/all?limit=${limit}`);
    const items = resp.data?.items || resp.data || [];
    return (items as any[]).map(normalizeProduct);
  } catch (err) {
    return [];
  }
}

export default { searchProducts, getProductById, getAllProducts };
