/**
 * Attention Copilot - Claude integration for Focus Shield
 *
 * Stores user preferences, rules, and request history.
 * Generates context for Claude to make informed decisions about allowances.
 */

import Store from 'electron-store';
import { getBlockedDomains, getActiveAllowances } from './store';

interface AttentionRule {
  id: string;
  rule: string;           // Natural language rule, e.g., "No YouTube before 6pm on weekdays"
  createdAt: number;
  active: boolean;
}

interface AllowanceRequest {
  id: string;
  url: string;
  domain: string;
  reason: string;         // User's reasoning for wanting access
  requestedAt: number;
  requestedDuration: number;  // minutes
  decision: 'pending' | 'approved' | 'denied' | 'deferred';
  decisionReason?: string;
  deferredUntil?: number; // timestamp for "watch later"
}

interface FocusSession {
  id: string;
  name: string;           // e.g., "Deep work", "Writing", "Coding"
  startedAt: number;
  plannedDuration: number; // minutes
  endedAt?: number;
}

interface AttentionProfile {
  goals: string[];                    // User's current goals
  workHours: { start: number; end: number }; // 9-17 = 9am-5pm
  weekendRules: string;               // How weekends differ
  energyPatterns: string;             // "I'm sharpest in the morning"
  knownWeaknesses: string[];          // "I fall into YouTube rabbit holes"
  accountabilityNotes: string;        // "Promised partner I'd focus until 3pm"
}

interface CopilotSchema {
  rules: AttentionRule[];
  requests: AllowanceRequest[];
  sessions: FocusSession[];
  profile: AttentionProfile;
}

const DEFAULT_PROFILE: AttentionProfile = {
  goals: [],
  workHours: { start: 9, end: 17 },
  weekendRules: 'More relaxed, but still mindful',
  energyPatterns: '',
  knownWeaknesses: [],
  accountabilityNotes: '',
};

export const copilotStore = new Store<CopilotSchema>({
  name: 'attention-copilot',
  defaults: {
    rules: [],
    requests: [],
    sessions: [],
    profile: DEFAULT_PROFILE,
  },
});

/**
 * Add a natural language rule.
 */
export function addRule(rule: string): AttentionRule {
  const newRule: AttentionRule = {
    id: crypto.randomUUID(),
    rule,
    createdAt: Date.now(),
    active: true,
  };
  const rules = copilotStore.get('rules', []);
  copilotStore.set('rules', [...rules, newRule]);
  return newRule;
}

/**
 * Get all active rules.
 */
export function getActiveRules(): AttentionRule[] {
  return copilotStore.get('rules', []).filter(r => r.active);
}

/**
 * Log an allowance request.
 */
export function logRequest(url: string, reason: string, duration: number): AllowanceRequest {
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const request: AllowanceRequest = {
    id: crypto.randomUUID(),
    url,
    domain,
    reason,
    requestedAt: Date.now(),
    requestedDuration: duration,
    decision: 'pending',
  };
  const requests = copilotStore.get('requests', []);
  copilotStore.set('requests', [...requests, request]);
  return request;
}

/**
 * Update a request's decision.
 */
export function updateRequestDecision(
  id: string,
  decision: AllowanceRequest['decision'],
  decisionReason?: string,
  deferredUntil?: number
): void {
  const requests = copilotStore.get('requests', []);
  const updated = requests.map(r =>
    r.id === id ? { ...r, decision, decisionReason, deferredUntil } : r
  );
  copilotStore.set('requests', updated);
}

/**
 * Get recent requests for pattern analysis.
 */
export function getRecentRequests(days: number = 7): AllowanceRequest[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return copilotStore.get('requests', []).filter(r => r.requestedAt > cutoff);
}

/**
 * Start a focus session.
 */
export function startFocusSession(name: string, duration: number): FocusSession {
  const session: FocusSession = {
    id: crypto.randomUUID(),
    name,
    startedAt: Date.now(),
    plannedDuration: duration,
  };
  const sessions = copilotStore.get('sessions', []);
  copilotStore.set('sessions', [...sessions, session]);
  return session;
}

/**
 * Get current active focus session if any.
 */
export function getActiveFocusSession(): FocusSession | null {
  const sessions = copilotStore.get('sessions', []);
  const now = Date.now();
  return sessions.find(s =>
    !s.endedAt && (s.startedAt + s.plannedDuration * 60 * 1000) > now
  ) || null;
}

/**
 * Update user's attention profile.
 */
export function updateProfile(updates: Partial<AttentionProfile>): void {
  const profile = copilotStore.get('profile', DEFAULT_PROFILE);
  copilotStore.set('profile', { ...profile, ...updates });
}

/**
 * Get the user's attention profile.
 */
export function getProfile(): AttentionProfile {
  return copilotStore.get('profile', DEFAULT_PROFILE);
}

/**
 * Generate full context for Claude to make an informed decision.
 */
export function generateClaudeContext(): string {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  const profile = getProfile();
  const rules = getActiveRules();
  const recentRequests = getRecentRequests(7);
  const activeSession = getActiveFocusSession();
  const blockedDomains = getBlockedDomains();
  const activeAllowances = getActiveAllowances();

  // Analyze request patterns
  const requestsToday = recentRequests.filter(r =>
    new Date(r.requestedAt).toDateString() === now.toDateString()
  );
  const deniedRecently = recentRequests.filter(r => r.decision === 'denied').length;
  const approvedRecently = recentRequests.filter(r => r.decision === 'approved').length;

  const isWorkHours = !isWeekend && hour >= profile.workHours.start && hour < profile.workHours.end;

  return `# Focus Shield - Attention Copilot Context

## Current Time & Context
- **Time**: ${now.toLocaleTimeString()} on ${dayOfWeek}, ${now.toLocaleDateString()}
- **Work hours**: ${isWorkHours ? 'YES - currently in work hours' : 'No - outside work hours'}
- **Weekend**: ${isWeekend ? 'Yes' : 'No'}

## Active Focus Session
${activeSession
  ? `- **Session**: "${activeSession.name}"
- **Started**: ${new Date(activeSession.startedAt).toLocaleTimeString()}
- **Planned duration**: ${activeSession.plannedDuration} minutes
- **Time remaining**: ${Math.max(0, Math.round((activeSession.startedAt + activeSession.plannedDuration * 60000 - Date.now()) / 60000))} minutes`
  : '- No active focus session'}

## User's Profile
- **Goals**: ${profile.goals.length > 0 ? profile.goals.join(', ') : 'Not set'}
- **Work hours**: ${profile.workHours.start}:00 - ${profile.workHours.end}:00
- **Energy patterns**: ${profile.energyPatterns || 'Not specified'}
- **Known weaknesses**: ${profile.knownWeaknesses.length > 0 ? profile.knownWeaknesses.join(', ') : 'Not specified'}
- **Accountability**: ${profile.accountabilityNotes || 'None noted'}
- **Weekend rules**: ${profile.weekendRules}

## Active Rules (Natural Language)
${rules.length > 0
  ? rules.map((r, i) => `${i + 1}. ${r.rule}`).join('\n')
  : 'No custom rules set'}

## Currently Blocked Sites
${blockedDomains.slice(0, 10).join(', ')}${blockedDomains.length > 10 ? ` (+${blockedDomains.length - 10} more)` : ''}

## Active Allowances (Temporary Access)
${activeAllowances.length > 0
  ? activeAllowances.map(a => `- ${a.domain}: ${Math.ceil((a.expiresAt - Date.now()) / 60000)}min left (reason: ${a.reason})`).join('\n')
  : 'None'}

## Recent Request Patterns (Last 7 Days)
- **Total requests**: ${recentRequests.length}
- **Approved**: ${approvedRecently}
- **Denied**: ${deniedRecently}
- **Requests today**: ${requestsToday.length}
${recentRequests.slice(0, 5).map(r =>
  `- ${r.domain}: "${r.reason}" → ${r.decision}`
).join('\n')}

## What You Should Consider
1. **Is this a genuine need or procrastination?** Look for vague reasons like "just checking" vs specific ones
2. **Time appropriateness**: Is this the right time for this content?
3. **Duration requested**: Short break vs. potential rabbit hole
4. **Pattern recognition**: Are they asking repeatedly for the same thing?
5. **Focus session respect**: Are they in a committed focus block?
6. **Content specificity**: Specific content (a particular video) vs. general browsing
7. **Alternative timing**: Could this be deferred to a better time?
8. **The slippery slope**: One video often becomes many
9. **User's track record**: How did similar past allowances go?
10. **Accountability commitments**: Did they promise someone they'd focus?

## Your Role
You are the user's attention copilot. Be supportive but honest. Your job is NOT to be a gatekeeper, but to help them make conscious choices about their attention. Sometimes the right answer is "yes, take a break!" and sometimes it's "let's defer this to tonight."
`;
}

/**
 * Generate a Claude deep link URL with prefilled context.
 */
export function generateClaudeDeepLink(userMessage?: string): string {
  const context = generateClaudeContext();

  const prompt = `${context}

---

${userMessage || "I'd like to discuss my focus and attention management. What would you like to change or request?"}`;

  // Claude app URL scheme (if available) or web fallback
  // For now, we'll use the web version with a prompt
  const encoded = encodeURIComponent(prompt);

  // Claude doesn't have a public deep link API yet, so we'll copy to clipboard
  // and open Claude, or use the API endpoint we have
  return `https://claude.ai/new?q=${encoded}`;
}
