/**
 * Persistent storage for Focus Shield (standalone, no Electron).
 * Uses a simple JSON file for persistence.
 */

import fs from 'fs';
import path from 'path';

const CONFIG_DIR = path.join(process.env.HOME || '/tmp', '.config', 'cc-focus');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface Allowance {
  domain: string;
  expiresAt: number;
  reason: string;
  grantedMinutes: number;
}

interface DelaySession {
  domain: string;
  lastAccess: number;
  accessCount: number;
  lastResetDate: string;
}

interface HardLockout {
  domain: string;
  until: string; // ISO date string, e.g. "2026-03-01"
}

interface StoreSchema {
  blockedDomains: string[];
  delayedDomains: string[];
  blockedPaths: Record<string, string[]>; // { domain: [path patterns] }
  allowances: Allowance[];
  delaySessions: DelaySession[];
  hardLockouts: HardLockout[];
  enabledCategories: string[]; // which block categories are active
}

// Block categories — each is a named group of domains.
// Users select which categories to enable during install.
export const BLOCK_CATEGORIES: Record<string, string[]> = {
  social: [
    'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com',
    'reddit.com', 'linkedin.com', 'discord.com', 'threads.net', 'bsky.app',
    'pinterest.com', 'news.ycombinator.com', 'polymarket.com',
  ],
  video: [
    'youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv',
  ],
  news: [
    'substack.com',
  ],
  shopping: [
    'amazon.com', 'ebay.com', 'kleinanzeigen.de',
  ],
  adult: [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com',
    'youporn.com', 'tube8.com', 'spankbang.com', 'eporner.com', 'porntrex.com',
    'txxx.com', 'hqporner.com', 'beeg.com', 'porn.com', 'thumbzilla.com',
    'pornone.com', 'fuq.com', 'tnaflix.com', 'drtuber.com', 'porndig.com',
    'youjizz.com', 'motherless.com', 'heavy-r.com', 'efukt.com', 'ixxx.com',
    'hclips.com', 'pornhat.com', 'pornmd.com', 'nudevista.com', 'lobstertube.com',
    'freeones.com', 'cam4.com', 'chaturbate.com', 'bongacams.com', 'stripchat.com',
    'myfreecams.com', 'livejasmin.com', 'camsoda.com', 'flirt4free.com',
    'onlyfans.com', 'fansly.com', 'pornpics.com', 'imagefap.com', 'sex.com',
    'literotica.com', 'rule34.xxx', 'e621.net', 'gelbooru.com', 'nhentai.net',
    'hentaihaven.xxx', 'hanime.tv', 'fakku.net', 'tsumino.com', 'hitomi.la',
    '8muses.com', 'simpcity.su', 'coomer.su', 'kemono.su', 'fapello.com',
    'sxyprn.com', 'daftsex.com', 'javlibrary.com', 'missav.com',
  ],
  gambling: [
    'bet365.com', 'draftkings.com', 'fanduel.com', 'bovada.lv',
    'pokerstars.com', 'betway.com', 'williamhill.com',
  ],
};

// Default enabled categories for new installs
const DEFAULT_CATEGORIES = ['social', 'video', 'news', 'adult'];

/** Merge selected category domains into a flat blocklist. */
export function domainsForCategories(categories: string[]): string[] {
  const all = new Set<string>();
  for (const cat of categories) {
    const domains = BLOCK_CATEGORIES[cat];
    if (domains) domains.forEach(d => all.add(d));
  }
  return [...all];
}

const DEFAULT_DELAYED: string[] = ['gmail.com', 'mail.google.com', 'are.na'];

const DEFAULTS: StoreSchema = {
  blockedDomains: domainsForCategories(DEFAULT_CATEGORIES),
  delayedDomains: DEFAULT_DELAYED,
  blockedPaths: {},
  allowances: [],
  delaySessions: [],
  hardLockouts: [],
  enabledCategories: DEFAULT_CATEGORIES,
};

// In-memory cache
let data: StoreSchema = { ...DEFAULTS };

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function load(): void {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      data = { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Failed to load config:', e);
    data = { ...DEFAULTS };
  }
}

function save(): void {
  ensureConfigDir();
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// Initialize on module load
load();

// Store-like interface
export const store = {
  get<K extends keyof StoreSchema>(key: K, defaultValue?: StoreSchema[K]): StoreSchema[K] {
    return data[key] ?? defaultValue ?? DEFAULTS[key];
  },
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    data[key] = value;
    save();
  },
};

// Helper functions
function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

function matchesDomain(query: string, pattern: string): boolean {
  const nq = normalizeDomain(query);
  const np = normalizeDomain(pattern);
  return nq === np || nq.endsWith('.' + np);
}

// Exported functions

export function isDomainBlocked(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  const blocked = store.get('blockedDomains', []);
  const isInBlocklist = blocked.some(b => {
    const nb = normalizeDomain(b);
    return normalized === nb || normalized.endsWith('.' + nb);
  });
  if (!isInBlocklist) return false;

  const allowances = store.get('allowances', []);
  const now = Date.now();
  const hasAllowance = allowances.some(
    a => matchesDomain(normalized, a.domain) && a.expiresAt > now
  );
  return !hasAllowance;
}

export function grantAllowance(domain: string, minutes: number, reason: string): Allowance {
  const normalized = normalizeDomain(domain);
  const allowances = store.get('allowances', []);
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

export function revokeAllowance(domain: string): void {
  const normalized = normalizeDomain(domain);
  const allowances = store.get('allowances', []);
  store.set('allowances', allowances.filter(a => a.domain !== normalized));
}

export function getBlockedDomains(): string[] {
  return store.get('blockedDomains', []);
}

// Returns blocked domains minus those with active allowances (what should actually be in /etc/hosts)
export function getEffectivelyBlockedDomains(): string[] {
  const blocked = store.get('blockedDomains', []);
  const allowances = store.get('allowances', []);
  const now = Date.now();

  // Get domains with active allowances
  const allowedDomains = new Set(
    allowances
      .filter(a => a.expiresAt > now)
      .map(a => normalizeDomain(a.domain))
  );

  // Filter out allowed domains and their subdomains
  return blocked.filter(domain => {
    const normalized = normalizeDomain(domain);
    // Check if this domain or its parent has an allowance
    for (const allowed of allowedDomains) {
      if (normalized === allowed || normalized.endsWith('.' + allowed)) {
        return false;
      }
    }
    return true;
  });
}

export function addBlockedDomain(domain: string): void {
  const normalized = normalizeDomain(domain);
  const blocked = store.get('blockedDomains', []);
  if (!blocked.includes(normalized)) {
    store.set('blockedDomains', [...blocked, normalized]);
  }
}

export function removeBlockedDomain(domain: string): void {
  const normalized = normalizeDomain(domain);
  const blocked = store.get('blockedDomains', []);
  store.set('blockedDomains', blocked.filter(d => d !== normalized));
}

export function getActiveAllowances(): Allowance[] {
  const allowances = store.get('allowances', []);
  const now = Date.now();
  const active = allowances.filter(a => a.expiresAt > now);
  if (active.length !== allowances.length) {
    store.set('allowances', active);
  }
  return active;
}

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

export function isDomainDelayed(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  const delayed = store.get('delayedDomains', []);
  return delayed.some(d => matchesDomain(normalized, d));
}

export function getDelaySeconds(domain: string): number {
  const normalized = normalizeDomain(domain);
  const sessions = store.get('delaySessions', []);
  const today = new Date().toISOString().split('T')[0];
  let session = sessions.find(s => s.domain === normalized);
  if (session && session.lastResetDate !== today) {
    session.accessCount = 0;
    session.lastResetDate = today;
  }
  const count = session?.accessCount || 0;
  return Math.min(10 * Math.pow(2, count), 160);
}

export function recordDelayAccess(domain: string): void {
  const normalized = normalizeDomain(domain);
  const sessions = store.get('delaySessions', []);
  const today = new Date().toISOString().split('T')[0];
  const now = Date.now();
  const existingIndex = sessions.findIndex(s => s.domain === normalized);

  if (existingIndex >= 0) {
    const session = sessions[existingIndex];
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

export function isInActiveSession(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  const sessions = store.get('delaySessions', []);
  const now = Date.now();
  const SESSION_DURATION = 15 * 60 * 1000;
  const session = sessions.find(s => s.domain === normalized);
  if (!session) return false;
  return (now - session.lastAccess) < SESSION_DURATION;
}

export function updateSessionAccess(domain: string): void {
  const normalized = normalizeDomain(domain);
  const sessions = store.get('delaySessions', []);
  const session = sessions.find(s => s.domain === normalized);
  if (session) {
    session.lastAccess = Date.now();
    store.set('delaySessions', sessions);
  }
}

export function getDelayedDomains(): string[] {
  return store.get('delayedDomains', []);
}

export function addDelayedDomain(domain: string): void {
  const normalized = normalizeDomain(domain);
  const delayed = store.get('delayedDomains', []);
  if (!delayed.includes(normalized)) {
    store.set('delayedDomains', [...delayed, normalized]);
  }
}

export function removeDelayedDomain(domain: string): void {
  const normalized = normalizeDomain(domain);
  const delayed = store.get('delayedDomains', []);
  store.set('delayedDomains', delayed.filter(d => d !== normalized));
}

// Path blocking functions

export function getBlockedPaths(): Record<string, string[]> {
  return store.get('blockedPaths', {});
}

export function addBlockedPath(domain: string, pathPattern: string): void {
  const normalized = normalizeDomain(domain);
  const paths = store.get('blockedPaths', {});
  if (!paths[normalized]) {
    paths[normalized] = [];
  }
  if (!paths[normalized].includes(pathPattern)) {
    paths[normalized].push(pathPattern);
  }
  store.set('blockedPaths', paths);
}

export function removeBlockedPath(domain: string, pathPattern: string): void {
  const normalized = normalizeDomain(domain);
  const paths = store.get('blockedPaths', {});
  if (paths[normalized]) {
    paths[normalized] = paths[normalized].filter((p: string) => p !== pathPattern);
    if (paths[normalized].length === 0) {
      delete paths[normalized];
    }
    store.set('blockedPaths', paths);
  }
}

// Hard lockout functions — config-driven domain locks with expiry dates.
// Replaces hardcoded LOCKED_DOMAINS in server.ts and mcp.ts.

export function getHardLockouts(): HardLockout[] {
  return store.get('hardLockouts', []);
}

export function addHardLockout(domain: string, until: string): void {
  const normalized = normalizeDomain(domain);
  const lockouts = store.get('hardLockouts', []);
  const filtered = lockouts.filter(l => normalizeDomain(l.domain) !== normalized);
  store.set('hardLockouts', [...filtered, { domain: normalized, until }]);
}

export function removeHardLockout(domain: string): void {
  const normalized = normalizeDomain(domain);
  const lockouts = store.get('hardLockouts', []);
  store.set('hardLockouts', lockouts.filter(l => normalizeDomain(l.domain) !== normalized));
}

/** Check if a domain is hard-locked (locked and lockout period hasn't expired). */
export function isHardLocked(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  const lockouts = store.get('hardLockouts', []);
  const now = new Date();
  return lockouts.some(l => {
    const lockDomain = normalizeDomain(l.domain);
    const matches = normalized === lockDomain || normalized.endsWith('.' + lockDomain);
    if (!matches) return false;
    return now < new Date(l.until);
  });
}

/** Get the lockout expiry date for a domain, or null if not locked. */
export function getHardLockoutUntil(domain: string): string | null {
  const normalized = normalizeDomain(domain);
  const lockouts = store.get('hardLockouts', []);
  const now = new Date();
  const lockout = lockouts.find(l => {
    const lockDomain = normalizeDomain(l.domain);
    const matches = normalized === lockDomain || normalized.endsWith('.' + lockDomain);
    return matches && now < new Date(l.until);
  });
  return lockout?.until ?? null;
}

/** Get all currently active hard lockouts (not expired). */
export function getActiveHardLockouts(): HardLockout[] {
  const lockouts = store.get('hardLockouts', []);
  const now = new Date();
  return lockouts.filter(l => now < new Date(l.until));
}

/** Get enabled category names. */
export function getEnabledCategories(): string[] {
  return store.get('enabledCategories', DEFAULT_CATEGORIES);
}
