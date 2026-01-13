/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,

    // API proxy to Node.js backend
    async rewrites() {
        return [{
            source: '/api/:path*',
            destination: process.env.NEXT_PUBLIC_API_URL + '/api/:path*',
        }, ];
    },

    // Allow dev origins (fixes cross-origin warning)
    allowedDevOrigins: ['127.0.0.1', 'localhost'],

    // Image configuration for Shopify CDN and Salesforce
    images: {
        remotePatterns: [{
                protocol: 'https',
                hostname: 'cdn.shopify.com',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'easymartdummy.myshopify.com',
                pathname: '/**',
            },
            // Salesforce image domains
            {
                protocol: 'https',
                hostname: '**.force.com',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: '**.salesforce.com',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: '**.salesforceusercontent.com',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: '**.documentforce.com',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: '**.content.force.com',
                pathname: '/**',
            },
        ],
    },

    // Environment variables
    env: {
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
    },

    // Enable SWC minification
    swcMinify: true,

    // Experimental features
    experimental: {
        optimizeCss: true,
    },

    // Enable standalone output for Docker
    //output: 'standalone',

    async headers() {
        return [
            {
                // Apply to both /chat and /embed routes
                source: '/:path(chat|embed)',
                headers: [
                    {
                        key: 'Content-Security-Policy',
                        value: [
                            "frame-ancestors 'self'",
                            "https://orgfarm-e6b615be40-dev-ed.develop.my.site.com",
                            "https://orgfarm-e6b615be40-dev-ed.develop.preview.salesforce-experience.com",
                            "https://*.salesforce.com",
                            "https://*.force.com",
                            "https://*.salesforce-experience.com",
                        ].join(' '),
                    },
                ],
            },
        ];
    },
};

module.exports = nextConfig;