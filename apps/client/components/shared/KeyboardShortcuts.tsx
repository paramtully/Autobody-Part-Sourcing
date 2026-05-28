'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const SHORTCUTS = [
  { key: '/', description: 'Focus search input' },
  { key: '↑ / ↓', description: 'Navigate results rows' },
  { key: 'Enter', description: 'Open focused row detail' },
  { key: 'Space', description: 'Toggle compare selection on focused row' },
  { key: 'c', description: 'Open compare tray' },
  { key: 'Esc', description: 'Close popovers / compare tray' },
  { key: '?', description: 'Show this help modal' },
];

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't hijack when typing in inputs
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        // Focus the first visible search input on the page
        const input = document.querySelector<HTMLInputElement>('input[type="text"]');
        if (input) {
          input.focus();
          input.select();
        } else {
          router.push('/search');
        }
      }

      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
          <h2 className="text-[14px] font-semibold text-[#0B1220]">Keyboard shortcuts</h2>
          <button onClick={() => setOpen(false)} className="text-[#94A3B8] hover:text-[#0B1220]">
            <X size={16} />
          </button>
        </div>
        <div className="divide-y divide-[#F7F8FA]">
          {SHORTCUTS.map(({ key, description }) => (
            <div key={key} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[12px] text-[#475569]">{description}</span>
              <kbd className="inline-flex items-center px-2 py-0.5 bg-[#F7F8FA] border border-[#E5E7EB] rounded text-[11px] font-mono text-[#0B1220] font-semibold">
                {key}
              </kbd>
            </div>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-[#E5E7EB]">
          <p className="text-[11px] text-[#94A3B8]">Press <kbd className="px-1 py-0.5 bg-[#F7F8FA] border border-[#E5E7EB] rounded text-[10px] font-mono">?</kbd> to close</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
