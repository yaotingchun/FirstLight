
export const RobotIcon = ({ size = 12, color = 'currentColor' }: { size?: number, color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
        <line x1="9" y1="16" x2="9" y2="16" />
        <line x1="15" y1="16" x2="15" y2="16" />
    </svg>
);

export const DroneIcon = ({ size = 12, color = 'currentColor' }: { size?: number, color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
        <path d="M4 4l3 3" />
        <path d="M20 4l-3 3" />
        <path d="M4 20l3-3" />
        <path d="M20 20l-3-3" />
        <circle cx="4" cy="4" r="1.5" fill={color} />
        <circle cx="20" cy="4" r="1.5" fill={color} />
        <circle cx="4" cy="20" r="1.5" fill={color} />
        <circle cx="20" cy="20" r="1.5" fill={color} />
    </svg>
);

