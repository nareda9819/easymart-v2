# Salesforce Site Base URL Configuration - Steps Documentation

## Issue
TypeScript compilation error in `products.ts`:
```
Property 'SALESFORCE_SITE_BASE_URL' does not exist on type '{ PORT: number; NODE_ENV: string; ... }'. 
Did you mean 'SALESFORCE_BASE_URL'?
```

**Location**: Line 78 in `products.ts`

## Root Cause
The `products.ts` file was attempting to access `config.SALESFORCE_SITE_BASE_URL`, but this property was not defined in the configuration object exported from `env.ts`.

## Solution Steps

### Step 1: Identify the Missing Configuration
- **File**: `backend-node/src/config/env.ts`
- **Issue**: The `config` object was missing the `SALESFORCE_SITE_BASE_URL` property
- **Usage**: This property is used in `products.ts` to construct product URLs for the Salesforce Experience Cloud site

### Step 2: Add the Missing Property
- **File Modified**: `backend-node/src/config/env.ts`
- **Line Added**: Line 21
- **Code Added**:
  ```typescript
  SALESFORCE_SITE_BASE_URL: process.env.SALESFORCE_SITE_BASE_URL || "",
  ```

### Step 3: Verify the Fix
The configuration now includes:
```typescript
// Salesforce credentials
SALESFORCE_BASE_URL: process.env.SALESFORCE_BASE_URL || "",
SALESFORCE_SITE_BASE_URL: process.env.SALESFORCE_SITE_BASE_URL || "",
SALESFORCE_TOKEN_URL: process.env.SALESFORCE_TOKEN_URL || "",
// ... other Salesforce configs
```

## How It Works

### Environment Variable
Add to your `.env` file:
```env
SALESFORCE_SITE_BASE_URL=https://your-domain.my.site.com
```

### Usage in products.ts
The `SALESFORCE_SITE_BASE_URL` is used in the `normalizeProductFromApex` function to construct product URLs:

```typescript
const siteBase = (config.SALESFORCE_SITE_BASE_URL || runtimeBase || config.SALESFORCE_BASE_URL || '')
  .replace(/\/+$/, '');

const siteUrl = siteBase ? `${siteBase}/FantasticEcomm/product/${handle}/${id}` : undefined;
```

### URL Pattern
The final product URL follows the pattern:
```
{SALESFORCE_SITE_BASE_URL}/FantasticEcomm/product/{handle}/{productId}
```

Example:
```
https://your-domain.my.site.com/FantasticEcomm/product/smart-home-hub/a0h8c000001234ABC
```

## Configuration Priority
The system uses a fallback chain for determining the site base URL:

1. **SALESFORCE_SITE_BASE_URL** (explicit site URL from env)
2. **Runtime Instance URL** (from Salesforce client connection)
3. **SALESFORCE_BASE_URL** (general Salesforce instance URL)

## Testing
After making this change:
1. Ensure TypeScript compilation succeeds
2. Verify that product URLs are correctly generated
3. Test that the URLs navigate to the correct product pages on your Salesforce Experience Cloud site

## Related Files
- `backend-node/src/config/env.ts` - Configuration definition
- `backend-node/src/modules/salesforce_adapter/products.ts` - Product URL generation
- `.env` - Environment variable configuration (not in repo)

## Date
January 9, 2026
