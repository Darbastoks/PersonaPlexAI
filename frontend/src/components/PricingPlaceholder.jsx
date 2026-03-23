import React from 'react';

export default function PricingPlaceholder() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '2rem', marginTop: '3rem' }}>
      
      {/* Starter Tier */}
      <div className="glass-panel hover-scale" style={{ padding: '2.5rem', width: '100%', maxWidth: '350px', display: 'flex', flexDirection: 'column', transition: 'transform 0.3s ease' }}>
        <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Starter</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Perfect for very small businesses.</p>
        <div style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '2rem' }}>$49<span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>/mo</span></div>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem', flex: 1 }}>
          <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: 'var(--accent-blue)' }}>✓</span> 500 AI Voice Minutes</li>
          <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: 'var(--accent-blue)' }}>✓</span> US Accent Only</li>
          <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: 'var(--accent-blue)' }}>✓</span> 1 Custom Agent</li>
        </ul>
        <button className="btn btn-secondary" style={{ width: '100%' }}>Choose Starter</button>
      </div>

      {/* Pro Tier */}
      <div className="glass-panel hover-scale" style={{ padding: '2.5rem', width: '100%', maxWidth: '350px', display: 'flex', flexDirection: 'column', border: '1px solid var(--accent-purple)', background: 'rgba(139, 92, 246, 0.05)', position: 'relative', transform: 'scale(1.05)' }}>
        <div style={{ position: 'absolute', top: '-15px', right: '20px', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', color: 'white', padding: '0.25rem 1rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 600 }}>Most Popular</div>
        <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--accent-purple)' }}>Professional</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>For growing agencies and businesses.</p>
        <div style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '2rem' }}>$199<span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>/mo</span></div>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem', flex: 1 }}>
          <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: 'var(--accent-purple)' }}>✓</span> 3,000 AI Voice Minutes</li>
          <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: 'var(--accent-purple)' }}>✓</span> US & UK Accents</li>
          <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: 'var(--accent-purple)' }}>✓</span> 5 Custom Agents</li>
          <li style={{ display: 'flex', gap: '0.5rem' }}><span style={{ color: 'var(--accent-purple)' }}>✓</span> Human Chat Fallback</li>
        </ul>
        <button className="btn btn-primary" style={{ width: '100%' }}>Choose Pro</button>
      </div>

    </div>
  );
}
