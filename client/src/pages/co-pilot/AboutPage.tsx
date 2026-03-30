// client/src/pages/co-pilot/AboutPage.tsx
// Wrapper page for the About/Donation tab (static page, no header)

import React from 'react';
import { DonationTab } from '@/components/DonationTab';
import { Link } from 'react-router-dom';

export default function AboutPage() {
  const userId = localStorage.getItem('vecto_user_id') || 'default';

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6 mb-24" data-testid="about-page">
      <DonationTab userId={userId} />

      {/* Privacy Policy Link */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
        <Link to="/co-pilot/policy" className="text-blue-500 hover:text-blue-600 text-sm">
          Privacy Policy
        </Link>
      </div>
    </div>
  );
}
