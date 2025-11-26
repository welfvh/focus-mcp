/**
 * Focus Shield - Main App Component
 *
 * Dashboard showing context, rules, and suggested activities.
 */

import React, { useState, useEffect } from 'react';

// Types matching the main process
interface AttentionProfile {
  goals: string[];
  workHours: { start: number; end: number };
  weekendRules: string;
  energyPatterns: string;
  knownWeaknesses: string[];
  accountabilityNotes: string;
}

interface AttentionRule {
  id: string;
  rule: string;
  createdAt: number;
  active: boolean;
}

interface FocusSession {
  id: string;
  name: string;
  startedAt: number;
  plannedDuration: number;
  endedAt?: number;
}

interface ContextData {
  time: string;
  day: string;
  date: string;
  isWorkHours: boolean;
  isWeekend: boolean;
  screenTime?: number; // minutes
  sleep?: { score: number; duration: number }; // from Oura
  steps?: number; // from Apple Health
  activeSession?: FocusSession;
}

interface DashboardState {
  context: ContextData;
  profile: AttentionProfile;
  rules: AttentionRule[];
  blockedDomains: string[];
  shieldActive: boolean;
}

const suggestedActivities = [
  { emoji: '🚶', label: 'Go for a walk', duration: '15-30 min' },
  { emoji: '😴', label: 'Take a power nap', duration: '20 min' },
  { emoji: '🧘', label: 'Meditation / Olo session', duration: '10-20 min' },
  { emoji: '📚', label: 'Listen to Audible', duration: 'any' },
  { emoji: '💪', label: 'Quick workout', duration: '15 min' },
  { emoji: '☕', label: 'Make tea, no screens', duration: '10 min' },
  { emoji: '📝', label: 'Journal / brain dump', duration: '10 min' },
  { emoji: '🌳', label: 'Step outside, breathe', duration: '5 min' },
];

function App() {
  const [state, setState] = useState<DashboardState>({
    context: {
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      day: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      isWorkHours: false,
      isWeekend: new Date().getDay() === 0 || new Date().getDay() === 6,
    },
    profile: {
      goals: [],
      workHours: { start: 9, end: 17 },
      weekendRules: '',
      energyPatterns: '',
      knownWeaknesses: [],
      accountabilityNotes: '',
    },
    rules: [],
    blockedDomains: [],
    shieldActive: true,
  });

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const hour = now.getHours();
      const isWeekend = now.getDay() === 0 || now.getDay() === 6;
      const isWorkHours = !isWeekend && hour >= state.profile.workHours.start && hour < state.profile.workHours.end;

      setState(prev => ({
        ...prev,
        context: {
          ...prev.context,
          time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          day: now.toLocaleDateString('en-US', { weekday: 'long' }),
          date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          isWorkHours,
          isWeekend,
        },
      }));
    }, 60000);

    return () => clearInterval(interval);
  }, [state.profile.workHours]);

  // Fetch state from main process via API
  useEffect(() => {
    fetch('http://localhost:8053/status')
      .then(res => res.json())
      .then(data => {
        setState(prev => ({
          ...prev,
          blockedDomains: data.blockedDomains || [],
          shieldActive: data.shieldActive || false,
        }));
      })
      .catch(() => {});
  }, []);

  const openClaudeChat = (prompt: string) => {
    // Use Claude's deep link
    const encoded = encodeURIComponent(prompt);
    window.open(`https://claude.ai/new?q=${encoded}`, '_blank');
  };

  const handleArgueWithClaude = () => {
    const prompt = `# Focus Shield - Attention Copilot Context

## Current Time & Context
- **Time**: ${state.context.time} on ${state.context.day}, ${state.context.date}
- **Work hours**: ${state.context.isWorkHours ? 'YES - currently in work hours' : 'No - outside work hours'}
- **Weekend**: ${state.context.isWeekend ? 'Yes' : 'No'}

## Currently Blocked Sites
${state.blockedDomains.slice(0, 10).join(', ')}${state.blockedDomains.length > 10 ? ` (+${state.blockedDomains.length - 10} more)` : ''}

## Your Role
You are my attention copilot. Help me make conscious choices about my attention. I can:
- Request temporary access to a blocked site (with reasoning)
- Add new sites to block
- Create natural language rules (e.g., "No YouTube before 6pm on weekdays")
- Update my goals and preferences
- Defer content to a better time

What would you like to discuss?`;

    openClaudeChat(prompt);
  };

  const handleRequestAccess = () => {
    const url = prompt('Enter URL you want to access:');
    if (!url) return;

    const requestPrompt = `# Focus Shield - Access Request

## Current Context
- **Time**: ${state.context.time} on ${state.context.day}
- **Work hours**: ${state.context.isWorkHours ? 'YES' : 'No'}

## Request
I want to access: ${url}

Please help me think through whether this makes sense right now:
- Is this the right time?
- Is this specific content or general browsing?
- Should I defer this to later?
- What's my honest reason for wanting this?`;

    openClaudeChat(requestPrompt);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.shield}>🛡️</span>
          <h1 style={styles.title}>Focus Shield</h1>
        </div>
        <div style={styles.shieldStatus}>
          <span style={{
            ...styles.statusDot,
            backgroundColor: state.shieldActive ? '#4ade80' : '#f87171'
          }} />
          {state.shieldActive ? 'Active' : 'Inactive'}
        </div>
      </header>

      <main style={styles.main}>
        {/* Context Section */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>📍 Current Context</h2>
          <div style={styles.contextGrid}>
            <div style={styles.contextCard}>
              <div style={styles.contextValue}>{state.context.time}</div>
              <div style={styles.contextLabel}>{state.context.day}</div>
            </div>
            <div style={styles.contextCard}>
              <div style={styles.contextValue}>{state.context.date}</div>
              <div style={styles.contextLabel}>
                {state.context.isWorkHours ? '💼 Work Hours' : '🌙 Off Hours'}
              </div>
            </div>
            <div style={styles.contextCard}>
              <div style={styles.contextValue}>{state.context.screenTime || '—'}</div>
              <div style={styles.contextLabel}>📱 Screen Time (min)</div>
            </div>
            <div style={styles.contextCard}>
              <div style={styles.contextValue}>{state.context.sleep?.score || '—'}</div>
              <div style={styles.contextLabel}>😴 Sleep Score</div>
            </div>
            <div style={styles.contextCard}>
              <div style={styles.contextValue}>{state.context.steps?.toLocaleString() || '—'}</div>
              <div style={styles.contextLabel}>👟 Steps Today</div>
            </div>
          </div>
        </section>

        {/* Rules Section */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>📋 Active Rules</h2>
          {state.rules.length > 0 ? (
            <ul style={styles.rulesList}>
              {state.rules.map(rule => (
                <li key={rule.id} style={styles.ruleItem}>{rule.rule}</li>
              ))}
            </ul>
          ) : (
            <p style={styles.emptyState}>No custom rules yet. Talk to Claude to create some.</p>
          )}
        </section>

        {/* Actions */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>🤖 Claude Actions</h2>
          <div style={styles.actionButtons}>
            <button style={styles.primaryButton} onClick={handleArgueWithClaude}>
              💬 Argue with Claude
            </button>
            <button style={styles.secondaryButton} onClick={handleRequestAccess}>
              🔓 Request Access
            </button>
          </div>
        </section>

        {/* Suggested Activities */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>✨ Good Things To Do Right Now</h2>
          <div style={styles.activitiesGrid}>
            {suggestedActivities.map((activity, i) => (
              <div key={i} style={styles.activityCard}>
                <span style={styles.activityEmoji}>{activity.emoji}</span>
                <span style={styles.activityLabel}>{activity.label}</span>
                <span style={styles.activityDuration}>{activity.duration}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Blocked Sites Summary */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>🚫 Blocked ({state.blockedDomains.length})</h2>
          <div style={styles.blockedList}>
            {state.blockedDomains.slice(0, 8).map(domain => (
              <span key={domain} style={styles.blockedChip}>{domain}</span>
            ))}
            {state.blockedDomains.length > 8 && (
              <span style={styles.blockedChip}>+{state.blockedDomains.length - 8} more</span>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: '100vh',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  shield: {
    fontSize: '32px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
  },
  shieldStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#aaa',
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  section: {
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '12px',
    padding: '16px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#888',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  contextGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
    gap: '12px',
  },
  contextCard: {
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '8px',
    padding: '12px',
    textAlign: 'center',
  },
  contextValue: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#fff',
  },
  contextLabel: {
    fontSize: '11px',
    color: '#888',
    marginTop: '4px',
  },
  rulesList: {
    listStyle: 'none',
  },
  ruleItem: {
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '6px',
    marginBottom: '8px',
    fontSize: '14px',
  },
  emptyState: {
    color: '#666',
    fontSize: '14px',
    fontStyle: 'italic',
  },
  actionButtons: {
    display: 'flex',
    gap: '12px',
  },
  primaryButton: {
    flex: 1,
    padding: '12px 16px',
    fontSize: '14px',
    fontWeight: 600,
    border: 'none',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    color: '#fff',
    cursor: 'pointer',
  },
  secondaryButton: {
    flex: 1,
    padding: '12px 16px',
    fontSize: '14px',
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
  },
  activitiesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '10px',
  },
  activityCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  activityEmoji: {
    fontSize: '24px',
    marginBottom: '6px',
  },
  activityLabel: {
    fontSize: '12px',
    fontWeight: 500,
    textAlign: 'center',
  },
  activityDuration: {
    fontSize: '10px',
    color: '#888',
    marginTop: '4px',
  },
  blockedList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  blockedChip: {
    padding: '4px 10px',
    fontSize: '12px',
    background: 'rgba(239, 68, 68, 0.2)',
    color: '#f87171',
    borderRadius: '12px',
  },
};

export default App;
