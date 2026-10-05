import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

interface AndroidMacroDroidGuideProps {
  hookUrl: string;
  tokenReady: boolean;
  onCopyToken: () => void;
}

const steps = [
  { title: 'Prepare MacroDroid', image: '01-permissions.svg', alt: 'Setup diagram: grant MacroDroid Usage Access and the permissions requested for screen OCR.' },
  { title: 'Choose the screenshot trigger', image: '02-trigger-and-app.svg', alt: 'Setup diagram: File Changed, Created files in Screenshots, with Uber Driver in the foreground.' },
  { title: 'Read the current offer', image: '03-ocr-request.svg', alt: 'Setup diagram: current-screen OCR goes into ocr_arr, then req[text], then JSON Output into body_json.' },
  { title: 'Insert your own token', image: '04-private-token.svg', alt: 'Setup diagram: HTTP POST with X-Shortcut-Token header set to YOUR_SHORTCUT_TOKEN, a placeholder to replace.' },
  { title: 'Guard capture and upload', image: '05-foreground-guards.svg', alt: 'Setup diagram: an outer foreground If protects OCR; an inner foreground If protects the request and all response actions.' },
  { title: 'Read and speak the response', image: '06-response-and-voice.svg', alt: 'Setup diagram: parse the current response into r; when code is 200, show r[notification] and speak r[voice].' },
  { title: 'Test before relying on it', image: '07-parked-test.svg', alt: 'Setup diagram: another app is blocked; test an Uber offer, spoken response, and saved history separately while parked.' },
] as const;

export default function AndroidMacroDroidGuide({ hookUrl, tokenReady, onCopyToken }: AndroidMacroDroidGuideProps) {
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const current = steps[step];
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView?.({ block: 'start' });
  }, [step]);

  return (
    <details id="android-macrodroid-guide" className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-sm text-gray-700">
      <summary className="cursor-pointer text-base font-semibold text-gray-900">
        Android: MacroDroid screenshot setup · illustrated guide
      </summary>
      <div className="mt-4 space-y-5">
        <p>Take your normal screenshot with <strong>Uber Driver on screen</strong> to send the current screen text to Offer Analyzer. No floating trigger is required. Screenshots from other apps are blocked by the checks below.</p>
        <p className="text-xs text-gray-600">Set up and test while parked. This app filter also allows non-offer screens inside Uber Driver. It does not automatically detect new offers. Pictures are schematic illustrations of the tested Samsung setup; Android and MacroDroid labels can vary.</p>
        <nav aria-label="MacroDroid setup steps" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {steps.map((item, index) => (
            <Button key={item.title} type="button" variant={index === step ? 'default' : 'outline'} className="h-11 px-0" aria-label={`Step ${index + 1}: ${item.title}`} aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}>
              {index + 1}
            </Button>
          ))}
        </nav>
        <section aria-labelledby="macrodroid-step-heading" className="space-y-4">
          <h3 id="macrodroid-step-heading" ref={headingRef} tabIndex={-1} className="scroll-mt-24 text-lg font-semibold text-gray-900" aria-live="polite">{step + 1}. {current.title}</h3>
          <figure className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <a href={`/guides/macrodroid/${current.image}`} target="_blank" rel="noopener noreferrer" aria-label={`Open larger picture: ${current.title}`}>
              <img src={`/guides/macrodroid/${current.image}`} alt={current.alt} width="640" height="460" className="h-auto w-full" />
            </a>
            <figcaption className="border-t px-3 py-2 text-xs text-gray-500">Illustration · tap the picture to open it larger. Examples contain no personal token.</figcaption>
          </figure>

          {step === 0 && <ol className="list-decimal space-y-3 pl-5">
            <li>Install <a href="https://www.macrodroid.com/" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">MacroDroid</a>. If you already have a macro, use <strong>Export/Import → Export → Storage</strong> to keep a private backup before editing.</li>
            <li>Create or open your <strong>Offer Analyzer</strong> macro. Keep it <strong>disabled while editing</strong>. If you already have a working request, preserve its actions and add the guards in steps 2 and 5.</li>
            <li>In Android Settings, search for <strong>Usage data access</strong> (or Usage Access) and turn it on for MacroDroid. This lets the app check which app is in front.</li>
            <li>When MacroDroid requests access for the screenshot folder or screen-reading action, follow its prompts. If offered a screen-capture choice, use <strong>Entire screen</strong> for this flow. Review the access before granting it.</li>
            <li>Allow notifications if you want the result displayed, and check media/text-to-speech volume. If Android pauses MacroDroid in the background, check its battery/background settings.</li>
          </ol>}

          {step === 1 && <ol className="list-decimal space-y-3 pl-5">
            <li>Add <strong>File Changed</strong> as the trigger. Select your phone’s screenshot folder, commonly <code className="break-all">/storage/emulated/0/Pictures/Screenshots</code>. Set the file filter to <code>*</code>, and select <strong>Created</strong> only.</li>
            <li>Under the macro’s green <strong>Constraints</strong> section, choose <strong>Device State → Application Running → Running in foreground → Use App History → Select Application(s) → Uber Driver</strong>. Save the constraint.</li>
            <li>If your working macro already has <strong>Wait Until Trigger → File Changed</strong>, keep its same folder and Created setting, <strong>1 second timeout</strong> and <strong>Continue on timeout</strong>. This wait was part of the tested Samsung macro; it is not required for every phone.</li>
            <li>Use File Changed for screenshots. An <strong>Accessibility Service Enabled</strong> trigger watches a service being enabled; it is not a screenshot trigger.</li>
          </ol>}

          {step === 2 && <div className="space-y-3">
            <p>Create these <strong>local variables</strong> in the macro. Start strings empty and <code>code</code> at <code>0</code>.</p>
            <div className="overflow-x-auto rounded border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">MacroDroid local variables</caption>
                <thead><tr className="border-b"><th scope="col" className="p-2">Type</th><th scope="col" className="p-2">Names</th></tr></thead>
                <tbody>
                  <tr><th scope="row" className="p-2 font-normal">Array</th><td className="p-2"><code>ocr_arr</code></td></tr>
                  <tr><th scope="row" className="p-2 font-normal">Dictionary</th><td className="p-2"><code>req</code>, <code>r</code></td></tr>
                  <tr><th scope="row" className="p-2 font-normal">String</th><td className="p-2"><code>body_json</code>, <code>resp</code></td></tr>
                  <tr><th scope="row" className="p-2 font-normal">Integer</th><td className="p-2"><code>code</code></td></tr>
                </tbody>
              </table>
            </div>
            <ol className="list-decimal space-y-3 pl-5">
              <li>Add <strong>Read Screenshot Contents</strong>. Store the current-screen OCR in <code>ocr_arr</code>. This reads what is on screen when it runs, not the saved triggering image.</li>
              <li>Add <strong>Set Variable</strong>: choose <code>req</code>, create its <code>text</code> entry as a string, and use the magic-text picker to insert <code>ocr_arr</code> in <strong>Standard Format</strong> (<code>{'{lv=ocr_arr}'}</code>). Set the entry at runtime; do not paste old OCR into it.</li>
              <li>Set <code>req[source]</code> to <code>android_text</code> and <code>req[shortcut_system]</code> to <code>macrodroid</code>. These are labels, not your account identity.</li>
              <li>Add <strong>JSON Output</strong>: dictionary <code>req</code> → string <code>body_json</code>. Keep this after the variable assignments and before HTTP.</li>
            </ol>
          </div>}

          {step === 3 && <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="font-semibold text-gray-900">Every person must insert their own token.</p>
              <p>Sign in to your own VectoPilot account on this site, review your services and rules, and copy <a href="#offer-shortcut-token" className="text-blue-700 underline">Your shortcut token</a>. Replace <code>YOUR_SHORTCUT_TOKEN</code> with that value. Never use the example text or someone else’s token.</p>
              <Button type="button" variant="outline" className="mt-3" disabled={!tokenReady} onClick={onCopyToken}><Copy className="mr-2 h-4 w-4" />Copy my token</Button>
              {!tokenReady && <p className="mt-2 text-xs">Load or retry your token in the token section below first.</p>}
            </div>
            <ol className="list-decimal space-y-3 pl-5">
              <li>Add <strong>HTTP Request</strong>, method <strong>POST</strong>. Use this site’s hook URL:<code className="mt-1 block break-all rounded bg-white p-2 select-all">{hookUrl}</code></li>
              <li>In <strong>Headers</strong>, add the name <code>X-Shortcut-Token</code> and paste <strong>your token</strong> as its value. Keep it out of the URL and screenshots you share.</li>
              <li>Set content type to <code>application/json</code>, body source to <strong>Text</strong>, and insert the <code>body_json</code> variable with the magic-text picker (<code>{'{lv=body_json}'}</code>).</li>
              <li>Enable <strong>Block next action until complete</strong>. Store the response body in <code>resp</code> and the HTTP return code in <code>code</code>. Use a <strong>30 second timeout</strong> and leave certificate validation enabled.</li>
            </ol>
            <p className="text-xs">Use the token and URL from the same site. Regenerating a token invalidates the old one; update every macro or shortcut using it. Keep exports containing your token private.</p>
          </div>}

          {step === 4 && <ol className="list-decimal space-y-3 pl-5">
            <li>Before OCR, immediately after any wait, insert an <strong>If</strong> with the same <strong>Uber Driver → Running in foreground → Use App History</strong> condition. Put OCR and all following actions inside it.</li>
            <li>Immediately before <strong>HTTP Request</strong>, insert a second <strong>If</strong> with that foreground condition. Put <strong>HTTP Request, JSON Parse, the return-code check, notification and speech</strong> inside this second block.</li>
            <li>After the response actions, close the return-code If, then the inner foreground If, then the outer foreground If with their matching <strong>End If</strong> actions.</li>
            <li>Keep the macro-wide constraint from step 2 as well. These checks cover the trigger, capture and upload stages. If a foreground check fails, skip the entire remaining block, including its response actions.</li>
          </ol>}

          {step === 5 && <ol className="list-decimal space-y-3 pl-5">
            <li>After the blocking HTTP Request, add <strong>JSON Parse</strong>: string <code>resp</code> → dictionary <code>r</code>.</li>
            <li>Add <strong>If → Compare Values</strong>: local integer <code>code</code> equals <code>200</code>.</li>
            <li>Inside this If, add <strong>Display Notification</strong> with the current <code>r[notification]</code> value, then <strong>Speak Text</strong> with <code>{'{lv=r[voice]}'}</code>. Use the magic-text picker for the dictionary entries.</li>
            <li>Close all three If blocks as shown in step 5. <strong>Voice Search</strong> is not needed for speaking the result; leave it disabled if present.</li>
            <li>A failed request, empty response or <strong>NO DATA</strong> is not an accept/reject decision. If old text is repeated, disable the macro and check the response variables and action order before using it again.</li>
          </ol>}

          {step === 6 && <div className="space-y-3">
            <p>First disable <strong>HTTP Request, JSON Parse, Display Notification and Speak Text</strong> together for a dry run. Save and enable the macro, then use its System Log to check:</p>
            <ol className="list-decimal space-y-3 pl-5">
              <li>Take a screenshot in <strong>Settings</strong>. There should be no analysis or speech. In MacroDroid’s System Log, the foreground constraint should prevent the trigger from firing.</li>
              <li>Take a screenshot with <strong>Uber Driver still on screen</strong>. One invocation should reach OCR and both foreground checks; disabled HTTP sends nothing.</li>
              <li>If your macro has the one-second wait, switch away during it; separately, test switching away during OCR. The first and second foreground checks should respectively stop the remaining block. Do not share logs containing your token or captured text.</li>
            </ol>
            <p>When these pass, restore all four actions and save. Verify Settings screenshots are still blocked. Then test a genuine offer while parked: confirm the current spoken decision and check <strong>Offer Analyzer → Daily Offers</strong> separately for the saved record. Hearing a result alone does not confirm that history was saved.</p>
            <p>Keep Uber Driver visible until the response arrives. This setup reads current-screen text; a different screen or overlay can affect capture. Repeat the checks after permission, token or app changes.</p>
            <p className="text-xs">The working Samsung setup and its app-switch guards were tested, and the owner confirmed it works. A newly rebuilt macro still needs these checks on its own phone.</p>
          </div>}
        </section>
        <div className="flex items-center justify-between gap-3 border-t border-blue-200 pt-4">
          <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
          <span className="text-xs text-gray-600">{step + 1} of {steps.length}</span>
          <Button type="button" disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
        </div>
        <a href="https://macrodroidforum.com/wiki/index.php/Action:HTTP_Request" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 underline">MacroDroid HTTP Request help<ExternalLink className="h-3 w-3" /></a>
      </div>
    </details>
  );
}
