global with sharing class WidgetHelper {

    // Internal helper: safely determine AccountId for current user
    public static Id getAccountIdForCurrentUser() {
        Id userId = UserInfo.getUserId();

        // Use describe to check which fields exist on User in this org
        Map<String, Schema.SObjectField> userFields = Schema.SObjectType.User.fields.getMap();

        try {
            // If User has AccountId field, prefer that (some orgs may have it)
            if (userFields.containsKey('AccountId')) {
                String q = 'SELECT Id, AccountId FROM User WHERE Id = '\'' + String.escapeSingleQuotes(String.valueOf(userId)) + '\' LIMIT 1';
                User u = (User) Database.query(q);
                if (u != null && u.AccountId != null) return u.AccountId;
            }

            // If User has ContactId field, fetch Contact.AccountId
            if (userFields.containsKey('ContactId')) {
                String q2 = 'SELECT Id, ContactId FROM User WHERE Id = '\'' + String.escapeSingleQuotes(String.valueOf(userId)) + '\' LIMIT 1';
                User u2 = (User) Database.query(q2);
                if (u2 != null && u2.ContactId != null) {
                    String q3 = 'SELECT AccountId FROM Contact WHERE Id = '\'' + String.escapeSingleQuotes(String.valueOf(u2.ContactId)) + '\' LIMIT 1';
                    Contact c = (Contact) Database.query(q3);
                    if (c != null) return c.AccountId;
                }
            }

        } catch (Exception e) {
            System.debug('WidgetHelper.getAccountIdForCurrentUser error: ' + e.getMessage());
        }

        return null;
    }

    // Aura/LWC callable method
    @AuraEnabled(cacheable=true)
    public static String getBuyerAccountId() {
        Id acct = getAccountIdForCurrentUser();
        return acct == null ? null : String.valueOf(acct);
    }

}