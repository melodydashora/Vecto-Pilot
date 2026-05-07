# PLAN: Fix Coach payload error + add attachment options (Files / Folder / Camera)

**Created:** 2026-05-07 (late)
**Author:** Claude Code (Opus 4.7)
**Filed under:** Rule 1 (Planning Before Implementation), Rule 9 (zero-tolerance drift)
**Scope:** Two related Coach UX fixes — both client-side, no server changes.
**Status:** Awaiting advisor validation, then Melody approval (pre-approved per her message 2026-05-07: "you have taken into account everything that can go wrong so I trust you on planning this so it doesn't").

---

## 1. Background

### Finding A — Payload error

`server/bootstrap/middleware.js:210` sets the `/api/chat` JSON body limit to **10MB**. The Coach client encodes attachments via `reader.readAsDataURL(file)` (`useCoachChat.ts:137`), which produces a base64 data URL — base64 inflates the payload by ~33%. Trigger conditions:

| Source | Raw | Base64 | Hits 10MB limit? |
|---|---|---|---|
| Phone photo (typical JPEG) | 3-5MB | 4-7MB | Sometimes (single attachment) |
| 4K screenshot or high-res photo | 8-12MB | 11-16MB | **Yes, every time** |
| Multiple phone photos | 6-15MB total | 8-20MB total | Often |

Server returns `{ error: 'payload_too_large', code: 'payload_too_large' }` (`server/middleware/error-handler.js:32-36`). Client at `useCoachChat.ts:193-209` only special-cases `missing_timezone` — every other 4xx falls through to a generic `"Sorry—chat failed: ..."` message. Driver sees a vague failure, doesn't know to compress or take a smaller photo.

### Finding B — Missing attachment options

Current attachment surface (`RideshareCoach.tsx:842-865`): one Paperclip button → hidden `<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt">`. No folder picker, no camera capture.

Melody's directive: add **Files**, **Folder**, and **Live camera capture** options.

---

## 2. Objectives

- **O1.** Stop driver-facing payload errors for normal attachment use cases (single phone photo, screenshot, common file). Compression makes the 10MB limit effectively unhittable for image attachments.
- **O2.** Map `code: 'payload_too_large'` to a clear user-facing error so when the limit IS hit (e.g., 50MB raw video), the driver knows what to do.
- **O3.** Replace the single Paperclip button with a popover menu offering three explicit options: Files / Folder / Camera. Same downstream `CoachAttachment` shape; no server changes.
- **O4.** Mobile camera = native HTML attribute (`capture="environment"`); desktop camera = small modal using `getUserMedia` + canvas snapshot.

---

## 3. Approach

### 3.0 Cascade rule (continuing convention)

When code is added or modified:
1. No `// 2026-05-07: added compression because ...` breadcrumb comments. Plan + commit message + LESSONS_LEARNED carry the historical record.
2. Match existing project shapes: keep the `CoachAttachment` shape (`{ name, type, data }`), keep `handleFileSelect` as the public entry point, keep the existing accept list.

### 3.1 Phase 1 — Client-side image compression + better error UX

**File: `client/src/hooks/coach/useCoachChat.ts`**

**A — Add `compressImageToDataUrl()` helper.**

```typescript
async function compressImageToDataUrl(
  file: File,
  maxDim = 2048,
  quality = 0.85
): Promise<string> {
  // Only compress images. Other types pass through with a plain readAsDataURL.
  if (!file.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Decode → downscale → re-encode as JPEG.
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', quality);
}
```

**B — Refactor `handleFileSelect` to compress images before adding to attachments.**

Current implementation reads each file as data URL. New shape:

```typescript
const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.currentTarget.files;
  if (!files) return;

  // Filter to accepted types (mirrors the input's accept attribute).
  const accepted = Array.from(files).filter(f =>
    f.type.startsWith('image/') ||
    f.type === 'application/pdf' ||
    f.type === 'text/plain' ||
    f.name.match(/\.(doc|docx|txt)$/i)
  );

  // Cap total attachments at MAX_ATTACHMENTS (after compression).
  const MAX_ATTACHMENTS = 10;
  const remaining = MAX_ATTACHMENTS - attachments.length;
  if (remaining <= 0) {
    setValidationErrors([{ field: 'attachments', message: `Max ${MAX_ATTACHMENTS} attachments` }]);
    setTimeout(() => setValidationErrors([]), 5000);
    return;
  }
  const toProcess = accepted.slice(0, remaining);
  const droppedCount = accepted.length - toProcess.length;

  // Compress in parallel.
  const newAttachments = await Promise.all(
    toProcess.map(async (file) => ({
      name: file.name,
      type: file.type.startsWith('image/') ? 'image/jpeg' : file.type,
      data: await compressImageToDataUrl(file),
    }))
  );

  setAttachments(prev => [...prev, ...newAttachments]);

  if (droppedCount > 0) {
    setValidationErrors([{
      field: 'attachments',
      message: `${droppedCount} file(s) skipped — max ${MAX_ATTACHMENTS} attachments`
    }]);
    setTimeout(() => setValidationErrors([]), 5000);
  }

  if (fileInputRef.current) fileInputRef.current.value = '';
}, [attachments.length]);
```

**C — Add post-encode size precheck before send.**

In `send()`, before constructing the request body:

```typescript
const totalAttachmentSize = filesToSend.reduce((sum, a) => sum + a.data.length, 0);
const PAYLOAD_BUDGET = 9 * 1024 * 1024; // 9MB — server limit is 10MB, leave room for message+history
if (totalAttachmentSize > PAYLOAD_BUDGET) {
  setMsgs((m) => [
    ...m.slice(0, -1),
    { role: 'assistant', content: 'Attachments are too large to send. Try fewer files or smaller photos.' }
  ]);
  setIsStreaming(false);
  return;
}
```

**D — Better server-error mapping.**

In the existing `if (!res.ok && ...)` block, expand the special-cased codes:

```typescript
if (errData.code === 'missing_timezone') {
  setMsgs((m) => [...m.slice(0, -1), {
    role: "assistant",
    content: "I need your location to give you accurate advice! Please enable GPS in your browser settings and refresh the page."
  }]);
} else if (errData.code === 'payload_too_large') {
  setMsgs((m) => [...m.slice(0, -1), {
    role: "assistant",
    content: "Attachments are too large for the coach. Try a smaller image, take a new photo at lower resolution, or attach fewer files."
  }]);
} else {
  setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `Sorry—chat failed: ${errData.message || errData.error}` }]);
}
```

### 3.2 Phase 2 — Attachment popover menu (Files / Folder / Camera)

**File: `client/src/components/RideshareCoach.tsx`**

**A — Add three hidden file inputs:**

```tsx
{/* Files (existing — unchanged behavior) */}
<input ref={fileInputRef} type="file" multiple
       accept="image/*,.pdf,.doc,.docx,.txt"
       onChange={handleFileSelect} className="hidden" ... />

{/* Folder picker (new) */}
<input ref={folderInputRef} type="file" multiple
       /* @ts-expect-error - webkitdirectory not in standard types */
       webkitdirectory="" directory=""
       onChange={handleFileSelect} className="hidden" ... />

{/* Mobile camera (new — opens native camera on iOS/Android) */}
<input ref={cameraInputRef} type="file"
       accept="image/*" capture="environment"
       onChange={handleFileSelect} className="hidden" ... />
```

The `handleFileSelect` from `useCoachChat` handles all three identically — they all produce `File` objects, the filter keeps only accepted types, the compression pipeline runs the same way.

**B — Replace the Paperclip button with a popover menu.**

Use `shadcn/ui`'s Popover (already in project — verified by checking imports elsewhere). Three buttons inside:

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button size="icon" className="rounded-full h-10 w-10 ..." disabled={isStreaming || isListening}
            data-testid="button-attachment-menu" title="Attach...">
      <Paperclip className="h-4 w-4" />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-44 p-1" align="end" side="top">
    <button onClick={() => fileInputRef.current?.click()} className="...">
      <FileIcon /> Files
    </button>
    <button onClick={() => folderInputRef.current?.click()} className="...">
      <FolderIcon /> Folder
    </button>
    <button onClick={openCamera} className="...">
      <CameraIcon /> Camera
    </button>
  </PopoverContent>
</Popover>
```

**C — Camera trigger logic.**

`openCamera()` chooses path based on capability detection:

```typescript
function openCamera() {
  // Mobile path: use the native camera intent via input[capture]
  // Detection: small screen + touch + iOS/Android UA → use input[capture]
  // Otherwise: open desktop modal with getUserMedia
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    cameraInputRef.current?.click();
  } else {
    setCameraModalOpen(true);
  }
}
```

The mobile path is one click — native camera UI handles capture, returns a File, runs through the same `handleFileSelect` → compression pipeline.

The desktop path opens a `<CameraCaptureModal>` (new component, see §3.3).

### 3.3 Phase 3 — `CameraCaptureModal` (desktop fallback)

**New file: `client/src/components/coach/CameraCaptureModal.tsx`**

Small modal component:

```tsx
export function CameraCaptureModal({
  open, onClose, onCapture
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },  // prefer rear camera if present
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        const message = err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Enable it in your browser settings.'
          : 'Could not access camera.';
        setError(message);
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Same JPEG/0.85 default as compressImageToDataUrl — modal output goes
    // through the same downstream attachment pipeline.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onCapture(dataUrl);
    onClose();
  }

  // ... render dialog with <video>, capture button, error fallback
}
```

When `onCapture(dataUrl)` fires, the parent (RideshareCoach) appends a `CoachAttachment` directly to `setAttachments` (skipping `handleFileSelect` since the data is already a compressed JPEG data URL):

```typescript
function handleCameraCapture(dataUrl: string) {
  setAttachments(prev => [...prev, {
    name: `camera-${Date.now()}.jpg`,
    type: 'image/jpeg',
    data: dataUrl
  }]);
}
```

### 3.4 What's preserved unchanged

- `CoachAttachment` shape — same `{ name, type, data }`.
- `send()` request body shape — same `attachments` array sent to `/api/chat`.
- Server-side handling — no changes to `server/api/chat/chat.js`, no schema changes, no new endpoints.
- The existing `Paperclip` icon for the trigger button (just becomes a popover trigger instead of direct click).

---

## 4. Files affected

| File | Change | LOC estimate |
|---|---|---|
| `client/src/hooks/coach/useCoachChat.ts` | Add `compressImageToDataUrl`; refactor `handleFileSelect` to compress + filter + cap; add size precheck in `send()`; expand server-error mapping | ~80 lines added/modified |
| `client/src/components/RideshareCoach.tsx` | Replace single Paperclip button with Popover containing 3 options; add 2 new hidden inputs (folder, camera-mobile); add camera-modal state + handler | ~50 lines added/modified |
| `client/src/components/coach/CameraCaptureModal.tsx` | NEW component for desktop camera capture via getUserMedia | ~80 lines new |
| `LESSONS_LEARNED.md` | New 2026-05-07 entry: payload-error class, base64-inflation observation, client-side compression as architectural fix | ~30 lines |
| `claude_memory` | Audit row, status `resolved`, parent_id=318 | DB row |

**Net: ~210 lines added, ~30 modified, no deletions. Three files touched, one new file. Server untouched.**

---

## 5. Risk analysis

| Risk | Severity | Mitigation |
|---|---|---|
| `createImageBitmap` not available on older browsers | Low | iOS Safari 14+, Chrome 50+, Firefox 79+. Vecto Pilot's user base is modern phones (driver iOS/Android), all supported. Fall-back to legacy `<img>` decode if needed (additional ~30 lines, defer unless surfaced). |
| Compression strips EXIF / orientation metadata | Medium | `createImageBitmap` decodes with proper orientation (the spec respects EXIF Orientation). Output JPEG won't carry EXIF, but the visible content is correctly rotated. For a Coach use case (offer screenshots, dash photos), EXIF isn't load-bearing. |
| Folder picker returns hundreds of files | Medium | The MAX_ATTACHMENTS=10 cap + accept-list filter + count message handles this. Driver picks Downloads → 47 files → 3 match accept → those 3 get compressed → "47 - 3 = 44 files skipped" warning. |
| `webkitdirectory` not supported in some browsers | Low | Chrome, Safari (iOS+macOS), Firefox, Edge all support it. The folder option degrades to "no folder picker available" silently if the input attribute is unrecognized — input still acts as a normal file picker, no JS error. Worst case: folder option works as files-only on edge browsers. |
| `getUserMedia` permission denied → confusing UX | Medium | The modal catches `NotAllowedError` explicitly and shows a clear message: "Camera permission denied. Enable it in your browser settings." Driver knows what to do. |
| `getUserMedia` requires HTTPS | None | Replit deployments serve HTTPS. Workspace dev also HTTPS. localhost (browser dev mode) is exempt from the HTTPS requirement. |
| Mobile native camera + popover → user has to tap twice | Low | One tap opens popover, second tap on Camera opens camera. Minimal overhead vs. the current "tap Paperclip → file picker pops up." Same number of taps for files (Paperclip → pick file). Folder and Camera are net-new affordances; one extra tap is the right cost. |
| Multiple compressions in parallel saturate browser memory | Low | `Promise.all` over up to 10 files. Each compression decodes one image at a time per task. Browser handles ~10 concurrent ImageBitmaps without issue. The `bitmap.close()` after canvas draw frees GPU memory promptly. |
| Compression introduces a delay before attachment appears in UI | Low | Compression of a 4MB photo on a modern phone is ~100-300ms. Drivers will see a brief pause. Could add a loading state per attachment, but starting simple — pause is shorter than the current "encode then upload" path was anyway. |
| Server `payload_too_large` error message text changes between versions | None | Client matches on `code: 'payload_too_large'`, not on message text. Change-resistant. |
| Camera modal stream not properly closed on component unmount | Medium | The useEffect cleanup explicitly calls `streamRef.current?.getTracks().forEach(t => t.stop())`. Verified in the code skeleton above. Without this cleanup, the camera light stays on after closing the modal — visible bug. |
| iOS Safari refuses `getUserMedia` outside a user gesture | None | Modal only opens on the explicit Camera button click — that IS the user gesture. |

---

## 6. Implementation order

Phase 1 first (compression + UX, smaller surface, less risky), Phase 2 second (popover + folder), Phase 3 third (desktop camera modal).

1. **Phase 1 — compression + UX in `useCoachChat.ts`.** Add helper, refactor `handleFileSelect`, add size precheck, expand error mapping. Run lint, smoke-test current Files button: should still work with compression now active.
2. **Phase 2 — popover menu + folder/camera-mobile inputs in `RideshareCoach.tsx`.** Three hidden inputs, popover trigger. Test on a phone (or mobile DevTools emulation): mobile camera input should open native camera UI; folder picker should work.
3. **Phase 3 — `CameraCaptureModal.tsx`.** New component, wire into RideshareCoach. Test desktop browser: permission flow, capture, modal cleanup.
4. **Verification.** Lint clean, build clean, manual smoke per §7.
5. **Documentation cascade.** LESSONS_LEARNED entry, claude_memory row.
6. **Commit.** Stage scoped files only; don't push until smoke test passes.
7. **Push.** After Melody confirms.

---

## 7. Test cases

### 7.1 Phase 1 (compression + UX)

- **T1 — Image compression activates:** Attach a 4MB phone photo. Inspect the resulting `attachment.data` length. Should be <1MB (vs. ~5.5MB pre-fix). Verify the image is still visually intact.
- **T2 — Non-image passthrough:** Attach a 200KB PDF. Should pass through `compressImageToDataUrl` unchanged via the `if (!file.type.startsWith('image/'))` branch.
- **T3 — Size precheck rejects oversized batches:** Attach 10 large images (worst case post-compression). If total >9MB, send is rejected client-side with the inline error. Pre-fix would have hit 413 server-side.
- **T4 — Server `payload_too_large` mapped to clear UX:** Force the path by attaching files that bypass compression (e.g., 9MB PDF). Expect: `"Attachments are too large for the coach. Try a smaller image, take a new photo at lower resolution, or attach fewer files."` not the generic "Sorry—chat failed."
- **T5 — Max-attachments cap works:** Try to attach 15 files at once. First 10 are added, remaining 5 dropped with "5 file(s) skipped — max 10 attachments" warning. Verified for 5 seconds, then warning auto-clears.
- **T6 — Existing happy path unchanged:** Attach one phone photo, type a message, send. Coach responds normally with vision context.

### 7.2 Phase 2 (popover menu)

- **T7 — Popover opens on Paperclip click:** Click the (renamed-trigger) button. Popover appears with three options: Files / Folder / Camera.
- **T8 — Files option:** Click Files in popover. Native file picker opens with the existing accept list. Behaves identically to today's flow.
- **T9 — Folder option:** Click Folder in popover. Native folder picker opens. Pick a folder containing 5 supported files + 5 unsupported. Verify only the 5 supported are added; warning shows skipped count.
- **T10 — Camera option (mobile):** On a phone, click Camera. Native camera UI opens (iOS/Android). Take a photo. Photo gets compressed and added to attachments.
- **T11 — Camera option (desktop):** On a desktop browser, click Camera. CameraCaptureModal opens, requests permission, shows live preview. Click Capture button. Photo added to attachments. Modal closes; camera light goes off.

### 7.3 Phase 3 (camera modal)

- **T12 — Permission denied UX:** Block camera permission for the site. Click Camera. Modal opens, shows clear error "Camera permission denied. Enable it in your browser settings." with a Close button.
- **T13 — Modal cleanup on close:** Open camera modal, then close without capturing. Verify the camera light goes off (stream closed).
- **T14 — Modal cleanup on component unmount:** Open camera modal, then navigate away from the Coach page. Verify the camera light goes off.

### 7.4 Static / sweep

- **T15 — Lint:** `npm run lint` clean across new scope.
- **T16 — Build:** `npm run build` clean (TypeScript checks pass; Vite bundle builds).
- **T17 — TypeScript narrowing:** No `any` types introduced; `compressImageToDataUrl` properly typed; `CameraCaptureModal` props properly typed.

---

## 8. Resolutions for advisor flags (2026-05-07)

Advisor flagged three things on plan validation. Resolutions:

### Flag 1 — non-image payload error message

The 9MB precheck catches large PDFs/docs that bypass image compression, but the error message ("Try fewer files or smaller photos") doesn't fit a PDF case. **Decision:** keep the simple message, refine if it surfaces in real use. Format-aware messaging is a follow-up if drivers actually send oversized PDFs.

### Flag 2 — shadcn Popover availability

**Verified.** `client/src/components/ui/popover.tsx` exists, imports `@radix-ui/react-popover`, exports `Popover`, `PopoverTrigger`, `PopoverContent`. Zero current importers (the component is shipped but unused). Using it is fine; no new dep needed.

### Flag 3 — mobile-detection heuristic for camera path

User-Agent sniffing (`/iPhone|iPad|iPod|Android/i`) misroutes iPad-in-desktop-mode (default on iPadOS 13+). Switching to **feature-detect**:

```typescript
function preferNativeCameraInput(): boolean {
  // Touch-capable + capture-attribute support → mobile path
  // (capture is silently ignored on desktop Chrome/Firefox even when present, so
  // the touch heuristic is the load-bearing check.)
  return 'ontouchstart' in window;
}
```

Routes:
- Touch device (iPad in desktop-mode counts as touch) → click camera input → native camera UI on iOS/Android, falls back to file picker on touch-Chromebook (acceptable).
- Non-touch desktop → CameraCaptureModal with `getUserMedia`.

iPad-in-desktop-mode now correctly routes to the native camera path because it's still touch-capable.

### Bonus implementation suggestion (advisor) — per-attachment compression loading state

Compression of a 4MB photo on a mid-tier Android phone can take 500ms-1s. Without a loading state, the driver wonders if their tap registered. **Adding:** the attachment chip displays a spinner + filename until compression resolves, then swaps to the regular file-icon + filename. Two extra lines of state in `useCoachChat.ts` (`Set<string>` of in-progress filenames), simple swap in the chip JSX.

This adds T6b to the test cases:
- **T6b — Compression loading state visible:** Attach a 4MB image. Before the promise resolves, the chip shows a spinner. After, the chip shows the file icon. Smooth transition, no flicker.

---

## 9. Outcome measures

- ✅ Compression reduces typical phone-photo attachment payloads by 80%+ (5MB → <1MB).
- ✅ Driver no longer hits 413 for normal attachment use cases.
- ✅ When 413 IS hit (e.g., large PDF), driver sees a clear actionable message.
- ✅ Three attachment options visible in the popover: Files, Folder, Camera.
- ✅ Mobile camera opens native camera UI.
- ✅ Desktop camera opens permission-respecting modal with live preview + capture.
- ✅ Modal cleanup properly stops the camera stream.
- ✅ Lint + build clean.
- ✅ LESSONS_LEARNED entry filed.
- ✅ claude_memory row filed.

---

## 10. References

- `server/bootstrap/middleware.js:210` — `/api/chat` 10MB JSON limit.
- `server/middleware/error-handler.js:32-36` — 413 handler emits `code: 'payload_too_large'`.
- `client/src/hooks/coach/useCoachChat.ts` — current `handleFileSelect` (lines 120-143), `send()` (lines 149-310).
- `client/src/components/RideshareCoach.tsx:842-865` — current Paperclip button + hidden file input.
- shadcn/ui Popover component — already used elsewhere in client (verify in implementation).
- Web APIs: `createImageBitmap`, `HTMLCanvasElement.toDataURL`, `navigator.mediaDevices.getUserMedia`, `<input type="file" capture="environment">`, `<input webkitdirectory>`.
- CLAUDE.md doctrines: NO FALLBACKS — GLOBAL APP RULE; ABSOLUTE PRECISION (compression preserves visible content, doesn't mask data).
- Audit chain: rows 318-324. This row will be ~325.
