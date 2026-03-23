import React, { useState, useEffect, useRef } from 'react';
import './index.css';
import VoiceTestingWidget from './components/VoiceTestingWidget';
import DashboardPlaceholder from './components/DashboardPlaceholder';
import PricingPlaceholder from './components/PricingPlaceholder';

// ── Typing Animation Hook ──────────────────────────────────────
function useTypingAnimation(words, typingSpeed = 80, deletingSpeed = 40, pauseTime = 2000) {
  const [text, setText] = useState('');
  const [wordIndex, setWordIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentWord = words[wordIndex];
    let timeout;

    if (!isDeleting && text === currentWord) {
      timeout = setTimeout(() => setIsDeleting(true), pauseTime);
    } else if (isDeleting && text === '') {
      setIsDeleting(false);
      setWordIndex((prev) => (prev + 1) % words.length);
    } else {
      timeout = setTimeout(() => {
        setText(currentWord.substring(0, isDeleting ? text.length - 1 : text.length + 1));
      }, isDeleting ? deletingSpeed : typingSpeed);
    }

    return () => clearTimeout(timeout);
  }, [text, isDeleting, wordIndex, words, typingSpeed, deletingSpeed, pauseTime]);

  return text;
}

// ── Scroll Reveal Hook ─────────────────────────────────────────
function useScrollReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, visible];
}

// ── Section Wrapper ────────────────────────────────────────────
function RevealSection({ children, ...props }) {
  const [ref, visible] = useScrollReveal();
  return (
    <section ref={ref} className={`fade-in-view ${visible ? 'visible' : ''}`} {...props}>
      {children}
    </section>
  );
}

// ── App ────────────────────────────────────────────────────────
function App() {
  const [isHovered, setIsHovered] = useState(false);
  const typedText = useTypingAnimation([
    'Modern Businesses',
    'Beauty Salons',
    'Agencies',
    'Clinics',
    'Restaurants'
  ]);

  const features = [
    { text: 'Sub-200ms voice models', icon: '⚡', color: 'rgba(59, 130, 246, 0.15)' },
    { text: 'Customizable US / UK Accents', icon: '🎙️', color: 'rgba(139, 92, 246, 0.15)' },
    { text: 'Human fallback for text chats', icon: '💬', color: 'rgba(236, 72, 153, 0.15)' },
    { text: 'Intelligent LRU caching', icon: '🧠', color: 'rgba(6, 182, 212, 0.15)' },
  ];

  return (
    <>
      <div className="gradient-bg"></div>

      <nav className="navbar fade-up">
        <div className="logo">
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.9rem'
          }}>⚡</div>
          PersonaPlex AI
        </div>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#demo">Try Demo</a>
          <a href="#dashboard">Dashboard</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary">Login</button>
          <button className="btn btn-primary">Get Started</button>
        </div>
      </nav>

      <main>
        {/* ── Hero ──────────────────────────────────────────── */}
        <section className="hero">
          <div className="fade-up" style={{ animationDelay: '0.1s' }}>
            <span style={{
              background: 'rgba(139, 92, 246, 0.08)',
              color: 'var(--accent-purple)',
              padding: '0.5rem 1.2rem',
              borderRadius: '999px',
              fontWeight: 600,
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
              display: 'inline-block',
              border: '1px solid rgba(139, 92, 246, 0.15)'
            }}>
              ✨ Open Source AI Receptionist
            </span>
            <h1>
              The Autonomous Voice for <br />
              <span className="text-gradient">{typedText}</span>
              <span className="typing-cursor"></span>
            </h1>
            <p>
              Deploy a hyper-realistic, fully autonomous AI receptionist that speaks
              naturally to your clients. Seamlessly route human text fallbacks
              straight to your dashboard.
            </p>
            <div className="hero-cta">
              <button
                className="btn btn-primary"
                style={{ padding: '1rem 2rem', fontSize: '1.05rem' }}
                onClick={() => document.getElementById('dashboard').scrollIntoView({ behavior: 'smooth' })}
              >
                Configure Agent
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '1rem 2rem', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onClick={() => document.getElementById('demo').scrollIntoView({ behavior: 'smooth' })}
              >
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: isHovered ? 'var(--accent-pink)' : 'var(--text-secondary)',
                  transition: 'background 0.3s ease'
                }}></div>
                Try the Live Demo
              </button>
            </div>

            <div className="latency-badge" style={{ animationDelay: '0.6s' }}>
              <div className="latency-dot"></div>
              Avg. response: ~177ms with Groq
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────── */}
        <RevealSection id="features" style={{ padding: '5rem 5%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <h2 className="section-heading">Always on, always natural.</h2>
          <p className="section-desc">
            Powered by Groq's lightning-fast inference and open-source voice models.
            Configure Llama-3 logic and neural TTS to give your brand a stunningly human voice.
          </p>
          <ul className="features-grid">
            {features.map((f, i) => (
              <li key={i} className="glass-panel feature-card hover-scale">
                <div className="feature-icon" style={{ background: f.color }}>{f.icon}</div>
                {f.text}
              </li>
            ))}
          </ul>
        </RevealSection>

        {/* ── Demo ──────────────────────────────────────────── */}
        <RevealSection id="demo" style={{ padding: '5rem 5%', display: 'flex', justifyContent: 'center' }}>
          <VoiceTestingWidget />
        </RevealSection>

        {/* ── Dashboard ─────────────────────────────────────── */}
        <RevealSection id="dashboard" style={{ padding: '5rem 5%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h2 className="section-heading">Control your Agent</h2>
          <p className="section-desc">
            Customize instructions, choose an accent, and handle human fallbacks from one beautiful dashboard.
          </p>
          <DashboardPlaceholder />
        </RevealSection>

        {/* ── Pricing ───────────────────────────────────────── */}
        <RevealSection id="pricing" style={{ padding: '5rem 5%', display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
          <h2 className="section-heading">Simple, transparent pricing</h2>
          <p className="section-desc">Pick the plan that works best for your agency.</p>
          <PricingPlaceholder />
        </RevealSection>
      </main>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="footer">
        <div className="footer-links">
          <a href="#features">Features</a>
          <a href="#demo">Demo</a>
          <a href="#dashboard">Dashboard</a>
          <a href="#pricing">Pricing</a>
        </div>
        <p>© 2026 PersonaPlex AI — Built with ⚡ by Rokas</p>
      </footer>
    </>
  );
}

export default App;
