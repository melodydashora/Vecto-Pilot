import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export function UserProfileModal({ isOpen, onClose, userId }: UserProfileModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    preferred_city: '',
    preferred_state: '',
    rideshare_platform: 'uber',
    target_hourly_rate: '',
    avg_trip_minutes: '15',
    avg_wait_minutes: '5',
    driver_experience_level: 'intermediate'
  });

  // Fetch existing profile
  const { data: profile, isLoading } = useQuery({
    queryKey: ['/api/profile', userId],
    queryFn: async () => {
      const response = await fetch(`/api/profile/${userId}`);
      if (!response.ok) throw new Error('Failed to fetch profile');
      return response.json();
    },
    enabled: isOpen && !!userId
  });

  // Update form when profile loads
  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        preferred_city: profile.preferred_city || '',
        preferred_state: profile.preferred_state || '',
        rideshare_platform: profile.rideshare_platform || 'uber',
        target_hourly_rate: profile.target_hourly_rate ? String(profile.target_hourly_rate) : '',
        avg_trip_minutes: profile.avg_trip_minutes ? String(profile.avg_trip_minutes) : '15',
        avg_wait_minutes: profile.avg_wait_minutes ? String(profile.avg_wait_minutes) : '5',
        driver_experience_level: profile.driver_experience_level || 'intermediate'
      });
    }
  }, [profile]);

  // Save profile mutation
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', '/api/profile', {
        ...data,
        user_id: userId
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/profile', userId] });
      toast({
        title: 'Profile saved',
        description: 'Your driver profile has been updated successfully.',
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: 'Save failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-user-profile">
        <DialogHeader>
          <DialogTitle data-testid="text-profile-title">Driver Profile & Preferences</DialogTitle>
          <DialogDescription>
            Update your profile and preferences for personalized recommendations
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading profile...</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Personal Information */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Personal Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    data-testid="input-full-name"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    data-testid="input-email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="driver@example.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    data-testid="input-phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>
            </div>

            {/* Preferred Location */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Preferred Location</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="preferred_city">City</Label>
                  <Input
                    id="preferred_city"
                    data-testid="input-city"
                    value={formData.preferred_city}
                    onChange={(e) => setFormData({ ...formData, preferred_city: e.target.value })}
                    placeholder="Frisco"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="preferred_state">State</Label>
                  <Input
                    id="preferred_state"
                    data-testid="input-state"
                    value={formData.preferred_state}
                    onChange={(e) => setFormData({ ...formData, preferred_state: e.target.value })}
                    placeholder="TX"
                  />
                </div>
              </div>
            </div>

            {/* Driver Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Driver Settings</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rideshare_platform">Rideshare Platform</Label>
                  <Select
                    value={formData.rideshare_platform}
                    onValueChange={(value) => setFormData({ ...formData, rideshare_platform: value })}
                  >
                    <SelectTrigger id="rideshare_platform" data-testid="select-platform">
                      <SelectValue placeholder="Select platform" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="uber">Uber</SelectItem>
                      <SelectItem value="lyft">Lyft</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="driver_experience_level">Experience Level</Label>
                  <Select
                    value={formData.driver_experience_level}
                    onValueChange={(value) => setFormData({ ...formData, driver_experience_level: value })}
                  >
                    <SelectTrigger id="driver_experience_level" data-testid="select-experience">
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner (&lt; 6 months)</SelectItem>
                      <SelectItem value="intermediate">Intermediate (6mo - 2yr)</SelectItem>
                      <SelectItem value="expert">Expert (2+ years)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="target_hourly_rate">Target Hourly Rate ($)</Label>
                  <Input
                    id="target_hourly_rate"
                    type="number"
                    data-testid="input-hourly-rate"
                    value={formData.target_hourly_rate}
                    onChange={(e) => setFormData({ ...formData, target_hourly_rate: e.target.value })}
                    placeholder="30"
                    min="0"
                    step="1"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="avg_trip_minutes">Avg Trip Time (min)</Label>
                  <Input
                    id="avg_trip_minutes"
                    type="number"
                    data-testid="input-trip-minutes"
                    value={formData.avg_trip_minutes}
                    onChange={(e) => setFormData({ ...formData, avg_trip_minutes: e.target.value })}
                    placeholder="15"
                    min="1"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="avg_wait_minutes">Avg Wait Time (min)</Label>
                  <Input
                    id="avg_wait_minutes"
                    type="number"
                    data-testid="input-wait-minutes"
                    value={formData.avg_wait_minutes}
                    onChange={(e) => setFormData({ ...formData, avg_wait_minutes: e.target.value })}
                    placeholder="5"
                    min="1"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                data-testid="button-cancel"
                disabled={saveMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-testid="button-save-profile"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
