# UI Components (`client/src/components/ui/`)

## Purpose

Shadcn/ui primitive components - the foundational UI building blocks. These are pre-built, accessible React components based on Radix UI primitives, styled with TailwindCSS.

## Usage

Import components directly from this folder:

```typescript
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
```

## Components (48 total)

### Layout & Structure
| Component | Purpose |
|-----------|---------|
| `card.tsx` | Container with header, content, footer |
| `separator.tsx` | Visual divider |
| `aspect-ratio.tsx` | Fixed aspect ratio container |
| `scroll-area.tsx` | Custom scrollable area |
| `resizable.tsx` | Resizable panels |

### Forms & Inputs
| Component | Purpose |
|-----------|---------|
| `button.tsx` | Clickable button with variants |
| `input.tsx` | Text input field |
| `textarea.tsx` | Multi-line text input |
| `checkbox.tsx` | Boolean checkbox |
| `radio-group.tsx` | Single-select radio buttons |
| `switch.tsx` | Toggle switch |
| `select.tsx` | Dropdown selection |
| `slider.tsx` | Range slider |
| `form.tsx` | Form wrapper with validation |
| `label.tsx` | Form field label |

### Overlays & Dialogs
| Component | Purpose |
|-----------|---------|
| `dialog.tsx` | Modal dialog |
| `alert-dialog.tsx` | Confirmation dialog |
| `sheet.tsx` | Slide-out panel |
| `drawer.tsx` | Bottom/side drawer |
| `popover.tsx` | Floating popover |
| `tooltip.tsx` | Hover tooltip |
| `hover-card.tsx` | Rich hover preview |

### Navigation
| Component | Purpose |
|-----------|---------|
| `tabs.tsx` | Tab navigation |
| `navigation-menu.tsx` | Top navigation |
| `menubar.tsx` | Application menubar |
| `breadcrumb.tsx` | Breadcrumb navigation |
| `pagination.tsx` | Page navigation |

### Data Display
| Component | Purpose |
|-----------|---------|
| `table.tsx` | Data table |
| `avatar.tsx` | User avatar |
| `badge.tsx` | Status badge |
| `progress.tsx` | Progress bar |
| `skeleton.tsx` | Loading placeholder |
| `chart.tsx` | Data visualization |

### Feedback
| Component | Purpose |
|-----------|---------|
| `alert.tsx` | Alert message |
| `toast.tsx` | Toast notification |
| `toaster.tsx` | Toast container |
| `sonner.tsx` | Sonner toast integration |

### Disclosure
| Component | Purpose |
|-----------|---------|
| `accordion.tsx` | Expandable sections |
| `collapsible.tsx` | Toggle visibility |

### Menus
| Component | Purpose |
|-----------|---------|
| `dropdown-menu.tsx` | Dropdown menu |
| `context-menu.tsx` | Right-click menu |
| `command.tsx` | Command palette |

### Misc
| Component | Purpose |
|-----------|---------|
| `calendar.tsx` | Date picker calendar |
| `carousel.tsx` | Image/content carousel |
| `input-otp.tsx` | OTP input |
| `toggle.tsx` | Toggle button |
| `toggle-group.tsx` | Group of toggle buttons |

## Customization

Components are styled via TailwindCSS classes. Global theming is controlled by CSS variables in `index.css`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 47.4% 11.2%;
  --primary: 222.2 47.4% 11.2%;
  /* ... */
}
```

## Adding New Components

Use the shadcn CLI to add new components:

```bash
npx shadcn-ui@latest add [component-name]
```

This downloads the component source to this folder for full customization.

## Connections

- **Used by:** All page and feature components
- **Styling:** TailwindCSS + CSS variables
- **Base:** Radix UI primitives
- **Documentation:** https://ui.shadcn.com/docs/components
