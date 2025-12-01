/**
 * HTTP/HTTPS Proxy for Focus Shield
 *
 * Intercepts requests to delayed domains and serves the delay page.
 * After the countdown, allows the request through.
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';
import {
  isDomainDelayed,
  isInActiveSession,
  getDelaySeconds,
  updateSessionAccess,
  isDomainBlocked,
} from './store';

const PROXY_PORT = 8080;
let proxyServer: http.Server | null = null;

/**
 * Start the HTTP proxy server.
 */
export async function startProxyServer(): Promise<void> {
  if (proxyServer) {
    console.log('⚠️  Proxy server already running');
    return;
  }

  proxyServer = http.createServer(handleProxyRequest);

  return new Promise((resolve) => {
    proxyServer!.listen(PROXY_PORT, '127.0.0.1', () => {
      console.log(`🔀 Proxy server running on http://127.0.0.1:${PROXY_PORT}`);
      console.log(`   Configure system proxy: System Settings → Network → Proxies`);
      console.log(`   Set HTTP/HTTPS proxy to: 127.0.0.1:${PROXY_PORT}`);
      resolve();
    });
  });
}

/**
 * Stop the proxy server.
 */
export async function stopProxyServer(): Promise<void> {
  return new Promise((resolve) => {
    if (proxyServer) {
      proxyServer.close(() => {
        console.log('🔀 Proxy server stopped');
        resolve();
      });
      proxyServer = null;
    } else {
      resolve();
    }
  });
}

/**
 * Handle incoming proxy requests.
 */
async function handleProxyRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse
): Promise<void> {
  const requestUrl = clientReq.url || '';

  try {
    // Parse the URL
    const url = new URL(requestUrl.startsWith('http') ? requestUrl : `http://${clientReq.headers.host}${requestUrl}`);
    const domain = url.hostname;

    console.log(`🔀 Proxy request: ${domain}${url.pathname}`);

    // Check if domain is fully blocked
    if (isDomainBlocked(domain)) {
      serveBlockedPage(clientRes, domain);
      return;
    }

    // Check if domain should be delayed
    if (isDomainDelayed(domain)) {
      // Check if in active session (15 min window)
      if (isInActiveSession(domain)) {
        console.log(`✅ ${domain} in active session - allowing through`);
        updateSessionAccess(domain);
        proxyRequestThrough(clientReq, clientRes, url);
        return;
      }

      // Need to show delay page
      console.log(`⏱️  ${domain} requires delay`);
      serveDelayPage(clientRes, domain);
      return;
    }

    // Normal domain - proxy through
    proxyRequestThrough(clientReq, clientRes, url);

  } catch (err) {
    console.error('Proxy error:', err);
    clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
    clientRes.end('Proxy Error');
  }
}

/**
 * Serve the delay countdown page.
 */
function serveDelayPage(res: http.ServerResponse, domain: string): void {
  const delaySeconds = getDelaySeconds(domain);

  // Read delay-page.html
  const delayPagePath = path.join(__dirname, 'delay-page.html');

  if (fs.existsSync(delayPagePath)) {
    let html = fs.readFileSync(delayPagePath, 'utf8');

    // Inject delay parameters into the HTML
    html = html.replace('const params = new URLSearchParams(window.location.search);', `
      const domain = "${domain}";
      const delaySeconds = ${delaySeconds};
      const accessCount = 0; // TODO: get from store
      const nextDelay = ${Math.min(delaySeconds * 2, 160)};
    `);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else {
    // Fallback HTML
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Focus Shield - Take a Breath</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
          }
          h1 { font-size: 48px; margin: 0 0 20px; }
          .timer { font-size: 72px; font-weight: bold; margin: 30px 0; }
          .message { font-size: 20px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div>
          <h1>🛡️ Take a Breath</h1>
          <div class="message">${domain}</div>
          <div class="timer" id="timer">${delaySeconds}</div>
          <div class="message">Is this really necessary right now?</div>
        </div>
        <script>
          let remaining = ${delaySeconds};
          const timer = document.getElementById('timer');

          function countdown() {
            if (remaining > 0) {
              timer.textContent = remaining;
              remaining--;
              setTimeout(countdown, 1000);
            } else {
              timer.textContent = 'Proceeding...';
              // Record the delay completion and redirect
              fetch('http://127.0.0.1:8053/api/delay-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: '${domain}' })
              }).then(() => {
                window.location.href = 'https://${domain}';
              });
            }
          }

          countdown();
        </script>
      </body>
      </html>
    `);
  }
}

/**
 * Serve a blocked page for fully blocked domains.
 */
function serveBlockedPage(res: http.ServerResponse, domain: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Focus Shield - Blocked</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #1a1a1a;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          text-align: center;
        }
        h1 { font-size: 48px; }
        p { font-size: 20px; opacity: 0.8; }
      </style>
    </head>
    <body>
      <div>
        <h1>🛡️ Blocked</h1>
        <p>${domain}</p>
        <p>This site is blocked. Talk to Claude to request access.</p>
      </div>
    </body>
    </html>
  `);
}

/**
 * Proxy the request through to the actual destination.
 */
function proxyRequestThrough(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  url: URL
): void {
  const options: https.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const protocol = url.protocol === 'https:' ? https : http;

  const proxyReq = protocol.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err);
    clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
    clientRes.end('Bad Gateway');
  });

  clientReq.pipe(proxyReq);
}
