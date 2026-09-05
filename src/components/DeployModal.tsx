import React, { useState } from 'react';
import { X, Rocket, Copy, Check, Globe, Terminal } from 'lucide-react';
import confetti from 'canvas-confetti';

interface DeployModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeployModal: React.FC<DeployModalProps> = ({ isOpen, onClose }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleTriggerConfetti = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-emerald-950/80 to-slate-950">
          <div className="flex items-center gap-2.5">
            <Rocket size={20} className="text-emerald-400" />
            <h2 className="font-bold text-slate-100 text-base">
              Deploy Your Free AI App To The World 🚀
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-6 max-h-[80vh] overflow-y-auto scrollbar-thin">
          {/* Overview */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 leading-relaxed">
            <p className="font-semibold text-slate-100 text-sm mb-1">
              🎉 Congratulations! You have a complete, fully working AI application.
            </p>
            You can launch this app for the public with <strong>$0 server costs</strong>. Anyone can access it on their desktop, phone, or tablet.
          </div>

          {/* Option 1: Vercel Deploy */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-slate-800 text-white flex items-center justify-center font-bold text-xs">
                1
              </div>
              <h3 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                Deploy to Vercel (Fastest & Free)
              </h3>
            </div>

            <ol className="text-xs text-slate-300 space-y-2.5 pl-8 list-decimal">
              <li>
                Upload your code to a free GitHub Repository.
              </li>
              <li>
                Sign in to <a href="https://vercel.com" target="_blank" rel="noreferrer" className="text-cyan-400 underline">Vercel.com</a> (Free Hobby account).
              </li>
              <li>
                Click <strong>"Add New"</strong> &rarr; <strong>"Project"</strong> and select your GitHub repository.
              </li>
              <li>
                Click <strong>"Deploy"</strong>. In ~30 seconds, your site will be live with an SSL HTTPS domain!
              </li>
            </ol>
          </div>

          {/* Terminal Command Quickstart */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Terminal size={14} className="text-cyan-400" /> Or Deploy via Vercel CLI in 1 Command:
            </h4>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs flex items-center justify-between text-slate-200">
              <code>npx vercel</code>
              <button
                onClick={() => copyToClipboard('npx vercel', 1)}
                className="p-1 text-slate-400 hover:text-white"
              >
                {copiedIndex === 1 ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {/* Option 2: Netlify / Cloudflare Pages */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-slate-800 text-white flex items-center justify-center font-bold text-xs">
                2
              </div>
              <h3 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                <Globe size={15} className="text-blue-400" /> Build Output for Netlify / Cloudflare
              </h3>
            </div>
            <p className="text-xs text-slate-400 pl-8">
              Run <code className="bg-slate-950 text-cyan-400 px-1 py-0.5 rounded">npm run build</code> to generate static production assets in the <code className="text-amber-300">dist/</code> folder, then drag-and-drop it into Netlify or Cloudflare Pages.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between">
          <button
            onClick={handleTriggerConfetti}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold"
          >
            ✨ Celebrate Launch!
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors"
          >
            Got It!
          </button>
        </div>
      </div>
    </div>
  );
};
