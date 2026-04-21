import React from "react";

export const Logo: React.FC<{ size?: number; className?: string }> = ({ size = 24, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <polygon points="12,2 22,17 2,17" />
    <path d="M3 19 L21 19 L22 22 L2 22 Z" strokeLinejoin="round" />
  </svg>
);
