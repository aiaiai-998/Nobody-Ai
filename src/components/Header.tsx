import React from 'react';
import { Menu, Download, Trash2, ChevronDown, ShieldCheck, Zap, WifiOff } from 'lucide-react';
import type { AIModel } from '../types';

interface HeaderProps {
  onToggleMobileSidebar: () => void;
  models: AIModel[];
  activeModelId: string;
  onSelectModel: (modelId: string) => void;
  onClearChat: () => void;
  onExportChat: () => void;
  hasMessages: boolean;
}

const PROVIDER_ORDER = ['OpenRouter', 'Groq', 'Offline demo'] as const;

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileSidebar,
  models,
  activeModelId,
  onSelectModel,
  onClearChat,
  onExportChat,
  hasMessages,
}) => {
  const activeModel = models.find((m) => m.id === activeModelId) ?? models[0];

  const grouped = PROVIDER_ORDER.map((provider) => ({
    provider,
    items: models.filter((m) => m.provider === provider),
  })).filter((group) => group.items.length > 0);

  return (
    <header className="sticky top-0 z-30 h-14 bg-slate-950/80 border-b border-slate-800/80 backdrop-blur-md px-4 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile menu button */}
        <button
          onClick={onToggleMobileSidebar}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
        >
          <Menu size={20} />
        </button>

        {/* Model Selector Dropdown */}
        <div className="relative group min-w-0">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 cursor-pointer transition-all min-w-0">
            <Zap size={15} className="text-cyan-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-200 truncate">
              {activeModel?.name ?? 'Select a model'}
            </span>
            {activeModel && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-medium shrink-0">
                {activeModel.badge}
              </span>
            )}
            <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-200 transition-transform group-hover:rotate-180 shrink-0" />
          </div>

          {/* Model options menu */}
          <div className="absolute top-full left-0 mt-1 w-80 max-h-[70vh] overflow-y-auto scrollbar-thin bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-2 hidden group-hover:block z-50 animate-in fade-in duration-150">
            {grouped.map((group) => (
              <div key={group.provider} className="mb-2 last:mb-0">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1">
                  {group.provider}
                </p>
                <div className="space-y-1">
                  {group.items.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => onSelectModel(m.id)}
                      className={`w-full text-left p-2 rounded-lg text-xs transition-colors flex flex-col ${
                        activeModelId === m.id
                          ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30'
                          : 'hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-semibold">
                        <span className="truncate">{m.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 shrink-0">
                          {m.speed}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                        {m.description}
                      </span>
                      {m.requiresKey && (
                        <span className="text-[10px] text-amber-400/80 mt-1">
                          Requires an API key in Settings
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Header Right Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${
            activeModel?.requiresKey
              ? 'bg-cyan-950/40 border-cyan-800/40 text-cyan-300'
              : 'bg-slate-900/60 border-slate-700/60 text-slate-400'
          }`}
          title={
            activeModel?.requiresKey
              ? 'Add a free API key in Settings'
              : 'Runs entirely in your browser'
          }
        >
          {activeModel?.requiresKey ? <ShieldCheck size={13} /> : <WifiOff size={13} />}
          <span>{activeModel?.provider ?? 'Model'}</span>
        </div>

        {hasMessages && (
          <>
            <button
              onClick={onExportChat}
              title="Export Chat"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
            >
              <Download size={18} />
            </button>
            <button
              onClick={onClearChat}
              title="Clear conversation"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-900 transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </>
        )}
      </div>
    </header>
  );
};
