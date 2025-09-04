import { cn } from '~/utils/';

export default function GPTIcon({
  size = 25,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  const unit = '41';
  const height = size;
  const width = size;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${unit} ${unit}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      strokeWidth="1.5"
      className={cn(className, '')}
    >
      <defs>
        <linearGradient id="aipyq-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="25%" stopColor="#EC4899" />
          <stop offset="50%" stopColor="#F97316" />
          <stop offset="75%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
      </defs>
      <circle cx="20.5" cy="20.5" r="18" fill="url(#aipyq-gradient)" />
      <circle cx="20.5" cy="20.5" r="12" fill="white" />
      <path d="M26 18 L26 23 L30 20 Z" fill="url(#aipyq-gradient)" />
    </svg>
  );
}
