import React, { useState } from 'react';
import type { Message } from '../types';
import { Bot, User, Copy, Check, Volume2, VolumeX, AlertTriangle, FileText } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface ChatMessageProps {
  message: Message;
  isLast: boolean;
  isStreaming: boolean;
}

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: true,
});

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isStreaming }) => {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const isUser = message.role === 'user';

  const handleCopyText = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSpeak = () => {
    if (!('speechSynthesis' in window)) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel(); // Stop any previous
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.rate = 1.0;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const renderFormattedContent = (content: string) => {
    if (isUser) {
      return <p className="whitespace-pre-wrap leading-relaxed">{content}</p>;
    }

    try {
      const rawHtml = marked.parse(content) as string;
      // Model output is untrusted input: `marked` does not sanitise, so strip
      // anything executable before it reaches the DOM.
      const cleanHtml = DOMPurify.sanitize(rawHtml, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel'],
      });
      return (
        <div
          className="prose prose-invert max-w-none text-slate-200 text-sm md:text-base leading-relaxed"
          dangerouslySetInnerHTML={{ __html: cleanHtml }}
        />
      );
    } catch {
      return <p className="whitespace-pre-wrap leading-relaxed">{content}</p>;
    }
  };

  return (
    <div
      className={`group px-4 py-5 md:px-6 transition-colors ${
        isUser
          ? 'bg-slate-900/40 border-b border-slate-800/40'
          : 'bg-slate-900/80 border-b border-slate-800/80 backdrop-blur-sm'
      }`}
    >
      <div className="max-w-4xl mx-auto flex gap-4 md:gap-6">
        {/* Avatar */}
        <div className="shrink-0">
          {isUser ? (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <User size={18} />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
              <Bot size={18} />
            </div>
          )}
        </div>

        {/* Message Content & Actions */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-200">
                {isUser ? 'You' : 'Kian AI'}
              </span>
              {message.model && !isUser && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                  {message.model}
                </span>
              )}
            </div>

            {/* Action buttons */}
            {!isUser && message.content && (
              <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={handleCopyText}
                  title="Copy response"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                </button>
                <button
                  onClick={handleSpeak}
                  title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {isSpeaking ? (
                    <VolumeX size={15} className="text-cyan-400 animate-pulse" />
                  ) : (
                    <Volume2 size={15} />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {message.attachments.map((a) =>
                a.kind === 'image' && a.dataUrl ? (
                  <img
                    key={a.id}
                    src={a.dataUrl}
                    alt={a.name}
                    className="max-h-56 rounded-xl border border-slate-700 object-contain bg-slate-950"
                  />
                ) : (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300"
                    title={a.error ?? a.name}
                  >
                    <FileText size={13} className="text-emerald-400 shrink-0" />
                    <span className="truncate max-w-[180px]">{a.name}</span>
                    {a.error && (
                      <span className="text-amber-400 shrink-0">unreadable</span>
                    )}
                  </div>
                )
              )}
            </div>
          )}

          {/* Error Banner if any */}
          {message.error && (
            <div className="my-2 p-3 rounded-xl bg-amber-950/40 border border-amber-800/50 flex items-center gap-2 text-amber-300 text-xs">
              <AlertTriangle size={16} className="shrink-0 text-amber-400" />
              <span>{message.content}</span>
            </div>
          )}

          {/* Formatted body */}
          <div className={isStreaming ? 'typing-cursor' : ''}>
            {renderFormattedContent(message.content)}
          </div>
        </div>
      </div>
    </div>
  );
};
