import React, { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'https://personaplex-backend.onrender.com';

export default function VoiceTestingWidget() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [transcript, setTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [latencyMs, setLatencyMs] = useState(null);
  const [textInput, setTextInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const recognitionRef = useRef(null);
  const audioCtxRef = useRef(null);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = async (event) => {
        const text = event.results[0][0].transcript;
        setTranscript(text);
        setIsRecording(false);
        await sendMessage(text);
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        setIsRecording(false);
        setStatus('Click the mic to try again.');
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  const sendMessage = async (message) => {
    setIsLoading(true);
    setStatus('Processing...');
    setAiResponse('');
    setLatencyMs(null);

    const start = performance.now();

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, agentName: 'Sarah' })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'API Request Failed');
      }

      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(data.latencyMs || elapsed);
      setAiResponse(data.reply);
      setStatus('AI is speaking...');

      if (data.audioBase64) {
        try {
          const ctx = getAudioContext();
          const binaryString = window.atob(data.audioBase64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.onended = () => setStatus('Idle');
          source.start(0);
        } catch (err) {
          console.error('Web Audio API failed:', err);
          setStatus('Browser Audio Error');
        }
      } else {
        // Explicitly warn the user that the server is missing the Deepgram key!
        setStatus('⚠️ WARNING: Deepgram API Key is missing on the Render Cloud Server!');
      }
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
      setLatencyMs(null);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRecording = () => {
    getAudioContext(); // UNLOCK AUDIO CONTEXT ON FIRST CLICK TO BYPASS AUTOPLAY POLICIES

    if (!recognitionRef.current) {
      setStatus('Voice not supported. Use text input below.');
      return;
    }
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
      setStatus('Idle');
    } else {
      setTranscript('');
      setAiResponse('');
      setLatencyMs(null);
      recognitionRef.current.start();
      setIsRecording(true);
      setStatus('Listening... speak now');
    }
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    setTranscript(textInput.trim());
    sendMessage(textInput.trim());
    setTextInput('');
  };

  const speakText = (text) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.includes('en-GB') && v.name.includes('Female'))
      || voices.find(v => v.lang.includes('en-US'))
      || voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    utterance.onend = () => setStatus('Idle');
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="glass-panel" style={{ padding: '2.5rem', width: '100%', maxWidth: '500px', margin: '0 auto', textAlign: 'center' }}>
      <h3 style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>Live Voice Demo</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
        Click the microphone and speak, or type below.
      </p>

      {/* Mic Button */}
      <div
        onClick={toggleRecording}
        style={{
          width: '90px',
          height: '90px',
          borderRadius: '50%',
          margin: '0 auto 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isRecording ? 'rgba(236, 72, 153, 0.15)' : 'rgba(59, 130, 246, 0.12)',
          border: `2px solid ${isRecording ? 'var(--accent-pink)' : 'rgba(59, 130, 246, 0.3)'}`,
          cursor: 'pointer',
          transition: 'all 0.3s ease',
        }}
        className={isRecording ? 'pulse-anim' : ''}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill={isRecording ? 'var(--accent-pink)' : 'var(--accent-blue)'} xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2ZM19 11C19 14.87 15.87 18 12 18C8.13 18 5 14.87 5 11H3C3 15.53 6.39 19.28 10.73 19.87V23H13.27V19.87C17.61 19.28 21 15.53 21 11H19Z" />
        </svg>
      </div>

      {/* Waveform */}
      {isRecording && (
        <div className="waveform">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className={`wave-bar ${isRecording ? 'recording' : ''}`} />
          ))}
        </div>
      )}

      {/* Status */}
      <div style={{
        fontSize: '1rem',
        fontWeight: 600,
        color: isRecording ? 'var(--accent-pink)' : isLoading ? 'var(--accent-purple)' : 'var(--accent-blue)',
        marginBottom: '1rem',
        transition: 'color 0.3s ease'
      }}>
        {isLoading && (
          <span style={{ display: 'inline-block', animation: 'pulse 1.5s infinite', marginRight: '0.5rem' }}>●</span>
        )}
        {status}
      </div>

      {/* Text Input Fallback */}
      <form onSubmit={handleTextSubmit} style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Or type your message..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '0.7rem 1rem',
              borderRadius: '12px',
              border: '1px solid var(--glass-border)',
              background: 'rgba(0,0,0,0.3)',
              color: 'white',
              fontSize: '0.9rem',
              fontFamily: 'inherit',
              outline: 'none',
              transition: 'border-color 0.2s ease'
            }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading || !textInput.trim()}
            style={{ padding: '0.7rem 1.2rem', fontSize: '0.85rem' }}
          >
            Send
          </button>
        </div>
      </form>

      {/* Transcript */}
      {transcript && (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          padding: '0.8rem 1rem',
          borderRadius: '12px',
          marginBottom: '0.75rem',
          border: '1px solid rgba(255,255,255,0.06)',
          textAlign: 'left'
        }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>You said</div>
          <div style={{ color: 'white', fontSize: '0.9rem' }}>"{transcript}"</div>
        </div>
      )}

      {/* AI Response */}
      {aiResponse && (
        <div className="fade-up" style={{
          background: 'rgba(139, 92, 246, 0.06)',
          padding: '0.8rem 1rem',
          borderRadius: '12px',
          border: '1px solid rgba(139, 92, 246, 0.12)',
          textAlign: 'left'
        }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--accent-purple)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Response</div>
          <div style={{ color: 'white', fontSize: '0.9rem' }}>"{aiResponse}"</div>
        </div>
      )}

      {/* Latency Badge */}
      {latencyMs !== null && (
        <div style={{
          marginTop: '1rem',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.3rem 0.8rem',
          borderRadius: '999px',
          fontSize: '0.75rem',
          fontWeight: 600,
          background: latencyMs < 500 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
          color: latencyMs < 500 ? 'var(--accent-green)' : '#f59e0b',
          border: `1px solid ${latencyMs < 500 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}`
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }}></div>
          {latencyMs}ms round-trip
        </div>
      )}
    </div>
  );
}
