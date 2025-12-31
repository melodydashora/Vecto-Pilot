// client/src/pages/auth/SignUpPage.tsx
// Multi-step registration form (4 steps) with social login options

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
import { Progress } from '@/components/ui/progress';
import { Loader2, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { MarketOption, VehicleMake, RegisterData } from '@/types/auth';

// Social login icons as inline SVGs for reliability
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

const AppleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
  </svg>
);

// Separator component
const OrDivider = () => (
  <div className="relative my-6">
    <div className="absolute inset-0 flex items-center">
      <div className="w-full border-t border-slate-600" />
    </div>
    <div className="relative flex justify-center text-sm">
      <span className="px-4 bg-slate-800/50 text-slate-400">or continue with email</span>
    </div>
  </div>
);

// Validation schema for the full form
const signUpSchema = z.object({
  // Step 1: Account
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(10, 'Please enter a valid phone number'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),

  // Step 2: Address
  address1: z.string().min(1, 'Address is required'),
  address2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  country: z.string().min(1, 'Country is required'),
  stateTerritory: z.string().min(1, 'State/Province is required'),
  zipCode: z.string().optional(),
  market: z.string().min(1, 'Market is required'),

  // Step 3: Vehicle
  vehicleYear: z.coerce.number().min(2005, 'Year must be 2005 or later'),
  vehicleMake: z.string().min(1, 'Make is required'),
  vehicleModel: z.string().min(1, 'Model is required'),
  seatbelts: z.coerce.number().min(1, 'Seatbelts is required').max(15),

  // Step 4: Services & Terms
  ridesharePlatforms: z.array(z.string()).min(1, 'Select at least one platform'),

  // Vehicle Class (base tier)
  eligEconomy: z.boolean().optional(),       // Standard 4-seat sedan
  eligXl: z.boolean().optional(),            // 6+ seat SUV/minivan
  eligXxl: z.boolean().optional(),           // 6+ seat + extra cargo
  eligComfort: z.boolean().optional(),       // Newer vehicle, extra legroom
  eligLuxurySedan: z.boolean().optional(),   // Premium sedan
  eligLuxurySuv: z.boolean().optional(),     // Premium SUV

  // Vehicle Attributes (hardware features)
  attrElectric: z.boolean().optional(),      // Fully electric vehicle (EV)
  attrGreen: z.boolean().optional(),         // Hybrid or low-emission
  attrWav: z.boolean().optional(),           // Wheelchair accessible
  attrSki: z.boolean().optional(),           // Ski rack / winter ready
  attrCarSeat: z.boolean().optional(),       // Child safety seat

  // Service Preferences (unchecked = avoid these rides)
  prefPetFriendly: z.boolean().optional(),   // Accept passengers with pets
  prefTeen: z.boolean().optional(),          // Unaccompanied minors (13-17)
  prefAssist: z.boolean().optional(),        // Door-to-door assistance for seniors
  prefShared: z.boolean().optional(),        // Carpool/shared rides

  marketingOptIn: z.boolean(),
  termsAccepted: z.boolean().refine(val => val === true, 'You must accept the terms'),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type SignUpFormData = z.infer<typeof signUpSchema>;

const STEPS = [
  { id: 1, title: 'Account', description: 'Create your account' },
  { id: 2, title: 'Address', description: 'Where do you drive?' },
  { id: 3, title: 'Vehicle', description: 'Your vehicle info' },
  { id: 4, title: 'Services', description: 'Platforms & terms' },
];

// Dropdown option type
interface DropdownOption {
  value: string;
  label: string;
}

export default function SignUpPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Social login handlers - redirect to OAuth endpoints
  const handleGoogleSignUp = () => {
    setSocialLoading('google');
    setError(null);
    // Redirect to Google OAuth endpoint (signup mode)
    window.location.href = '/api/auth/google?mode=signup';
  };

  const handleAppleSignUp = () => {
    setSocialLoading('apple');
    setError(null);
    // Redirect to Apple OAuth endpoint (signup mode)
    window.location.href = '/api/auth/apple?mode=signup';
  };

  // Data for dropdowns
  const [countries, setCountries] = useState<DropdownOption[]>([]);
  const [regions, setRegions] = useState<DropdownOption[]>([]);
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [isLoadingCountries, setIsLoadingCountries] = useState(false);
  const [isLoadingRegions, setIsLoadingRegions] = useState(false);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);
  const [isLoadingMakes, setIsLoadingMakes] = useState(false);

  const form = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      address1: '',
      address2: '',
      city: '',
      country: 'US', // Default to US
      stateTerritory: '',
      zipCode: '',
      market: '',
      vehicleYear: new Date().getFullYear(),
      vehicleMake: '',
      vehicleModel: '',
      seatbelts: 4,
      ridesharePlatforms: ['uber'],
      // Vehicle Class - default to economy for most drivers
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
      termsAccepted: false,
    },
  });

  const watchYear = form.watch('vehicleYear');
  const watchMake = form.watch('vehicleMake');
  const watchPlatforms = form.watch('ridesharePlatforms');
  const watchCountry = form.watch('country');

  // Fetch countries on mount (all=true to show all countries, not just those with platform data)
  useEffect(() => {
    setIsLoadingCountries(true);
    fetch('/api/platform/countries-dropdown?all=true')
      .then(res => res.json())
      .then(data => {
        setCountries(data.countries || []);
        setIsLoadingCountries(false);
      })
      .catch(err => {
        console.error('Failed to fetch countries:', err);
        setIsLoadingCountries(false);
      });
  }, []);

  // Check if selected country has platform data (for showing dropdown vs text input)
  const selectedCountryHasPlatformData = countries.find(c => c.value === watchCountry)?.hasPlatformData ?? false;
  const isOtherCountry = watchCountry === 'OTHER';

  // Fetch regions when country changes
  useEffect(() => {
    if (watchCountry && watchCountry !== 'OTHER') {
      setIsLoadingRegions(true);
      form.setValue('stateTerritory', ''); // Reset region when country changes
      form.setValue('market', ''); // Reset market when country changes
      fetch(`/api/platform/regions-dropdown?country=${encodeURIComponent(watchCountry)}`)
        .then(res => res.json())
        .then(data => {
          setRegions(data.regions || []);
          setIsLoadingRegions(false);
        })
        .catch(err => {
          console.error('Failed to fetch regions:', err);
          setIsLoadingRegions(false);
        });

      // Also fetch markets for the selected country
      setIsLoadingMarkets(true);
      fetch(`/api/platform/markets-dropdown?country=${encodeURIComponent(watchCountry)}`)
        .then(res => res.json())
        .then(data => {
          setMarkets(data.markets || []);
          setIsLoadingMarkets(false);
        })
        .catch(err => {
          console.error('Failed to fetch markets:', err);
          setIsLoadingMarkets(false);
        });
    } else if (watchCountry === 'OTHER') {
      // Clear regions/markets for OTHER - user will enter manually
      setRegions([]);
      setMarkets([]);
      form.setValue('stateTerritory', '');
      form.setValue('market', '');
    }
  }, [watchCountry, form]);

  // Fetch vehicle years
  useEffect(() => {
    fetch('/api/vehicle/years')
      .then(res => res.json())
      .then(data => setYears(data.years || []))
      .catch(err => console.error('Failed to fetch years:', err));
  }, []);

  // Fetch vehicle makes
  useEffect(() => {
    setIsLoadingMakes(true);
    fetch('/api/vehicle/makes')
      .then(res => res.json())
      .then(data => {
        setMakes(data.makes || []);
        setIsLoadingMakes(false);
      })
      .catch(err => {
        console.error('Failed to fetch makes:', err);
        setIsLoadingMakes(false);
      });
  }, []);

  // Validate current step before proceeding
  const validateStep = async (): Promise<boolean> => {
    let fieldsToValidate: (keyof SignUpFormData)[] = [];

    switch (step) {
      case 1:
        fieldsToValidate = ['firstName', 'lastName', 'email', 'phone', 'password', 'confirmPassword'];
        break;
      case 2:
        fieldsToValidate = ['address1', 'city', 'country', 'stateTerritory', 'market'];
        break;
      case 3:
        fieldsToValidate = ['vehicleYear', 'vehicleMake', 'vehicleModel', 'seatbelts'];
        break;
      case 4:
        fieldsToValidate = ['ridesharePlatforms', 'termsAccepted'];
        break;
    }

    const result = await form.trigger(fieldsToValidate);
    return result;
  };

  const nextStep = async () => {
    const isValid = await validateStep();
    if (isValid && step < 4) {
      setStep(step + 1);
      setError(null);
    }
  };

  const prevStep = () => {
    if (step > 1) {
      setStep(step - 1);
      setError(null);
    }
  };

  const onSubmit = async (data: SignUpFormData) => {
    setIsLoading(true);
    setError(null);

    const registerData: RegisterData = {
      ...data,
    };

    const result = await registerUser(registerData);

    if (result.success) {
      // Redirect to sign-in page so user can verify their credentials work
      // Show success message via URL parameter
      navigate('/auth/sign-in?registered=true');
    } else {
      setError(result.error || 'Registration failed');
    }

    setIsLoading(false);
  };

  const togglePlatform = (platform: string) => {
    const current = form.getValues('ridesharePlatforms');
    if (current.includes(platform)) {
      form.setValue('ridesharePlatforms', current.filter(p => p !== platform));
    } else {
      form.setValue('ridesharePlatforms', [...current, platform]);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 py-8">
      <Card className="w-full max-w-lg bg-slate-800/50 border-slate-700">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center">
            <span className="text-2xl font-bold text-white">VP</span>
          </div>
          <CardTitle className="text-2xl text-white">Create Account</CardTitle>
          <CardDescription className="text-slate-400">
            Step {step} of 4: {STEPS[step - 1].description}
          </CardDescription>

          {/* Progress indicator */}
          <div className="mt-4">
            <Progress value={(step / 4) * 100} className="h-2" />
            <div className="flex justify-between mt-2">
              {STEPS.map((s) => (
                <div
                  key={s.id}
                  className={`flex flex-col items-center ${
                    s.id <= step ? 'text-amber-400' : 'text-slate-500'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      s.id < step
                        ? 'bg-amber-500 text-white'
                        : s.id === step
                        ? 'bg-amber-500/20 border-2 border-amber-500 text-amber-500'
                        : 'bg-slate-700 text-slate-500'
                    }`}
                  >
                    {s.id < step ? <Check className="w-3 h-3" /> : s.id}
                  </div>
                  <span className="text-xs mt-1 hidden sm:block">{s.title}</span>
                </div>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Social Login - Only show on Step 1 */}
          {step === 1 && (
            <>
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full bg-white hover:bg-gray-50 text-gray-900 border-gray-300"
                  onClick={handleGoogleSignUp}
                  disabled={isLoading || socialLoading !== null}
                >
                  {socialLoading === 'google' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span className="ml-2">Continue with Google</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full bg-black hover:bg-gray-900 text-white border-gray-700"
                  onClick={handleAppleSignUp}
                  disabled={isLoading || socialLoading !== null}
                >
                  {socialLoading === 'apple' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <AppleIcon />
                  )}
                  <span className="ml-2">Continue with Apple</span>
                </Button>
              </div>

              <OrDivider />
            </>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Step 1: Account */}
              {step === 1 && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-200">First Name *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="John"
                              className="bg-slate-700/50 border-slate-600 text-white"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-200">Last Name *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Doe"
                              className="bg-slate-700/50 border-slate-600 text-white"
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
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Email *</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="driver@example.com"
                            className="bg-slate-700/50 border-slate-600 text-white"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Phone Number *</FormLabel>
                        <div className="flex gap-2">
                          <div className="flex items-center px-3 bg-slate-700/50 border border-slate-600 rounded-md text-slate-300 text-sm min-w-[60px] justify-center">
                            +1
                          </div>
                          <FormControl>
                            <Input
                              type="tel"
                              placeholder="(555) 123-4567"
                              className="bg-slate-700/50 border-slate-600 text-white flex-1"
                              {...field}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Password *</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Create a password"
                            className="bg-slate-700/50 border-slate-600 text-white"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-slate-400 text-xs">
                          Min 8 chars, 1 uppercase, 1 lowercase, 1 number
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Confirm Password *</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Confirm your password"
                            className="bg-slate-700/50 border-slate-600 text-white"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* Step 2: Address */}
              {step === 2 && (
                <>
                  {/* Country dropdown - first */}
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Country *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                              <SelectValue placeholder={isLoadingCountries ? 'Loading...' : 'Select country'} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[200px] overflow-y-auto">
                            {countries.map((country) => (
                              <SelectItem key={country.value} value={country.value}>
                                {country.label}
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
                    name="address1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Address Line 1 *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="123 Main Street"
                            className="bg-slate-700/50 border-slate-600 text-white"
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
                        <FormLabel className="text-slate-200">Address Line 2</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Apt, Suite, Unit (optional)"
                            className="bg-slate-700/50 border-slate-600 text-white"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    {/* City first, then State - natural address flow */}
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-200">City *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Dallas"
                              className="bg-slate-700/50 border-slate-600 text-white"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="stateTerritory"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-200">State/Province *</FormLabel>
                          {/* Show dropdown if regions available, otherwise show text input */}
                          {regions.length > 0 && !isOtherCountry ? (
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                              disabled={!watchCountry || isLoadingRegions}
                            >
                              <FormControl>
                                <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
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
                                {regions.map((region) => (
                                  <SelectItem key={region.value} value={region.value}>
                                    {region.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <FormControl>
                              <Input
                                placeholder={isLoadingRegions ? 'Loading...' : 'Enter state/province'}
                                className="bg-slate-700/50 border-slate-600 text-white"
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

                  <FormField
                    control={form.control}
                    name="zipCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">ZIP Code</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="75201"
                            className="bg-slate-700/50 border-slate-600 text-white"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="market"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Market *</FormLabel>
                        {/* Show dropdown if markets available, otherwise show text input */}
                        {markets.length > 0 && !isOtherCountry ? (
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                            disabled={!watchCountry || isLoadingMarkets}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                                <SelectValue placeholder={
                                  !watchCountry
                                    ? 'Select country first'
                                    : isLoadingMarkets
                                    ? 'Loading...'
                                    : 'Select your market'
                                } />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-h-[200px] overflow-y-auto">
                              {markets.map((market) => (
                                <SelectItem key={market.value} value={market.value}>
                                  {market.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <>
                            <FormControl>
                              <Input
                                placeholder={isLoadingMarkets ? 'Loading...' : 'Enter your market (e.g., Dallas-Fort Worth)'}
                                className="bg-slate-700/50 border-slate-600 text-white"
                                disabled={!watchCountry || isLoadingMarkets}
                                {...field}
                              />
                            </FormControl>
                            <FormDescription className="text-slate-400 text-xs">
                              Enter the city/metro area where you primarily drive
                            </FormDescription>
                          </>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* Step 3: Vehicle */}
              {step === 3 && (
                <>
                  <FormField
                    control={form.control}
                    name="vehicleYear"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Year *</FormLabel>
                        <Select
                          onValueChange={(val) => field.onChange(parseInt(val))}
                          defaultValue={field.value?.toString()}
                        >
                          <FormControl>
                            <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
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

                  <FormField
                    control={form.control}
                    name="vehicleMake"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Make *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                              <SelectValue placeholder={isLoadingMakes ? 'Loading...' : 'Select make'} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[300px] overflow-y-auto">
                            {makes.map((make) => (
                              <SelectItem key={make.id} value={make.name}>
                                {make.name}
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
                      <FormItem>
                        <FormLabel className="text-slate-200">Model *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., Camry, Model 3, Accord"
                            className="bg-slate-700/50 border-slate-600 text-white"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="seatbelts"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200">Number of Seatbelts *</FormLabel>
                        <Select
                          onValueChange={(val) => field.onChange(parseInt(val))}
                          defaultValue={field.value?.toString()}
                        >
                          <FormControl>
                            <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                              <SelectValue placeholder="Select seatbelt count" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((num) => (
                              <SelectItem key={num} value={num.toString()}>
                                {num}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* Step 4: Services & Terms */}
              {step === 4 && (
                <>
                  {/* Platforms Section */}
                  <div>
                    <FormLabel className="text-slate-200">Which platforms do you drive for? *</FormLabel>
                    <p className="text-xs text-slate-400 mt-1 mb-3">
                      Select all that apply
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'uber', label: 'Uber' },
                        { id: 'lyft', label: 'Lyft' },
                        { id: 'ridehail', label: 'Other Ridehail' },
                        { id: 'private', label: 'Private/Chauffeur' },
                      ].map((platform) => (
                        <div
                          key={platform.id}
                          className="flex items-center space-x-2 p-2 rounded-lg hover:bg-slate-700/30 transition-colors"
                        >
                          <Checkbox
                            id={platform.id}
                            checked={watchPlatforms?.includes(platform.id)}
                            onCheckedChange={() => togglePlatform(platform.id)}
                          />
                          <label
                            htmlFor={platform.id}
                            className="text-sm text-slate-200 cursor-pointer"
                          >
                            {platform.label}
                          </label>
                        </div>
                      ))}
                    </div>
                    {form.formState.errors.ridesharePlatforms && (
                      <p className="text-sm text-red-500 mt-1">
                        {form.formState.errors.ridesharePlatforms.message}
                      </p>
                    )}
                  </div>

                  {/* Vehicle Class Section */}
                  <div className="bg-slate-700/30 rounded-lg p-4">
                    <FormLabel className="text-slate-200">Vehicle Class</FormLabel>
                    <p className="text-xs text-slate-400 mt-1 mb-3">
                      What type of vehicle do you drive? Select all that apply.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { name: 'eligEconomy', label: 'Economy', desc: '4 seats, standard vehicle' },
                        { name: 'eligXl', label: 'Large (XL)', desc: '6+ seats, SUV/Minivan' },
                        { name: 'eligXxl', label: 'Extra Large (XXL)', desc: '6+ seats + cargo space' },
                        { name: 'eligComfort', label: 'Comfort', desc: 'Newer, extra legroom' },
                        { name: 'eligLuxurySedan', label: 'Luxury Sedan', desc: 'Premium sedan, black on black' },
                        { name: 'eligLuxurySuv', label: 'Luxury SUV', desc: 'Premium SUV, 6+ seats' },
                      ].map(({ name, label }) => (
                        <FormField
                          key={name}
                          control={form.control}
                          name={name as keyof SignUpFormData}
                          render={({ field }) => (
                            <div className="flex items-center space-x-2 p-2 rounded-lg hover:bg-slate-700/50 transition-colors">
                              <Checkbox
                                id={name}
                                checked={field.value as boolean}
                                onCheckedChange={field.onChange}
                              />
                              <label htmlFor={name} className="text-sm text-slate-200 cursor-pointer">
                                {label}
                              </label>
                            </div>
                          )}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Vehicle Attributes Section */}
                  <div className="bg-slate-700/30 rounded-lg p-4">
                    <FormLabel className="text-slate-200">Vehicle Features</FormLabel>
                    <p className="text-xs text-slate-400 mt-1 mb-3">
                      Special features of your vehicle
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { name: 'attrElectric', label: 'Electric (EV)' },
                        { name: 'attrGreen', label: 'Green / Hybrid' },
                        { name: 'attrWav', label: 'Wheelchair (WAV)' },
                        { name: 'attrSki', label: 'Ski / Winter Ready' },
                        { name: 'attrCarSeat', label: 'Car Seat Available' },
                      ].map(({ name, label }) => (
                        <FormField
                          key={name}
                          control={form.control}
                          name={name as keyof SignUpFormData}
                          render={({ field }) => (
                            <div className="flex items-center space-x-2 p-2 rounded-lg hover:bg-slate-700/50 transition-colors">
                              <Checkbox
                                id={name}
                                checked={field.value as boolean}
                                onCheckedChange={field.onChange}
                              />
                              <label htmlFor={name} className="text-sm text-slate-200 cursor-pointer">
                                {label}
                              </label>
                            </div>
                          )}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Service Preferences Section */}
                  <div className="bg-slate-700/30 rounded-lg p-4">
                    <FormLabel className="text-slate-200">Service Preferences</FormLabel>
                    <p className="text-xs text-slate-400 mt-1 mb-3">
                      Rides you're willing to accept. Unchecked = we'll avoid sending you these.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { name: 'prefPetFriendly', label: 'Pet Friendly' },
                        { name: 'prefTeen', label: 'Teen Rides (13-17)' },
                        { name: 'prefAssist', label: 'Assist / Seniors' },
                        { name: 'prefShared', label: 'Shared / Pool Rides' },
                      ].map(({ name, label }) => (
                        <FormField
                          key={name}
                          control={form.control}
                          name={name as keyof SignUpFormData}
                          render={({ field }) => (
                            <div className="flex items-center space-x-2 p-2 rounded-lg hover:bg-slate-700/50 transition-colors">
                              <Checkbox
                                id={name}
                                checked={field.value as boolean}
                                onCheckedChange={field.onChange}
                              />
                              <label htmlFor={name} className="text-sm text-slate-200 cursor-pointer">
                                {label}
                              </label>
                            </div>
                          )}
                        />
                      ))}
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="marketingOptIn"
                    render={({ field }) => (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="marketingOptIn"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                        <label htmlFor="marketingOptIn" className="text-sm text-slate-200 cursor-pointer">
                          Receive VectoPilot news and updates
                        </label>
                      </div>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="termsAccepted"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-start space-x-2">
                          <Checkbox
                            id="termsAccepted"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="mt-0.5"
                          />
                          <label htmlFor="termsAccepted" className="text-sm text-slate-200 cursor-pointer">
                            I agree to the{' '}
                            <Link to="/auth/terms" className="text-amber-400 hover:text-amber-300" target="_blank">
                              Terms and Conditions
                            </Link>{' '}
                            *
                          </label>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* Navigation buttons */}
              <div className="flex justify-between pt-4">
                {step > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={prevStep}
                    className="border-slate-600 text-slate-200 hover:bg-slate-700"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                ) : (
                  <div />
                )}

                {step < 4 ? (
                  <Button
                    type="button"
                    onClick={nextStep}
                    className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                  >
                    Next
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      <>
                        Create Account
                        <Check className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </Form>

          <div className="mt-6 text-center text-slate-400">
            <span>Already have an account? </span>
            <Link to="/auth/sign-in" className="text-amber-400 hover:text-amber-300 font-medium">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
