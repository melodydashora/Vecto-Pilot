// client/src/pages/co-pilot/IntelPage.tsx
// Wrapper page for the Rideshare Intel tab

import React from 'react';
import RideshareIntelTab from '@/components/RideshareIntelTab';

export default function IntelPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6" data-testid="intel-page">
      <RideshareIntelTab />
    </div>
  );
}
