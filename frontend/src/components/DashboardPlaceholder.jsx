import React, { useState } from 'react';

const TABS = [
  { id: 'agent-settings', label: 'Agent Settings', icon: '⚙️' },
  { id: 'knowledge-base', label: 'Knowledge Base', icon: '📚' },
  { id: 'call-logs', label: 'Call Logs', icon: '📞' },
  { id: 'human-fallback', label: 'Human Fallback', icon: '👤' },
  { id: 'subscription', label: 'Subscription', icon: '💳' },
];

export default function DashboardPlaceholder() {
  const [activeTab, setActiveTab] = useState('agent-settings');

  return (
    <div className="glass-panel" style={{ padding: 0, display: 'flex', overflow: 'hidden', minHeight: '480px', width: '100%', maxWidth: '960px', margin: '0 auto' }}>

      {/* Sidebar */}
      <div style={{
        width: '220px',
        background: 'rgba(0,0,0,0.25)',
        borderRight: '1px solid var(--glass-border)',
        padding: '1.5rem 0.75rem',
        flexShrink: 0
      }}>
        <h3 style={{
          padding: '0 0.75rem',
          marginBottom: '1.5rem',
          fontSize: '1.1rem',
          background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>Dashboard</h3>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.75rem',
                    textAlign: 'left',
                    background: isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    border: 'none',
                    borderRadius: '10px',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: '0.88rem',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    fontFamily: 'inherit'
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>{tab.icon}</span>
                  {tab.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '2.5rem' }}>
        {activeTab === 'agent-settings' && (
          <div className="fade-up">
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem' }}>Agent Settings</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Agent Name</label>
                <input type="text" defaultValue="Sarah" style={{
                  width: '100%', maxWidth: '360px', padding: '0.65rem 0.85rem', borderRadius: '10px',
                  border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.3)',
                  color: 'white', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none'
                }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Voice Accent</label>
                <select style={{
                  width: '100%', maxWidth: '360px', padding: '0.65rem 0.85rem', borderRadius: '10px',
                  border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.3)',
                  color: 'white', fontSize: '0.9rem', fontFamily: 'inherit'
                }}>
                  <option>English (US) — Professional</option>
                  <option>English (UK) — Friendly</option>
                  <option>English (US) — Energetic</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>System Prompt (Llama-3 Instructions)</label>
                <textarea
                  rows="4"
                  defaultValue="You are Sarah, the friendly receptionist for Acme Corp. Answer questions politely and briefly."
                  style={{
                    width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px',
                    border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.3)',
                    color: 'white', fontFamily: 'inherit', fontSize: '0.9rem', resize: 'vertical', outline: 'none'
                  }}
                />
              </div>
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }}>Save Changes</button>
            </div>
          </div>
        )}

        {activeTab === 'human-fallback' && (
          <div className="fade-up">
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem' }}>Human Fallback</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.95rem' }}>
              When the AI encounters a message it cannot handle, the session is routed here.
            </p>
            <div style={{
              padding: '2.5rem', border: '1px dashed rgba(255,255,255,0.08)',
              borderRadius: '14px', textAlign: 'center', color: 'var(--text-secondary)'
            }}>
              No active fallback requests at the moment.
            </div>
          </div>
        )}

        {activeTab === 'call-logs' && (
          <div className="fade-up">
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem' }}>Call Logs</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                { time: '2 min ago', caller: 'John D.', duration: '1:23', status: 'Resolved' },
                { time: '15 min ago', caller: 'Sarah M.', duration: '0:45', status: 'Resolved' },
                { time: '1 hr ago', caller: 'Mike R.', duration: '2:10', status: 'Escalated' },
              ].map((log, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.8rem 1rem', background: 'rgba(0,0,0,0.2)',
                  borderRadius: '10px', fontSize: '0.88rem'
                }}>
                  <span style={{ color: 'var(--text-secondary)', width: '100px' }}>{log.time}</span>
                  <span style={{ flex: 1 }}>{log.caller}</span>
                  <span style={{ color: 'var(--text-secondary)', width: '60px' }}>{log.duration}</span>
                  <span style={{
                    padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                    background: log.status === 'Resolved' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                    color: log.status === 'Resolved' ? '#10b981' : '#f59e0b'
                  }}>{log.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!['agent-settings', 'human-fallback', 'call-logs'].includes(activeTab) && (
          <div className="fade-up">
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', textTransform: 'capitalize' }}>{activeTab.replace(/-/g, ' ')}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>This section is currently under development.</p>
          </div>
        )}
      </div>
    </div>
  );
}
