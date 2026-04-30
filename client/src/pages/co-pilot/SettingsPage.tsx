// client/src/pages/co-pilot/SettingsPage.tsx
// 2026-02-13: User profile settings page with editable fields
// Uses same API endpoints and patterns as SignUpPage for consistency

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/auth-context';
import { API_ROUTES } from '@/constants/apiRoutes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/useToast';
import { Loader2, ArrowLeft, Save, User, MapPin, Car, Briefcase } from 'lucide-react';
import { UberSettingsSection } from '@/components/settings/UberSettingsSection';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import type { MarketOption } from '@/types/auth';

// Validation schema for settings form
const settingsSchema = z.object({
  // Personal Info (nickname only editable)
  nickname: z.string().optional(),
  phone: z.string().min(10, 'Please enter a valid phone number'),

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

interface DropdownOption {
  value: string;
  label: string;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { profile, vehicle, isLoading: authLoading, updateProfile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  // Dropdown data
  const [countries, setCountries] = useState<DropdownOption[]>([]);
  const [regions, setRegions] = useState<DropdownOption[]>([]);
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [isLoadingRegions, setIsLoadingRegions] = useState(false);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);

  // 2026-02-13: Custom market name when "Other" is selected
  const [customMarket, setCustomMarket] = useState('');

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      nickname: '',
      phone: '',
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

  const _watchPlatforms = form.watch('ridesharePlatforms');
  const watchCountry = form.watch('country');
  const watchMarket = form.watch('market');
  const watchState = form.watch('stateTerritory');

  // 2026-02-13: Track "Other" market selection
  const isOtherMarket = watchMarket === '__OTHER__';

  // Load profile data into form when profile is available
  useEffect(() => {
    if (profile) {
      form.reset({
        nickname: profile.nickname || profile.firstName,
        phone: profile.phone || '',
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
      });
    }
  }, [profile, vehicle, form]);

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
        if (profile?.market && !marketList.some(m => m.value === profile.market)) {
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
        if (profile?.market) {
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
    setIsSaving(true);

    try {
      // 2026-02-13: Handle custom market ("Other" selection)
      let finalMarket = data.market;
      if (data.market === '__OTHER__' && customMarket.trim()) {
        try {
          const addMarketRes = await fetch(API_ROUTES.INTELLIGENCE.ADD_MARKET, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              market_name: customMarket.trim(),
              city: data.city,
              state: data.stateTerritory,
            }),
          });
          const addMarketData = await addMarketRes.json();
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
          console.error('Failed to add custom market:', err);
          toast({
            title: "Error",
            description: "Failed to add custom market",
            variant: "destructive",
          });
          setIsSaving(false);
          return;
        }
      } else if (data.market === '__OTHER__' && !customMarket.trim()) {
        toast({
          title: "Error",
          description: "Please enter your market name",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }

      const result = await updateProfile({
        nickname: data.nickname,
        phone: data.phone,
        address1: data.address1,
        address2: data.address2,
        city: data.city,
        stateTerritory: data.stateTerritory,
        zipCode: data.zipCode,
        country: data.country,
        market: finalMarket,
        ridesharePlatforms: data.ridesharePlatforms,
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
      } as any);

      if (result.success) {
        toast({
          title: "Settings saved",
          description: "Your profile has been updated successfully.",
        });
        await refreshProfile();
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to save settings",
          variant: "destructive",
        });
      }
    } catch (_err) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
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
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                    <FormControl>
                      <div className="flex gap-2">
                        <div className="flex items-center px-3 bg-gray-100 border border-gray-300 rounded-md text-gray-600 text-sm min-w-[60px] justify-center">
                          +1
                        </div>
                        <Input
                          type="tel"
                          placeholder="(555) 555-5555"
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 flex-1"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

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
                          <SelectTrigger className="bg-white border-gray-300 text-gray-800">
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
                            <SelectTrigger className="bg-white border-gray-300 text-gray-800">
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
                          disabled={!watchCountry || isLoadingMarkets}
                        >
                          <FormControl>
                            <SelectTrigger className="bg-white border-gray-300 text-gray-800">
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
                            <Input
                              placeholder="Enter your market name (e.g., Dallas-Fort Worth)"
                              className="bg-white border-gray-300 text-gray-800"
                              value={customMarket}
                              onChange={(e) => setCustomMarket(e.target.value)}
                            />
                            <FormDescription className="text-gray-500 text-xs mt-1">
                              Your market will be added to our database
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
                        <SelectTrigger className="bg-white border-gray-300 text-gray-800">
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
                        <SelectTrigger className="bg-white border-gray-300 text-gray-800 w-32">
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

          {/* Uber Integration Section */}
          <UberSettingsSection />

          {/* Rideshare Platforms Section */}
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Briefcase className="h-5 w-5 text-amber-400" />
                Rideshare Platforms
              </CardTitle>
              <CardDescription>Platforms you drive for</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="ridesharePlatforms"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex flex-wrap gap-4">
                      {[
                        { id: 'uber', label: 'Uber' },
                        { id: 'lyft', label: 'Lyft' },
                        { id: 'ridehail', label: 'Other Ridehail' },
                        { id: 'private', label: 'Private/Chauffeur' },
                      ].map((platform) => (
                        <label key={platform.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
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

              {/* Vehicle Class Section */}
              <Separator className="bg-gray-200" />
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Vehicle Class</label>
                <p className="text-xs text-gray-500">What type of vehicle do you drive?</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { name: 'eligEconomy', label: 'Economy' },
                    { name: 'eligXl', label: 'Large (XL)' },
                    { name: 'eligXxl', label: 'Extra Large (XXL)' },
                    { name: 'eligComfort', label: 'Comfort' },
                    { name: 'eligLuxurySedan', label: 'Luxury Sedan' },
                    { name: 'eligLuxurySuv', label: 'Luxury SUV' },
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

              {/* Vehicle Attributes Section */}
              <Separator className="bg-gray-200" />
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Vehicle Features</label>
                <p className="text-xs text-gray-500">Special features of your vehicle</p>
                <div className="grid grid-cols-2 gap-2">
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

              {/* Service Preferences Section */}
              <Separator className="bg-gray-200" />
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Service Preferences</label>
                <p className="text-xs text-gray-500">Rides you're willing to take (unchecked = avoid)</p>
                <div className="grid grid-cols-2 gap-2">
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
            </CardContent>
          </Card>

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
                  Save Changes
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
