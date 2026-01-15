import { salesforceClient } from './client';
import { logger } from '../observability/logger';
import { config } from '../../config/env';
import { batchGetProductImageUrls } from './media';

export interface ProductDTO {
  id: string;
  name: string;
  handle?: string;
  description?: string;
  price?: string;
  images?: string[];
  image?: string;
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
    const products = (items as any[]).map(normalizeProductFromApex);
    
    // Enrich products with images from Salesforce Files if they have no images
    await enrichProductsWithSalesforceImages(products);
    
    return products;
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
  const imgs: string[] = (raw.images || raw.imageUrls || [])
    .map((i: any) => (typeof i === 'string' ? i : i.url))
    .filter(Boolean);
  const image = raw.imageUrl || imgs[0] || undefined;

  return {
    id: raw.productId || raw.Id || raw.id || String(raw.id || ''),
    name: raw.productName || raw.Name || raw.title || raw.name || '',
    handle: raw.handle || raw.slug || undefined,
    description: raw.description || raw.Description || undefined,
    price: String(price),
    images: imgs,
    image,
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

  const imgs: string[] = raw.imageUrl ? [raw.imageUrl] : (raw.images || []).map((i: any) => (typeof i === 'string' ? i : i.url)).filter(Boolean);
  const image = raw.imageUrl || (raw.images && raw.images[0]) || undefined;

  return {
    id,
    name: raw.productName || raw.Name || raw.title || raw.name || '',
    handle: handle || undefined,
    description: raw.description || raw.Description || undefined,
    price: raw.unitPrice != null ? String(raw.unitPrice) : '0',
    images: imgs,
    image,
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

/**
 * Enrich products with images from Salesforce CMS.
 * Uses batch query for efficiency - single SOQL + CMS API calls.
 * Returns public CDN URLs that can be rendered directly by frontend.
 */
async function enrichProductsWithSalesforceImages(products: ProductDTO[]): Promise<void> {
  // Filter products that need images
  const productsNeedingImages = products.filter(p => !p.image && (!p.images || p.images.length === 0));
  
  if (productsNeedingImages.length === 0) {
    return;
  }
  
  logger.info('Enriching products with Salesforce CMS images', { count: productsNeedingImages.length });
  
  try {
    // Use batch function for efficiency
    const productIds = productsNeedingImages.map(p => p.id);
    const imageUrlsMap = await batchGetProductImageUrls(productIds);
    
    // Apply images to products
    for (const product of productsNeedingImages) {
      const urls = imageUrlsMap.get(product.id);
      if (urls && urls.length > 0) {
        product.images = urls;
        product.image = urls[0];
        
        logger.debug('Enriched product with CMS images', { 
          productId: product.id, 
          imageCount: urls.length,
          firstUrl: urls[0]
        });
      }
    }
  } catch (err) {
    const e = err as any;
    logger.warn('Failed to batch fetch images', { error: e?.message });
  }
}

export default { searchProducts, getProductById, getAllProducts };
