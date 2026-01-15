// client/src/pages/co-pilot/SettingsPage.tsx
// User profile settings page with editable fields

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/useToast';
import { Loader2, ArrowLeft, Save, User, MapPin, Car, Briefcase, AlertTriangle, Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import type { MarketOption, VehicleMake, VehicleModel } from '@/types/auth';
import { API_ROUTES } from '@/constants/apiRoutes';

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
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [isLoadingRegions, setIsLoadingRegions] = useState(false);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);
  const [isLoadingMakes, setIsLoadingMakes] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Model autocomplete state
  const [modelInputValue, setModelInputValue] = useState('');
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);

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

  const watchYear = form.watch('vehicleYear');
  const watchMake = form.watch('vehicleMake');
  const _watchPlatforms = form.watch('ridesharePlatforms');
  const watchCountry = form.watch('country');
  const watchModel = form.watch('vehicleModel');

  // Filter models based on input for autocomplete suggestions
  const filteredModels = modelInputValue
    ? models.filter(m => m.name.toLowerCase().includes(modelInputValue.toLowerCase()))
    : models;

  // Check if the current model value matches a known model (case-insensitive)
  const isModelKnown = models.some(m => m.name.toLowerCase() === watchModel?.toLowerCase());

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
      // Set model input for autocomplete
      if (vehicle?.model) {
        setModelInputValue(vehicle.model);
      }
    }
  }, [profile, vehicle, form]);

  // Fetch countries on mount
  useEffect(() => {
    fetch(API_ROUTES.PLATFORM.COUNTRIES_DROPDOWN)
      .then(res => res.json())
      .then(data => setCountries(data.countries || []))
      .catch(err => console.error('Failed to load countries:', err));
  }, []);

  // Fetch regions when country changes
  useEffect(() => {
    if (watchCountry) {
      setIsLoadingRegions(true);
      fetch(API_ROUTES.PLATFORM.REGIONS(watchCountry))
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

      // Fetch markets for country
      setIsLoadingMarkets(true);
      fetch(API_ROUTES.PLATFORM.MARKETS_BY_COUNTRY(watchCountry))
        .then(res => res.json())
        .then(data => {
          let marketList = data.markets || [];
          // Add current profile value if not in list
          if (profile?.market && !marketList.some((m: MarketOption) => m.value === profile.market)) {
            marketList = [{ value: profile.market, label: profile.market }, ...marketList];
          }
          setMarkets(marketList);
          setIsLoadingMarkets(false);
        })
        .catch(err => {
          console.error('Failed to load markets:', err);
          // Still show profile value if API fails
          if (profile?.market) {
            setMarkets([{ value: profile.market, label: profile.market }]);
          }
          setIsLoadingMarkets(false);
        });
    }
  }, [watchCountry, profile?.stateTerritory, profile?.market]);

  // Fetch vehicle years on mount
  useEffect(() => {
    fetch(API_ROUTES.PLATFORM.UBER.YEARS)
      .then(res => res.json())
      .then(data => {
        let yearList = data.years || [];
        // Add current vehicle year if not in list (so it displays correctly)
        if (vehicle?.year && !yearList.includes(vehicle.year)) {
          yearList = [vehicle.year, ...yearList].sort((a, b) => b - a);
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

  // Fetch makes when year changes
  useEffect(() => {
    if (watchYear) {
      setIsLoadingMakes(true);
      fetch(API_ROUTES.PLATFORM.UBER.MAKES(watchYear.toString()))
        .then(res => res.json())
        .then(data => {
          let makeList = data.makes || [];
          // Add current vehicle make if not in list (so it displays correctly)
          if (vehicle?.make && !makeList.some((m: VehicleMake) => m.name === vehicle.make)) {
            makeList = [{ id: `custom-${vehicle.make}`, name: vehicle.make }, ...makeList];
          }
          setMakes(makeList);
          setIsLoadingMakes(false);
        })
        .catch(err => {
          console.error('Failed to load makes:', err);
          // Still show vehicle make if API fails
          if (vehicle?.make) {
            setMakes([{ id: `custom-${vehicle.make}`, name: vehicle.make }]);
          }
          setIsLoadingMakes(false);
        });
    }
  }, [watchYear, vehicle?.make]);

  // Fetch models when make changes
  useEffect(() => {
    if (watchYear && watchMake) {
      setIsLoadingModels(true);
      fetch(API_ROUTES.PLATFORM.UBER.MODELS(watchYear.toString(), watchMake))
        .then(res => res.json())
        .then(data => {
          let modelList = data.models || [];
          // Add current vehicle model if not in list (so it displays correctly)
          if (vehicle?.model && !modelList.some((m: VehicleModel) => m.name === vehicle.model)) {
            modelList = [{ id: `custom-${vehicle.model}`, name: vehicle.model }, ...modelList];
          }
          setModels(modelList);
          setIsLoadingModels(false);
        })
        .catch(err => {
          console.error('Failed to load models:', err);
          // Still show vehicle model if API fails
          if (vehicle?.model) {
            setModels([{ id: `custom-${vehicle.model}`, name: vehicle.model }]);
          }
          setIsLoadingModels(false);
        });
    }
  }, [watchYear, watchMake, vehicle?.model]);

  const onSubmit = async (data: SettingsFormData) => {
    setIsSaving(true);

    try {
      const result = await updateProfile({
        nickname: data.nickname,
        phone: data.phone,
        address1: data.address1,
        address2: data.address2,
        city: data.city,
        stateTerritory: data.stateTerritory,
        zipCode: data.zipCode,
        country: data.country,
        market: data.market,
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
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm">Manage your profile and preferences</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Personal Info Section */}
          <Card className="bg-slate-800/50 border-slate-700">
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
                  <label className="text-sm font-medium text-slate-400">First Name</label>
                  <Input
                    value={profile.firstName}
                    disabled
                    className="bg-slate-700/50 border-slate-600 text-slate-400"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Last Name</label>
                  <Input
                    value={profile.lastName}
                    disabled
                    className="bg-slate-700/50 border-slate-600 text-slate-400"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">Email</label>
                <Input
                  value={profile.email}
                  disabled
                  className="bg-slate-700/50 border-slate-600 text-slate-400"
                />
                <p className="text-xs text-slate-500">Contact support to change your email</p>
              </div>

              {/* Editable fields - use lighter bg-slate-600 for visibility */}
              <FormField
                control={form.control}
                name="nickname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nickname</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="How should we greet you?"
                        className="bg-slate-600 border-slate-500 text-white placeholder:text-slate-400"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>This is what we'll use to greet you in the app</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <div className="flex">
                        <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-slate-500 bg-slate-700/50 text-slate-400 text-sm">
                          +1
                        </span>
                        <Input
                          type="tel"
                          placeholder="(555) 555-5555"
                          className="rounded-l-none bg-slate-600 border-slate-500 text-white placeholder:text-slate-400"
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
          <Card className="bg-slate-800/50 border-slate-700">
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
                    <FormLabel>Base Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Street address"
                        className="bg-slate-600 border-slate-500 text-white placeholder:text-slate-400"
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
                    <FormLabel>Base Address 2 (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Apt, suite, unit, etc."
                        className="bg-slate-600 border-slate-500 text-white placeholder:text-slate-400"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                            <SelectValue placeholder="Select country" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px] overflow-y-auto">
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

                <FormField
                  control={form.control}
                  name="stateTerritory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State/Province</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                            <SelectValue placeholder={isLoadingRegions ? "Loading..." : "Select state"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px] overflow-y-auto">
                          {regions.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="City"
                          className="bg-slate-600 border-slate-500 text-white placeholder:text-slate-400"
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
                      <FormLabel>ZIP/Postal Code</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="ZIP code"
                          className="bg-slate-600 border-slate-500 text-white placeholder:text-slate-400"
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
                name="market"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Market</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                          <SelectValue placeholder={isLoadingMarkets ? "Loading..." : "Select market"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-[300px] overflow-y-auto">
                        {markets.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>The city where you primarily drive</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Vehicle Section */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Car className="h-5 w-5 text-purple-400" />
                Vehicle
              </CardTitle>
              <CardDescription>Your primary vehicle information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="vehicleYear"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year</FormLabel>
                      <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                            <SelectValue placeholder="Year" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px] overflow-y-auto">
                          {years.map((y) => (
                            <SelectItem key={y} value={y.toString()}>
                              {y}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vehicleMake"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                            <SelectValue placeholder={isLoadingMakes ? "Loading..." : "Make"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px] overflow-y-auto">
                          {makes.map((m) => (
                            <SelectItem key={m.id} value={m.name}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vehicleModel"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Model</FormLabel>
                      <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <div className="relative">
                              <Input
                                placeholder={
                                  !watchMake
                                    ? 'Select make first'
                                    : isLoadingModels
                                    ? 'Loading models...'
                                    : 'Type or select model'
                                }
                                className="bg-slate-600 border-slate-500 text-white placeholder:text-slate-400 pr-8"
                                disabled={!watchMake || isLoadingModels}
                                value={field.value || ''}
                                onChange={(e) => {
                                  field.onChange(e.target.value);
                                  setModelInputValue(e.target.value);
                                  if (!modelPopoverOpen && e.target.value) {
                                    setModelPopoverOpen(true);
                                  }
                                }}
                                onFocus={() => {
                                  if (watchMake && !isLoadingModels) {
                                    setModelPopoverOpen(true);
                                  }
                                }}
                              />
                              <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                            </div>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command>
                            <CommandList>
                              <CommandEmpty>
                                {isLoadingModels ? 'Loading...' : 'No matching models found'}
                              </CommandEmpty>
                              <CommandGroup>
                                {filteredModels.slice(0, 10).map((model) => (
                                  <CommandItem
                                    key={model.id}
                                    value={model.name}
                                    onSelect={() => {
                                      field.onChange(model.name);
                                      setModelInputValue(model.name);
                                      setModelPopoverOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${
                                        field.value === model.name ? 'opacity-100' : 'opacity-0'
                                      }`}
                                    />
                                    {model.name}
                                  </CommandItem>
                                ))}
                                {filteredModels.length > 10 && (
                                  <div className="px-2 py-1.5 text-xs text-slate-400">
                                    Type to filter {filteredModels.length - 10} more models...
                                  </div>
                                )}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {/* Warning when model doesn't match known list */}
                      {field.value && !isLoadingModels && models.length > 0 && !isModelKnown && (
                        <div className="flex items-center gap-1.5 text-amber-400 text-xs mt-1">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Model not in our database - please verify spelling</span>
                        </div>
                      )}
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
                    <FormLabel>Number of Seatbelts</FormLabel>
                    <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger className="bg-slate-600 border-slate-500 text-white w-32">
                          <SelectValue placeholder="Seatbelts" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {[4, 5, 6, 7, 8].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Including driver seat</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Rideshare Platforms Section */}
          <Card className="bg-slate-800/50 border-slate-700">
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
                          <span>{platform.label}</span>
                        </label>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Vehicle Class Section */}
              <Separator className="bg-slate-700" />
              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-300">Vehicle Class</label>
                <p className="text-xs text-slate-400">What type of vehicle do you drive?</p>
                <div className="grid grid-cols-2 gap-3">
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
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                          <span className="text-sm">{label}</span>
                        </label>
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Vehicle Attributes Section */}
              <Separator className="bg-slate-700" />
              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-300">Vehicle Features</label>
                <p className="text-xs text-slate-400">Special features of your vehicle</p>
                <div className="grid grid-cols-2 gap-3">
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
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                          <span className="text-sm">{label}</span>
                        </label>
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Service Preferences Section */}
              <Separator className="bg-slate-700" />
              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-300">Service Preferences</label>
                <p className="text-xs text-slate-400">Rides you're willing to take (unchecked = avoid)</p>
                <div className="grid grid-cols-2 gap-3">
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
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={field.value as boolean}
                            onCheckedChange={field.onChange}
                          />
                          <span className="text-sm">{label}</span>
                        </label>
                      )}
                    />
                  ))}
                </div>
              </div>

              <Separator className="bg-slate-700" />

              <FormField
                control={form.control}
                name="marketingOptIn"
                render={({ field }) => (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <span className="text-sm">
                      Send me tips, updates, and promotional content
                    </span>
                  </label>
                )}
              />
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="sticky bottom-20 bg-gradient-to-t from-slate-900 via-slate-900 to-transparent pt-4">
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
    </div>
  );
}
