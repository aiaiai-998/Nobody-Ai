import React from 'react';
import {
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  Rocket,
  Sparkles,
  Bot,
  X,
  Code,
  Feather,
  GraduationCap,
  Zap
} from 'lucide-react';
import type { ChatSession, SystemPersona } from '../types';
import { SYSTEM_PERSONAS } from '../config/constants';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  activePersonaId: string;
  onSelectPersona: (id: string) => void;
  onOpenSettings: () => void;
  onOpenDeployModal: () => void;
  isOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  activePersonaId,
  onSelectPersona,
  onOpenSettings,
  onOpenDeployModal,
  isOpen,
  onCloseMobile,
}) => {
  const getPersonaIcon = (iconName: string) => {
    switch (iconName) {
      case 'Code': return <Code size={16} />;
      case 'Feather': return <Feather size={16} />;
      case 'GraduationCap': return <GraduationCap size={16} />;
      case 'Zap': return <Zap size={16} />;
      default: return <Sparkles size={16} />;
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed md:static top-0 left-0 bottom-0 z-50 w-72 bg-slate-950/95 border-r border-slate-800/80 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-500 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <Bot size={20} />
            </div>
            <div>
              <h1 className="font-bold text-base text-slate-100 leading-none">
                Kian AI
              </h1>
              <span className="text-[10px] font-semibold tracking-wider text-cyan-400 uppercase">
                Free open-weight models
              </span>
            </div>
          </div>

          <button
            onClick={onCloseMobile}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={() => {
              onNewChat();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm shadow-md shadow-cyan-500/15 transition-all active:scale-[0.98]"
          >
            <Plus size={18} />
            New Chat
          </button>
        </div>

        {/* Persona Selector */}
        <div className="px-3 py-2 border-b border-slate-800/60">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
            AI Mode / Persona
          </p>
          <div className="space-y-1">
            {SYSTEM_PERSONAS.map((persona: SystemPersona) => (
              <button
                key={persona.id}
                onClick={() => onSelectPersona(persona.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activePersonaId === persona.id
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <span className={activePersonaId === persona.id ? 'text-cyan-400' : 'text-slate-500'}>
                  {getPersonaIcon(persona.icon)}
                </span>
                <span className="truncate">{persona.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Chat History List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
            Recent Chats
          </p>

          {sessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              No chats yet. Start a new conversation!
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`group relative flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                  activeSessionId === session.id
                    ? 'bg-slate-800 text-slate-100 border border-slate-700/80 font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                }`}
                onClick={() => {
                  onSelectSession(session.id);
                  onCloseMobile();
                }}
              >
                <MessageSquare size={14} className="shrink-0 text-slate-500 group-hover:text-cyan-400" />
                <span className="truncate flex-1 pr-6">{session.title}</span>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  title="Delete chat"
                  className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-all"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Bottom Actions Footer */}
        <div className="p-3 border-t border-slate-800/80 space-y-2">
          {/* Deploy for free guide */}
          <button
            onClick={() => {
              onOpenDeployModal();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-800/40 text-emerald-300 text-xs font-semibold hover:border-emerald-600/60 transition-all group"
          >
            <div className="flex items-center gap-2">
              <Rocket size={15} className="text-emerald-400 group-hover:animate-bounce" />
              <span>Deploy For Free</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-700/40">
              Guide
            </span>
          </button>

          {/* Settings button */}
          <button
            onClick={() => {
              onOpenSettings();
              onCloseMobile();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-300 hover:bg-slate-900 text-xs font-medium transition-colors"
          >
            <Settings size={15} className="text-slate-400" />
            <span>Settings & API Keys</span>
          </button>
        </div>
      </aside>
    </>
  );
};
