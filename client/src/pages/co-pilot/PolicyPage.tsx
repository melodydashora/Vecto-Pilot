// client/src/pages/co-pilot/PolicyPage.tsx
// 2026-02-03: Made publicly accessible at /policy.
// 2026-05-23: Also mounted at /privacy (canonical public URL); both paths render this page.
//             In-app users still reach it via /co-pilot/policy.
// 2026-09-13: Rewritten platform-neutral. Vecto Pilot has no integration with, and no
//             relationship to, Uber, Lyft, or any rideshare/delivery platform.
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function PolicyPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const isPublicAccess =
    location.pathname === '/privacy' || location.pathname === '/policy';

  const handleBack = () => {
    // If there's history, go back; otherwise go to home
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-6 mb-24">
      {isPublicAccess ? (
        <button
          onClick={handleBack}
          className="inline-flex items-center text-blue-500 hover:text-blue-600 mb-6"
        >
          ← Back
        </button>
      ) : (
        <Link to="/co-pilot/about" className="inline-flex items-center text-blue-500 hover:text-blue-600 mb-6">
          ← Back to About
        </Link>
      )}

      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 mb-8 text-white">
        <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-blue-100">Last Updated: September 13, 2026</p>
      </div>

      <div className="space-y-6">
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <p className="text-gray-700 dark:text-gray-300">
            Vecto Pilot is committed to protecting your privacy. This Privacy Policy explains how we
            collect, use, and safeguard your information when you use our application, which helps
            rideshare and delivery drivers plan where to be, judge the offers they receive, and
            improve their earnings — whichever platform or platforms they drive for.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mt-3">
            Vecto Pilot is an independent tool. It is not affiliated with, endorsed by, or connected
            to Uber, Lyft, DoorDash, or any other rideshare or delivery platform, and it never
            accesses your account on any platform.
          </p>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">1. Information We Collect</h2>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300">
            <li>• <strong>Account:</strong> Name, email, phone, and the profile details you enter, or the name and email provided by Google when you sign in with Google</li>
            <li>• <strong>Location Data:</strong> Your current location while you use the app, used to build recommendations for where you are</li>
            <li>• <strong>Offers You Submit:</strong> Screenshots or text of ride or delivery offers that you choose to send for analysis, and the decisions and outcomes you record about them</li>
            <li>• <strong>Vehicle and Preferences:</strong> Vehicle details, service eligibility, and driving preferences you provide</li>
            <li>• <strong>Device Info:</strong> Device type, operating system, and app usage patterns</li>
            <li>• <strong>Venue Data:</strong> Information about venues and events used to make recommendations</li>
          </ul>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">2. How We Use Your Information</h2>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300">
            <li>• Provide personalized driving strategy recommendations</li>
            <li>• Analyze the offers you submit and learn your preferences over time</li>
            <li>• Display real-time venue, event, traffic, and weather information</li>
            <li>• Analyze market conditions and demand patterns</li>
            <li>• Improve and optimize our services</li>
            <li>• Communicate important updates</li>
          </ul>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">3. Data Sharing</h2>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300 mb-4">
            <li>• <strong>AI Providers:</strong> Location context and the offers you submit are sent to third-party AI model providers to generate recommendations and analyses</li>
            <li>• <strong>Maps and Data Providers:</strong> Location coordinates are sent to mapping, geocoding, weather, and traffic providers to resolve your surroundings</li>
            <li>• <strong>Google:</strong> Only if you choose to sign in with Google</li>
            <li>• <strong>Service Providers:</strong> Third-party vendors who help operate our services (hosting, email, SMS)</li>
            <li>• <strong>Legal Requirements:</strong> When required by law</li>
          </ul>
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
            <p className="text-purple-800 dark:text-purple-200 font-medium">
              We do NOT sell your personal information. We do NOT share your data with any rideshare
              or delivery platform.
            </p>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">4. Data Security</h2>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300">
            <li>• Encryption of sensitive data in transit and at rest</li>
            <li>• Passwords stored only as salted hashes</li>
            <li>• Regular security assessments</li>
            <li>• Access controls for authorized personnel only</li>
          </ul>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">5. Your Rights</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
              <strong>Access</strong>
              <p className="text-sm text-gray-600 dark:text-gray-400">Request a copy of your data</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
              <strong>Correction</strong>
              <p className="text-sm text-gray-600 dark:text-gray-400">Request data correction</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
              <strong>Deletion</strong>
              <p className="text-sm text-gray-600 dark:text-gray-400">Request data deletion</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
              <strong>Portability</strong>
              <p className="text-sm text-gray-600 dark:text-gray-400">Request data transfer</p>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">6. Legal Compliance</h2>
          <p className="text-gray-700 dark:text-gray-300">
            We comply with GDPR and CCPA requirements.
          </p>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">7. Third-Party Services</h2>
          <p className="text-gray-700 dark:text-gray-300">
            If you sign in with Google, Google's handling of your sign-in is governed by{' '}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600 underline"
            >
              Google's Privacy Policy
            </a>. Map, geocoding, weather, traffic, and AI providers process only the data described
            in Section 3 and are bound by their own privacy terms.
          </p>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">8. Contact Us</h2>
          <p className="text-gray-700 dark:text-gray-300">
            Email: privacy@vectopilot.com
          </p>
        </section>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">Consent</h3>
          <p className="text-blue-800 dark:text-blue-200 text-sm">
            By creating an account and using Vecto Pilot, you consent to this Privacy Policy.
            You may withdraw consent at any time by deleting your account or contacting us at the
            address above.
          </p>
        </div>
      </div>
    </div>
  );
}
