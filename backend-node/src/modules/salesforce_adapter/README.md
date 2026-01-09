# Salesforce Adapter

This module provides a thin adapter to Salesforce for product search and cart operations.

Environment variables (see `backend-node/.env` or `.env.example`):

- `SALESFORCE_CLIENT_ID`
- `SALESFORCE_CLIENT_SECRET` (optional for password grant)
- `SALESFORCE_JWT_CLIENT_ID` (optional)
- `SALESFORCE_JWT_USERNAME`
- `SALESFORCE_JWT_PRIVATE_KEY` (PEM, escape newlines as `\\n` in `.env`)
- `SALESFORCE_USERNAME` (password grant fallback)
- `SALESFORCE_PASSWORD` (password grant fallback)
- `SALESFORCE_SECURITY_TOKEN` (password grant fallback)
- `SALESFORCE_TOKEN_URL` (e.g. `https://login.salesforce.com/services/oauth2/token`)
- `SALESFORCE_BASE_URL` (optional; adapter will use token `instance_url` if omitted)
- `SALESFORCE_API_VERSION` (e.g. `v57.0`)

Usage:

```ts
import { searchProducts, addToCart, getCart } from './modules/salesforce_adapter';

const results = await searchProducts('alpine', 5);
await addToCart('01tdL00000XdAEHQA3', 1);
const cart = await getCart();
```

Notes:
- This adapter expects Apex REST endpoints under `/services/apexrest/catalog` and `/services/apexrest/cart`.
- Adjust endpoints in `products.ts` / `cart.ts` if your org exposes different routes.
