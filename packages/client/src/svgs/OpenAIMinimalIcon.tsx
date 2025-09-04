export default function OpenAIMinimalIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="1"
      viewBox="0 0 40 40"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      height="1em"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="aipyq-gradient-minimal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="25%" stopColor="#EC4899" />
          <stop offset="50%" stopColor="#F97316" />
          <stop offset="75%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="url(#aipyq-gradient-minimal)" />
      <circle cx="20" cy="20" r="12" fill="white" />
      <path d="M25 18 L25 22 L29 20 Z" fill="url(#aipyq-gradient-minimal)" />
    </svg>
  );
}
