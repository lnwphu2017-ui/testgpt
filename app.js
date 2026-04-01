// ===== Firebase Configuration =====
const firebaseConfig = {
    apiKey: "AIzaSyBPfSorox7uaUqinjLYBh8NWiLFq-_uWuM",
    authDomain: "my-chatgpt-clone-a2e7b.firebaseapp.com",
    projectId: "my-chatgpt-clone-a2e7b",
    storageBucket: "my-chatgpt-clone-a2e7b.firebasestorage.app",
    messagingSenderId: "53565927251",
    appId: "1:53565927251:web:63752af52fff443bd87ba6",
    measurementId: "G-YB2YPB41EZ"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

// ===== ตัวแปร State หลัก =====
let currentUser = null;       // ผู้ใช้ที่ login อยู่
let conversations = [];       // เก็บแชททั้งหมด [{id, title, messages:[{role,content}]}]
let activeConvId = null;      // ID ของแชทที่เปิดอยู่
let selectedModel = localStorage.getItem('gpt-model') || 'gpt-4o-mini';  // โมเดลที่เลือกเริ่มต้น (จะถูกอัปเดตเมื่อใส่คีย์)
let isStreaming = false;       // กำลัง stream อยู่หรือไม่

// ===== รายการโมเดลที่รองรับ =====
const OPENAI_MODELS = [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
];

const OPENROUTER_MODELS = [
    { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)' },
    { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 (OpenRouter)' }
];

let MODELS = OPENAI_MODELS; // Default


// ===== DOM Elements =====
const $ = (s) => document.querySelector(s);
const loginScreen = $('#login-screen');
const apiModal = $('#api-modal');
const apiKeyInput = $('#api-key-input');
const chatArea = $('#chat-area');
const messagesDiv = $('#messages');
const welcomeDiv = $('#welcome');
const msgInput = $('#msg-input');
const chatList = $('#chat-list');
const modelLabel = $('#model-label');
const modelMenu = $('#model-menu');

// ===== ตั้งค่า marked.js สำหรับ Markdown =====
marked.setOptions({ breaks: true, gfm: true });

// ===== ฟังก์ชัน Render Markdown + KaTeX =====
// ===== ฟังก์ชัน Render Markdown + KaTeX (เวอร์ชันซ่อนสูตรกันบั๊ก) =====
function renderContent(text) {
    // 1. สร้างโกดังเก็บสูตรชั่วคราว
    const mathBlocks = [];

    // ฟังก์ชันช่วยดึงสูตรไปซ่อนไว้
    const saveMath = (match) => {
        const id = `%%MATH_${mathBlocks.length}%%`;
        mathBlocks.push(match);
        return id; // แปะป้าย placeholder ไว้แทน
    };

    let tempText = text;

    // 2. ค้นหาและซ่อนสูตรคณิตศาสตร์ทุกรูปแบบ (เพื่อหนี marked.js)
    tempText = tempText.replace(/\\\[([\s\S]*?)\\\]/g, saveMath); // ซ่อน \[ ... \]
    tempText = tempText.replace(/\\\(([\s\S]*?)\\\)/g, saveMath); // ซ่อน \( ... \)
    tempText = tempText.replace(/\$\$([\s\S]*?)\$\$/g, saveMath); // ซ่อน $$ ... $$

    // 3. ปล่อยให้ marked.js จัดการตัวหนา/ตัวเอียง/ขึ้นบรรทัดใหม่ตามปกติ
    let html = marked.parse(tempText);

    // 4. เอาสูตรคณิตศาสตร์ที่ซ่อนไว้ คืนร่างกลับเข้าไปใน HTML
    mathBlocks.forEach((math, index) => {
        html = html.replace(`%%MATH_${index}%%`, math);
    });

    return html;
}

function applyKaTeX(el) {
    // 5. ให้ KaTeX มาไล่เรนเดอร์สูตรที่เพิ่งคืนร่าง ให้กลายเป็นสมการสวยๆ
    if (window.renderMathInElement) {
        renderMathInElement(el, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '\\(', right: '\\)', display: false },
                { left: '$', right: '$', display: false }
            ],
            throwOnError: false
        });
    }
}
// ===== Firebase Auth: ตรวจสอบสถานะ Login =====
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        loginScreen.classList.add('hide');
        // แสดงข้อมูลผู้ใช้ที่ sidebar
        $('#user-name').textContent = user.displayName || 'User';
        const avatar = $('#user-avatar');
        if (user.photoURL) {
            avatar.innerHTML = `<img src="${user.photoURL}" class="w-8 h-8 rounded-full" alt="avatar">`;
        } else {
            avatar.textContent = (user.displayName || 'U')[0].toUpperCase();
        }
        // ตรวจสอบว่ามี API Key หรือยัง
        if (!localStorage.getItem('openai-api-key')) {
            apiModal.classList.add('show');
        }
        // โหลดแชทจาก localStorage (ถ้ามี)
        loadConversations();
        if (conversations.length === 0) createNewChat();
    } else {
        currentUser = null;
        loginScreen.classList.remove('hide');
    }
});

// ===== ปุ่ม Google Login =====
$('#google-login-btn').addEventListener('click', () => {
    auth.signInWithPopup(provider).catch(err => alert('Login Error: ' + err.message));
});

// ===== ปุ่ม Logout =====
$('#logout-btn').addEventListener('click', () => {
    auth.signOut();
});

// ===== ตรวจสอบว่าโมเดลไหนใช้ได้บ้าง =====
async function fetchAvailableModels() {
    const key = localStorage.getItem('openai-api-key');
    const baseUrl = localStorage.getItem('api-base-url') || 'https://api.openai.com/v1/chat/completions';
    if (!key) return;

    try {
        // ดึงข้อมูลโมเดลทั้งหมดที่ API Key มีสิทธิ์ใช้งาน
        const modelsUrl = baseUrl.replace('/chat/completions', '/models');
        const res = await fetch(modelsUrl, {
            headers: { 'Authorization': `Bearer ${key}` }
        });

        if (res.ok) {
            const data = await res.json();

            if (data.data && data.data.length > 0) {
                let apiModels = data.data;

                // Filter for OpenRouter free keys
                if (key.startsWith('sk-or-')) {
                    apiModels = apiModels.filter(m => {
                        const isFreeByPricing = m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;
                        const isFreeByName = m.id.toLowerCase().includes('free') || m.id.includes('gpt-oss');
                        return isFreeByPricing || isFreeByName;
                    });
                }

                MODELS = apiModels.map(m => ({
                    id: m.id,
                    name: m.name || m.id,
                    available: true
                }));

                MODELS.sort((a, b) => a.name.localeCompare(b.name));

                // Auto-switch away from gpt-4o if using free key
                const modelExists = MODELS.find(m => m.id === selectedModel);
                if (!modelExists && MODELS.length > 0) {
                    selectedModel = MODELS[0].id;
                    localStorage.setItem('gpt-model', selectedModel);
                }

                renderModelMenu();
            }
        }
    } catch (e) {
        console.error('Failed to fetch models: ', e);
    }
}

// ===== จัดการ Dropdown ตามประเภท API =====
function updateModelListBasedOnApiKey() {
    const key = localStorage.getItem('openai-api-key') || '';
    if (key.startsWith('sk-or-')) {
        MODELS = OPENROUTER_MODELS;
        if (!MODELS.find(m => m.id === selectedModel)) selectedModel = 'openai/gpt-4o';
    } else {
        MODELS = OPENAI_MODELS;
        if (!MODELS.find(m => m.id === selectedModel)) selectedModel = 'gpt-4o';
    }

    // ตั้งค่าเริ่มต้นให้ทุกตัวใช้ได้ (ก่อนเช็ค)
    MODELS.forEach(m => m.available = true);
    localStorage.setItem('gpt-model', selectedModel);

    renderModelMenu();
    fetchAvailableModels(); // เรียกเช็ค API เบื้องหลัง
}

// ===== บันทึกและตรวจสอบ API Key =====
$('#save-api-key-btn').addEventListener('click', async () => {
    let key = apiKeyInput.value.trim();
    if (!key) { alert('กรุณาใส่ API Key ให้ถูกต้อง'); return; }

    const btn = $('#save-api-key-btn');
    const originalText = btn.textContent;
    btn.textContent = 'กำลังตรวจสอบ...';
    btn.disabled = true;

    // ตั้งค่า Base URL อัตโนมัติตาม Prefix ของ API Key
    let url = 'https://api.openai.com/v1/chat/completions';
    if (key.startsWith('sk-or-')) {
        url = 'https://openrouter.ai/api/v1/chat/completions';
    }

    try {
        // ตรวจสอบคีย์ผ่าน endpoint /models
        const modelsUrl = url.replace('/chat/completions', '/models');
        const res = await fetch(modelsUrl, {
            headers: { 'Authorization': `Bearer ${key}` }
        });

        if (res.ok) {
            localStorage.setItem('openai-api-key', key);
            localStorage.setItem('api-base-url', url);
            
            // โหลดโมเดลที่ใช้งานได้จริงๆ เข้ามา
            await fetchAvailableModels();
            
            apiModal.classList.remove('show');
        } else {
            const errData = await res.json().catch(() => ({}));
            alert('API Key ไม่ถูกต้อง: ' + (errData.error?.message || 'โปรดตรวจสอบคีย์อีกครั้ง'));
        }
    } catch (e) {
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
});

$('#api-key-edit-btn').addEventListener('click', () => {
    apiKeyInput.value = localStorage.getItem('openai-api-key') || '';
    apiModal.classList.add('show');
});

// ===== Model Dropdown =====
function renderModelMenu() {
    if (!MODELS || MODELS.length === 0) {
        modelLabel.textContent = "ไม่มีโมเดลที่ใช้ได้";
        modelMenu.innerHTML = '<div class="p-2 text-gray-500 text-xs">ไม่พบโมเดลที่ใช้ได้สำรับ Key นี้</div>';
        return;
    }
    modelMenu.innerHTML = MODELS.map(m => {
        const isSelected = m.id === selectedModel ? 'selected' : '';
        const isDisabled = m.available === false ? 'disabled' : '';
        return `<div data-model="${m.id}" class="${isSelected} ${isDisabled}">${m.name}</div>`;
    }).join('');
    modelLabel.textContent = MODELS.find(m => m.id === selectedModel)?.name || MODELS[0].name;
}
updateModelListBasedOnApiKey(); // เรียกตอนเริ่มโหลด

$('#model-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    modelMenu.classList.toggle('show');
});

modelMenu.addEventListener('click', (e) => {
    const target = e.target.closest('div[data-model]');
    if (!target || target.classList.contains('disabled')) return;

    const model = target.dataset.model;
    if (model) {
        selectedModel = model;
        localStorage.setItem('gpt-model', model);
        renderModelMenu();
        modelMenu.classList.remove('show');
    }
});
document.addEventListener('click', () => modelMenu.classList.remove('show'));

// ===== การจัดการ Conversation =====
function createNewChat() {
    const conv = { id: Date.now().toString(), title: 'แชทใหม่', messages: [] };
    conversations.unshift(conv);
    activeConvId = conv.id;
    saveConversations();
    renderChatList();
    renderMessages();
}

function switchChat(id) {
    activeConvId = id;
    renderChatList();
    renderMessages();
    // ปิด sidebar mobile
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('show');
}

function getActiveConv() {
    return conversations.find(c => c.id === activeConvId);
}

function renderChatList() {
    chatList.innerHTML = conversations
        .filter(c => c.messages.length > 0) // ซ่อน "แชทใหม่" ที่ยังไม่มีข้อความ
        .map(c => `
        <div class="chat-item group ${c.id === activeConvId ? 'active' : ''}" data-id="${c.id}">
            <span class="truncate flex-1">${c.title}</span>
            <button class="delete-chat-btn opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 transition-opacity ml-2" data-id="${c.id}" title="ลบแชท">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        </div>`
        ).join('');
}

// บันทึก/โหลด แชทจาก localStorage
function saveConversations() {
    localStorage.setItem('gpt-convs', JSON.stringify(conversations));
}
function loadConversations() {
    try {
        const data = JSON.parse(localStorage.getItem('gpt-convs'));
        if (data && data.length) {
            conversations = data;
            activeConvId = conversations[0].id;
            renderChatList();
            renderMessages();
        }
    } catch (e) { conversations = []; }
}

// ===== Render ข้อความในแชท =====
function renderMessages() {
    const conv = getActiveConv();
    if (!conv || conv.messages.length === 0) {
        welcomeDiv.style.display = 'flex';
        messagesDiv.innerHTML = '';
        return;
    }
    welcomeDiv.style.display = 'none';
    messagesDiv.innerHTML = conv.messages.map(m => createMsgHTML(m.role, m.content)).join('');
    // Apply KaTeX ให้ทุก bubble
    messagesDiv.querySelectorAll('.bubble').forEach(b => applyKaTeX(b));
    scrollToBottom();
}

function createMsgHTML(role, content) {
    const isUser = role === 'user';
    const bubbleContent = isUser ? escapeHtml(content) : renderContent(content);

    if (isUser) {
        const avatarText = currentUser?.displayName?.[0] || 'U';
        const avatarImg = currentUser?.photoURL
            ? `<img src="${currentUser.photoURL}" class="w-8 h-8 rounded-full" alt="">`
            : avatarText;
        return `<div class="msg user">
            <div class="avatar">${avatarImg}</div>
            <div class="bubble">${bubbleContent}</div>
        </div>`;
    } else {
        // นำ Avatar ฝั่ง AI ออกตามคำขอ เหลือแค่ bubble ข้อความ
        return `<div class="msg ai">
            <div class="bubble" style="margin-left: 0;">${bubbleContent}</div>
        </div>`;
    }
}

function escapeHtml(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
}

// ===== สร้างชื่อเรื่องสนทนาอัตโนมัติ (AI Summarize) =====
async function generateChatTitle(convId, userText) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;

    // ใช้ประโยค 30 ตัวอักษรแรกตั้งเป็นชื่อไปพลางๆ ก่อนเพื่อความเร็วหน้า UI
    conv.title = userText.substring(0, 30).trim() + (userText.length > 30 ? '...' : '');
    saveConversations();
    renderChatList();

    const key = localStorage.getItem('openai-api-key');
    const baseUrl = localStorage.getItem('api-base-url') || 'https://api.openai.com/v1/chat/completions';
    if (!key) return;

    // รัน API เบื้องหลังเพื่อหาชื่อหัวข้อที่สั้นกระชับ
    try {
        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: [
                    { role: 'system', content: 'Generate a very short 2-5 words title in Thai that summarizes the following user input. Return ONLY the title text. Do not use quotes or punctuation.' },
                    { role: 'user', content: userText }
                ],
                max_tokens: 15
            })
        });

        if (res.ok) {
            const data = await res.json();
            const title = data.choices[0].message.content.replace(/["']/g, '').trim();
            if (title) {
                conv.title = title;
                saveConversations();
                renderChatList();
            }
        }
    } catch (e) {
        console.error('Failed to generate title', e);
    }
}

// ===== ส่งข้อความไปหา OpenAI (Streaming) =====
async function sendMessage(overrideMaxTokens = null) {
    const text = msgInput.value.trim();
    if (!text || isStreaming) return;
    const apiKey = localStorage.getItem('openai-api-key');
    if (!apiKey) {
        apiModal.classList.add('show');
        return;
    }

    const conv = getActiveConv();
    if (!conv) return;

    const isFirstMessage = conv.messages.length === 0;

    // เพิ่มข้อความ user
    conv.messages.push({ role: 'user', content: text });

    if (isFirstMessage) {
        generateChatTitle(conv.id, text); // สั่งตั้งชื่อแชท
    } else {
        saveConversations();
    }

    msgInput.value = '';
    autoResize();
    welcomeDiv.style.display = 'none';
    // แสดงข้อความ user
    messagesDiv.innerHTML += createMsgHTML('user', text);
    // แสดง typing indicator (ลบ avatar ออก)
    const typingId = 'typing-' + Date.now();
    messagesDiv.innerHTML += `<div class="msg ai" id="${typingId}">
        <div class="bubble" style="margin-left: 0;"><div class="typing-dots"><span></span><span></span><span></span></div></div>
    </div>`;
    scrollToBottom();

    isStreaming = true;
    try {
        const baseUrl = localStorage.getItem('api-base-url') || 'https://api.openai.com/v1/chat/completions';

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };
        // หากใช้ OpenRouter มักต้องใส่ HTTP-Referer
        if (baseUrl.includes('openrouter.ai')) {
            headers['HTTP-Referer'] = window.location.href;
            headers['X-Title'] = 'GPT Chat Green Theme';
        }

        // กำหนด Max Tokens อัตโนมัติ (หรือใช้ตัวที่ส่งซ่อมมา)
        const reqMaxTokens = overrideMaxTokens ? overrideMaxTokens : 1500;

        // เรียก API แบบ Streaming
        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: selectedModel,
                messages: [
                    {
                        role: 'system',
                        content: `คุณคือผู้ช่วย AI อัจฉริยะ ปัจจุบันคุณกำลังถูกรันคำสั่งภายใต้ชื่อโมเดลว่า "${MODELS.find(m => m.id === selectedModel)?.name || selectedModel}" หากผู้ใช้ถามว่าคุณคือใครหรือเวอร์ชันอะไร ให้ตอบตามชื่อโมเดลนี้เป๊ะๆ ห้ามตอบเป็นรุ่นอื่นเด็ดขาด ให้ความช่วยเหลืออย่างเต็มที่และตอบเป็นภาษาไทยอย่างเป็นธรรมชาติ`
                    },
                    ...conv.messages.map(m => ({ role: m.role, content: m.content }))
                ],
                stream: true,
                max_tokens: reqMaxTokens
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            let errMsg = err.error?.message || `HTTP ${res.status}`;

            // 💡 แก้บัค OpenRouter เครดิตไม่พอ 1500 tokens
            // ถ้า Error บอกว่า "can only afford XXXX" ให้ดึงตัวเลขมาแล้วลองใหม่แบบเบื้องหลังทันที
            const affordMatch = errMsg.match(/can only afford (\d+)/);
            if (affordMatch && !overrideMaxTokens) {
                const affordableTokens = parseInt(affordMatch[1], 10);
                if (affordableTokens > 50) {
                    console.log('Auto-adjusting max_tokens to:', affordableTokens);
                    // ลบกล่องที่เพิ่งสร้างทิ้ง
                    const typingEl = document.getElementById(typingId);
                    if (typingEl) typingEl.remove();
                    const lastMsg = conv.messages.pop(); // เอา user เดิมออกก่อน
                    const msgs = messagesDiv.querySelectorAll('.msg.user');
                    if (msgs.length > 0) msgs[msgs.length - 1].remove();

                    msgInput.value = lastMsg.content; // คืนข้อความ
                    isStreaming = false;
                    return sendMessage(affordableTokens - 10); // ลองยิงใหม่ด้วย Token ที่รับไหว
                }
            }
            throw new Error(errMsg);
        }
        // อ่าน stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let aiText = '';
        // เปลี่ยน typing indicator เป็น bubble จริง
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.querySelector('.bubble').innerHTML = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
            for (const line of lines) {
                const data = line.replace('data: ', '');
                if (data === '[DONE]') break;
                try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta) {
                        aiText += delta;
                        if (typingEl) {
                            typingEl.querySelector('.bubble').innerHTML = renderContent(aiText);
                            applyKaTeX(typingEl.querySelector('.bubble'));
                        }
                        scrollToBottom();
                    }
                } catch (e) { /* ข้าม JSON ที่ parse ไม่ได้ */ }
            }
        }
        // บันทึกข้อความ AI ลง conversation
        conv.messages.push({ role: 'assistant', content: aiText });
        saveConversations();
    } catch (err) {
        // แสดง error ใน bubble
        const typingEl = document.getElementById(typingId);
        if (typingEl) {
            typingEl.querySelector('.bubble').innerHTML =
                `<div style="color:#ff6b6b; font-size: 14px; margin-bottom: 12px;">⚠️ Error: ${escapeHtml(err.message)}</div>
                 <button onclick="document.getElementById('api-key-edit-btn').click();" style="background: var(--btn-primary); color: var(--btn-text); padding: 6px 12px; border-radius: 6px; border: none; font-size: 13px; cursor: pointer; margin-right: 8px;">⚙️ เปลี่ยน API Key</button>
                 <button onclick="retryAfterError('${typingId}')" style="background: transparent; border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;">🔄 ลองอีกครั้ง</button>`;
        }
    }
    isStreaming = false;
}

// ===== ฟังก์ชันลองใหม่ (Retry) =====
window.retryAfterError = function (typingId) {
    const el = document.getElementById(typingId);
    if (el) el.remove(); // ลบกล่อง error ออก

    const conv = getActiveConv();
    if (!conv) return;

    // หาข้อความ user อันล่าสุด
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
        conv.messages.pop(); // เอาออกจาก history

        // ลบ UI กล่องข้อความ user อันก่อนหน้า
        const msgs = messagesDiv.querySelectorAll('.msg.user');
        if (msgs.length > 0) msgs[msgs.length - 1].remove();

        // ใส่ข้อความกลับเข้า input box
        msgInput.value = lastMsg.content;
        autoResize();

        // สั่งส่งข้อความอีกรอบทันที
        sendMessage();
    }
};

// ===== Event Listeners =====
// ปุ่มส่ง
$('#send-btn').addEventListener('click', sendMessage);

// Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่
msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Auto-resize textarea
function autoResize() {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 192) + 'px';
}
msgInput.addEventListener('input', autoResize);

// ปุ่ม New Chat
$('#new-chat-btn').addEventListener('click', createNewChat);

// คลิกเลือกแชทหรือลบแชทใน sidebar
chatList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-chat-btn');
    if (deleteBtn) {
        e.stopPropagation();
        const id = deleteBtn.dataset.id;
        if (confirm('คุณต้องการลบแชทนี้ใช่หรือไม่?')) {
            conversations = conversations.filter(c => c.id !== id);
            saveConversations();
            if (conversations.length === 0) {
                createNewChat();
            } else if (activeConvId === id) {
                switchChat(conversations[0].id);
            } else {
                renderChatList();
            }
        }
        return;
    }
    const id = e.target.closest('.chat-item')?.dataset?.id;
    if (id) switchChat(id);
});

// Ctrl+K shortcut สำหรับ New Chat
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); createNewChat(); }
});

// Mobile sidebar toggle
$('#mobile-menu-btn')?.addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
    $('#sidebar-overlay').classList.toggle('show');
});
$('#sidebar-overlay')?.addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('show');
});

// ปิด API modal เมื่อคลิกข้างนอก
apiModal.addEventListener('click', (e) => {
    if (e.target === apiModal && localStorage.getItem('openai-api-key')) {
        apiModal.classList.remove('show');
    }
});

