import React from 'react';
import { X, Key, Sliders, ExternalLink, ShieldCheck, Check } from 'lucide-react';
import type { AppSettings } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-2">
            <Sliders size={18} className="text-cyan-400" />
            <h2 className="font-bold text-slate-100 text-base">App Settings & API Keys</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto scrollbar-thin">
          {/* Privacy Note */}
          <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-300 flex items-start gap-2.5">
            <ShieldCheck size={18} className="shrink-0 text-cyan-400 mt-0.5" />
            <p>
              Both providers issue free keys. Your keys are saved <strong>only in this browser’s local storage</strong> and are sent directly to the provider’s own endpoint — never to a middleman. Without a key no model can be reached: pick "Scripted Offline Demo" to use the UI keyless.
            </p>
          </div>

          {/* Groq API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Key size={14} className="text-cyan-400" />
                Groq API Key (required for Groq models)
              </label>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
              >
                Get Free Key <ExternalLink size={10} />
              </a>
            </div>
            <input
              type="password"
              value={settings.groqApiKey}
              onChange={(e) => onUpdateSettings({ groqApiKey: e.target.value })}
              placeholder="gsk_..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* OpenRouter API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Key size={14} className="text-purple-400" />
                OpenRouter API Key (required for OpenRouter models)
              </label>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-purple-400 hover:underline flex items-center gap-1"
              >
                Get Free Key <ExternalLink size={10} />
              </a>
            </div>
            <input
              type="password"
              value={settings.openRouterApiKey}
              onChange={(e) => onUpdateSettings({ openRouterApiKey: e.target.value })}
              placeholder="sk-or-v1-..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Temperature Slider */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200">
                Creativity (Temperature): {settings.temperature}
              </label>
              <span className="text-[10px] text-slate-400">
                {settings.temperature < 0.4 ? 'Focused & Precise' : settings.temperature > 0.8 ? 'Creative & Imaginative' : 'Balanced'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.1"
              value={settings.temperature}
              onChange={(e) => onUpdateSettings({ temperature: parseFloat(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>

          {/* Max Tokens */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200">
                Max Output Tokens: {settings.maxTokens}
              </label>
            </div>
            <input
              type="range"
              min="256"
              max="4096"
              step="256"
              value={settings.maxTokens}
              onChange={(e) => onUpdateSettings({ maxTokens: parseInt(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-colors"
          >
            <Check size={14} /> Done
          </button>
        </div>
      </div>
    </div>
  );
};
