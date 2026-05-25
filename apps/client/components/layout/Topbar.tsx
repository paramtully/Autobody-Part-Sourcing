'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, GitCompare } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCompareStore } from '@/store/compareStore';

export default function Topbar() {
  const pathname = usePathname();
  const compareCount = useCompareStore(s => s.selected.length);

  return (
    <header className="sticky top-0 z-50 h-12 border-b flex items-center px-6 bg-[#111827] text-white">
      <Link href="/" className="font-semibold tracking-tight text-white text-[15px] mr-8 shrink-0">
        Partsync
      </Link>

      <nav className="flex items-center gap-1 flex-1">
        <TopbarLink href="/search" active={pathname.startsWith('/search')}>
          <Search size={14} className="shrink-0" />
          Search
        </TopbarLink>
      </nav>

      {compareCount > 0 && (
        <Link
          href={`/compare?ids=${useCompareStore.getState().selected.map(l => l.id).join(',')}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#D97706] text-white text-[13px] font-medium hover:bg-[#B45309] transition-colors"
        >
          <GitCompare size={13} />
          Compare ({compareCount})
        </Link>
      )}
    </header>
  );
}

function TopbarLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors',
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-300 hover:bg-white/5 hover:text-white',
      )}
    >
      {children}
    </Link>
  );
}
