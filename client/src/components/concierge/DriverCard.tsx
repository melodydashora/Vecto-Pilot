// client/src/components/concierge/DriverCard.tsx
// 2026-02-13: Business card component showing driver info to passengers
// 2026-02-13: Added interactive star rating + comment. Once submitted, switches to
//             "Thank you" confirmation to keep the card uncluttered.

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Car, Phone, Users, Star, Send, Loader2, Check } from 'lucide-react';
import { API_ROUTES } from '@/constants/apiRoutes';

interface DriverCardProps {
  name: string;
  phone?: string | null;
  vehicle?: {
    year: number;
    make: string;
    model: string;
    seatbelts: number;
  } | null;
  // 2026-02-13: Optional token for public page feedback (not shown on driver's preview)
  token?: string | null;
}

export function DriverCard({ name, phone, vehicle, token }: DriverCardProps) {
  // Feedback state (only active when token is provided = public page)
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleStarClick = (star: number) => {
    setRating(star);
    // Show comment field on first star selection
    if (!showComment) setShowComment(true);
  };

  const handleSubmit = async () => {
    if (!token || rating === 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(API_ROUTES.CONCIERGE.PUBLIC_FEEDBACK(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || null }),
      });

      const data = await res.json();
      if (data.ok) {
        setSubmitted(true);
      }
    } catch {
      // Silently fail — don't block the page for feedback errors
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="bg-gradient-to-br from-slate-800 to-slate-900 text-white border-0 shadow-lg">
      <CardContent className="p-6">
        {/* Driver name */}
        <div className="text-center mb-4">
          <h2 className="text-2xl font-bold tracking-tight">{name}</h2>
          <p className="text-slate-400 text-sm mt-1">Your Driver</p>
        </div>

        {/* Phone */}
        {phone && (
          <a
            href={`tel:${phone}`}
            className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg mb-3 hover:bg-slate-700 transition-colors"
          >
            <Phone className="h-5 w-5 text-green-400 flex-shrink-0" />
            <span className="text-base">{phone}</span>
          </a>
        )}

        {/* Vehicle */}
        {vehicle && (
          <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg mb-3">
            <Car className="h-5 w-5 text-blue-400 flex-shrink-0" />
            <span className="text-base">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </span>
          </div>
        )}

        {/* Seatbelts / capacity */}
        {vehicle?.seatbelts && (
          <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
            <Users className="h-5 w-5 text-amber-400 flex-shrink-0" />
            <span className="text-base">
              {vehicle.seatbelts - 1} passenger seats
            </span>
          </div>
        )}

        {/* ═══ STAR RATING (public page only, when token is provided) ═══ */}
        {token && !submitted && (
          <div className="mt-4 pt-3 border-t border-slate-700">
            <p className="text-center text-xs text-slate-400 mb-2">Rate your experience</p>

            {/* Interactive stars */}
            <div className="flex justify-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => handleStarClick(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-0.5 transition-transform hover:scale-110"
                  aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                >
                  <Star
                    className={`h-7 w-7 transition-colors ${
                      star <= (hoverRating || rating)
                        ? 'text-amber-400 fill-amber-400'
                        : 'text-slate-600'
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Comment input (appears after first star selection) */}
            {showComment && (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Leave a comment (optional)"
                  maxLength={500}
                  className="flex-1 text-sm px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                />
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={rating === 0 || isSubmitting}
                  className="bg-teal-600 hover:bg-teal-700 px-3"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ═══ SUBMITTED CONFIRMATION (replaces stars after feedback) ═══ */}
        {token && submitted && (
          <div className="mt-4 pt-3 border-t border-slate-700">
            <div className="flex items-center justify-center gap-2 text-teal-400">
              <Check className="h-4 w-4" />
              <span className="text-sm font-medium">Thanks for your feedback!</span>
            </div>
          </div>
        )}

        {/* Vecto Pilot branding (only when no token = driver preview, or always at bottom) */}
        {!token && (
          <div className="text-center mt-4 pt-3 border-t border-slate-700">
            <p className="text-xs text-slate-500">Powered by Vecto Pilot</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
