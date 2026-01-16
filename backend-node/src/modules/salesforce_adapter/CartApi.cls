@RestResource(urlMapping='/CartApi/*')
global with sharing class CartApi {

    /* =================================================
       ADD TO CART (UNCHANGED)
       ================================================= */
    @HttpPost
    global static AddToCartResponse addToCart() {

        RestResponse res = RestContext.response;
        AddToCartResponse out = new AddToCartResponse();

        try {
            AddToCartRequest req =
                (AddToCartRequest) JSON.deserialize(
                    RestContext.request.requestBody.toString(),
                    AddToCartRequest.class
                );

            if (String.isBlank(req.productId) || req.quantity == null || req.quantity <= 0) {
                return error(out, res, 400, 'Invalid productId or quantity');
            }

            Id webStoreId = [
                SELECT Id FROM WebStore
                WHERE Name = 'FantasticEcomm'
                LIMIT 1
            ].Id;

            Id buyerAccountId = '001dL00001jFm6lQAC';

            ConnectApi.CartSummary summary =
                ConnectApi.CommerceCart.getOrCreateActiveCartSummary(
                    webStoreId,
                    buyerAccountId,
                    'active'
                );

            WebCart cart = [
                SELECT Id, AccountId
                FROM WebCart
                WHERE Id = :summary.cartId
                LIMIT 1
            ];

            ConnectApi.CartItemInput input = new ConnectApi.CartItemInput();
            input.productId = req.productId;
            input.quantity  = String.valueOf(req.quantity);
            input.type      = ConnectApi.CartItemType.Product;

            ConnectApi.CommerceCart.addItemToCart(
                webStoreId,
                cart.AccountId,
                cart.Id,
                input,
                UserInfo.getDefaultCurrency()
            );

            // Query the created WebCartItem to obtain the cart item Id
            CartItem createdItem = [
                SELECT Id
                FROM CartItem
                WHERE CartId = :cart.Id AND Product2Id = :req.productId
                ORDER BY CreatedDate DESC
                LIMIT 1
            ];

            out.success = true;
            out.cartId    = cart.Id;
            out.cartItemId = (createdItem != null) ? createdItem.Id : null;
            out.message   = 'Item added to cart';
            res.statusCode = 200;

        } catch (Exception e) {
            out.success = false;
            out.message = e.getMessage();
            res.statusCode = 500;
        }

        return out;
    }

    /* =================================================
       READ CART (SOURCE OF cartItemId)
       ================================================= */
@HttpGet
global static GetCartResponse getCart() {

    RestResponse res = RestContext.response;
    RestRequest req = RestContext.request;
    GetCartResponse out = new GetCartResponse();
    out.lines = new List<CartLine>();

    try {
        Id webStoreId = [
            SELECT Id
            FROM WebStore
            WHERE Name = 'FantasticEcomm'
            LIMIT 1
        ].Id;

        // Get buyerAccountId from query parameter, fallback to hardcoded value
        String buyerAccountIdParam = req.params.get('buyerAccountId');
        Id buyerAccountId = String.isNotBlank(buyerAccountIdParam) 
            ? (Id)buyerAccountIdParam 
            : '001dL00001jFm6lQAC';

        System.debug('CartApi.getCart - Using buyerAccountId: ' + buyerAccountId);

        ConnectApi.CartSummary summary =
            ConnectApi.CommerceCart.getOrCreateActiveCartSummary(
                webStoreId,
                buyerAccountId,
                'active'
            );

        WebCart cart = [
            SELECT Id
            FROM WebCart
            WHERE Id = :summary.cartId
            LIMIT 1
        ];

        // 🔴 LOOP SCOPE IS CORRECT HERE
        for (CartItem wcItem : [
            SELECT Id, Product2Id, Quantity
            FROM CartItem
            WHERE CartId = :cart.Id
        ]) {
            CartLine line = new CartLine();
            line.cartItemId = wcItem.Id;
            line.productId  = wcItem.Product2Id;
            line.quantity   = Integer.valueOf(wcItem.Quantity);
            out.lines.add(line);
        }

        out.cartId  = cart.Id;
        out.success = true;
        res.statusCode = 200;

    } catch (Exception e) {
        out.success = false;
        out.message = e.getMessage();
        res.statusCode = 500;
    }

    return out;
}

    /* =================================================
       UPDATE / DELETE CART ITEM (+ / − / 🗑️)
       ================================================= */
    @HttpPatch
    global static UpdateCartItemResponse updateCartItem() {

        RestResponse res = RestContext.response;
        UpdateCartItemResponse out = new UpdateCartItemResponse();

        try {
            UpdateCartItemRequest req =
                (UpdateCartItemRequest) JSON.deserialize(
                    RestContext.request.requestBody.toString(),
                    UpdateCartItemRequest.class
                );

            if (String.isBlank(req.cartItemId)) {
                return errorUpdate(out, res, 400, 'cartItemId is required');
            }

            Id webStoreId = [
                SELECT Id FROM WebStore
                WHERE Name = 'FantasticEcomm'
                LIMIT 1
            ].Id;

            Id buyerAccountId = '001dL00001jFm6lQAC';

            ConnectApi.CartSummary summary =
                ConnectApi.CommerceCart.getOrCreateActiveCartSummary(
                    webStoreId,
                    buyerAccountId,
                    'active'
                );

            WebCart cart = [
                SELECT Id, AccountId
                FROM WebCart
                WHERE Id = :summary.cartId
                LIMIT 1
            ];

            if (req.quantity == null || req.quantity <= 0) {
                // DELETE
                ConnectApi.CommerceCart.deleteCartItem(
                    webStoreId,
                    cart.AccountId,
                    cart.Id,
                    req.cartItemId
                );
                out.cartItemId = req.cartItemId;
                out.message = 'Item removed';
            } else {
                // UPDATE
                ConnectApi.CartItemInput input = new ConnectApi.CartItemInput();
                input.quantity = String.valueOf(req.quantity);

                ConnectApi.CommerceCart.updateCartItem(
                    webStoreId,
                    cart.AccountId,
                    cart.Id,
                    req.cartItemId,
                    input
                );
                out.quantity = req.quantity;
                out.cartItemId = req.cartItemId;
                out.message  = 'Item updated';
            }

            out.success = true;
            res.statusCode = 200;

        } catch (Exception e) {
            out.success = false;
            out.message = e.getMessage();
            res.statusCode = 500;
        }

        return out;
    }

    /* =================================================
       DELETE CART ITEM (explicit DELETE handler)
       ================================================= */
    @HttpDelete
    global static DeleteCartItemResponse deleteCartItem() {

        RestResponse res = RestContext.response;
        DeleteCartItemResponse out = new DeleteCartItemResponse();

        try {
            DeleteCartItemRequest req =
                (DeleteCartItemRequest) JSON.deserialize(
                    RestContext.request.requestBody.toString(),
                    DeleteCartItemRequest.class
                );

            if (String.isBlank(req.cartItemId)) {
                return errorDelete(out, res, 400, 'cartItemId is required');
            }

            Id webStoreId = [
                SELECT Id FROM WebStore
                WHERE Name = 'FantasticEcomm'
                LIMIT 1
            ].Id;

            Id buyerAccountId = '001dL00001jFm6lQAC';

            ConnectApi.CartSummary summary =
                ConnectApi.CommerceCart.getOrCreateActiveCartSummary(
                    webStoreId,
                    buyerAccountId,
                    'active'
                );

            WebCart cart = [
                SELECT Id, AccountId
                FROM WebCart
                WHERE Id = :summary.cartId
                LIMIT 1
            ];

            ConnectApi.CommerceCart.deleteCartItem(
                webStoreId,
                cart.AccountId,
                cart.Id,
                req.cartItemId
            );

            out.cartItemId = req.cartItemId;
            out.success = true;
            out.message = 'Item removed';
            res.statusCode = 200;

        } catch (Exception e) {
            out.success = false;
            out.message = e.getMessage();
            res.statusCode = 500;
        }

        return out;
    }

    /* =================================================
       DTOs
       ================================================= */
    global class AddToCartRequest {
        public String productId;
        public Integer quantity;
    }

    global class UpdateCartItemRequest {
        public String cartItemId;
        public Integer quantity;
    }

    global class AddToCartResponse {
        public Boolean success;
        public String message;
        public Id cartId;
        public String cartItemId;
    }

    global class UpdateCartItemResponse {
        public Boolean success;
        public String message;
        public Integer quantity;
        public String cartItemId;
    }

    global class DeleteCartItemRequest {
        public String cartItemId;
    }

    global class DeleteCartItemResponse {
        public Boolean success;
        public String message;
        public String cartItemId;
    }

    global class GetCartResponse {
        public Boolean success;
        public String message;
        public Id cartId;
        public List<CartLine> lines;
    }

    global class CartLine {
        public String cartItemId;
        public String productId;
        public Integer quantity;
    }

    /* =================================================
       HELPERS
       ================================================= */
    private static AddToCartResponse error(
        AddToCartResponse r,
        RestResponse res,
        Integer status,
        String msg
    ) {
        r.success = false;
        r.message = msg;
        res.statusCode = status;
        return r;
    }

    private static UpdateCartItemResponse errorUpdate(
        UpdateCartItemResponse r,
        RestResponse res,
        Integer status,
        String msg
    ) {
        r.success = false;
        r.message = msg;
        res.statusCode = status;
        return r;
    }

    private static DeleteCartItemResponse errorDelete(
        DeleteCartItemResponse r,
        RestResponse res,
        Integer status,
        String msg
    ) {
        r.success = false;
        r.message = msg;
        res.statusCode = status;
        return r;
    }
}