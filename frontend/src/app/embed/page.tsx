'use client';

import { useEffect } from 'react';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatWindow } from '@/components/chat/ChatWindow';

export default function EmbedPage() {
  // Extract accountId from URL and store it
  useEffect(() => {
    // Get accountId from URL parameter
    const params = new URLSearchParams(window.location.search);
    const accountId = params.get('accountId');
    
    if (accountId) {
      // Store in localStorage for API calls to use
      localStorage.setItem('salesforce_buyer_account_id', accountId);
      console.log('✓ Buyer Account ID stored:', accountId);
    } else {
      console.warn('⚠️ No accountId parameter found in URL');
    }

    // Notify parent iframe is ready
    const isInIframe = window.self !== window.top;
    if (isInIframe && window.parent) {
      window.parent.postMessage({ type: 'widgetReady' }, '*');
    }
  }, []);

  // Handle close button - notify parent to close iframe
  const handleClose = () => {
    const isInIframe = window.self !== window.top;
    
    if (isInIframe && window.parent) {
      window.parent.postMessage({ type: 'closeWidget' }, '*');
    }
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-white">
      {/* Header */}
      <ChatHeader onClose={handleClose} />
      
      {/* Chat Content - fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <ChatWindow />
      </div>
    </div>
  );
}
