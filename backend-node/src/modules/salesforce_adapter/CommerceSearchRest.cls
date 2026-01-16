/**
 * CommerceSearchRest
 *
 * IMPORTANT:
 * - This Apex REST is NOT a substitute for B2B Commerce Storefront search.
 * - It provides a minimal, FLS-aware, user-mode, admin-style lookup on core objects.
 * - It does NOT attempt to replicate storefront entitlements/pricing/visibility.
 *
 * Returns internal catalog results with optional pricebook lookup and NO media URLs,
 * to avoid leaking internal org URLs or requiring user sessions in the client.
 */
@RestResource(urlMapping='/commerce/search')
global with sharing class CommerceSearchRest {

    // Request DTO
    global class SearchRequest {
        public String query;
        public Integer pageSize;
        public Id effectiveAccountId; // used only to hint pricebook; NOT identity
    }

    // Product DTO returned to caller
    global class ProductDTO {
        public Id productId;
        public String productName;
        public Decimal unitPrice;
        public String currencyIsoCode; // avoid reserved identifier 'currency'
        public String imageUrl; // intentionally left null (no internal URLs)
    }

    // Response wrapper
    global class SearchResponse {
        public List<ProductDTO> products = new List<ProductDTO>();
        public Integer totalSize = 0;
    }

    @HttpPost
    global static void doSearch() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;

        try {
            if (req.requestBody == null) {
                badRequest('Missing request body');
                return;
            }

            SearchRequest sr = (SearchRequest) JSON.deserialize(req.requestBody.toString(), SearchRequest.class);

            if (sr == null || String.isBlank(sr.query)) {
                badRequest('query is required');
                return;
            }

            Integer pageSize = (sr.pageSize != null && sr.pageSize > 0) ? Integer.valueOf(Math.min(sr.pageSize, 50)) : 10;

            // Determine a pricebook hint (admin-style). This is NOT storefront pricing/entitlements.
            Id pricebookId = null;
            if (sr.effectiveAccountId != null) {
                // If your org associates accounts to pricebooks via a custom field, set the API name here.
                // Many orgs do NOT have Account.Pricebook2Id. We therefore do NOT reference it directly.
                // Option A (recommended): pass an explicit Pricebook2Id in the request instead of Account Id.
                // Option B: implement your own mapping in a custom metadata or custom field and read it here.

                // No direct Account->Pricebook2 reference. Leave pricebookId null to fall back to Standard PB.
                // If you want to support a custom mapping, add your field API name below and enable FLS checks.
                // Example:
                // if (Schema.sObjectType.Account.fields.My_Pricebook__c.isAccessible()) {
                //     Account acct = [SELECT My_Pricebook__c FROM Account WHERE Id = :sr.effectiveAccountId LIMIT 1];
                //     pricebookId = acct.My_Pricebook__c;
                // }
            }

            if (pricebookId == null) {
                // FLS/CRUD check for Pricebook2 read
                if (!Schema.sObjectType.Pricebook2.isAccessible()) {
                    forbidden('Insufficient object access for Pricebook2');
                    return;
                }
                // Query the Standard Price Book
                Pricebook2 stdPb = [
                    SELECT Id
                    FROM Pricebook2
                    WHERE IsStandard = true
                    LIMIT 1
                ];
                pricebookId = stdPb != null ? stdPb.Id : null;
            }

            // Build LIKE query
            String likeQuery = '%' + String.escapeSingleQuotes(sr.query) + '%';

            // FLS for Product2 fields
            if (!Schema.sObjectType.Product2.isAccessible()
                || !Schema.sObjectType.Product2.fields.Name.isAccessible()
                || !Schema.sObjectType.Product2.fields.IsActive.isAccessible()) {
                forbidden('Insufficient field-level access for Product2 fields');
                return;
            }

            // Query limited set of fields
            List<Product2> products = [
                SELECT Id, Name
                FROM Product2
                WHERE IsActive = true
                AND (Name LIKE :likeQuery OR (Description != null AND Description LIKE :likeQuery))
                ORDER BY Name
                LIMIT :pageSize
            ];

            List<Id> productIds = new List<Id>();
            for (Product2 p : products) productIds.add(p.Id);

            // Map PricebookEntry by Product2Id for the chosen pricebook (admin-style, not storefront derivation)
            Map<Id, PricebookEntry> pbeMap = new Map<Id, PricebookEntry>();
            if (!productIds.isEmpty() && pricebookId != null) {
                if (!Schema.sObjectType.PricebookEntry.isAccessible()
                    || !Schema.sObjectType.PricebookEntry.fields.UnitPrice.isAccessible()) {
                    // If FLS blocks price access, skip pricing silently
                } else {
                    // NOTE: CurrencyIsoCode is not available if Multi-Currency is disabled.
                    // We only select fields that exist in all orgs by default.
                    for (PricebookEntry pbe : [
                        SELECT Product2Id, UnitPrice
                        FROM PricebookEntry
                        WHERE Pricebook2Id = :pricebookId
                        AND Product2Id IN :productIds
                        AND IsActive = true
                    ]) {
                        pbeMap.put(pbe.Product2Id, pbe);
                    }
                }
            }

            // Build response (no internal Content URLs)
            SearchResponse out = new SearchResponse();
            for (Product2 p : products) {
                ProductDTO dto = new ProductDTO();
                dto.productId = p.Id;
                dto.productName = p.Name;

                PricebookEntry pbe = pbeMap.get(p.Id);
                if (pbe != null) {
                    dto.unitPrice = pbe.UnitPrice;
                } else {
                    dto.unitPrice = null;
                }
                // We cannot reliably return CurrencyIsoCode if org is not multi-currency; omit it.
                dto.currencyIsoCode = null;

                dto.imageUrl = null; // Do not emit internal shepherd links
                out.products.add(dto);
            }

            out.totalSize = out.products.size();
            ok(out);
            return;

        } catch (QueryException qe) {
            serverError('QueryException: ' + qe.getMessage());
            return;
        } catch (Exception ex) {
            serverError('Exception: ' + ex.getMessage());
            return;
        }
    }

    // Helpers

    private static void writeJson(Integer status, Object body) {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        res.statusCode = status;
        res.responseBody = Blob.valueOf(JSON.serialize(body));
    }

    private static void writeError(Integer status, String message) {
        Map<String, Object> payload = new Map<String, Object>{
            'success' => false,
            'error' => message
        };
        writeJson(status, payload);
    }

    private static void ok(Object body) {
        writeJson(200, body);
    }

    private static void badRequest(String message) {
        writeError(400, message);
    }

    private static void forbidden(String message) {
        writeError(403, message);
    }

    private static void serverError(String message) {
        writeError(500, message);
    }
}