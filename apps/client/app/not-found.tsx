import Link from 'next/link';
import Container from '@/components/layout/Container';

export default function NotFound() {
  return (
    <Container className="py-24 text-center">
      <p className="text-[64px] font-bold text-[#E5E7EB] leading-none mb-4">404</p>
      <h1 className="text-[18px] font-semibold text-[#0B1220] mb-2">Page not found</h1>
      <p className="text-[13px] text-[#475569] mb-6">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/search"
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1F6FEB] text-white text-[13px] font-medium rounded-md hover:bg-[#134AB5] transition-colors"
      >
        Back to search
      </Link>
    </Container>
  );
}
