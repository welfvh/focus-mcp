/**
 * Persistent storage for Focus Shield.
 * Stores blocked domains, allowances, and settings.
 */

import Store from 'electron-store';

interface Allowance {
  domain: string;
  expiresAt: number;
  reason: string;
  grantedMinutes: number;
}

interface StoreSchema {
  blockedDomains: string[];
  allowances: Allowance[];
  dnsAutoStart: boolean;
  startAtLogin: boolean;
}

const DEFAULT_BLOCKED: string[] = [
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
];

export const store = new Store<StoreSchema>({
  defaults: {
    blockedDomains: DEFAULT_BLOCKED,
    allowances: [],
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

// Helpers
function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

function matchesDomain(query: string, pattern: string): boolean {
  const nq = normalizeDomain(query);
  const np = normalizeDomain(pattern);
  return nq === np || nq.endsWith('.' + np);
}
