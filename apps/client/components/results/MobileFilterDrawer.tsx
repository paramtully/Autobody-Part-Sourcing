'use client';

import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import FiltersSidebar from './FiltersSidebar';
import type { VendorFilterOption } from '@/lib/vendors';

interface MobileFilterDrawerProps {
  vendors: VendorFilterOption[];
}

export default function MobileFilterDrawer({ vendors }: MobileFilterDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button className="md:hidden flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E7EB] rounded-md text-[12px] text-[#475569] bg-white hover:bg-[#F7F8FA] transition-colors" />
        }
      >
        <Filter size={12} />
        Filters
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-[14px] text-left">Filter results</SheetTitle>
        </SheetHeader>
        <FiltersSidebar vendors={vendors} className="w-full" />
      </SheetContent>
    </Sheet>
  );
}
