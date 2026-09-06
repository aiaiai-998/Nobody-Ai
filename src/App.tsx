import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { SettingsModal } from './components/SettingsModal';
import { DeployModal } from './components/DeployModal';
import { SetupModal } from './components/SetupModal';
import type { AIModel, Attachment, Message, ChatSession, AppSettings } from './types';
import { DEFAULT_MODELS, SYSTEM_PERSONAS } from './config/constants';
import { STORAGE_KEY_SESSIONS, STORAGE_KEY_SETTINGS, migrateLegacyKeys } from './config/storage';
import { fetchOpenRouterFreeModels, normalizeModelId, sendChatMessage } from './services/aiService';

// Runs once at import, before any state reads localStorage, so chats saved by
// the previous build under the old key names are carried across the rename.
if (typeof localStorage !== 'undefined') {
  migrateLegacyKeys(localStorage);
}

const DEFAULT_SETTINGS: AppSettings = {
  activeModelId: DEFAULT_MODELS[0].id,
  activePersonaId: SYSTEM_PERSONAS[0].id,
  openRouterApiKey: '',
  groqApiKey: '',
  geminiApiKey: '',
  temperature: 0.7,
  maxTokens: 2048,
  autoSpeech: false,
};

export const App: React.FC = () => {
  // Load initial settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<AppSettings>;
        // Merge over defaults so keys added or removed in later versions behave,
        // and migrate any model id that no longer routes to a real endpoint.
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          activeModelId: normalizeModelId(parsed.activeModelId ?? DEFAULT_SETTINGS.activeModelId),
        };
      } catch {
        // Corrupt settings: fall through to defaults.
      }
    }
    return { ...DEFAULT_SETTINGS };
  });

  // Load initial chat sessions
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // Corrupt session store: fall through to a fresh welcome session.
      }
    }
    // Default welcome chat session
    const defaultSession: ChatSession = {
      id: `session_${Date.now()}`,
      title: 'Welcome to Kian AI',
      messages: [
        {
          id: `msg_welcome`,
          role: 'assistant',
          content: `👋 **Welcome to Kian AI**

A chat client for free models served by **Google AI Studio**, **Groq** and **OpenRouter**.

### Getting started
1. Open **Settings** (⚙️) in the sidebar.
2. Paste a free API key — [Gemini](https://aistudio.google.com/app/apikey), [Groq](https://console.groq.com/keys) or [OpenRouter](https://openrouter.ai/keys). All three are free with no card.
3. Leave the model on **Auto** and send a message.

### What to expect
- **Real streaming** from the model you select.
- **Honest errors** — if a key is missing or a model is rate-limited you get told plainly, rather than being handed a fake answer.
- **Three providers, stacked quotas** — Gemini, Groq and OpenRouter each have their own free allowance, and Auto walks all of them.
- **Voice & speech** — 🎤 to dictate, 🔊 to hear a reply.
- **Scripted Offline Demo** — a clearly-labelled non-AI mode for exercising the UI with no key and no network.

Your keys and chat history stay in this browser's local storage.`,
          timestamp: Date.now(),
          model: DEFAULT_MODELS[0].name,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPersonaId: SYSTEM_PERSONAS[0].id,
      modelId: DEFAULT_MODELS[0].id,
    };
    return [defaultSession];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [liveModels, setLiveModels] = useState<AIModel[]>([]);
  // First-run setup: only prompt when there is genuinely no key to work with.
  const [isSetupOpen, setIsSetupOpen] = useState<boolean>(
    () => !settings.openRouterApiKey?.trim() && !settings.groqApiKey?.trim()
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Curated presets first, then whatever OpenRouter reports as free right now,
  // de-duplicated by id.
  const models: AIModel[] = React.useMemo(() => {
    const byId = new Map<string, AIModel>();
    for (const model of DEFAULT_MODELS) byId.set(model.id, model);
    for (const model of liveModels) if (!byId.has(model.id)) byId.set(model.id, model);
    return [...byId.values()];
  }, [liveModels]);

  // Discover the live free catalog. Failures are non-fatal: the curated
  // presets still work, so we just quietly keep the shorter list.
  useEffect(() => {
    const controller = new AbortController();
    fetchOpenRouterFreeModels(controller.signal)
      .then((discovered) => {
        if (!controller.signal.aborted) setLiveModels(discovered);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Save settings on update
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  }, [settings]);

  // Save sessions on update
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
  }, [sessions]);

  // Get active session
  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  // Scroll to bottom when messages update
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeSession?.messages, isGenerating]);

  // Update Settings helper
  const handleUpdateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  // Create New Chat Session
  const handleNewChat = () => {
    const newSession: ChatSession = {
      id: `session_${Date.now()}`,
      title: 'New Conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPersonaId: settings.activePersonaId,
      modelId: settings.activeModelId,
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  // Delete Chat Session
  const handleDeleteSession = (id: string) => {
    const filtered = sessions.filter((s) => s.id !== id);
    setSessions(filtered);
    if (activeSessionId === id && filtered.length > 0) {
      setActiveSessionId(filtered[0].id);
    } else if (filtered.length === 0) {
      handleNewChat();
    }
  };

  // Select Persona
  const handleSelectPersona = (personaId: string) => {
    handleUpdateSettings({ activePersonaId: personaId });
  };

  // Select Model
  const handleSelectModel = (modelId: string) => {
    handleUpdateSettings({ activeModelId: modelId });
  };

  // Clear current active chat
  const handleClearChat = () => {
    if (!activeSession) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, messages: [], updatedAt: Date.now() } : s
      )
    );
  };

  // Export current active chat
  const handleExportChat = () => {
    if (!activeSession) return;
    const content = activeSession.messages
      .map((m) => `### ${m.role === 'user' ? 'User' : 'AI Assistant'}\n${m.content}\n`)
      .join('\n---\n\n');
    
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${activeSession.title.replace(/\s+/g, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle Send Message
  const handleSendMessage = async (text: string, attachments: Attachment[] = []) => {
    if ((!text.trim() && attachments.length === 0) || isGenerating) return;

    const targetSession = activeSession;
    if (!targetSession) return;
    const sessionId = targetSession.id;

    // No key and not the offline demo: guide the user instead of failing.
    const wantsRealModel = !normalizeModelId(settings.activeModelId).startsWith('offline/');
    const hasAnyKey = Boolean(
      settings.openRouterApiKey?.trim() || settings.groqApiKey?.trim() || settings.geminiApiKey?.trim()
    );
    if (wantsRealModel && !hasAnyKey) {
      setIsSetupOpen(true);
      return;
    }

    const activeModelObj = models.find((m) => m.id === settings.activeModelId) || models[0];
    const activePersonaObj = SYSTEM_PERSONAS.find((p) => p.id === settings.activePersonaId) || SYSTEM_PERSONAS[0];

    const userMessage: Message = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const assistantMsgId = `msg_${Date.now()}_assistant`;
    const initialAssistantMessage: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: activeModelObj.name,
    };

    // Auto update chat title if this is the first user message
    const isFirstUserMsg = targetSession.messages.filter((m) => m.role === 'user').length === 0;
    const updatedTitle = isFirstUserMsg
      ? text.slice(0, 30) + (text.length > 30 ? '...' : '')
      : targetSession.title;

    // Append messages to current session
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === sessionId) {
          return {
            ...s,
            title: updatedTitle,
            messages: [...s.messages, userMessage, initialAssistantMessage],
            updatedAt: Date.now(),
          };
        }
        return s;
      })
    );

    const noteModelUsed = (modelId: string) => {
      const label = models.find((m) => m.id === modelId)?.name ?? modelId;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantMsgId ? { ...m, model: `${label} (failover)` } : m
            ),
          };
        })
      );
    };

    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const currentHistory = [...targetSession.messages, userMessage];

    try {
      await sendChatMessage(
        currentHistory,
        activePersonaObj.systemPrompt,
        settings,
        {
          onModelUsed: noteModelUsed,
          onChunk: (chunkText) => {
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                return {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, content: chunkText } : m
                  ),
                };
              })
            );
          },
          onFinish: () => {
            setIsGenerating(false);
          },
          onError: (err) => {
            setIsGenerating(false);
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                return {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: `⚠️ ${err.message}`, error: true }
                      : m
                  ),
                };
              })
            );
          },
        },
        { signal: controller.signal, knownModels: models }
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleStopGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        activePersonaId={settings.activePersonaId}
        onSelectPersona={handleSelectPersona}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDeployModal={() => setIsDeployModalOpen(true)}
        isOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-slate-950">
        {/* Top Header */}
        <Header
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          models={models}
          activeModelId={settings.activeModelId}
          onSelectModel={handleSelectModel}
          onClearChat={handleClearChat}
          onExportChat={handleExportChat}
          hasMessages={(activeSession?.messages.length ?? 0) > 0}
        />

        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {activeSession?.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-cyan-500 via-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-2xl shadow-cyan-500/30 mb-4 animate-bounce">
                ✨
              </div>
              <h2 className="text-xl font-bold text-slate-100 mb-2">
                What would you like to build or ask?
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed mb-6">
                Your AI assistant is ready. Select a model, choose a prompt below, or type your own question.
              </p>
            </div>
          ) : (
            activeSession?.messages.map((msg, index) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isLast={index === activeSession.messages.length - 1}
                isStreaming={isGenerating && index === activeSession.messages.length - 1 && msg.role === 'assistant'}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Input Area */}
        <ChatInput
          onSendMessage={handleSendMessage}
          onStopGeneration={handleStopGeneration}
          isGenerating={isGenerating}
          isEmptyChat={activeSession?.messages.length === 0}
        />
      </div>

      {/* Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      <DeployModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
      />

      <SetupModal
        isOpen={isSetupOpen}
        openRouterApiKey={settings.openRouterApiKey}
        groqApiKey={settings.groqApiKey}
        geminiApiKey={settings.geminiApiKey}
        onSaveOpenRouterKey={(key) => handleUpdateSettings({ openRouterApiKey: key })}
        onSaveGroqKey={(key) => handleUpdateSettings({ groqApiKey: key })}
        onSaveGeminiKey={(key) => handleUpdateSettings({ geminiApiKey: key })}
        onDone={() => setIsSetupOpen(false)}
        onSkip={() => setIsSetupOpen(false)}
      />
    </div>
  );
};

export default App;
