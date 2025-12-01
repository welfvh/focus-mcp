# Progressive Delay System

## Overview

The delay system adds **progressive friction** to accessing certain sites (like Gmail) without fully blocking them. Each time you access a delayed domain, the wait time increases, encouraging you to minimize compulsive checking.

## How It Works

### Delay Progression
- **1st access**: 10 seconds
- **2nd access**: 20 seconds
- **3rd access**: 40 seconds
- **4th access**: 80 seconds
- **5th+ access**: 160 seconds (caps here)

Counts reset daily.

### Session Management
Once you complete the delay and access the site, you have a **15-minute session** where subsequent navigation works normally. This prevents the delay from interfering with legitimate work.

After 15 minutes of inactivity, the next access triggers a new delay.

## Current Implementation Status

### ✅ Completed
- Session tracking and delay calculation (`store.ts`)
- Delay countdown page UI (`delay-page.html`)
- API endpoints (`/delay`, `/api/check-delay`, `/api/delay-complete`)
- Progressive delay logic (10s → 160s)
- Daily reset mechanism

### 🚧 Not Yet Implemented
The actual **redirect mechanism** to serve the delay page when you try to access a delayed domain.

### Manual Testing (For Now)

To test the delay system manually:

1. Navigate to: `http://localhost:8053/delay?domain=gmail.com&delay=10&count=0`
2. Wait through the countdown
3. Check session tracking: `curl http://localhost:8053/api/check-delay/gmail.com`

## Future Implementation Options

### Option 1: Browser Extension
Create a lightweight extension that intercepts requests to delayed domains and redirects to the delay page.

### Option 2: Local HTTP Proxy
Set up a transparent proxy on port 80/443 that intercepts delayed domains and serves the delay page.

### Option 3: PAC File
Use a Proxy Auto-Configuration file to route delayed domains through the delay server.

## Configuration

Add domains to the delayed list in `src/main/store.ts`:

```typescript
const DEFAULT_DELAYED: string[] = [
  'gmail.com',
  'mail.google.com',
  // Add more...
];
```

Or via API:
```bash
curl -X POST http://localhost:8053/api/delay-domain \
  -H "Content-Type: application/json" \
  -d '{"domain":"gmail.com"}'
```

## Psychology

The delay system is designed to:
- **Interrupt the autopilot** - makes you conscious of the impulse
- **Create accountability** - shows you how many times you've checked today
- **Build awareness** - asks reflective questions during the wait
- **Avoid frustration** - doesn't break functionality once you're working

It's friction with purpose, not punishment.
