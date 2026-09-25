import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: number;
}

interface AssistantSettings {
  systemPrompt: string;
}

type WireHistoryMessage = Pick<ChatMessage, 'role' | 'content'>;

const ASSISTANT_SETTINGS_KEY = '4dprint.voice_assistant.settings';
const ASSISTANT_MESSAGES_KEY = '4dprint.voice_assistant.messages';
const DEFAULT_SYSTEM_PROMPT = '你是创客学堂的AI语音助手。用简洁友好的中文回答，每次不超过100字。你可以帮助用户：使用AI生成3D模型、指导磁场涂选操作、解释4D打印流程、回答3D打印基础问题。';
const MAX_SYSTEM_PROMPT_LENGTH = 800;
const MAX_USER_TEXT_LENGTH = 500;
const MAX_STORED_MESSAGES = 24;
const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 3600;

const MicIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getStringField = (value: Record<string, unknown>, key: string): string => {
  const field = value[key];
  return typeof field === 'string' ? field : '';
};

const normalizeSystemPrompt = (value: string): string => {
  const trimmed = value.trim();
  return (trimmed || DEFAULT_SYSTEM_PROMPT).slice(0, MAX_SYSTEM_PROMPT_LENGTH);
};

const normalizeUserText = (value: string): string => value.trim().slice(0, MAX_USER_TEXT_LENGTH);

const normalizeMessage = (value: unknown): ChatMessage | null => {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const content = getStringField(value, 'content').trim();
  if (!content) return null;
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();
  return { role, content: content.slice(0, 1200), createdAt };
};

const trimStoredMessages = (items: ChatMessage[]) => items.slice(-MAX_STORED_MESSAGES);

const loadAssistantMessages = (): ChatMessage[] => {
  try {
    const raw = localStorage.getItem(ASSISTANT_MESSAGES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return trimStoredMessages(parsed.map(normalizeMessage).filter(Boolean) as ChatMessage[]);
  } catch {
    return [];
  }
};

const loadAssistantSettings = (): AssistantSettings => {
  try {
    const raw = localStorage.getItem(ASSISTANT_SETTINGS_KEY);
    if (!raw) return { systemPrompt: DEFAULT_SYSTEM_PROMPT };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { systemPrompt: DEFAULT_SYSTEM_PROMPT };
    return { systemPrompt: normalizeSystemPrompt(getStringField(parsed, 'systemPrompt')) };
  } catch {
    return { systemPrompt: DEFAULT_SYSTEM_PROMPT };
  }
};

const buildConversationHistory = (messages: ChatMessage[]): WireHistoryMessage[] => {
  const latest = messages
    .filter((msg): msg is ChatMessage => (msg.role === 'user' || msg.role === 'assistant') && !!msg.content.trim())
    .slice(-MAX_CONTEXT_MESSAGES);

  const kept: WireHistoryMessage[] = [];
  let totalChars = 0;
  for (let i = latest.length - 1; i >= 0; i -= 1) {
    const msg = latest[i];
    const remaining = MAX_CONTEXT_CHARS - totalChars;
    if (remaining <= 0) break;
    const content = msg.content.trim();
    const clipped = content.length > remaining ? content.slice(-remaining) : content;
    kept.unshift({ role: msg.role, content: clipped });
    totalChars += clipped.length;
  }
  return kept;
};

const getDefaultWsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/voice/ws`;
};

const VoiceChat: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadAssistantMessages);
  const [status, setStatus] = useState('');
  const [textInput, setTextInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [connected, setConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(() => loadAssistantSettings().systemPrompt);
  const [draftSystemPrompt, setDraftSystemPrompt] = useState(systemPrompt);

  const wsRef = useRef<WebSocket | null>(null);
  const openRef = useRef(open);
  const systemPromptRef = useRef(systemPrompt);
  const lastSyncedPromptRef = useRef('');
  const messagesRef = useRef(messages);
  const audioChunksRef = useRef<Int16Array[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const thinkingTimerRef = useRef<number | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    try {
      localStorage.setItem(ASSISTANT_MESSAGES_KEY, JSON.stringify(trimStoredMessages(messages)));
    } catch {
      // localStorage can be unavailable in private or restricted browser contexts.
    }
  }, [messages]);

  useEffect(() => { scrollToBottom(); }, [messages, status, scrollToBottom]);

  useEffect(() => () => {
    if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages(prev => trimStoredMessages([...prev, { ...message, createdAt: message.createdAt ?? Date.now() }]));
  }, []);

  const sendAssistantConfig = useCallback((prompt: string, historyOverride?: ChatMessage[], force = false) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const normalizedPrompt = normalizeSystemPrompt(prompt);
    if (!force && lastSyncedPromptRef.current === normalizedPrompt) return;
    ws.send(JSON.stringify({
      type: 'config',
      system_prompt: normalizedPrompt,
      history: buildConversationHistory(historyOverride ?? messagesRef.current),
    }));
    lastSyncedPromptRef.current = normalizedPrompt;
  }, []);

  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    setStatus('助手连接中…');
    const wsUrl = import.meta.env.VITE_WS_URL || getDefaultWsUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setStatus('');
      lastSyncedPromptRef.current = '';
      sendAssistantConfig(systemPromptRef.current, messagesRef.current, true);
    };
    ws.onclose = () => {
      setConnected(false);
      if (openRef.current) setStatus('助手连接已断开');
    };
    ws.onerror = () => {
      setConnected(false);
      setStatus('助手连接失败，请检查后端服务');
    };

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        const audioUrl = URL.createObjectURL(new Blob([event.data], { type: 'audio/mp3' }));
        const audio = new Audio(audioUrl);
        audio.onended = () => URL.revokeObjectURL(audioUrl);
        audio.play().catch(() => {
          URL.revokeObjectURL(audioUrl);
          setStatus('语音播放失败');
        });
        return;
      }
      try {
        const data: unknown = JSON.parse(event.data);
        if (!isRecord(data)) return;
        const type = getStringField(data, 'type');
        const text = getStringField(data, 'text');
        if (type === 'status') {
          setStatus(text);
        } else if (type === 'config') {
          setStatus(text || '上下文已同步');
        } else if (type === 'stt') {
          appendMessage({ role: 'user', content: text });
          setStatus('');
        } else if (type === 'llm') {
          if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
          appendMessage({ role: 'assistant', content: text });
          setStatus('');
        } else if (type === 'done') {
          if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
          setStatus('');
        }
      } catch {
        setStatus('助手消息解析失败');
      }
    };
  }, [appendMessage, sendAssistantConfig]);

  useEffect(() => {
    systemPromptRef.current = systemPrompt;
    if (open && connected) sendAssistantConfig(systemPrompt);
  }, [connected, open, sendAssistantConfig, systemPrompt]);

  useEffect(() => {
    if (open) connectWs();
    if (!open && wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setConnected(false);
      setRecording(false);
      setStatus('');
    }
  }, [open, connectWs]);

  useEffect(() => () => {
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    processorRef.current?.disconnect();
    contextRef.current?.close().catch(() => undefined);
  }, []);

  const startRecording = async () => {
    if (recording) return;
    if (!connected) {
      connectWs();
      setStatus('助手连接中，请稍后再试');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const ctx = new AudioContext({ sampleRate: 16000 });
      contextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i += 1) {
          int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }
        audioChunksRef.current.push(int16);
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setRecording(true);
      setStatus('正在聆听…');
    } catch {
      setStatus('无法访问麦克风，请检查浏览器权限设置');
    }
  };

  const stopRecording = () => {
    if (!recording) return;
    setRecording(false);
    processorRef.current?.disconnect();
    contextRef.current?.close().catch(() => undefined);
    streamRef.current?.getTracks().forEach(t => t.stop());

    if (audioChunksRef.current.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
      const totalLen = audioChunksRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Int16Array(totalLen);
      let offset = 0;
      for (const chunk of audioChunksRef.current) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      wsRef.current.send(merged.buffer);
      setStatus('识别中…');
    }
    audioChunksRef.current = [];
  };

  const sendText = () => {
    const text = normalizeUserText(textInput);
    if (!text) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWs();
      setStatus('助手连接中，请稍后重试');
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'text', text }));
    appendMessage({ role: 'user', content: text });
    setTextInput('');
    setStatus('思考中…');
    if (thinkingTimerRef.current) window.clearTimeout(thinkingTimerRef.current);
    thinkingTimerRef.current = window.setTimeout(() => {
      setStatus('思考时间较长，请稍等…');
    }, 8000);
  };

  const saveAssistantSettings = () => {
    const nextPrompt = normalizeSystemPrompt(draftSystemPrompt);
    localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ systemPrompt: nextPrompt } satisfies AssistantSettings));
    setSystemPrompt(nextPrompt);
    setDraftSystemPrompt(nextPrompt);
    sendAssistantConfig(nextPrompt);
    setSettingsOpen(false);
    setStatus('助手定制已保存');
  };

  const resetAssistantSettings = () => {
    localStorage.removeItem(ASSISTANT_SETTINGS_KEY);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    setDraftSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    sendAssistantConfig(DEFAULT_SYSTEM_PROMPT, messagesRef.current, true);
    setStatus('助手定制已重置');
  };

  const clearConversation = () => {
    setMessages([]);
    messagesRef.current = [];
    localStorage.removeItem(ASSISTANT_MESSAGES_KEY);
    sendAssistantConfig(systemPrompt, [], true);
    setStatus('对话上下文已清空');
  };

  const closePanel = () => {
    setSettingsOpen(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        className="voice-chat-trigger"
        onClick={() => setOpen(true)}
        type="button"
        title="AI语音助手"
        aria-label={messages.length > 0 ? '打开AI语音助手，继续上次对话' : '打开AI语音助手'}
      >
        <MicIcon />
      </button>
    );
  }

  return (
    <section className="voice-chat-panel" aria-label="AI语音助手">
      <header className="voice-chat-head">
        <div className="voice-chat-title">
          <span className={`voice-chat-status-dot voice-chat-status-dot--${connected ? 'online' : 'offline'}`} aria-hidden="true" />
          <div>
            <strong>AI语音助手</strong>
            <span>{connected ? '已连接' : '未连接'} · {messages.length > 0 ? '可续接上次对话' : '新对话'}</span>
          </div>
        </div>
        <div className="voice-chat-head-actions">
          <button
            type="button"
            className="voice-chat-action"
            onClick={() => { setDraftSystemPrompt(systemPrompt); setSettingsOpen(prev => !prev); }}
            aria-pressed={settingsOpen}
          >
            <SettingsIcon />
            定制
          </button>
          <button type="button" className="voice-chat-action voice-chat-action--close" onClick={closePanel} aria-label="收起AI语音助手">
            <CloseIcon />
            收起
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="voice-chat-settings">
          <label className="voice-chat-settings-field">
            <span>助手定制提示词</span>
            <textarea
              value={draftSystemPrompt}
              onChange={(e) => setDraftSystemPrompt(e.target.value.slice(0, MAX_SYSTEM_PROMPT_LENGTH))}
              maxLength={MAX_SYSTEM_PROMPT_LENGTH}
              rows={4}
              placeholder="定义助手回答风格、领域和限制…"
            />
          </label>
          <div className="voice-chat-settings-row">
            <span>{draftSystemPrompt.length}/{MAX_SYSTEM_PROMPT_LENGTH}</span>
            <div>
              <button type="button" onClick={clearConversation}>清空对话</button>
              <button type="button" onClick={resetAssistantSettings}>重置</button>
              <button type="button" onClick={saveAssistantSettings}>保存</button>
            </div>
          </div>
        </div>
      )}

      <div className="voice-chat-messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="voice-chat-empty">按住麦克风说话，或输入文字提问</div>
        )}
        {messages.map((msg, index) => (
          <div key={`${msg.createdAt ?? index}-${index}`} className={`voice-chat-bubble voice-chat-bubble--${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {status && <div className="voice-chat-status">{status}</div>}
        <div ref={messagesEndRef} />
      </div>

      <form
        className="voice-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          sendText();
        }}
      >
        <button
          type="button"
          className={`voice-chat-record ${recording ? 'is-recording' : ''}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            startRecording();
          }}
          onPointerUp={stopRecording}
          onPointerCancel={stopRecording}
          onPointerLeave={() => { if (recording) stopRecording(); }}
          title="按住说话"
          aria-label={recording ? '松开发送语音' : '按住说话'}
        >
          <MicIcon size={20} />
        </button>
        <input
          type="text"
          name="assistant-message"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value.slice(0, MAX_USER_TEXT_LENGTH))}
          placeholder="输入文字提问…"
          aria-label="输入文字提问"
          autoComplete="off"
          maxLength={MAX_USER_TEXT_LENGTH}
        />
        <button type="submit" className="voice-chat-send" disabled={!textInput.trim()} aria-label="发送消息">
          <SendIcon />
        </button>
      </form>
    </section>
  );
};

export default VoiceChat;
