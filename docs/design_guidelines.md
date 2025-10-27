# Vecto Pilot - Strategy Coach Chat Interface Design Guidelines

## Design Approach

**System**: Linear/Notion-inspired productivity interface with Material Design motion principles
**Rationale**: Utility-focused driver assistance requires clean information hierarchy, high readability, and professional polish suitable for on-the-go use

## Core Design Elements

### Typography
- **Primary Font**: Inter (via Google Fonts CDN)
- **Hierarchy**:
  - Chat messages: text-base (16px), font-normal
  - Coach name/timestamp: text-sm (14px), font-medium
  - Input field: text-base (16px), font-normal
  - Loading states: text-sm (14px), font-medium
  - Section headers: text-lg (18px), font-semibold

### Layout System
**Spacing Primitives**: Tailwind units of 3, 4, 6, and 8
- Message bubbles: p-4, gap-3
- Container padding: p-6
- Input area: p-4
- Loading cards: p-6, gap-4

**Component Structure**:
- Fixed height chat container: h-[600px] on desktop, h-[calc(100vh-120px)] on mobile
- Input field height: h-12
- Message bubble max-width: max-w-3xl
- Avatar size: w-10 h-10

## Component Library

### 1. Chat Container
**Layout**: Fixed-position overlay (desktop) or full-width panel (mobile)
- Desktop: Bottom-right docked, w-96, rounded-t-2xl shadow-2xl
- Mobile: Full-screen takeover with slide-up animation
- Header: Sticky top with coach avatar, name "Strategy Coach", status indicator (green dot for active)
- Close button: Top-right, subtle icon (X from Heroicons)

### 2. Message Bubbles
**Driver Messages** (right-aligned):
- Rounded-2xl, rounded-br-sm
- p-4 padding
- max-w-[85%]
- Subtle shadow for depth

**Coach Messages** (left-aligned):
- Rounded-2xl, rounded-bl-sm
- p-4 padding
- max-w-[85%]
- Include small avatar (w-8 h-8) to left
- Timestamp below message: text-xs, reduced opacity

### 3. Loading State - Smart Block Analysis
**Design**: Skeleton card animation with progress indicator
- Card: p-6, rounded-xl, border
- Animated shimmer effect using gradient backgrounds
- Progress bar: h-1.5, rounded-full with animated fill
- Three stacked cards showing different analysis stages:
  1. "Analyzing ride patterns..." - 33% progress
  2. "Calculating optimal zones..." - 66% progress
  3. "Generating strategy insights..." - 100% progress
- Rotation: Each card displays for 60 seconds with smooth crossfade
- Pulse animation on active card border
- Time remaining display: "~2 min remaining" in text-sm

### 4. Input Field
**Components**:
- Container: Fixed bottom, p-4 background blur
- Textarea: rounded-xl, p-3, min-h-12, max-h-32 with auto-resize
- Send button: Circular, w-10 h-10, positioned absolute right-3
- Microphone icon button (Heroicons): Left of send button for voice input
- Focus state: Subtle ring and elevation increase
- Character count (if applicable): text-xs in bottom-right

### 5. Quick Actions
**Placement**: Below input field, horizontal scroll on mobile
- Pill-shaped buttons with icons
- Examples: "Surge zones?", "Best time?", "Break strategy?"
- px-4 py-2, rounded-full, gap-2
- Icon (Heroicons) + text combination
- Tap to auto-populate input field

### 6. Strategy Insight Cards (within chat)
**When coach provides strategy**:
- Distinct card design: rounded-lg, p-4, border-l-4 accent
- Icon at top (chart, location pin, clock from Heroicons)
- Title: font-semibold, text-base
- Body content: Bulleted list or short paragraphs
- "View full strategy" link at bottom

### 7. Typing Indicator
- Three animated dots (•••) bouncing
- Left-aligned with coach avatar
- Subtle animation: stagger delay of 0.15s per dot
- Height: h-8 to maintain consistent spacing

## Animations

**Loading Skeleton Shimmer**:
- Gradient sweep from left to right (1.5s duration, infinite)
- Opacity pulse on progress bars (2s ease-in-out)

**Message Entry**:
- Slide-up + fade-in (200ms ease-out)
- Stagger messages by 100ms when multiple load

**Coach Docked Panel**:
- Slide-up from bottom (300ms ease-out) on appearance
- Minimize animation: Scale down to floating button bottom-right

## Accessibility

- Focus indicators: 2px ring on all interactive elements
- Keyboard navigation: Tab through messages, input, quick actions
- Screen reader labels on all icon buttons
- High contrast maintained throughout (WCAG AA minimum)
- Touch targets: Minimum 44x44px for all buttons

## Icons

**Library**: Heroicons (via CDN)
- Send: PaperAirplaneIcon
- Microphone: MicrophoneIcon
- Close: XMarkIcon
- Strategy types: ChartBarIcon, MapPinIcon, ClockIcon
- Menu: EllipsisVerticalIcon (coach options)

## Responsive Behavior

**Desktop (lg+)**:
- Fixed width: w-96
- Docked bottom-right with 24px margin
- Minimize to floating action button

**Tablet (md)**:
- w-[400px] docked or slide-in panel from right
- Full-height panel option

**Mobile (base)**:
- Full-screen takeover
- Safe area insets for input field (pb-safe)
- Slide-up transition from bottom

## Special Considerations for Driving

- **Extra Large Touch Targets**: All buttons minimum 48px
- **High Contrast Text**: Ensure 7:1 ratio for critical information
- **No Distracting Motion**: Loading animations subtle and peripheral
- **Voice Input Priority**: Prominent microphone button
- **Glanceable Information**: Key insights in first 2 lines of coach messages
- **Persistent Visibility**: Coach minimizes to FAB, always accessible

This interface creates a professional, safety-conscious companion that provides drivers with intelligent assistance without compromising their focus on the road.