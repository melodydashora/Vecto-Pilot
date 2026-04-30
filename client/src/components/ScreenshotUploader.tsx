import React, { useState, useEffect, useRef } from 'react';

const ScreenshotUploader: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Memory Leak Cleanup: Revoke the object URL when preview changes or component unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Handle standard file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      processFile(event.target.files[0]);
    }
  };

  // 2. onPaste Support (Ctrl+V): Intercept paste events on the container
  const handlePaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          processFile(file);
        }
      }
    }
  };

  const processFile = (file: File) => {
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setMessage(null);
  };

  // 3. FormData Boundary Fix
  const handleUpload = async () => {
    if (!selectedFile) {
      setMessage({ type: 'error', text: 'Please select a screenshot first.' });
      return;
    }

    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('screenshot', selectedFile);

    try {
      // NOTE: We do NOT set 'Content-Type': 'multipart/form-data'.
      // Fetch/Axios will automatically set it with the correct multipart boundary string.
      const response = await fetch('/api/analyze/screenshot', {
        method: 'POST',
        body: formData,
        // headers: { 'Authorization': `Bearer ${yourToken}` } // Add if needed
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      const data = await response.json();
      setMessage({ type: 'success', text: 'Screenshot uploaded and analyzed successfully!' });
      console.log('Analysis Result:', data);

    } catch (error: any) {
      console.error('Upload failed:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to upload screenshot.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="p-6 bg-slate-800 rounded-lg border border-slate-700 max-w-md mx-auto focus:outline-none focus:ring-2 focus:ring-blue-500"
      onPaste={handlePaste}
      tabIndex={0} // Required to make the div focusable so it can catch paste events
    >
      <h3 className="text-xl font-bold text-white mb-4">📸 Upload Strategy Screenshot</h3>

      <div
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
          ${previewUrl ? 'border-blue-500 bg-slate-700' : 'border-slate-500 hover:border-blue-400 hover:bg-slate-750'}`}
        onClick={() => fileInputRef.current?.click()}
      >
        {previewUrl ? (
          <div className="relative">
            <img src={previewUrl} alt="Preview" className="max-h-64 mx-auto rounded shadow-md" />
            <p className="text-xs text-slate-400 mt-2">Click or paste to change</p>
          </div>
        ) : (
          <div className="py-8 text-slate-400">
            <p className="mb-2 text-3xl">📂</p>
            <p>Click to browse or <strong>Paste (Ctrl+V)</strong></p>
            <p className="text-xs mt-2 text-slate-500">Supports PNG, JPG</p>
          </div>
        )}

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*"
          className="hidden"
        />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {message && (
          <div className={`p-3 rounded text-sm ${message.type === 'success' ? 'bg-green-900/50 text-green-200' : 'bg-red-900/50 text-red-200'}`}>
            {message.text}
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
          className={`w-full py-2 px-4 rounded font-semibold transition-all
            ${!selectedFile || uploading
              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'}`}
        >
          {uploading ? 'Analyzing...' : 'Upload & Analyze'}
        </button>
      </div>
    </div>
  );
};

export default ScreenshotUploader;
