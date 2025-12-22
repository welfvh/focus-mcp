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

interface StoreSchema {
  blockedDomains: string[];
  delayedDomains: string[];
  allowances: Allowance[];
  delaySessions: DelaySession[];
}

const DEFAULT_BLOCKED: string[] = [
  // Social media & entertainment
  'youtube.com', 'youtu.be', 'netflix.com', 'twitter.com', 'x.com',
  'facebook.com', 'instagram.com', 'tiktok.com', 'reddit.com',
  'twitch.tv', 'news.ycombinator.com', 'linkedin.com', 'discord.com',
  'threads.net', 'bsky.app', 'pinterest.com', 'amazon.com', 'ebay.com',
  'kleinanzeigen.de', 'substack.com', 'polymarket.com',
  // NSFW
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
];

const DEFAULT_DELAYED: string[] = ['gmail.com', 'mail.google.com', 'are.na'];

const DEFAULTS: StoreSchema = {
  blockedDomains: DEFAULT_BLOCKED,
  delayedDomains: DEFAULT_DELAYED,
  allowances: [],
  delaySessions: [],
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
