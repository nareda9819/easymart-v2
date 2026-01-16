@RestResource(urlMapping='/WidgetHelper/*')
global with sharing class WidgetHelperRest {
    @HttpGet
    global static String getContext() {
        Id acct = WidgetHelper.getAccountIdForCurrentUser();
        return acct == null ? '' : String.valueOf(acct);
    }
}
