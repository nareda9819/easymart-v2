@RestResource(urlMapping='/WidgetHelper/*')
global with sharing class WidgetHelper {
    
    @HttpGet
    global static WidgetContext getContext() {
        WidgetContext ctx = new WidgetContext();
        
        try {
            // Get current user's account ID
            User currentUser = [
                SELECT Id, AccountId, ContactId 
                FROM User 
                WHERE Id = :UserInfo.getUserId() 
                LIMIT 1
            ];
            
            ctx.success = true;
            ctx.userId = currentUser.Id;
            ctx.accountId = currentUser.AccountId;
            ctx.contactId = currentUser.ContactId;
            
        } catch (Exception e) {
            ctx.success = false;
            ctx.message = e.getMessage();
        }
        
        return ctx;
    }
    
    global class WidgetContext {
        public Boolean success;
        public String message;
        public String userId;
        public String accountId;
        public String contactId;
    }
	@AuraEnabled(cacheable=true)
public static String getBuyerAccountId() {
    try {
        // Get ContactId from User
        User u = [
            SELECT ContactId
            FROM User
            WHERE Id = :UserInfo.getUserId()
            LIMIT 1
        ];

        // Internal user → no contact
        if (u.ContactId == null) {
            return null;
        }

        // Get AccountId from Contact
        Contact c = [
            SELECT AccountId
            FROM Contact
            WHERE Id = :u.ContactId
            LIMIT 1
        ];

        return c.AccountId;

    } catch (Exception e) {
        System.debug('Error getting buyer account: ' + e.getMessage());
        return null;
    }
}

}