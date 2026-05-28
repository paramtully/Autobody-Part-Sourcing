import { Skeleton } from '@/components/ui/skeleton';

export default function ResultRowSkeleton() {
  return (
    <tr className="border-b border-[#E5E7EB]" aria-hidden="true">
      <td className="w-10 px-3 py-2"><Skeleton className="w-4 h-4 rounded" /></td>
      <td className="px-3 py-2">
        <div className="space-y-1">
          <Skeleton className="h-3.5 w-36 rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
      </td>
      <td className="px-3 py-2"><Skeleton className="h-5 w-20 rounded" /></td>
      <td className="px-3 py-2"><Skeleton className="h-5 w-20 rounded" /></td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-4 w-14 rounded" />
        </div>
      </td>
      <td className="px-3 py-2"><Skeleton className="h-4 w-16 rounded" /></td>
      <td className="px-3 py-2 text-right"><Skeleton className="h-3.5 w-20 rounded ml-auto" /></td>
      <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-16 rounded ml-auto" /></td>
      <td className="px-3 py-2" />
    </tr>
  );
}
