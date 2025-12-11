export default function SafeScaffold() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Co-Pilot</h1>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-lg mb-4">
            <strong className="text-gray-900">Status:</strong>{' '}
            <span className="text-amber-600">Something went wrong loading the app.</span>
          </p>
          <div className="text-gray-600 mb-4">
            Please try refreshing the page. If the problem persists, check the browser console for errors.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  );
}
