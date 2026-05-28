'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Scan, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { fetchMakesWithModels, fetchYears, fetchCategories, fetchPositions, fetchConstraints, decodeVin } from '@/lib/api';
import { useRecentSearches } from '@/lib/useRecentSearches';
import { cn } from '@/lib/cn';

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;

export default function FitmentWizard() {
  const router = useRouter();
  const { addFitmentSearch } = useRecentSearches();

  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('');
  const [position, setPosition] = useState('');
  const [constraint, setConstraint] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // VIN decode state
  const [vinInput, setVinInput] = useState('');
  const [vinStatus, setVinStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [vinMessage, setVinMessage] = useState('');
  const vinInputRef = useRef<HTMLInputElement>(null);

  const { data: makesData } = useQuery({ queryKey: ['fitment', 'makes'], queryFn: fetchMakesWithModels, staleTime: 10 * 60_000 });
  const { data: yearsData } = useQuery({ queryKey: ['fitment', 'years'], queryFn: fetchYears, staleTime: 10 * 60_000 });
  const { data: categoriesData } = useQuery({ queryKey: ['fitment', 'categories'], queryFn: fetchCategories, staleTime: 10 * 60_000 });
  const { data: positionsData } = useQuery({ queryKey: ['fitment', 'positions'], queryFn: fetchPositions, staleTime: 10 * 60_000 });
  const { data: constraintsData } = useQuery({ queryKey: ['fitment', 'constraints'], queryFn: fetchConstraints, staleTime: 10 * 60_000 });

  const makes = makesData ? Object.keys(makesData).sort() : [];
  const models = make && makesData ? (makesData[make] ?? []).sort() : [];
  const years = yearsData?.years.map(y => y.year).sort((a, b) => b - a) ?? [];
  const categories = categoriesData?.categories ?? [];
  const positions = positionsData?.positions ?? [];
  const constraints = constraintsData?.constraints ?? [];

  // Reset dependent fields when parent changes
  useEffect(() => { setModel(''); setCategory(''); setPosition(''); setConstraint(''); }, [make]);

  const isReady = !!(year && make && model);

  const handleVinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);
    setVinInput(raw);
    setVinStatus('idle');
    setVinMessage('');
  };

  const handleVinDecode = async () => {
    const vin = vinInput.trim().toUpperCase();
    if (!VIN_REGEX.test(vin)) {
      setVinStatus('error');
      setVinMessage('VIN must be 17 characters (letters and numbers, no I/O/Q)');
      return;
    }
    setVinStatus('loading');
    setVinMessage('');
    try {
      const result = await decodeVin(vin);
      setYear(String(result.year));
      setMake(result.make);
      // Model population depends on makesData being loaded — set after next tick
      setTimeout(() => setModel(result.model), 0);
      setVinStatus('success');
      setVinMessage(`Decoded: ${result.year} ${result.make} ${result.model}`);
    } catch {
      setVinStatus('error');
      setVinMessage('Could not decode this VIN. Select vehicle manually below.');
    }
  };

  const handleVinKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleVinDecode(); }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isReady) return;
    addFitmentSearch({ make, model, year, category: category || undefined });
    const p = new URLSearchParams({ mode: 'fitment', year, make, model });
    if (category) p.set('category', category);
    if (position) p.set('position', position);
    if (constraint) p.set('constraint', constraint);
    router.push(`/search/results?${p.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* VIN decode row */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8] block mb-1.5">
          Decode by VIN (fastest)
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Scan size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              ref={vinInputRef}
              type="text"
              value={vinInput}
              onChange={handleVinChange}
              onKeyDown={handleVinKeyDown}
              placeholder="Paste 17-character VIN"
              maxLength={17}
              className={cn(
                'w-full pl-8 pr-3 py-2 border rounded-md text-[13px] mono bg-white focus:ring-1 focus:outline-none transition-colors',
                vinStatus === 'success'
                  ? 'border-green-400 focus:ring-green-400'
                  : vinStatus === 'error'
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-[#E5E7EB] focus:ring-[#1F6FEB] focus:border-[#1F6FEB]',
              )}
              aria-label="VIN input for auto-fill"
            />
          </div>
          <button
            type="button"
            onClick={handleVinDecode}
            disabled={vinInput.length < 17 || vinStatus === 'loading'}
            className="px-4 py-2 bg-[#1F6FEB] text-white text-[13px] font-semibold rounded-md hover:bg-[#134AB5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 flex items-center gap-1.5"
          >
            {vinStatus === 'loading' && <Loader2 size={13} className="animate-spin" />}
            Decode
          </button>
        </div>

        {/* Status message */}
        {vinStatus === 'success' && (
          <p className="flex items-center gap-1 mt-1 text-[12px] text-green-700">
            <CheckCircle size={12} /> {vinMessage}
          </p>
        )}
        {vinStatus === 'error' && (
          <p className="flex items-center gap-1 mt-1 text-[12px] text-red-600">
            <AlertCircle size={12} /> {vinMessage}
          </p>
        )}

        <p className="mt-1.5 text-[11px] text-[#94A3B8]">or select vehicle manually below</p>
      </div>

      {/* Divider */}
      <div className="border-t border-[#E5E7EB]" />

      {/* Row 1: Year, Make, Model */}
      <div className="grid grid-cols-3 gap-3">
        <WizardSelect
          label="Year"
          value={year}
          onChange={setYear}
          placeholder="Year"
          disabled={years.length === 0}
        >
          {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
        </WizardSelect>

        <WizardSelect
          label="Make"
          value={make}
          onChange={setMake}
          placeholder="Make"
          disabled={makes.length === 0}
        >
          {makes.map(m => <option key={m} value={m}>{m}</option>)}
        </WizardSelect>

        <WizardSelect
          label="Model"
          value={model}
          onChange={setModel}
          placeholder={make ? 'Model' : 'Select make first'}
          disabled={!make || models.length === 0}
        >
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </WizardSelect>
      </div>

      {/* Advanced (optional) */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        className="flex items-center gap-1 text-[12px] text-[#1F6FEB] hover:underline"
      >
        <ChevronDown size={12} className={cn('transition-transform', showAdvanced && 'rotate-180')} />
        {showAdvanced ? 'Hide' : 'Add'} category / position / constraint (optional)
      </button>

      {showAdvanced && (
        <div className="grid grid-cols-3 gap-3">
          <WizardSelect label="Category" value={category} onChange={setCategory} placeholder="Any category">
            {categories.map(c => <option key={c} value={c}>{formatEnum(c)}</option>)}
          </WizardSelect>
          <WizardSelect label="Position" value={position} onChange={setPosition} placeholder="Any position">
            {positions.map(p => <option key={p} value={p}>{formatEnum(p)}</option>)}
          </WizardSelect>
          <WizardSelect label="Constraint" value={constraint} onChange={setConstraint} placeholder="Any">
            {constraints.map(c => <option key={c} value={c}>{formatEnum(c)}</option>)}
          </WizardSelect>
        </div>
      )}

      <button
        type="submit"
        disabled={!isReady}
        className="w-full py-2.5 bg-[#1F6FEB] text-white text-[14px] font-semibold rounded-md hover:bg-[#134AB5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Search parts
      </button>
    </form>
  );
}

function WizardSelect({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            'w-full appearance-none bg-white border border-[#E5E7EB] rounded-md px-3 py-2 text-[13px] text-[#0B1220] focus:ring-1 focus:ring-[#1F6FEB] focus:border-[#1F6FEB] focus:outline-none transition-colors',
            disabled && 'opacity-50 cursor-not-allowed bg-[#F7F8FA]',
          )}
        >
          <option value="">{placeholder}</option>
          {children}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none" />
      </div>
    </div>
  );
}

function formatEnum(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
