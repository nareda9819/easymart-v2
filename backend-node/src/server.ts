import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import { registerWebModule } from "./modules/web/web.module";
import { config } from "./config";
import { logger } from "./modules/observability/logger";

export async function startServer() {
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  // Parse allowed origins from config (comma-separated string to array)
  const allowedOrigins = config.ALLOWED_ORIGINS
    ? config.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [];

  // Register CORS - restrict to allowed origins in production
  await fastify.register(fastifyCors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }
      // In development, allow all origins
      if (config.NODE_ENV !== "production") {
        return callback(null, true);
      }
      // In production, check against whitelist
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Origin not allowed
      logger.warn(`CORS blocked origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
  });

  // Register static file serving for widget assets (JS, CSS)
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, "modules/web/ui"),
    prefix: "/widget/",
  });

  // ============================================
  // WIDGET EMBED ROUTE (serves iframe content)
  // ============================================
  // Why: This HTML page loads inside an iframe on the Salesforce site.
  //      We set CSP frame-ancestors to only allow specific origins to embed it.
  fastify.get("/widget/embed", async (request, reply) => {
    // Get shop/site from query param or fall back to config
    const query = request.query as { shop?: string; site?: string };
    const siteOrigin = query.shop || query.site || config.SALESFORCE_SITE_BASE_URL || config.SHOPIFY_STORE_DOMAIN || "";
    
    // Build frame-ancestors list: the site origin + any additional allowed origins
    const frameAncestors = [
      siteOrigin ? `https://${siteOrigin.replace(/^https?:\/\//, "")}` : "",
      ...allowedOrigins,
    ].filter(Boolean).join(" ");

    // Build Content-Security-Policy header
    // - default-src 'self': only allow resources from same origin
    // - script-src 'self': only allow scripts from same origin
    // - style-src 'self' 'unsafe-inline': allow inline styles (needed for widget)
    // - frame-ancestors: ONLY these origins can embed this page in an iframe
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'", // Allow fetch to same origin (backend API)
      `frame-ancestors ${frameAncestors || "'none'"}`,
    ].join("; ");

    // Set CSP header
    reply.header("Content-Security-Policy", csp);

    // Return the embed HTML page
    // This page loads inside the iframe and contains the chat widget
    reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Easymart Chat Widget</title>
  <link rel="stylesheet" href="/widget/chat-widget.css">
  <style>
    /* Remove default body margin so widget fills iframe */
    body { margin: 0; padding: 0; }
    /* Position the chat container to fill iframe */
    #easymart-chat-container {
      position: relative !important;
      width: 100% !important;
      height: 100vh !important;
    }
    /* Make chat box fill the iframe */
    .easymart-chat-box {
      position: absolute !important;
      bottom: 0 !important;
      right: 0 !important;
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      border-radius: 0 !important;
    }
    /* Hide the floating toggle button (not needed in iframe) */
    .easymart-chat-toggle { display: none !important; }
  </style>
</head>
<body>
  <!-- Widget will be injected here by chat-widget.js -->
  
  <script>
    // Pass configuration to widget script
    // EASYMART_BACKEND_URL: where the widget sends chat messages
    // EASYMART_IFRAME_MODE: tells widget it's inside an iframe (use postMessage)
    // EASYMART_PARENT_ORIGIN: parent origin for postMessage (security)
    window.EASYMART_BACKEND_URL = "/api/chat";
    window.EASYMART_IFRAME_MODE = true;
    window.EASYMART_PARENT_ORIGIN = ${JSON.stringify(siteOrigin ? `https://${siteOrigin.replace(/^https?:\/\//, "")}` : "*")};
  </script>
  <script src="/widget/chat-widget.js"></script>
</body>
</html>`);
  });

  // Register modules
  await registerWebModule(fastify);

  // Global health check
  fastify.get("/health", async () => ({
    status: "ok",
    service: "easymart-node-backend",
    timestamp: new Date().toISOString(),
  }));

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    logger.error("Request error", { error: error.message, path: request.url });
    reply.status(500).send({ error: "Internal Server Error" });
  });

  // Start server
  try {
    await fastify.listen({
      port: config.PORT,
      host: "0.0.0.0",
    });
    logger.info(`🚀 Server running on port ${config.PORT}`);
  } catch (err) {
    logger.error("Failed to start server", err);
    throw err;
  }

  return fastify;
}
