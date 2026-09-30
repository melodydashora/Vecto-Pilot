import { useNavigate } from 'react-router-dom';
import { useRunSetup } from '@/contexts/run-setup-context';
import { Button } from '@/components/ui/button';

// The choice is intentionally small: canonical saved values stay in their editors.
// Confirming preferences never starts Strategy or venue generation.
export default function RunSetupSummary() {
  const setup = useRunSetup();
  const navigate = useNavigate();
  const missing = Array.from(new Set((setup.setup?.missingFields ?? []).map(field => field === 'offerRules'
    ? 'Offer Analyzer preferences' : field.includes('selectedServices') ? 'services'
    : field.startsWith('vehicle') ? 'vehicle details' : field.includes('ridesharePlatforms')
    ? 'platforms' : 'required preferences')));
  return <section aria-label="Saved setup" className="space-y-4">
    <p className="text-sm leading-relaxed text-muted-foreground">Use your saved preferences, or make changes for this session. Start Strategy when you’re ready.</p>
    {setup.loading && <p role="status" className="text-sm text-muted-foreground">Confirming your saved settings…</p>}
    {setup.error && <p role="alert" className="text-sm text-destructive">{setup.error}</p>}
    {setup.setup && !setup.setup.ready && <p role="status" className="text-sm text-muted-foreground">Complete {missing.join(', ') || 'your preferences'} before continuing.</p>}
    {!!setup.unsavedEditors?.length && <p role="status" className="text-sm text-muted-foreground">Your changes are still unsaved. Finish saving, or return to the editor to discard them.</p>}
    {setup.saveUnconfirmed && !setup.saving && <p role="status" className="text-sm text-muted-foreground">Your changes could not be confirmed. Review and save them before continuing.</p>}
    <div className="space-y-2">
      <Button className="min-h-11 h-auto w-full whitespace-normal py-3" disabled={!setup.canContinue}
        onClick={() => { if (setup.confirmPreferences()) navigate('/co-pilot/strategy'); }}>Continue with Preference</Button>
      <Button variant="outline" className="min-h-11 h-auto w-full whitespace-normal py-3" disabled={setup.starting || setup.saving}
        onClick={() => { setup.editSetup(); navigate('/co-pilot/settings'); }}>Change Preferences for this session</Button>
    </div>
  </section>;
}
