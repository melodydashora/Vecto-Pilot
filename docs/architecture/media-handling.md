# Media Handling Architecture

**Last Updated:** 2026-02-10

This document describes how files and images are handled within the Vecto Co-Pilot ecosystem.

## 1. File Uploads

### Current State
- **Primary Use Case:** Sending screenshots to the AI Agent (Eidolon) or "Omni-Presence" endpoint.
- **Mechanism:** **Base64 Encoding** inside JSON payloads.
    - **Pros:** Simple, stateless, works well with LLM vision APIs (OpenAI, Claude, Gemini) which often accept base64 strings directly.
    - **Cons:** Increases payload size (33% overhead), memory intensive for large files.
- **Limits:** `express.json({ limit: "5mb" })` configured in `gateway-server.js` and `assistant-proxy.ts`.

### Future State (Presigned URLs)
For larger files or user-generated content (e.g., profile photos, dashcam footage):
1.  **Client:** Request upload URL from API (`GET /api/upload/sign`).
2.  **Server:** Generate S3/GCS Presigned URL.
3.  **Client:** PUT file directly to object storage.
4.  **Client:** Send object key to Server/AI.

## 2. Image Processing

### Client-Side
- **Screenshot Capture:** Used by Siri Shortcuts (external to web app).
- **Optimization:** Web app does not currently perform heavy image manipulation.

### Server-Side (AI Vision)
- **OCR:** "Omni-Presence" (Level 4) relies on **iOS Client-Side OCR** (Live Text) *before* sending data to the server.
    - **Why?** Saves tokens, privacy, speed.
    - **Fallback:** Server can pass raw images to `gpt-4o` or `gemini-1.5-pro` for text extraction if client-side OCR fails.

### Storage
- **Current:** No persistent file storage (database only).
- **Planned:** Google Cloud Storage bucket for `driver_verification` docs.
