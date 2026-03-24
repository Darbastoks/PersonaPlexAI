(function() {
  const SCRIPT_URL = new URL(document.currentScript.src);
  const BASE_URL = SCRIPT_URL.origin;

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

  // 3. UI Structure
  const container = document.createElement('div');
  container.className = 'personaplex-widget';
  container.innerHTML = `
    <div class="personaplex-chat-window" id="personaplex-chat">
      <div class="personaplex-header">
        <div style="width: 30px; height: 30px; border-radius: 50%; background: var(--personaplex-primary); display: flex; align-items: center; justify-content: center;">🤖</div>
        <h4>Persona AI Assistant</h4>
        <div style="margin-left: auto; cursor: pointer;" id="personaplex-close">✕</div>
      </div>
      <div class="personaplex-content" id="personaplex-messages">
        <div class="personaplex-message personaplex-ai">Hello! I'm your AI assistant. How can I help you today?</div>
      </div>
      <div class="personaplex-status" id="personaplex-status"></div>
      <div class="personaplex-footer">
        <input type="text" class="personaplex-input" id="personaplex-input" placeholder="Type a message...">
        <div class="personaplex-mic" id="personaplex-mic">🎙️</div>
      </div>
    </div>
    <div class="personaplex-launcher" id="personaplex-launcher">
      <span style="font-size: 30px;">💬</span>
    </div>
  `;
  document.body.appendChild(container);

  // 4. Selectors
  const launcher = document.getElementById('personaplex-launcher');
  const chatWindow = document.getElementById('personaplex-chat');
  const closeBtn = document.getElementById('personaplex-close');
  const messagesDiv = document.getElementById('personaplex-messages');
  const input = document.getElementById('personaplex-input');
  const micBtn = document.getElementById('personaplex-mic');
  const statusDiv = document.getElementById('personaplex-status');

  // 5. Functions
  const toggleChat = () => {
    chatWindow.style.display = chatWindow.style.display === 'flex' ? 'none' : 'flex';
    if (chatWindow.style.display === 'flex') {
      initAudio();
      input.focus();
    }
  };

  const addMessage = (role, text) => {
    const msg = document.createElement('div');
    msg.className = `personaplex-message personaplex-${role}`;
    msg.textContent = text;
    messagesDiv.appendChild(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  };

  const initAudio = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
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
    } catch (e) {
      console.error('Audio play failed', e);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim()) return;
    addMessage('user', text);
    const currentHistory = [...history];
    history.push({ role: 'user', content: text });
    input.value = '';
    statusDiv.textContent = 'Thinking...';

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
      }
    } catch (e) {
      statusDiv.textContent = 'Connection Error';
    }
  };

  // 6. Speech Recognition
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

  // 7. Event Listeners
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
