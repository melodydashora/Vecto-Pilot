export default function SafeScaffold() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Co-Pilot</h1>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-lg mb-4">
            <strong className="text-gray-900">Status:</strong>{' '}
            <span className="text-blue-600">Snapshot resolved; loading Smart Blocks…</span>
          </p>
          <div className="text-gray-600">
            Strategy and Coach will appear once data is ready.
          </div>
        </div>
      </div>
    </div>
  );
}
