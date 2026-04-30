# Siri Shortcuts Guide — Vecto-Pilot Integration

> Complete guide to creating both Custom Shortcuts and Personal Automations that connect to the Vecto-Pilot API.

## What Are Siri Shortcuts?

Siri Shortcuts are multi-step automations you build in Apple's Shortcuts app (pre-installed on iOS/iPadOS). They let you chain together actions from different apps into a single tap or voice command. There are two main types:

- **Custom Shortcuts** — You tap to run them
- **Personal Automations** — They run automatically based on triggers

---

## TYPE A: Creating a Custom Shortcut From Scratch

### Step-by-step on your iPhone/iPad

1. **Open the Shortcuts app** — it's pre-installed. If you removed it, re-download from the App Store.
2. **Tap the "+" button** in the upper-right corner of the screen. A blank, untitled shortcut opens in the editor.
3. **Name your shortcut** — Tap "New Shortcut" at the top, tap "Rename," type your name (e.g., "Vecto Status Check"), tap Done.
4. **Add actions** — Tap "Add Action." You'll see categories like Scripting, Web, Media, Location, etc. Tap a category, then tap an action to add it. You can also search for actions by name.

### Key Action Types

| Action | What It Does |
|--------|-------------|
| **Get Contents of URL** | Makes HTTP requests (GET, POST, PUT, DELETE) to any API. This is how you hit the Vecto API. |
| **Get Dictionary Value** | Parses JSON responses. |
| **Show Result / Show Notification** | Displays output to you. |
| **If/Otherwise** | Conditional logic. |
| **Repeat** | Loops. |
| **Set Variable / Get Variable** | Store and retrieve values. |
| **Ask for Input** | Prompts you for text/numbers. |
| **Text** | Creates a text string (use for building JSON bodies). |

6. **Arrange actions** — Drag actions up/down to reorder. Each action's output flows into the next.
7. **Test it** — Tap the Play button (triangle) at the bottom to run your shortcut.
8. **Done** — Tap "Done" to save. It appears in your Shortcuts library.

### Example: "Check Vecto Server"

```
Action 1: URL → enter https://vectocopilot.com/api/health
Action 2: Get Contents of URL → Method: GET
Action 3: Get Dictionary Value → Key: "status"
Action 4: If → "Value" equals "healthy"
Action 5 (inside If): Show Notification → "Vecto is running!"
Action 6 (inside Otherwise): Show Notification → "Vecto is DOWN!"
```

### Example: "Log Memory Entry"

```
Action 1: Ask for Input → "What should I remember?" (text input)
Action 2: Text → Build JSON:
  {"session_id":"siri-shortcut","category":"insight","title":"Siri Note","content":"[Provided Input]","source":"user","tags":["siri","mobile"]}
Action 3: URL → https://vectocopilot.com/api/memory
Action 4: Get Contents of URL → Method: POST, Headers: Content-Type: application/json, Request Body: [the Text from step 2]
Action 5: Show Notification → "Memory saved!"
```

---

## TYPE B: Creating a Personal Automation From Scratch

Personal automations run automatically when a trigger event happens — no tapping required.

### Step-by-step

1. Open Shortcuts app → tap **"Automation"** tab at the bottom.
2. Tap **"+"** in the upper-right (or "New Automation" if this is your first).
3. Tap **"Create Personal Automation"**
4. **Choose a trigger:**

### Available Trigger Categories

| Category | Triggers |
|----------|----------|
| **Event** | Time of Day (specific time, sunrise, sunset — daily/weekly/monthly), Alarm (snoozed or stopped), Sleep (wind down, bedtime, waking up), Apple Watch Workout, Sound Recognition |
| **Travel** | Arrive (at a location), Leave (a location), Before I Commute, CarPlay (connects/disconnects), Transit |
| **Communication** | Message (received from specific person), Email (received from sender), Phone Call (incoming) |
| **Setting** | Wi-Fi (connects/disconnects), Bluetooth (connects/disconnects), NFC (scans tag), App (opens/closes), Airplane Mode, Do Not Disturb, Low Power Mode, Battery Level |

5. **Configure trigger options** — e.g., if Time of Day, set the time and repeat schedule.
6. Tap **Next → Add Action** — same as custom shortcuts. Add your actions.
7. Tap **Next → review summary**. Options: "Run Immediately" (no confirmation needed) or "Run After Confirmation." For most automations, "Run Immediately" is what you want.
8. Tap **Done**. The automation is live.

### Example: "Morning Vecto Briefing"

```
Trigger: Time of Day → 7:00 AM, Daily
Action 1: URL → https://vectocopilot.com/api/memory/stats
Action 2: Get Contents of URL → GET
Action 3: Show Notification → "Memory stats: [Dictionary Value]"
```

### Example: "Auto-log When Leaving Home"

```
Trigger: Leave → [Your home address]
Action 1: Text → {"session_id":"auto-departure","category":"context","title":"Left home","content":"User departed home at [Current Date]","source":"system","tags":["location","auto"]}
Action 2: URL → https://vectocopilot.com/api/memory
Action 3: Get Contents of URL → POST, with JSON body from step 1
```

---

## Pro Tips for Both Types

### Passing data between actions
Each action produces an output. The next action automatically receives it as input. You can also tap on any input field and select **"Magic Variable"** to pick output from any previous action — not just the one right above it.

### Making API calls with authentication
In the "Get Contents of URL" action, tap **"Show More"** to reveal Headers. Add an `Authorization` header with your token if your API requires it.

### Error handling
Use **"If"** actions to check the result of API calls. If the dictionary value for "error" exists, show an alert. Otherwise, proceed normally.

### Adding to Home Screen
Long-press any shortcut → **Add to Home Screen**. You get a one-tap launcher icon.

### Siri voice trigger
Tap the shortcut name → it becomes the Siri phrase. Say **"Hey Siri, [shortcut name]"** to run it hands-free.

### Share Sheet integration
In the shortcut editor, tap the info (i) button → toggle **"Show in Share Sheet."** This lets you trigger the shortcut from the share button in any app.

---

## Vecto-Pilot API Endpoints for Shortcuts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Check if server is running |
| `/api/memory` | GET | List all memories (with ?category, ?status, ?search filters) |
| `/api/memory` | POST | Create a new memory entry |
| `/api/memory/:id` | PATCH | Update a memory entry |
| `/api/memory/stats` | GET | Memory statistics by category |
| `/api/memory/rules` | GET | All active rules |
| `/api/memory/session/:id` | GET | Memories from a specific session |
| `/api/hooks/analyze-offer` | POST | OCR/Signals hook |
| `/api/hooks` | POST | Siri Translation hook |
