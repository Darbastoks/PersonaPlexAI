(function() {
  const SCRIPT_TAG = document.currentScript;
  const SCRIPT_URL = new URL(SCRIPT_TAG.src);
  const BASE_URL = SCRIPT_URL.origin;
  const CLIENT_KEY = SCRIPT_TAG.getAttribute('data-key') || 'default';
  const CLIENT_EMAIL = SCRIPT_TAG.getAttribute('data-email') || '';

  // 1. Inject CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${BASE_URL}/widget.css`;
  document.head.appendChild(link);

  // 2. State
  let history = [];
  let isRecording = false;
  let audioCtx = null;
  let recognition = null;
  let sessionId = 'session_' + Date.now();
  let messageCount = 0;
  let leadCaptured = false;

  // 3. UI Structure
  const container = document.createElement('div');
  container.className = 'personaplex-widget';
  container.innerHTML = `
    <div class="personaplex-chat-window" id="personaplex-chat">
      <div class="personaplex-header">
        <div style="width: 30px; height: 30px; border-radius: 50%; background: var(--personaplex-primary); display: flex; align-items: center; justify-content: center;">💬</div>
        <h4>ChatVora AI</h4>
        <div style="margin-left: auto; cursor: pointer;" id="personaplex-close">✕</div>
      </div>
      <div class="personaplex-content" id="personaplex-messages">
        <div class="personaplex-message personaplex-ai">Hi! I'm here to help you with any questions. What can I help you with?</div>
        <div class="personaplex-quick-replies" id="personaplex-quick-replies">
          <button class="personaplex-quick-btn" data-msg="What services do you offer?">Services</button>
          <button class="personaplex-quick-btn" data-msg="What are your hours?">Hours</button>
          <button class="personaplex-quick-btn" data-msg="What are your prices?">Pricing</button>
          <button class="personaplex-quick-btn" data-msg="I'd like to book an appointment">Book now</button>
        </div>
      </div>
      <div class="personaplex-status" id="personaplex-status"></div>
      <div class="personaplex-footer">
        <input type="text" class="personaplex-input" id="personaplex-input" placeholder="Type a message...">
        <div class="personaplex-mic" id="personaplex-mic">🎙️</div>
      </div>
    </div>
    <div class="personaplex-launcher" id="personaplex-launcher">
      <span style="font-size: 30px;">💬</span>
      <div class="personaplex-badge" id="personaplex-badge">1</div>
    </div>
  `;
  document.body.appendChild(container);

  // Inject quick-reply + badge CSS
  const extraStyle = document.createElement('style');
  extraStyle.textContent = `
    .personaplex-quick-replies { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; }
    .personaplex-quick-btn { background: rgba(0,212,126,0.1); border: 1px solid rgba(0,212,126,0.3); color: #00d47e; padding: 6px 14px; border-radius: 16px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: all 0.2s; }
    .personaplex-quick-btn:hover { background: rgba(0,212,126,0.2); }
    .personaplex-badge { position: absolute; top: -4px; right: -4px; width: 20px; height: 20px; background: #ef4444; color: white; border-radius: 50%; font-size: 11px; display: flex; align-items: center; justify-content: center; font-weight: 700; animation: badgePulse 2s infinite; }
    @keyframes badgePulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
    .personaplex-lead-form { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: rgba(0,212,126,0.05); border: 1px solid rgba(0,212,126,0.2); border-radius: 10px; margin-top: 8px; }
    .personaplex-lead-form input { padding: 8px 12px; border: 1px solid #333; border-radius: 6px; background: #1a1a1a; color: #fff; font-size: 13px; font-family: inherit; outline: none; }
    .personaplex-lead-form input:focus { border-color: #00d47e; }
    .personaplex-lead-form button { padding: 8px; background: #00d47e; color: #000; border: none; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
    .personaplex-launcher { position: relative; }
  `;
  document.head.appendChild(extraStyle);

  // 4. Selectors
  const launcher = document.getElementById('personaplex-launcher');
  const chatWindow = document.getElementById('personaplex-chat');
  const closeBtn = document.getElementById('personaplex-close');
  const messagesDiv = document.getElementById('personaplex-messages');
  const input = document.getElementById('personaplex-input');
  const micBtn = document.getElementById('personaplex-mic');
  const statusDiv = document.getElementById('personaplex-status');
  const badge = document.getElementById('personaplex-badge');

  // 5. Quick Reply buttons
  document.querySelectorAll('.personaplex-quick-btn').forEach(btn => {
    btn.onclick = () => {
      const msg = btn.getAttribute('data-msg');
      // Remove quick replies after first click
      const qr = document.getElementById('personaplex-quick-replies');
      if (qr) qr.remove();
      sendMessage(msg);
    };
  });

  // 6. Functions
  const toggleChat = async () => {
    const isOpen = chatWindow.style.display === 'flex';
    chatWindow.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
      initAudio();
      input.focus();
      badge.style.display = 'none'; // Hide notification badge

      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (e) {}
    }
  };

  const addMessage = (role, text) => {
    const msg = document.createElement('div');
    msg.className = `personaplex-message personaplex-${role}`;
    msg.textContent = text;
    messagesDiv.appendChild(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  };

  // Show lead capture form after AI asks for contact info
  const showLeadForm = () => {
    if (leadCaptured) return;
    const form = document.createElement('div');
    form.className = 'personaplex-lead-form';
    form.innerHTML = `
      <input type="text" id="plex-lead-name" placeholder="Your name">
      <input type="email" id="plex-lead-email" placeholder="Email address">
      <input type="tel" id="plex-lead-phone" placeholder="Phone number">
      <button id="plex-lead-submit">Send my info ✓</button>
    `;
    messagesDiv.appendChild(form);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    document.getElementById('plex-lead-submit').onclick = async () => {
      const name = document.getElementById('plex-lead-name').value.trim();
      const email = document.getElementById('plex-lead-email').value.trim();
      const phone = document.getElementById('plex-lead-phone').value.trim();

      if (!name && !email && !phone) return;

      form.remove();
      leadCaptured = true;
      addMessage('user', `${name}${email ? ', ' + email : ''}${phone ? ', ' + phone : ''}`);

      // Send to backend
      try {
        await fetch(`${BASE_URL}/api/lead-capture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, phone, source: 'chatbot-widget', clientKey: CLIENT_KEY, clientEmail: CLIENT_EMAIL })
        });
      } catch (e) {}

      // AI acknowledges
      sendMessage(`My name is ${name}${email ? ', email: ' + email : ''}${phone ? ', phone: ' + phone : ''}`);
    };
  };

  // Detect if AI is asking for contact info
  const checkForLeadPrompt = (reply) => {
    const triggers = ['name and', 'phone number', 'email', 'contact', 'reach you', 'follow up', 'get back to you'];
    const lower = reply.toLowerCase();
    if (!leadCaptured && triggers.some(t => lower.includes(t))) {
      setTimeout(showLeadForm, 500);
    }
  };

  const initAudio = () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  };

  const playAudio = async (base64) => {
    try {
      initAudio();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const buffer = await audioCtx.decodeAudioData(bytes.buffer);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      source.onended = () => { statusDiv.textContent = ''; };
    } catch (e) {}
  };

  const sendMessage = async (text) => {
    if (!text.trim()) return;
    addMessage('user', text);
    const currentHistory = [...history];
    history.push({ role: 'user', content: text });
    input.value = '';
    statusDiv.textContent = 'Thinking...';
    messageCount++;

    try {
      const resp = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: currentHistory })
      });
      const data = await resp.json();
      if (data.reply) {
        addMessage('ai', data.reply);
        history.push({ role: 'assistant', content: data.reply });
        if (data.audioBase64) {
          statusDiv.textContent = 'Speaking...';
          playAudio(data.audioBase64);
        } else {
          statusDiv.textContent = '';
        }
        // Check if AI is prompting for contact info
        checkForLeadPrompt(data.reply);
      }
    } catch (e) {
      statusDiv.textContent = 'Connection Error';
    }
  };

  // Save conversation when user leaves
  const saveLog = () => {
    if (history.length > 0) {
      navigator.sendBeacon(`${BASE_URL}/api/chat-log`, JSON.stringify({
        messages: history,
        sessionId: sessionId
      }));
    }
  };
  window.addEventListener('beforeunload', saveLog);

  // 7. Speech Recognition
  const initSpeech = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      sendMessage(text);
    };
    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove('active');
    };
    recognition.onerror = () => {
      isRecording = false;
      micBtn.classList.remove('active');
    };
  };

  initSpeech();

  // 8. Auto-popup after 5 seconds (attention grabber)
  setTimeout(() => {
    if (chatWindow.style.display !== 'flex') {
      badge.style.display = 'flex';
    }
  }, 5000);

  // 9. Event Listeners
  launcher.onclick = toggleChat;
  closeBtn.onclick = toggleChat;
  input.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(input.value); };
  micBtn.onclick = () => {
    initAudio();
    if (!recognition) return alert('Speech not supported in this browser');
    if (isRecording) {
      recognition.stop();
    } else {
      recognition.start();
      isRecording = true;
      micBtn.classList.add('active');
      statusDiv.textContent = 'Listening...';
    }
  };

})();
