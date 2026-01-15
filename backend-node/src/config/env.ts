import dotenv from "dotenv";

// Load environment variables
dotenv.config();

export const config = {
  // Server
    PORT: Number(process.env.PORT || 3002),
  NODE_ENV: process.env.NODE_ENV || "development",

  // Python Assistant API
  PYTHON_BASE_URL: process.env.PYTHON_BASE_URL || "http://localhost:8000",

  // Shopify credentials
  SHOPIFY_STORE_DOMAIN: (process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, ""),
  SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN || "",
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2024-01",

  // Salesforce credentials
  SALESFORCE_BASE_URL: process.env.SALESFORCE_BASE_URL || "",
    SALESFORCE_SITE_BASE_URL: process.env.SALESFORCE_SITE_BASE_URL || "",
  SALESFORCE_TOKEN_URL: process.env.SALESFORCE_TOKEN_URL || "",
  SALESFORCE_CLIENT_ID: process.env.SALESFORCE_CLIENT_ID || "",
  SALESFORCE_CLIENT_SECRET: process.env.SALESFORCE_CLIENT_SECRET || "",
  SALESFORCE_JWT_CLIENT_ID: process.env.SALESFORCE_JWT_CLIENT_ID || "",
  SALESFORCE_JWT_USERNAME: process.env.SALESFORCE_JWT_USERNAME || "",
  SALESFORCE_JWT_PRIVATE_KEY: process.env.SALESFORCE_JWT_PRIVATE_KEY || "",
  SALESFORCE_USERNAME: process.env.SALESFORCE_USERNAME || "",
  SALESFORCE_PASSWORD: process.env.SALESFORCE_PASSWORD || "",
  SALESFORCE_SECURITY_TOKEN: process.env.SALESFORCE_SECURITY_TOKEN || "",
  SALESFORCE_API_VERSION: process.env.SALESFORCE_API_VERSION || "v57.0",
  SALESFORCE_WEBSTORE_ID: process.env.SALESFORCE_WEBSTORE_ID || "0ZEdL000002glCfWAI",
  
  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || "easymart-secret-change-in-production",

  // CORS/CSP: Comma-separated list of allowed origins for widget embedding
  // Example: "https://mystore.my.site.com,https://admin.shopify.com"
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "",
  // Optional public backend URL (used to build absolute proxy URLs). If not set, proxy URLs will be relative.
  BACKEND_BASE_URL: (process.env.BACKEND_BASE_URL || '').replace(/\/+$/, ''),
};

// Validate required environment variables
const requiredEnvVars = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ACCESS_TOKEN"];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar] && config.NODE_ENV === "production") {
    console.warn(`⚠️  Warning: ${envVar} is not set in environment variables`);
  }
}
