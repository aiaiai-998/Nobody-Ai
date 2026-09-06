import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Mic,
  MicOff,
  Square,
  Sparkles,
  Code,
  Atom,
  Lightbulb,
  Cpu,
  Paperclip,
  X,
  FileText,
  ImageIcon,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { Attachment } from '../types';
import { QUICK_PROMPTS } from '../config/constants';
import {
  MAX_DOCUMENTS_PER_MESSAGE,
  MAX_IMAGES_PER_MESSAGE,
  formatBytes,
  isImageMime,
  readFileAsAttachment,
} from '../services/attachments';

interface ChatInputProps {
  onSendMessage: (text: string, attachments: Attachment[]) => void;
  onStopGeneration: () => void;
  isGenerating: boolean;
  isEmptyChat: boolean;
}

const ACCEPT = 'image/*,application/pdf,text/plain,text/markdown,text/csv,application/json';

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onStopGeneration,
  isGenerating,
  isEmptyChat,
}) => {
  const [prompt, setPrompt] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isReading, setIsReading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;

    // Enforce the per-message caps here so the user is told up front, rather
    // than having the provider reject the whole request later.
    const incomingImages = files.filter((f) => isImageMime(f.type));
    const incomingDocs = files.filter((f) => !isImageMime(f.type));

    const roomForImages = Math.max(
      0,
      MAX_IMAGES_PER_MESSAGE - attachments.filter((a) => a.kind === 'image').length
    );
    const roomForDocs = Math.max(
      0,
      MAX_DOCUMENTS_PER_MESSAGE - attachments.filter((a) => a.kind === 'document').length
    );

    const accepted = [
      ...incomingImages.slice(0, roomForImages),
      ...incomingDocs.slice(0, roomForDocs),
    ];
    const skipped =
      Math.max(0, incomingImages.length - roomForImages) +
      Math.max(0, incomingDocs.length - roomForDocs);

    setNotice(
      skipped > 0
        ? `Up to ${MAX_IMAGES_PER_MESSAGE} images and ${MAX_DOCUMENTS_PER_MESSAGE} documents per message — ${skipped} file${skipped === 1 ? '' : 's'} not added. Send this one, then attach the rest in a follow-up.`
        : null
    );

    if (accepted.length === 0) return;

    setIsReading(true);
    try {
      const next = await Promise.all(accepted.map(readFileAsAttachment));
      setAttachments((prev) => [...prev, ...next]);
    } finally {
      setIsReading(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const canSend = Boolean(prompt.trim()) || attachments.length > 0;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSend || isGenerating || isReading) return;

    const text = prompt.trim() || 'Please describe and summarise what I have attached.';
    onSendMessage(text, attachments);
    setPrompt('');
    setAttachments([]);
    setNotice(null);
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

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
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
              onClick={() => onSendMessage(item.prompt, [])}
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
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          void addFiles(Array.from(e.dataTransfer?.files ?? []));
        }}
        className={`relative rounded-2xl bg-slate-900/90 border shadow-2xl backdrop-blur-md transition-all p-2 ${
          isDragOver
            ? 'border-cyan-400 ring-2 ring-cyan-500/30'
            : 'border-slate-800 focus-within:border-cyan-500/50'
        }`}
      >
        {/* Attachment limit notice */}
        {notice && (
          <div className="mx-2 mt-1 mb-1 flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-300">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        {/* Pending attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pt-1 pb-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg border text-[11px] max-w-full ${
                  a.error
                    ? 'bg-amber-950/40 border-amber-800/50 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                {a.kind === 'image' ? (
                  <ImageIcon size={13} className="shrink-0 text-cyan-400" />
                ) : (
                  <FileText size={13} className="shrink-0 text-emerald-400" />
                )}
                <span className="truncate max-w-[140px]" title={a.name}>
                  {a.name}
                </span>
                <span className="text-slate-500 shrink-0">{formatBytes(a.sizeBytes)}</span>
                {a.error && (
                  <span title={a.error} className="shrink-0 flex items-center">
                    <AlertCircle size={13} className="text-amber-400" aria-label={a.error} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white shrink-0"
                  title="Remove"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask anything, or drop an image or PDF here..."
          rows={1}
          className="w-full bg-transparent text-slate-100 placeholder-slate-500 px-3 py-2 text-sm md:text-base focus:outline-none resize-none max-h-44 scrollbar-thin"
        />

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 mt-1 px-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isReading}
              title="Attach an image, PDF or text file"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all disabled:opacity-50"
            >
              {isReading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Paperclip size={18} />
              )}
            </button>

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
                disabled={!canSend || isReading}
                className={`p-2 rounded-xl flex items-center justify-center transition-all ${
                  canSend && !isReading
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
        Kian AI routes to free open-weight models via OpenRouter and Groq · images, PDFs and text
        files welcome
      </p>
    </div>
  );
};
