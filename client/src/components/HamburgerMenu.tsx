// client/src/components/HamburgerMenu.tsx
// Slide-out navigation menu for secondary pages.
//
// 2026-04-05: Created for hamburger menu (Task 3).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Settings, Calendar, Info, Heart, HelpCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const MENU_ITEMS = [
  { label: 'Preferences', icon: Settings, path: '/co-pilot/settings' },
  { label: 'Schedule', icon: Calendar, path: '/co-pilot/schedule' },
  { label: 'About', icon: Info, path: '/co-pilot/about' },
  { label: 'Donate', icon: Heart, path: '/co-pilot/donate' },
  { label: 'Help', icon: HelpCircle, path: '/co-pilot/help' },
] as const;

export default function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-white hover:bg-white/20 p-2"
          title="Menu"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-64 p-0">
        <SheetHeader className="p-4 pb-2 border-b bg-gradient-to-r from-purple-600 to-blue-600">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-white text-lg">Menu</SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/20 p-1 h-auto"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>
        <nav className="p-2">
          {MENU_ITEMS.map(item => (
            <button
              key={item.path}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              onClick={() => {
                navigate(item.path);
                setOpen(false);
              }}
            >
              <item.icon className="h-5 w-5 text-gray-500" />
              {item.label}
            </button>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
