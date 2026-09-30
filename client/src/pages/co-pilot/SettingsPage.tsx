// client/src/pages/co-pilot/SettingsPage.tsx
// 2026-02-13: User profile settings page with editable fields
// Uses same API endpoints and patterns as SignUpPage for consistency

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, type Resolver, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/auth-context';
import { useRunSetup } from '@/contexts/run-setup-context';
import { API_ROUTES } from '@/constants/apiRoutes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/useToast';
import { Loader2, ArrowLeft, Save, User, MapPin, Car, Briefcase } from 'lucide-react';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import type { MarketOption, DriverProfile, DriverVehicle } from '@/types/auth';
import { mergeSettingsDraft, sameSettingsValue, settingsSectionForField, SETTINGS_PLATFORMS, SELECTABLE_SERVICES, type SettingsSection, type ServiceSection } from '@/lib/settings-draft';

// Validation schema for settings form
const settingsSchema = z.object({
  // Personal Info (nickname only editable)
  nickname: z.string().optional(),
  phone: z.string().min(10, 'Please enter a valid phone number'),
  fuelEconomyMpg: z.number().int().min(1).max(2147483647).nullable(),
  earningsGoalDaily: z.number().min(0).max(99999999.99).multipleOf(0.01).nullable(),
  shiftHoursTarget: z.number().min(0).max(24).multipleOf(0.1).nullable(),
  maxDeadheadMi: z.number().int().min(0).max(500).nullable(),

  // Base Location (home address)
  address1: z.string().min(1, 'Address is required'),
  address2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  stateTerritory: z.string().min(1, 'State/Province is required'),
  zipCode: z.string().optional(),
  country: z.string().min(1, 'Country is required'),
  market: z.string().min(1, 'Market is required'),

  // Vehicle
  vehicleYear: z.coerce.number().min(2005, 'Year must be 2005 or later'),
  vehicleMake: z.string().min(1, 'Make is required'),
  vehicleModel: z.string().min(1, 'Model is required'),
  seatbelts: z.coerce.number().min(1, 'Seatbelts is required').max(15),

  // Rideshare Platforms
  ridesharePlatforms: z.array(z.string()).min(1, 'Select at least one platform'),
  selectedServices: z.array(z.string()).min(1, 'Choose the services you want to offer for this setup'),

  // Vehicle Class (base tier)
  eligEconomy: z.boolean().optional(),
  eligXl: z.boolean().optional(),
  eligXxl: z.boolean().optional(),
  eligComfort: z.boolean().optional(),
  eligLuxurySedan: z.boolean().optional(),
  eligLuxurySuv: z.boolean().optional(),

  // Vehicle Attributes
  attrElectric: z.boolean().optional(),
  attrGreen: z.boolean().optional(),
  attrWav: z.boolean().optional(),
  attrSki: z.boolean().optional(),
  attrCarSeat: z.boolean().optional(),

  // Service Preferences
  prefPetFriendly: z.boolean().optional(),
  prefTeen: z.boolean().optional(),
  prefAssist: z.boolean().optional(),
  prefShared: z.boolean().optional(),

  marketingOptIn: z.boolean(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

function profileSettingsValues(profile: DriverProfile, vehicle?: DriverVehicle | null): SettingsFormData {
  return {
    nickname: profile.nickname || profile.firstName,
    phone: profile.phone || '',
    fuelEconomyMpg: profile.fuelEconomyMpg ?? null,
    earningsGoalDaily: profile.earningsGoalDaily ?? null,
    shiftHoursTarget: profile.shiftHoursTarget ?? null,
    maxDeadheadMi: profile.maxDeadheadMi ?? null,
    address1: profile.address1 || '',
    address2: profile.address2 || '',
    city: profile.city || '',
    stateTerritory: profile.stateTerritory || '',
    zipCode: profile.zipCode || '',
    country: profile.country || 'US',
    market: profile.market || '',
    vehicleYear: vehicle?.year || new Date().getFullYear(),
    vehicleMake: vehicle?.make || '',
    vehicleModel: vehicle?.model || '',
    seatbelts: vehicle?.seatbelts || 4,
    ridesharePlatforms: profile.ridesharePlatforms || ['uber'],
    selectedServices: profile.selectedServices ?? [],
    // Vehicle Class
    eligEconomy: profile.eligEconomy ?? true,
    eligXl: profile.eligXl || false,
    eligXxl: profile.eligXxl || false,
    eligComfort: profile.eligComfort || false,
    eligLuxurySedan: profile.eligLuxurySedan || false,
    eligLuxurySuv: profile.eligLuxurySuv || false,
    // Vehicle Attributes
    attrElectric: profile.attrElectric || false,
    attrGreen: profile.attrGreen || false,
    attrWav: profile.attrWav || false,
    attrSki: profile.attrSki || false,
    attrCarSeat: profile.attrCarSeat || false,
    // Service Preferences
    prefPetFriendly: profile.prefPetFriendly || false,
    prefTeen: profile.prefTeen || false,
    prefAssist: profile.prefAssist || false,
    prefShared: profile.prefShared || false,
    marketingOptIn: profile.marketingOptIn || false,
  };
}

interface DropdownOption {
  value: string;
  label: string;
}

export default function SettingsPage() {
  const { user, token, profile, isLoading } = useAuth();
  if (isLoading || (user && (!profile || profile.userId !== user.userId))) {
    return <div role="status" className="flex items-center justify-center p-8">Loading your settings…</div>;
  }
  if (!user || !profile) {
    return <div className="container max-w-2xl mx-auto px-4 py-8"><Alert><AlertDescription>Please sign in to access your settings.</AlertDescription></Alert></div>;
  }
  // A different authenticated account gets a new form before any private draft can render.
  return <SettingsEditor key={`${user.userId}:${token}`} />;
}

function SettingsEditor() {
  const runSetup = useRunSetup();
  const restoredDraft = useRef(runSetup.getEditorDraft<{ values: SettingsFormData; baseline: SettingsFormData; customMarket: string }>('preferences'));
  const lastDraftReset = useRef(runSetup.draftResetVersion);
  const navigate = useNavigate();
  const { profile: authProfile, vehicle: authVehicle, isLoading: authLoading, updateProfile } = useAuth();
  // Form values and their compare-and-swap revision share one confirmed read.
  const profile = runSetup.setup?.profile ?? authProfile;
  const vehicle = runSetup.setup ? runSetup.setup.vehicle : authVehicle;
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [section, setSection] = useState<SettingsSection>('profile');
  const [serviceSection, setServiceSection] = useState<ServiceSection>('ridehail');
  const [validationMessage, setValidationMessage] = useState('');
  const [focusField, setFocusField] = useState<keyof SettingsFormData | 'customMarket' | null>(null);
  const customMarketRef = useRef<HTMLInputElement>(null);
  const [customMarketError, setCustomMarketError] = useState('');
  const baselineRef = useRef<SettingsFormData | null>(null);
  const saveRef = useRef<{ submitted: SettingsFormData; incoming: SettingsFormData | null } | null>(null);
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);

  // Dropdown data
  const [countries, setCountries] = useState<DropdownOption[]>([]);
  const [regions, setRegions] = useState<DropdownOption[]>([]);
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [isLoadingRegions, setIsLoadingRegions] = useState(false);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);

  // 2026-02-13: Custom market name when "Other" is selected
  const [customMarket, setCustomMarket] = useState(restoredDraft.current?.customMarket ?? '');
  const customMarketValue = useRef(customMarket);
  customMarketValue.current = customMarket;

  const form = useForm<SettingsFormData>({
    // Cast: react-hook-form@7.71 added a 4th generic; @hookform/resolvers@5.2.2's
    // zodResolver returns Resolver<TFieldValues> which doesn't match the new shape,
    // and z.coerce.number() makes input type 'unknown' vs output 'number'.
    resolver: zodResolver(settingsSchema) as unknown as Resolver<SettingsFormData>,
    defaultValues: {
      nickname: '',
      phone: '',
      fuelEconomyMpg: null,
      earningsGoalDaily: null,
      shiftHoursTarget: null,
      maxDeadheadMi: null,
      address1: '',
      address2: '',
      city: '',
      stateTerritory: '',
      zipCode: '',
      country: 'US',
      market: '',
      vehicleYear: new Date().getFullYear(),
      vehicleMake: '',
      vehicleModel: '',
      seatbelts: 4,
      ridesharePlatforms: ['uber'],
      selectedServices: [],
      // Vehicle Class
      eligEconomy: true,
      eligXl: false,
      eligXxl: false,
      eligComfort: false,
      eligLuxurySedan: false,
      eligLuxurySuv: false,
      // Vehicle Attributes
      attrElectric: false,
      attrGreen: false,
      attrWav: false,
      attrSki: false,
      attrCarSeat: false,
      // Service Preferences
      prefPetFriendly: false,
      prefTeen: false,
      prefAssist: false,
      prefShared: false,
      marketingOptIn: false,
    },
  });

  const watchPlatforms = form.watch('ridesharePlatforms');
  const watchCountry = form.watch('country');
  const watchMarket = form.watch('market');
  const watchState = form.watch('stateTerritory');

  // 2026-02-13: Track "Other" market selection
  const isOtherMarket = watchMarket === '__OTHER__';

  const applyBaseline = (incoming: SettingsFormData, previous = baselineRef.current) => {
    const draft = previous ? mergeSettingsDraft(previous, form.getValues(), incoming)
      : restoredDraft.current ? mergeSettingsDraft(restoredDraft.current.baseline, restoredDraft.current.values, incoming) : incoming;
    restoredDraft.current = null;
    baselineRef.current = incoming;
    form.reset(incoming, { keepErrors: true, keepTouched: true });
    for (const key of Object.keys(draft) as (keyof SettingsFormData)[]) {
      if (!sameSettingsValue(draft[key], incoming[key])) {
        form.setValue(key, draft[key], { shouldDirty: true });
      }
    }
  };

  useEffect(() => {
    const rememberDraft = () => {
      if (!baselineRef.current) return;
      const values = form.getValues();
      runSetup.setEditorDraft('preferences', sameSettingsValue(values, baselineRef.current) &&
        !(values.market === '__OTHER__' && customMarketValue.current)
        ? null : { values, baseline: baselineRef.current, customMarket: customMarketValue.current });
    };
    const subscription = form.watch(rememberDraft);
    rememberDraft();
    return () => subscription.unsubscribe();
  }, [form, runSetup.setEditorDraft, customMarket]);

  useEffect(() => {
    if (lastDraftReset.current === runSetup.draftResetVersion) return;
    lastDraftReset.current = runSetup.draftResetVersion;
    restoredDraft.current = null;
    customMarketValue.current = '';
    setCustomMarket('');
    if (runSetup.setup?.profile) baselineRef.current = profileSettingsValues(runSetup.setup.profile, runSetup.setup.vehicle);
    if (baselineRef.current) form.reset(baselineRef.current);
  }, [form, runSetup.draftResetVersion]);

  // Load profile data into form when profile is available
  useEffect(() => {
    if (profile) {
      const incoming = profileSettingsValues(profile, vehicle);
      // updateProfile refreshes the source before resolving. Hold it until the save
      // settles so an edit (including reverting a value) during the request survives.
      if (saveRef.current) saveRef.current.incoming = incoming;
      else applyBaseline(incoming);
    }
  }, [profile, vehicle, form]);

  useEffect(() => {
    if (!focusField) return;
    if (focusField === 'customMarket') customMarketRef.current?.focus();
    else form.setFocus(focusField);
    setFocusField(null);
  }, [focusField, section, serviceSection, form]);

  const onInvalid = (errors: FieldErrors<SettingsFormData>) => {
    const field = Object.keys(errors)[0] as keyof SettingsFormData | undefined;
    if (!field) return;
    setSection(settingsSectionForField(field));
    if (field.startsWith('eligLuxury')) setServiceSection('premium');
    else if (field === 'ridesharePlatforms') setServiceSection('ridehail');
    setValidationMessage('Check the highlighted field. Your changes have not been saved.');
    setFocusField(field);
  };

  // Fetch countries on mount
  useEffect(() => {
    fetch(API_ROUTES.PLATFORM.COUNTRIES_DROPDOWN)
      .then(res => res.json())
      .then(data => setCountries(data.countries || []))
      .catch(err => console.error('Failed to load countries:', err));
  }, []);

  // 2026-02-13: Fetch regions when country changes (using correct dropdown endpoint)
  useEffect(() => {
    if (watchCountry) {
      setIsLoadingRegions(true);
      fetch(API_ROUTES.PLATFORM.REGIONS_DROPDOWN(watchCountry))
        .then(res => res.json())
        .then(data => {
          let regionList = data.regions || [];
          // Add current profile value if not in list (so it displays correctly)
          if (profile?.stateTerritory && !regionList.some((r: DropdownOption) => r.value === profile.stateTerritory)) {
            regionList = [{ value: profile.stateTerritory, label: profile.stateTerritory }, ...regionList];
          }
          setRegions(regionList);
          setIsLoadingRegions(false);
        })
        .catch(err => {
          console.error('Failed to load regions:', err);
          // Still show profile value if API fails
          if (profile?.stateTerritory) {
            setRegions([{ value: profile.stateTerritory, label: profile.stateTerritory }]);
          }
          setIsLoadingRegions(false);
        });

    }
  }, [watchCountry, profile?.stateTerritory]);

  // 2026-02-13: Fetch markets when country or state changes
  // For US: filter by selected state using intelligence endpoint's ?state= param
  // For other countries: use platform endpoint (no state filtering)
  useEffect(() => {
    if (!watchCountry) return;

    setIsLoadingMarkets(true);

    // Build endpoint URL with optional state filter
    let marketsEndpoint: string;
    if (watchCountry === 'US') {
      marketsEndpoint = watchState
        ? `${API_ROUTES.INTELLIGENCE.MARKETS_DROPDOWN}?state=${encodeURIComponent(watchState)}`
        : API_ROUTES.INTELLIGENCE.MARKETS_DROPDOWN;
    } else {
      marketsEndpoint = API_ROUTES.PLATFORM.MARKETS_DROPDOWN(watchCountry);
    }

    // 2026-02-13: Include auth header — intelligence routes require authentication
    fetch(marketsEndpoint, { headers: getAuthHeader() })
      .then(res => res.json())
      .then(data => {
        // Convert to MarketOption format (API may return strings or objects)
        const marketList: MarketOption[] = (data.markets || []).map((m: string | MarketOption) =>
          typeof m === 'string' ? { value: m, label: m } : m
        );
        // Add current profile market if not in list
        if (profile?.market && profile.market !== '__OTHER__' && !marketList.some(m => m.value === profile.market)) {
          marketList.unshift({ value: profile.market, label: profile.market });
        }
        // Add "Other" option at the end
        marketList.push({ value: '__OTHER__', label: 'Other (add new market)' });
        setMarkets(marketList);
        setIsLoadingMarkets(false);
      })
      .catch(err => {
        console.error('Failed to load markets:', err);
        // Still show profile market + Other
        const fallback: MarketOption[] = [];
        if (profile?.market && profile.market !== '__OTHER__') {
          fallback.push({ value: profile.market, label: profile.market });
        }
        fallback.push({ value: '__OTHER__', label: 'Other (add new market)' });
        setMarkets(fallback);
        setIsLoadingMarkets(false);
      });
  }, [watchCountry, watchState, profile?.market]);

  // 2026-02-13: Fetch vehicle years using correct endpoint (not uber-specific)
  useEffect(() => {
    fetch(API_ROUTES.VEHICLE.YEARS)
      .then(res => res.json())
      .then(data => {
        let yearList = data.years || [];
        // Add current vehicle year if not in list (so it displays correctly)
        if (vehicle?.year && !yearList.includes(vehicle.year)) {
          yearList = [vehicle.year, ...yearList].sort((a: number, b: number) => b - a);
        }
        setYears(yearList);
      })
      .catch(err => {
        console.error('Failed to load years:', err);
        // Still show vehicle year if API fails
        if (vehicle?.year) {
          setYears([vehicle.year]);
        }
      });
  }, [vehicle?.year]);

  const onSubmit = async (data: SettingsFormData) => {
    if (saveRef.current) return;
    if (!runSetup.setup || runSetup.loading) {
      setValidationMessage('Wait for your saved setup to be confirmed before saving.');
      return;
    }
    const settingsRevision = runSetup.setup.settingsRevision;
    if (typeof settingsRevision !== 'number' || !Number.isInteger(settingsRevision)) {
      setValidationMessage('Your saved profile could not be confirmed. Reload your preferences before saving.');
      return;
    }
    if (data.market === '__OTHER__' && !customMarket.trim()) {
      setCustomMarketError('Please enter your market name');
      setValidationMessage('Please review the highlighted field in Location.');
      setSection('location');
      setFocusField('customMarket');
      return;
    }
    const request = { submitted: structuredClone(data), incoming: null as SettingsFormData | null };
    const releaseSave = runSetup.beginSave();
    let confirmedSave = false;
    saveRef.current = request;
    setIsSaving(true);
    setValidationMessage('');

    try {
      // 2026-02-13: Handle custom market ("Other" selection)
      let finalMarket = data.market;
      if (data.market === '__OTHER__' && customMarket.trim()) {
        try {
          const addMarketRes = await fetch(API_ROUTES.INTELLIGENCE.ADD_MARKET, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({
              market_name: customMarket.trim(),
              city: data.city,
              state: data.stateTerritory,
            }),
          });
          const addMarketData = await addMarketRes.json();
          if (!activeRef.current) return;
          if (addMarketData.success) {
            finalMarket = addMarketData.market_name;
          } else {
            toast({
              title: "Error",
              description: "Failed to add custom market",
              variant: "destructive",
            });
            setIsSaving(false);
            return;
          }
        } catch (err) {
          if (!activeRef.current) return;
          console.error('Failed to add custom market:', err);
          toast({
            title: "Error",
            description: "Failed to add custom market",
            variant: "destructive",
          });
          setIsSaving(false);
          return;
        }
      }

      if (!activeRef.current) return;
      const result = await updateProfile({
        nickname: data.nickname,
        phone: data.phone,
        fuelEconomyMpg: data.fuelEconomyMpg,
        earningsGoalDaily: data.earningsGoalDaily,
        shiftHoursTarget: data.shiftHoursTarget,
        maxDeadheadMi: data.maxDeadheadMi,
        address1: data.address1,
        address2: data.address2,
        city: data.city,
        stateTerritory: data.stateTerritory,
        zipCode: data.zipCode,
        country: data.country,
        market: finalMarket,
        ridesharePlatforms: data.ridesharePlatforms,
        selectedServices: data.selectedServices,
        // Vehicle Class
        eligEconomy: data.eligEconomy,
        eligXl: data.eligXl,
        eligXxl: data.eligXxl,
        eligComfort: data.eligComfort,
        eligLuxurySedan: data.eligLuxurySedan,
        eligLuxurySuv: data.eligLuxurySuv,
        // Vehicle Attributes
        attrElectric: data.attrElectric,
        attrGreen: data.attrGreen,
        attrWav: data.attrWav,
        attrSki: data.attrSki,
        attrCarSeat: data.attrCarSeat,
        // Service Preferences
        prefPetFriendly: data.prefPetFriendly,
        prefTeen: data.prefTeen,
        prefAssist: data.prefAssist,
        prefShared: data.prefShared,
        marketingOptIn: data.marketingOptIn,
        // Vehicle is nested
        vehicle: {
          year: data.vehicleYear,
          make: data.vehicleMake,
          model: data.vehicleModel,
          seatbelts: data.seatbelts,
        },
      } as any, settingsRevision);

      if (!activeRef.current) return;
      if (result.success) {
        confirmedSave = true;
        // Only this save's own readback confirms its canonical values. A held
        // background refresh may predate the PUT and must not undo a successful save.
        const confirmed = result.confirmedProfile?.profile
          ? profileSettingsValues(result.confirmedProfile.profile, result.confirmedProfile.vehicle)
          : { ...request.submitted, market: finalMarket };
        applyBaseline(confirmed, request.submitted);
        if (request.submitted.market === '__OTHER__') setCustomMarket('');
        const saveMessage = sameSettingsValue(form.getValues(), confirmed)
          ? 'Your profile has been updated successfully.'
          : 'Settings saved. You made more changes while saving; save again to keep those too.';
        toast({
          title: "Settings saved",
          description: result.profileRefreshFailed
            ? `${saveMessage} The latest saved values could not be reloaded.`
            : saveMessage,
        });
        // The shared review popup opens over this editor, preserving any newer typing.
        await runSetup.finishSave();
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to save settings",
          variant: "destructive",
        });
      }
    } catch (_err) {
      if (!activeRef.current) return;
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      releaseSave();
      // A failed request does not confirm its payload. Still adopt any background
      // refresh against the previous saved baseline, retaining the user's draft.
      if (activeRef.current && !confirmedSave && request.incoming) applyBaseline(request.incoming);
      if (saveRef.current === request) saveRef.current = null;
      if (activeRef.current) setIsSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container max-w-2xl mx-auto px-4 py-8">
        <Alert>
          <AlertDescription>
            Please sign in to access your settings.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 pb-24 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 text-sm">Manage your profile and preferences</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <p className="font-medium text-gray-900">Your services</p>
            <p className="mt-1 break-words text-gray-600">
              {watchPlatforms?.length
                ? watchPlatforms.map(id => SETTINGS_PLATFORMS.find(option => option.id === id)?.label ?? id).join(' · ')
                : 'No services selected'}
            </p>
            <p className="mt-1 text-xs text-gray-500">{form.formState.isDirty ? 'Unsaved changes' : 'No unsaved changes'} · Selections stay with you when changing sections.</p>
          </div>
          {validationMessage && <Alert role="alert"><AlertDescription>{validationMessage}</AlertDescription></Alert>}
          <Tabs value={section} onValueChange={value => setSection(value as SettingsSection)}>
            <TabsList aria-label="Settings sections" className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
              <TabsTrigger value="profile" className="whitespace-normal">Profile</TabsTrigger>
              <TabsTrigger value="location" className="whitespace-normal">Location</TabsTrigger>
              <TabsTrigger value="vehicle" className="whitespace-normal">Vehicle</TabsTrigger>
              <TabsTrigger value="services" className="whitespace-normal">Services</TabsTrigger>
            </TabsList>
          <TabsContent value="profile" forceMount hidden={section !== 'profile'} className="space-y-4">
          {/* Personal Info Section */}
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5 text-blue-400" />
                Personal Info
              </CardTitle>
              <CardDescription>Your account information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Read-only fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-500">First Name</label>
                  <Input
                    value={profile.firstName}
                    disabled
                    className="bg-gray-100 border-gray-200 text-gray-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-500">Last Name</label>
                  <Input
                    value={profile.lastName}
                    disabled
                    className="bg-gray-100 border-gray-200 text-gray-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-500">Email</label>
                <Input
                  value={profile.email}
                  disabled
                  className="bg-gray-100 border-gray-200 text-gray-500"
                />
                <p className="text-xs text-gray-500">Contact support to change your email</p>
              </div>

              {/* Editable fields */}
              <FormField
                control={form.control}
                name="nickname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700">Nickname</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="How should we greet you?"
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription className="text-gray-500 text-xs">This is what we'll use to greet you in the app</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700">Phone Number</FormLabel>
                      <div className="flex gap-2">
                        <div className="flex items-center px-3 bg-gray-100 border border-gray-300 rounded-md text-gray-600 text-sm min-w-[60px] justify-center">
                          +1
                        </div>
                        <FormControl><Input
                          type="tel"
                          placeholder="(555) 555-5555"
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 flex-1 min-w-0"
                          {...field}
                        /></FormControl>
                      </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Work preferences</CardTitle>
              <CardDescription>Used by your Coach and Strategy. Leave a field blank when it is unknown.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {([
                ['fuelEconomyMpg', 'Fuel economy (mpg)', 1, 2147483647, 1],
                ['earningsGoalDaily', 'Daily earnings goal', 0, 99999999.99, 0.01],
                ['shiftHoursTarget', 'Target shift (hours)', 0, 24, 0.1],
                ['maxDeadheadMi', 'Maximum empty pickup distance (miles)', 0, 500, 1],
              ] as const).map(([name, label, min, max, step]) => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl><Input {...field} type="number" inputMode="decimal" min={min} max={max} step={step}
                      value={field.value ?? ''} onChange={event => field.onChange(event.target.value === '' ? null : event.target.valueAsNumber)} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
              <p className="text-sm text-muted-foreground sm:col-span-2">Your shared-ride preference and pickup limit initialize Offer Analyzer rules until you save rules there. Saved analyzer rules take priority. Other service preferences remain available to your Coach; they are not additional automatic offer gates.</p>
            </CardContent>
          </Card>
          </TabsContent>
          <TabsContent value="location" forceMount hidden={section !== 'location'}>
          {/* Base Location Section */}
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5 text-green-400" />
                Base Location
              </CardTitle>
              <CardDescription>Your home address for distance calculations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="address1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700">Base Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Street address"
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="address2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700">Base Address 2 (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Apt, suite, unit, etc."
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                {/* Country dropdown */}
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Country</FormLabel>
                      <Select key={`country-${field.value}`} onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="bg-white border-gray-300 text-gray-800">
                            <SelectValue placeholder="Select country" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[200px] overflow-y-auto">
                          {countries.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 2026-02-13: State/Province - dropdown if regions available, text input fallback */}
                <FormField
                  control={form.control}
                  name="stateTerritory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">State/Province</FormLabel>
                      {regions.length > 0 ? (
                        <Select
                          key={`state-${field.value}`}
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={!watchCountry || isLoadingRegions}
                        >
                          <FormControl>
                            <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="bg-white border-gray-300 text-gray-800">
                              <SelectValue placeholder={
                                !watchCountry
                                  ? 'Select country first'
                                  : isLoadingRegions
                                  ? 'Loading...'
                                  : 'Select state/province'
                              } />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[200px] overflow-y-auto">
                            {regions.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <FormControl>
                          <Input
                            placeholder={isLoadingRegions ? 'Loading...' : 'Enter state/province'}
                            className="bg-white border-gray-300 text-gray-800"
                            disabled={!watchCountry || isLoadingRegions}
                            {...field}
                          />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">City</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="City"
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="zipCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">ZIP/Postal Code</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="ZIP code"
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* 2026-02-13: Market dropdown - filtered by selected state */}
              <FormField
                control={form.control}
                name="market"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700">Market</FormLabel>
                    {markets.length > 0 ? (
                      <>
                        <Select
                          key={`market-${field.value}`}
                          onValueChange={(val) => {
                            field.onChange(val);
                            if (val !== '__OTHER__') {
                              setCustomMarket('');
                            }
                          }}
                          value={field.value}
                          disabled={!watchCountry || isLoadingMarkets || (isSaving && isOtherMarket)}
                        >
                          <FormControl>
                            <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="bg-white border-gray-300 text-gray-800">
                              <SelectValue placeholder={
                                !watchCountry
                                  ? 'Select country first'
                                  : isLoadingMarkets
                                  ? 'Loading...'
                                  : !watchState
                                  ? 'Select state first'
                                  : 'Select your market'
                              } />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[200px] overflow-y-auto">
                            {markets.map((m) => (
                              <SelectItem key={m.value} value={m.value}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {watchState && (
                          <FormDescription className="text-gray-500 text-xs">
                            Showing markets in {watchState}
                          </FormDescription>
                        )}
                        {/* Show text input when "Other" is selected */}
                        {isOtherMarket && (
                          <div className="mt-2">
                            <label htmlFor="settings-custom-market" className="text-sm font-medium text-gray-700">Custom market name</label>
                            <Input
                              id="settings-custom-market"
                              ref={customMarketRef}
                              disabled={isSaving}
                              aria-invalid={Boolean(customMarketError)}
                              aria-describedby="settings-custom-market-help"
                              placeholder="Enter your market name (e.g., Dallas-Fort Worth)"
                              className="bg-white border-gray-300 text-gray-800"
                              value={customMarket}
                              onChange={(e) => { setCustomMarket(e.target.value); setCustomMarketError(''); }}
                            />
                            <FormDescription id="settings-custom-market-help" className="text-gray-500 text-xs mt-1">
                              {customMarketError || (isSaving ? 'Saving this market name. Other settings remain editable.' : 'Your market will be added to our database')}
                            </FormDescription>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <FormControl>
                          <Input
                            placeholder={isLoadingMarkets ? 'Loading...' : 'Enter your market (e.g., Dallas-Fort Worth)'}
                            className="bg-white border-gray-300 text-gray-800"
                            disabled={!watchCountry || isLoadingMarkets}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-gray-500 text-xs">
                          Enter the city/metro area where you primarily drive
                        </FormDescription>
                      </>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          </TabsContent>
          <TabsContent value="vehicle" forceMount hidden={section !== 'vehicle'} className="space-y-4">
          {/* Vehicle Section */}
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Car className="h-5 w-5 text-purple-400" />
                Vehicle
              </CardTitle>
              <CardDescription>Your primary vehicle information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Year dropdown */}
              <FormField
                control={form.control}
                name="vehicleYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700">Year</FormLabel>
                    {/* 2026-02-13: key forces Radix Select to re-mount when form.reset() updates value */}
                    <Select key={`year-${field.value}`} onValueChange={(val) => field.onChange(parseInt(val))} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="bg-white border-gray-300 text-gray-800">
                          <SelectValue placeholder="Select year" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-[300px] overflow-y-auto">
                        {years.map((year) => (
                          <SelectItem key={year} value={year.toString()}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 2026-02-13: Make & Model in a row (matches sign-up pattern) */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="vehicleMake"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Make</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Toyota, Honda"
                          className="bg-white border-gray-300 text-gray-800"
                          autoComplete="off"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vehicleModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Model</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Camry, Model 3"
                          className="bg-white border-gray-300 text-gray-800"
                          autoComplete="off"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="seatbelts"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700">Number of Seatbelts</FormLabel>
                    {/* 2026-02-13: key forces Radix Select to re-mount when form.reset() updates value */}
                    <Select key={`seatbelts-${field.value}`} onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="bg-white border-gray-300 text-gray-800 w-32">
                          <SelectValue placeholder="Seatbelts" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-gray-500 text-xs">Including driver seat</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className="bg-white border-gray-200 shadow-sm"><CardContent className="pt-6">
              {/* Vehicle Attributes Section */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Vehicle Features</label>
                <p className="text-xs text-gray-500">Special features of your vehicle</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { name: 'attrElectric', label: 'Electric (EV)' },
                    { name: 'attrGreen', label: 'Green / Hybrid' },
                    { name: 'attrWav', label: 'Wheelchair (WAV)' },
                    { name: 'attrSki', label: 'Ski / Winter' },
                    { name: 'attrCarSeat', label: 'Car Seat' },
                  ].map(({ name, label }) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name as keyof SettingsFormData}
                      render={({ field }) => (
                        <div className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                          <Checkbox
                            id={`settings-${name}`}
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                          <label htmlFor={`settings-${name}`} className="text-sm text-gray-700 cursor-pointer">
                            {label}
                          </label>
                        </div>
                      )}
                    />
                  ))}
                </div>
              </div>

          </CardContent></Card>
          </TabsContent>
          <TabsContent value="services" forceMount hidden={section !== 'services'}>
          <Card className="mb-4 bg-white border-gray-200 shadow-sm">
            <CardHeader><CardTitle>Services for this setup</CardTitle><CardDescription>Choose the services you want to offer. This selection does not grant platform or vehicle eligibility.</CardDescription></CardHeader>
            <CardContent><FormField control={form.control} name="selectedServices" render={({ field }) => <FormItem>
              <div className="grid gap-3 sm:grid-cols-2">{SELECTABLE_SERVICES.map(service => <label key={service.id} className="flex min-h-11 items-center gap-2">
                <Checkbox checked={field.value.includes(service.id)} onCheckedChange={checked => field.onChange(checked
                  ? [...field.value, service.id] : field.value.filter(value => value !== service.id))} />
                <span>Offer {service.label}</span>
              </label>)}</div><FormMessage />
            </FormItem>} /></CardContent>
          </Card>
          {/* Rideshare Platforms Section */}
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Briefcase className="h-5 w-5 text-amber-400" />
                Driving services
              </CardTitle>
              <CardDescription>Organize the services and vehicle classes you use.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={serviceSection} onValueChange={value => setServiceSection(value as ServiceSection)}>
                <TabsList aria-label="Driving service sections" className="grid h-auto w-full grid-cols-1 gap-1 min-[380px]:grid-cols-3">
                  <TabsTrigger value="ridehail" className="whitespace-normal">Ridehail</TabsTrigger>
                  <TabsTrigger value="premium" className="whitespace-normal">Black / premium</TabsTrigger>
                  <TabsTrigger value="private" className="whitespace-normal">Private / chauffeur</TabsTrigger>
                </TabsList>
                <TabsContent value={serviceSection} className="space-y-4">
              <p className="text-sm text-gray-600">
                {serviceSection === 'premium'
                  ? 'Your luxury vehicle selections. These are separate from the platforms you drive for.'
                  : serviceSection === 'private'
                    ? 'Select private or chauffeur work. Your vehicle details and ride preferences are shared across services.'
                    : 'Select the ridehail platforms and vehicle classes you use.'}
              </p>
              <div hidden={serviceSection === 'premium'}>
              <FormField
                control={form.control}
                name="ridesharePlatforms"
                render={({ field }) => (
                  <FormItem>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {SETTINGS_PLATFORMS.filter(platform => platform.section === serviceSection).map((platform, index) => (
                        <label key={platform.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            ref={index === 0 ? field.ref : undefined}
                            name={field.name}
                            aria-invalid={Boolean(form.formState.errors.ridesharePlatforms)}
                            checked={field.value?.includes(platform.id)}
                            onCheckedChange={(checked) => {
                              const newValue = checked
                                ? [...(field.value || []), platform.id]
                                : (field.value || []).filter((p) => p !== platform.id);
                              field.onChange(newValue);
                            }}
                          />
                          <span className="text-sm text-gray-700">{platform.label}</span>
                        </label>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>

              {/* Vehicle Class Section */}
              <Separator className="bg-gray-200" />
              <div className="space-y-3" hidden={serviceSection === 'private'}>
                <label className="text-sm font-medium text-gray-700">Vehicle Class</label>
                <p className="text-xs text-gray-500">What type of vehicle do you drive?</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { name: 'eligEconomy', label: 'Economy' },
                    { name: 'eligXl', label: 'Large (XL)' },
                    { name: 'eligXxl', label: 'Extra Large (XXL)' },
                    { name: 'eligComfort', label: 'Comfort' },
                    { name: 'eligLuxurySedan', label: 'Luxury Sedan' },
                    { name: 'eligLuxurySuv', label: 'Luxury SUV' },
                  ].filter(({ name }) => name.startsWith('eligLuxury') === (serviceSection === 'premium')).map(({ name, label }) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name as keyof SettingsFormData}
                      render={({ field }) => (
                        <div className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                          <Checkbox
                            id={`settings-${name}`}
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                          <label htmlFor={`settings-${name}`} className="text-sm text-gray-700 cursor-pointer">
                            {label}
                          </label>
                        </div>
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Service Preferences Section */}
              <Separator className="bg-gray-200" />
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Service Preferences</label>
                <p className="text-xs text-gray-500">Rides you're willing to take (unchecked = avoid)</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { name: 'prefPetFriendly', label: 'Pet Friendly' },
                    { name: 'prefTeen', label: 'Teen Rides' },
                    { name: 'prefAssist', label: 'Assist / Seniors' },
                    { name: 'prefShared', label: 'Shared / Pool' },
                  ].map(({ name, label }) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name as keyof SettingsFormData}
                      render={({ field }) => (
                        <div className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                          <Checkbox
                            id={`settings-${name}`}
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                          <label htmlFor={`settings-${name}`} className="text-sm text-gray-700 cursor-pointer">
                            {label}
                          </label>
                        </div>
                      )}
                    />
                  ))}
                </div>
              </div>

              <Separator className="bg-gray-200" />

              <FormField
                control={form.control}
                name="marketingOptIn"
                render={({ field }) => (
                  <div className="flex items-center space-x-2 p-2">
                    <Checkbox
                      id="settings-marketingOptIn"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <label htmlFor="settings-marketingOptIn" className="text-sm text-gray-700 cursor-pointer">
                      Send me tips, updates, and promotional content
                    </label>
                  </div>
                )}
              />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          </TabsContent>
          </Tabs>

          <Button type="button" variant="outline" className="w-full mb-3" disabled={isSaving}
            onClick={() => navigate('/co-pilot/offer-analyzer')}>Offer Analyzer</Button>

          {/* Save Button */}
          <div className="sticky bottom-20 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent pt-4">
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save and review
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>

      {/* About link (moved from bottom nav 2026-02-13) */}
      <div className="text-center mt-6 pb-4">
        <a
          href="/co-pilot/about"
          className="text-sm text-gray-400 hover:text-gray-600 hover:underline"
        >
          About Vecto Pilot
        </a>
      </div>
    </div>
  );
}
