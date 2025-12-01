/**
 * Persistent storage for Focus Shield.
 * Stores blocked domains, allowances, delayed domains, and session tracking.
 */

import Store from 'electron-store';

interface Allowance {
  domain: string;
  expiresAt: number;
  reason: string;
  grantedMinutes: number;
}

interface DelaySession {
  domain: string;
  lastAccess: number; // timestamp of last access
  accessCount: number; // number of sessions today
  lastResetDate: string; // YYYY-MM-DD for daily reset
}

interface StoreSchema {
  blockedDomains: string[];
  delayedDomains: string[]; // Domains that get progressive delays
  allowances: Allowance[];
  delaySessions: DelaySession[]; // Track session counts per domain
  dnsAutoStart: boolean;
  startAtLogin: boolean;
}

const DEFAULT_BLOCKED: string[] = [
  // Social media & entertainment
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'netflix.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'twitch.tv',
  'news.ycombinator.com',

  // NSFW - Major sites (covers 90%+ of traffic)
  'pornhub.com',
  'www.pornhub.com',
  'xvideos.com',
  'www.xvideos.com',
  'xnxx.com',
  'www.xnxx.com',
  'xhamster.com',
  'www.xhamster.com',
  'redtube.com',
  'youporn.com',
  'tube8.com',
  'spankbang.com',
  'eporner.com',
  'porntrex.com',
  'txxx.com',
  'hqporner.com',
  'beeg.com',
  'porn.com',
  'thumbzilla.com',
  'pornone.com',
  'fuq.com',
  'tnaflix.com',
  'drtuber.com',
  'porndig.com',
  'youjizz.com',
  'motherless.com',
  'heavy-r.com',
  'efukt.com',
  'ixxx.com',
  'hclips.com',
  'pornhat.com',
  'fapster.xxx',
  'pornmd.com',
  'nudevista.com',
  'lobstertube.com',
  'freeones.com',
  'cam4.com',
  'chaturbate.com',
  'bongacams.com',
  'stripchat.com',
  'myfreecams.com',
  'livejasmin.com',
  'camsoda.com',
  'flirt4free.com',
  'onlyfans.com',
  'fansly.com',
  'pornpics.com',
  'imagefap.com',
  'sex.com',
  'literotica.com',
  'nifty.org',
  'asstr.org',
  'rule34.xxx',
  'e621.net',
  'gelbooru.com',
  'danbooru.donmai.us',
  'nhentai.net',
  'hentaihaven.xxx',
  'hanime.tv',
  'fakku.net',
  'tsumino.com',
  'hitomi.la',
  '8muses.com',
  'simpcity.su',
  'coomer.su',
  'kemono.su',
  'thothub.lol',
  'fapello.com',
  'sxyprn.com',
  'daftsex.com',
  'javlibrary.com',
  'javfree.me',
  'missav.com',
];

const DEFAULT_DELAYED: string[] = [
  // Productivity distractions that benefit from progressive delay
  'gmail.com',
  'mail.google.com',
];

export const store = new Store<StoreSchema>({
  defaults: {
    blockedDomains: DEFAULT_BLOCKED,
    delayedDomains: DEFAULT_DELAYED,
    allowances: [],
    delaySessions: [],
    dnsAutoStart: false,
    startAtLogin: false,
  },
});

/**
 * Check if a domain is currently blocked.
 */
export function isDomainBlocked(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  const blocked = store.get('blockedDomains', []);

  const isInBlocklist = blocked.some(b => {
    const nb = normalizeDomain(b);
    return normalized === nb || normalized.endsWith('.' + nb);
  });

  if (!isInBlocklist) return false;

  // Check for active allowance
  const allowances = store.get('allowances', []);
  const now = Date.now();
  const hasAllowance = allowances.some(
    a => matchesDomain(normalized, a.domain) && a.expiresAt > now
  );

  return !hasAllowance;
}

/**
 * Grant temporary access to a domain.
 */
export function grantAllowance(domain: string, minutes: number, reason: string): Allowance {
  const normalized = normalizeDomain(domain);
  const allowances = store.get('allowances', []);

  // Remove existing allowance for this domain
  const filtered = allowances.filter(a => a.domain !== normalized);

  const allowance: Allowance = {
    domain: normalized,
    expiresAt: Date.now() + minutes * 60 * 1000,
    reason,
    grantedMinutes: minutes,
  };

  store.set('allowances', [...filtered, allowance]);
  return allowance;
}

/**
 * Revoke an allowance for a domain.
 */
export function revokeAllowance(domain: string): void {
  const normalized = normalizeDomain(domain);
  const allowances = store.get('allowances', []);
  store.set('allowances', allowances.filter(a => a.domain !== normalized));
}

/**
 * Get all blocked domains.
 */
export function getBlockedDomains(): string[] {
  return store.get('blockedDomains', []);
}

/**
 * Add a domain to the blocklist.
 */
export function addBlockedDomain(domain: string): void {
  const normalized = normalizeDomain(domain);
  const blocked = store.get('blockedDomains', []);
  if (!blocked.includes(normalized)) {
    store.set('blockedDomains', [...blocked, normalized]);
  }
}

/**
 * Remove a domain from the blocklist.
 */
export function removeBlockedDomain(domain: string): void {
  const normalized = normalizeDomain(domain);
  const blocked = store.get('blockedDomains', []);
  store.set('blockedDomains', blocked.filter(d => d !== normalized));
}

/**
 * Get active allowances (not expired).
 */
export function getActiveAllowances(): Allowance[] {
  const allowances = store.get('allowances', []);
  const now = Date.now();
  const active = allowances.filter(a => a.expiresAt > now);

  // Clean up expired ones
  if (active.length !== allowances.length) {
    store.set('allowances', active);
  }

  return active;
}

/**
 * Get remaining minutes for a domain's allowance.
 */
export function getAllowanceRemaining(domain: string): number {
  const normalized = normalizeDomain(domain);
  const allowances = store.get('allowances', []);
  const now = Date.now();

  const allowance = allowances.find(
    a => matchesDomain(normalized, a.domain) && a.expiresAt > now
  );

  if (!allowance) return 0;
  return Math.ceil((allowance.expiresAt - now) / 60000);
}

/**
 * Check if domain should be delayed (progressive friction).
 */
export function isDomainDelayed(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  const delayed = store.get('delayedDomains', []);
  return delayed.some(d => matchesDomain(normalized, d));
}

/**
 * Calculate delay seconds for a domain based on today's access count.
 * Progressive: 10s, 20s, 40s, 80s, 160s (caps at 160s)
 */
export function getDelaySeconds(domain: string): number {
  const normalized = normalizeDomain(domain);
  const sessions = store.get('delaySessions', []);
  const today = new Date().toISOString().split('T')[0];

  let session = sessions.find(s => s.domain === normalized);

  // Reset count if it's a new day
  if (session && session.lastResetDate !== today) {
    session.accessCount = 0;
    session.lastResetDate = today;
  }

  const count = session?.accessCount || 0;

  // Progressive delay: 10s * (2^count), capped at 160s
  const delay = Math.min(10 * Math.pow(2, count), 160);
  return delay;
}

/**
 * Record a delay session access (increments count).
 */
export function recordDelayAccess(domain: string): void {
  const normalized = normalizeDomain(domain);
  const sessions = store.get('delaySessions', []);
  const today = new Date().toISOString().split('T')[0];
  const now = Date.now();

  const existingIndex = sessions.findIndex(s => s.domain === normalized);

  if (existingIndex >= 0) {
    const session = sessions[existingIndex];

    // Reset if new day
    if (session.lastResetDate !== today) {
      session.accessCount = 1;
      session.lastResetDate = today;
    } else {
      session.accessCount += 1;
    }

    session.lastAccess = now;
    sessions[existingIndex] = session;
  } else {
    sessions.push({
      domain: normalized,
      lastAccess: now,
      accessCount: 1,
      lastResetDate: today,
    });
  }

  store.set('delaySessions', sessions);
}

/**
 * Check if domain is in an active session (accessed within last 15 minutes).
 */
export function isInActiveSession(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  const sessions = store.get('delaySessions', []);
  const now = Date.now();
  const SESSION_DURATION = 15 * 60 * 1000; // 15 minutes

  const session = sessions.find(s => s.domain === normalized);
  if (!session) return false;

  return (now - session.lastAccess) < SESSION_DURATION;
}

/**
 * Update last access time (for keeping session alive during navigation).
 */
export function updateSessionAccess(domain: string): void {
  const normalized = normalizeDomain(domain);
  const sessions = store.get('delaySessions', []);

  const session = sessions.find(s => s.domain === normalized);
  if (session) {
    session.lastAccess = Date.now();
    store.set('delaySessions', sessions);
  }
}

/**
 * Get all delayed domains.
 */
export function getDelayedDomains(): string[] {
  return store.get('delayedDomains', []);
}

/**
 * Add a domain to the delayed list.
 */
export function addDelayedDomain(domain: string): void {
  const normalized = normalizeDomain(domain);
  const delayed = store.get('delayedDomains', []);
  if (!delayed.includes(normalized)) {
    store.set('delayedDomains', [...delayed, normalized]);
  }
}

/**
 * Remove a domain from the delayed list.
 */
export function removeDelayedDomain(domain: string): void {
  const normalized = normalizeDomain(domain);
  const delayed = store.get('delayedDomains', []);
  store.set('delayedDomains', delayed.filter(d => d !== normalized));
}

// Helpers
function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

function matchesDomain(query: string, pattern: string): boolean {
  const nq = normalizeDomain(query);
  const np = normalizeDomain(pattern);
  return nq === np || nq.endsWith('.' + np);
}
