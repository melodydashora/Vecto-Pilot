// client/src/pages/co-pilot/PolicyPage.tsx
import React from 'react';
import { Link } from 'react-router-dom';

export default function PolicyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-6 mb-24">
      <Link to="/co-pilot/about" className="inline-flex items-center text-blue-500 hover:text-blue-600 mb-6">
        ← Back to About
      </Link>

      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 mb-8 text-white">
        <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-blue-100">Last Updated: December 27, 2025</p>
      </div>

      <div className="space-y-6">
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <p className="text-gray-700 dark:text-gray-300">
            VectoPilot is committed to protecting your privacy. This Privacy Policy explains how we
            collect, use, and safeguard your information when you use our application designed to help
            rideshare drivers optimize their strategy and earnings through integration with the Uber API.
          </p>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">1. Information We Collect</h2>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300">
            <li>• <strong>Driver Profile:</strong> Name, email, and profile details via Uber authentication</li>
            <li>• <strong>Location Data:</strong> Current location and service areas for strategy optimization</li>
            <li>• <strong>Trip Data:</strong> Trip history, earnings, and performance metrics</li>
            <li>• <strong>Device Info:</strong> Device type, OS, and app usage patterns</li>
            <li>• <strong>Venue Data:</strong> Information about venues and events for recommendations</li>
          </ul>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">2. How We Use Your Information</h2>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300">
            <li>• Provide personalized driving strategy recommendations</li>
            <li>• Display real-time venue and event information</li>
            <li>• Analyze market conditions and surge patterns</li>
            <li>• Improve and optimize our services</li>
            <li>• Communicate important updates</li>
          </ul>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">3. Data Sharing</h2>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300 mb-4">
            <li>• <strong>Uber:</strong> To access your driver data through the Uber API</li>
            <li>• <strong>Service Providers:</strong> Third-party vendors who help operate our services</li>
            <li>• <strong>Legal Requirements:</strong> When required by law</li>
          </ul>
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
            <p className="text-purple-800 dark:text-purple-200 font-medium">
              We do NOT sell your personal information. We do NOT use Uber data for competitive purposes.
            </p>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">4. Data Security</h2>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300">
            <li>• Encryption of sensitive data in transit and at rest</li>
            <li>• Secure storage of access tokens and credentials</li>
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
            We comply with GDPR, CCPA, and Uber API Terms of Use requirements.
          </p>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">7. Third-Party Services</h2>
          <p className="text-gray-700 dark:text-gray-300">
            We integrate with Uber. Please review{' '}
            <a
              href="https://www.uber.com/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600 underline"
            >
              Uber's Privacy Policy
            </a>.
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
            By using VectoPilot and authorizing Uber access, you consent to this Privacy Policy.
            You may revoke consent by disconnecting our app from your Uber account.
          </p>
        </div>
      </div>
    </div>
  );
}
