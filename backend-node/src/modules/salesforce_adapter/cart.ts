import { salesforceClient } from './client';
import { logger } from '../observability/logger';

export interface ApexCartLine {
  cartItemId: string;
  productId: string;
  quantity: number;
  // Optional fields that some Apex implementations may return on cart lines
  productName?: string;
  name?: string;
  title?: string;
  unitPrice?: number;
  price?: number | string;
  imageUrl?: string;
  image?: string;
}

export interface ApexGetCartResponse {
  success: boolean;
  message?: string;
  cartId?: string;
  lines?: ApexCartLine[];
}

export interface ApexAddToCartResponse {
  success: boolean;
  message?: string;
  cartId?: string;
  cartItemId?: string;
}

export interface ApexUpdateCartItemResponse {
  success: boolean;
  message?: string;
  quantity?: number;
  cartItemId?: string;
}

export interface ApexDeleteCartItemResponse {
  success: boolean;
  message?: string;
  cartItemId?: string;
}

/**
 * Get cart from Salesforce using Apex REST CartApi
 */
export async function getCart(): Promise<ApexGetCartResponse> {
  try {
    const client = salesforceClient.getClient();
    const resp = await client.get('/services/apexrest/CartApi');
    logger.info('Salesforce getCart response', { success: resp.data?.success, lineCount: resp.data?.lines?.length });
    return resp.data;
  } catch (error: any) {
    logger.error('Salesforce getCart failed', { message: error.message });
    return { success: false, message: error.message, lines: [] };
  }
}

/**
 * Add product to Salesforce cart
 */
export async function addToCart(productId: string, quantity: number): Promise<ApexAddToCartResponse> {
  try {
    const client = salesforceClient.getClient();
    const payload = { productId, quantity };
    const resp = await client.post('/services/apexrest/CartApi', payload);
    logger.info('Salesforce addToCart response', { success: resp.data?.success, cartItemId: resp.data?.cartItemId });
    return resp.data;
  } catch (error: any) {
    logger.error('Salesforce addToCart failed', { productId, quantity, message: error.message });
    return { success: false, message: error.message };
  }
}

/**
 * Update cart item quantity (or delete if quantity <= 0)
 */
export async function updateCartItem(cartItemId: string, quantity: number): Promise<ApexUpdateCartItemResponse> {
  try {
    const client = salesforceClient.getClient();
    const payload = { cartItemId, quantity };
    const resp = await client.patch('/services/apexrest/CartApi', payload);
    logger.info('Salesforce updateCartItem response', { success: resp.data?.success, cartItemId: resp.data?.cartItemId });
    return resp.data;
  } catch (error: any) {
    logger.error('Salesforce updateCartItem failed', { cartItemId, quantity, message: error.message });
    return { success: false, message: error.message };
  }
}

/**
 * Remove item from cart
 */
export async function removeFromCart(cartItemId: string): Promise<ApexDeleteCartItemResponse> {
  try {
    const client = salesforceClient.getClient();
    const payload = { cartItemId };
    const resp = await client.delete('/services/apexrest/CartApi', { data: payload });
    logger.info('Salesforce removeFromCart response', { success: resp.data?.success, cartItemId: resp.data?.cartItemId });
    return resp.data;
  } catch (error: any) {
    logger.error('Salesforce removeFromCart failed', { cartItemId, message: error.message });
    return { success: false, message: error.message };
  }
}

export default { getCart, addToCart, updateCartItem, removeFromCart };
