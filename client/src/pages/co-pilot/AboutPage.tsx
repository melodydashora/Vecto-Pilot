// client/src/pages/co-pilot/AboutPage.tsx
// Wrapper page for the About/Donation tab (static page, no header)

import React from 'react';
import { DonationTab } from '@/components/DonationTab';

export default function AboutPage() {
  const userId = localStorage.getItem('vecto_user_id') || 'default';

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="about-page">
      <DonationTab userId={userId} />
    </div>
  );
}
