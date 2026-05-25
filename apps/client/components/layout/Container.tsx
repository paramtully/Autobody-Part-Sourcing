import { cn } from '@/lib/cn';

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}

export default function Container({ children, className, wide }: ContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-6',
        wide ? 'max-w-[1400px]' : 'max-w-[1200px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
