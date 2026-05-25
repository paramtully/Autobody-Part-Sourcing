'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Tag, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useRecentSearches } from '@/lib/useRecentSearches';

const VIN_LENGTH = 17;

interface PartNumberInputProps {
  defaultValue?: string;
  autoFocus?: boolean;
}

export default function PartNumberInput({ defaultValue = '', autoFocus }: PartNumberInputProps) {
  const router = useRouter();
  const { partSearches, addPartSearch } = useRecentSearches();
  const [value, setValue] = useState(defaultValue);
  const [vinTagPending, setVinTagPending] = useState<string | null>(null);
  const [vinTag, setVinTag] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    setValue(raw);

    // VIN detection: if user pastes a 17-char alphanumeric string
    const stripped = raw.replace(/-/g, '');
    if (stripped.length === VIN_LENGTH && /^[A-HJ-NPR-Z0-9]{17}$/i.test(stripped)) {
      setVinTagPending(`...${stripped.slice(-8)}`);
    } else {
      setVinTagPending(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.replace(/-/g, '').trim().toUpperCase();
    if (!q) return;
    addPartSearch(q, vinTag);
    const url = new URLSearchParams({ q, mode: 'part' });
    router.push(`/search/results?${url.toString()}`);
  };

  const acceptVinTag = () => {
    if (vinTagPending) { setVinTag(vinTagPending); setVinTagPending(null); }
  };

  const clearVinTag = () => { setVinTag(undefined); setVinTagPending(null); };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex items-center gap-2 p-3 bg-white border-2 border-[#E5E7EB] rounded-lg focus-within:border-[#1F6FEB] transition-colors shadow-[0_1px_2px_rgba(2,6,23,0.05)]">
        <Search size={18} className="text-[#94A3B8] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="Enter OEM or aftermarket part number (e.g. 57704-1E200)"
          className="flex-1 bg-transparent outline-none text-[15px] mono num text-[#0B1220] placeholder:text-[#94A3B8] placeholder:font-sans placeholder:not-mono"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-label="Part number search"
        />
        {vinTag && (
          <div className="flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 text-[11px] font-medium shrink-0">
            <Tag size={10} />
            <span>{vinTag}</span>
            <button type="button" onClick={clearVinTag} className="hover:text-blue-900">
              <X size={10} />
            </button>
          </div>
        )}
        <button
          type="submit"
          disabled={!value.trim()}
          className="px-4 py-1.5 bg-[#1F6FEB] text-white text-[13px] font-semibold rounded-md hover:bg-[#134AB5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          Search
        </button>
      </div>

      {/* VIN tag prompt */}
      {vinTagPending && !vinTag && (
        <div className="mt-1 flex items-center gap-2 text-[12px] text-[#475569] px-1">
          <Tag size={11} />
          <span>Tag this search with VIN <strong>{vinTagPending}</strong>?</span>
          <button type="button" onClick={acceptVinTag} className="text-[#1F6FEB] hover:underline">Yes</button>
          <button type="button" onClick={() => setVinTagPending(null)} className="text-[#94A3B8] hover:underline">No</button>
        </div>
      )}

    </form>
  );
}
