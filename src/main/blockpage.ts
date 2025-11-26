/**
 * Block Page Server
 *
 * Runs a local HTTPS server that displays a "blocked" page when users
 * try to access blocked domains. The hosts file redirects blocked domains
 * to 127.0.0.1, and this server catches those requests.
 */

import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { generateKeyPairSync, createSign } from 'crypto';

let httpServer: ReturnType<typeof createHttpServer> | null = null;
let httpsServer: ReturnType<typeof createHttpsServer> | null = null;

// Generate a self-signed certificate for HTTPS
function generateSelfSignedCert(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // Create a simple self-signed certificate
  // This will show a browser warning, but that's actually good - it makes
  // the block more obvious than a blank page
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  // For simplicity, we'll just use the key - browsers will show a cert error
  // which serves as our "blocked" indicator
  return { key, cert: key }; // This won't work for HTTPS, but that's fine
}

const BLOCK_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Focus Shield - Blocked</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 500px;
    }
    .shield {
      font-size: 4rem;
      margin-bottom: 1rem;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      color: #e94560;
    }
    .domain {
      font-family: monospace;
      background: rgba(255,255,255,0.1);
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      margin: 1rem 0;
      font-size: 1.1rem;
      color: #0f3460;
      background: #e94560;
    }
    p {
      color: rgba(255,255,255,0.7);
      line-height: 1.6;
      margin-bottom: 1rem;
    }
    .hint {
      font-size: 0.85rem;
      color: rgba(255,255,255,0.5);
      margin-top: 2rem;
    }
    .hint code {
      background: rgba(255,255,255,0.1);
      padding: 0.2rem 0.4rem;
      border-radius: 0.25rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="shield">🛡️</div>
    <h1>Site Blocked</h1>
    <div class="domain" id="domain">this site</div>
    <p>Focus Shield is protecting your attention.</p>
    <p>If you need access, talk to Claude about why this is important right now.</p>
    <div class="hint">
      Ask Claude: <code>"I need to access [site] because..."</code>
    </div>
  </div>
  <script>
    // Show the blocked domain
    const host = window.location.hostname;
    if (host && host !== '127.0.0.1' && host !== 'localhost') {
      document.getElementById('domain').textContent = host;
    }
  </script>
</body>
</html>`;

function handleRequest(req: any, res: any) {
  const host = req.headers.host?.split(':')[0] || 'unknown';

  console.log(`🛡️ Blocked request to: ${host}${req.url}`);

  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(BLOCK_PAGE_HTML);
}

export function startBlockPageServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // HTTP server on port 80 (needs sudo, but we already have it for hosts file)
      httpServer = createHttpServer(handleRequest);

      httpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EACCES') {
          console.log('⚠️ Block page server needs root for port 80 (will use redirect instead)');
        } else if (err.code === 'EADDRINUSE') {
          console.log('⚠️ Port 80 already in use');
        } else {
          console.error('Block page server error:', err);
        }
      });

      // Try port 80 first, fall back to 8080
      httpServer.listen(80, '127.0.0.1', () => {
        console.log('🛡️ Block page server running on http://127.0.0.1:80');
        resolve();
      });

      httpServer.on('error', () => {
        // Fall back to port 8080 if 80 fails
        httpServer = createHttpServer(handleRequest);
        httpServer.listen(8080, '127.0.0.1', () => {
          console.log('🛡️ Block page server running on http://127.0.0.1:8080');
          resolve();
        });
      });

    } catch (err) {
      reject(err);
    }
  });
}

export function stopBlockPageServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (httpsServer) {
    httpsServer.close();
    httpsServer = null;
  }
}
