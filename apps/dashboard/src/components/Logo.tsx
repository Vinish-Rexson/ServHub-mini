import React from "react";

export const Logo: React.FC<{ size?: number; className?: string }> = ({ size = 28, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ flexShrink: 0 }}
  >
    <defs>
      <linearGradient id="servhub-grad-1" x1="2" y1="4" x2="30" y2="28" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6366f1" />
        <stop offset="0.5" stopColor="#8b5cf6" />
        <stop offset="1" stopColor="#06b6d4" />
      </linearGradient>
      <linearGradient id="servhub-grad-2" x1="16" y1="2" x2="16" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#ffffff" stopOpacity="0.9" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0.4" />
      </linearGradient>
    </defs>
    {/* Outer Rounded Hexagon / Shield */}
    <rect
      x="2"
      y="2"
      width="28"
      height="28"
      rx="8"
      fill="#11131a"
      stroke="url(#servhub-grad-1)"
      strokeWidth="1.5"
    />
    {/* Dynamic Geometric Cloud/Edge Crest */}
    <path
      d="M16 7L24 19H8L16 7Z"
      fill="url(#servhub-grad-1)"
      opacity="0.9"
    />
    <path
      d="M16 11L21 18.5H11L16 11Z"
      fill="#08090d"
    />
    <circle cx="16" cy="16" r="2" fill="#38bdf8" />
    <path
      d="M9 23H23"
      stroke="url(#servhub-grad-1)"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
