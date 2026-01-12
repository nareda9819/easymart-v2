'use client';

import { useEffect } from 'react';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatWindow } from '@/components/chat/ChatWindow';

export default function EmbedPage() {
  // Detect if running in iframe and notify parent
  useEffect(() => {
    const isInIframe = window.self !== window.top;
    
    if (isInIframe && window.parent) {
      // Notify parent that widget is ready
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
