// client/src/components/co-pilot/QuickPhrases.tsx
// Pre-loaded rideshare phrases for instant translation without speaking
//
// 2026-03-16: Created for FIFA World Cup rider translation feature.
// Categories: Greetings, Route, Comfort, Payment, Safety
// Tapping a phrase triggers instant translation + TTS playback.

import { Button } from '@/components/ui/button';

export interface QuickPhrase {
  key: string;
  en: string;
  category: 'greeting' | 'route' | 'comfort' | 'payment' | 'safety';
}

// Pre-loaded English phrases — translated on-the-fly via the translation API
// so we don't need to maintain translation tables for 20+ languages.
export const QUICK_PHRASES: QuickPhrase[] = [
  // Greetings
  { key: 'welcome', en: 'Welcome! How are you?', category: 'greeting' },
  { key: 'name', en: 'Nice to meet you! I am your driver.', category: 'greeting' },
  { key: 'enjoy', en: 'Enjoy the World Cup! Have a great time!', category: 'greeting' },

  // Route
  { key: 'confirm_dest', en: 'Is this the correct destination?', category: 'route' },
  { key: 'preferred_route', en: 'Do you have a preferred route?', category: 'route' },
  { key: 'arriving', en: 'We are arriving at your destination now.', category: 'route' },
  { key: 'eta', en: 'We will arrive in about 10 minutes.', category: 'route' },
  { key: 'traffic', en: 'There is some traffic ahead. It may take a few extra minutes.', category: 'route' },

  // Comfort
  { key: 'temperature', en: 'Is the temperature okay?', category: 'comfort' },
  { key: 'music', en: 'Would you like me to play some music?', category: 'comfort' },
  { key: 'water', en: 'Would you like a bottle of water?', category: 'comfort' },
  { key: 'charger', en: 'There is a phone charger available if you need it.', category: 'comfort' },

  // Payment
  { key: 'paid_app', en: 'The ride is already paid through the app. No cash needed.', category: 'payment' },
  { key: 'tip', en: 'Tips are appreciated but never expected. Thank you!', category: 'payment' },

  // Safety
  { key: 'seatbelt', en: 'Please fasten your seatbelt.', category: 'safety' },
  { key: 'stop', en: 'I will pull over to a safe spot.', category: 'safety' },
  { key: 'dropoff', en: 'I am dropping you off right here. Watch for traffic.', category: 'safety' },
];

const CATEGORY_LABELS: Record<string, string> = {
  greeting: 'Greetings',
  route: 'Route',
  comfort: 'Comfort',
  payment: 'Payment',
  safety: 'Safety',
};

// 2026-04-05: Fixed contrast — old colors (text-*-300) were invisible on light backgrounds
const CATEGORY_COLORS: Record<string, string> = {
  greeting: 'bg-blue-50 text-blue-700 border-blue-300',
  route: 'bg-green-50 text-green-700 border-green-300',
  comfort: 'bg-purple-50 text-purple-700 border-purple-300',
  payment: 'bg-amber-50 text-amber-700 border-amber-300',
  safety: 'bg-red-50 text-red-700 border-red-300',
};

interface QuickPhrasesProps {
  onSelect: (phrase: QuickPhrase) => void;
  isTranslating: boolean;
  selectedCategory?: string;
}

export default function QuickPhrases({ onSelect, isTranslating, selectedCategory }: QuickPhrasesProps) {
  const categories = Object.keys(CATEGORY_LABELS);
  const displayCategories = selectedCategory
    ? [selectedCategory]
    : categories;

  return (
    <div className="space-y-3">
      {displayCategories.map(cat => {
        const phrases = QUICK_PHRASES.filter(p => p.category === cat);
        return (
          <div key={cat}>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              {CATEGORY_LABELS[cat]}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {phrases.map(phrase => (
                <Button
                  key={phrase.key}
                  variant="outline"
                  size="sm"
                  disabled={isTranslating}
                  onClick={() => onSelect(phrase)}
                  className={`text-sm h-auto py-1.5 px-2.5 border font-medium ${CATEGORY_COLORS[cat]} hover:opacity-90 transition-opacity`}
                >
                  {phrase.en}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
