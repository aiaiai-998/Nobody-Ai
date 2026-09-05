import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff, Square, Sparkles, Code, Atom, Lightbulb, Cpu } from 'lucide-react';
import { QUICK_PROMPTS } from '../config/constants';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onStopGeneration: () => void;
  isGenerating: boolean;
  isEmptyChat: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onStopGeneration,
  isGenerating,
  isEmptyChat,
}) => {
  const [prompt, setPrompt] = useState('');
  const [isListening, setIsListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    onSendMessage(prompt.trim());
    setPrompt('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleVoiceInput = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech Recognition is not supported in this browser. Try Google Chrome or Microsoft Edge.');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
  };

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Atom': return <Atom size={16} className="text-cyan-400" />;
      case 'Code': return <Code size={16} className="text-emerald-400" />;
      case 'Lightbulb': return <Lightbulb size={16} className="text-amber-400" />;
      case 'Cpu': return <Cpu size={16} className="text-purple-400" />;
      default: return <Sparkles size={16} className="text-blue-400" />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-4 pb-4">
      {/* Quick Prompt Cards if conversation is empty */}
      {isEmptyChat && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_PROMPTS.map((item, idx) => (
            <button
              key={idx}
              onClick={() => onSendMessage(item.prompt)}
              className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/80 transition-all text-left group shadow-lg shadow-black/20"
            >
              <div className="p-2 rounded-xl bg-slate-800 border border-slate-700/80 group-hover:scale-105 transition-transform">
                {getIcon(item.icon)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
                  {item.title}
                </p>
                <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                  {item.prompt}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input Box Container */}
      <div className="relative rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-md focus-within:border-cyan-500/50 transition-all p-2">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything... (e.g., write code, explain a concept, create a story)"
          rows={1}
          className="w-full bg-transparent text-slate-100 placeholder-slate-500 px-3 py-2 text-sm md:text-base focus:outline-none resize-none max-h-44 scrollbar-thin"
        />

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 mt-1 px-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleVoiceInput}
              title={isListening ? 'Listening... click to stop' : 'Voice input'}
              className={`p-2 rounded-xl text-slate-400 hover:text-white transition-all ${
                isListening
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'
                  : 'hover:bg-slate-800'
              }`}
            >
              {isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            {isListening && (
              <span className="text-xs text-red-400 font-medium animate-pulse ml-1">
                Listening...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isGenerating ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition-all"
              >
                <Square size={13} className="fill-amber-300" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!prompt.trim()}
                className={`p-2 rounded-xl flex items-center justify-center transition-all ${
                  prompt.trim()
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 hover:opacity-90 active:scale-95'
                    : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                }`}
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-center text-slate-500 mt-2">
        Kian AI routes to free open-weight models via OpenRouter and Groq
      </p>
    </div>
  );
};
