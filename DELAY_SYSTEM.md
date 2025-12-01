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

### ✅ Implemented: HTTP Proxy
The delay system now uses an **HTTP proxy** to intercept requests and serve the delay page!

**How it works:**
1. Proxy server runs on `localhost:8080`
2. System configured to route traffic through proxy
3. When you try to access a delayed domain (like Gmail):
   - Proxy intercepts the request
   - Checks if domain is delayed
   - Checks if you're in an active session (15 min window)
   - If new session needed: serves delay countdown page
   - After countdown: redirects to actual site and starts session
4. Subsequent requests within 15 minutes pass through normally

**Setup:**
```bash
# Start Focus Shield (proxy starts automatically)
npm run dev

# Configure system proxy
./scripts/configure-proxy.sh

# Or manually: System Settings → Network → Proxies
# Set HTTP/HTTPS proxy to: 127.0.0.1:8080
```

**Testing:**
1. Configure system proxy (see above)
2. Open browser and navigate to gmail.com
3. You'll see the delay countdown page
4. After countdown, Gmail loads normally
5. Keep using Gmail for 15 minutes - no more delays
6. After 15 min idle, next access triggers new delay

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
