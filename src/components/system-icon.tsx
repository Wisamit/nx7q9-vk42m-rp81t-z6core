import type { SVGProps } from "react";

export type SystemIconName =
  | "dashboard" | "patients" | "orders" | "billing" | "digital" | "specimen" | "transfer"
  | "worklist" | "report" | "critical" | "microbiology" | "sendout" | "catalog" | "pricing"
  | "template" | "referrer" | "clinical" | "analyzer" | "integration" | "inventory"
  | "equipment" | "qc" | "quality" | "analytics" | "notification" | "resilience"
  | "settings" | "users" | "roles" | "security" | "search" | "clock" | "calendar"
  | "palette" | "image" | "globe" | "sun" | "moon" | "menu" | "close" | "plus" | "logout";

const paths: Record<SystemIconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  patients: <><circle cx="9" cy="8" r="4"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><circle cx="18" cy="9" r="3"/><path d="M16 15.5c3.4-.7 6 1.2 6 4.5"/></>,
  orders: <><path d="M7 3h10l2 3v15H5V6z"/><path d="M8 10h8M8 14h8M8 18h5"/></>,
  billing: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h3"/></>,
  digital: <><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M9 18h6M9 6h6"/></>,
  specimen: <><path d="M9 2h6M10 2v5l-4 8a5 5 0 0 0 4.5 7h3a5 5 0 0 0 4.5-7l-4-8V2"/><path d="M8 15h8"/></>,
  transfer: <><path d="M3 8h14l-3-3M17 8l-3 3M21 16H7l3-3M7 16l3 3"/></>,
  worklist: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  report: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
  critical: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 18h.01"/></>,
  microbiology: <><circle cx="12" cy="12" r="6"/><circle cx="9" cy="10" r="1"/><circle cx="14" cy="13" r="1"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/></>,
  sendout: <><path d="M3 7h13v10H3z"/><path d="M16 10h3l2 3v4h-5M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></>,
  catalog: <><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></>,
  pricing: <><path d="M20 12 12 20 4 12V4h8z"/><circle cx="9" cy="9" r="1"/></>,
  template: <><path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h8M8 15h5"/></>,
  referrer: <><circle cx="8" cy="8" r="3"/><path d="M2 20a6 6 0 0 1 12 0M16 8h6M19 5v6"/></>,
  clinical: <><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="8"/></>,
  analyzer: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4M15 12h2M7 16h10"/></>,
  integration: <><path d="M8 7a4 4 0 0 1 7-2l2 2M16 17a4 4 0 0 1-7 2l-2-2M14 10l-4 4"/></>,
  inventory: <><path d="M4 7 12 3l8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/></>,
  equipment: <><path d="M14 6 18 2l4 4-4 4M10 14l-8 8M13 7 4 16M16 10l-9 9"/></>,
  qc: <><path d="m4 12 5 5L20 6"/><circle cx="12" cy="12" r="10"/></>,
  quality: <><path d="m12 2 3 6 7 .8-5 4.8 1.5 6.9L12 17l-6.5 3.5L7 13.6 2 8.8 9 8z"/></>,
  analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  notification: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  resilience: <><path d="M12 3a9 9 0 1 0 8.5 6M12 3v5h5"/><path d="m8 14 2.5 2.5L16 11"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  users: <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20a6 6 0 0 1 12 0M13 16a5 5 0 0 1 9 4"/></>,
  roles: <><path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></>,
  security: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="9" cy="6.5" r=".8"/><circle cx="14" cy="6" r=".8"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></>,
  moon: <path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  close: <path d="M6 6l12 12M18 6 6 18"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3M21 3v18h-6"/></>,
};

export function SystemIcon({ name, size = 18, ...props }: { name: SystemIconName; size?: number } & SVGProps<SVGSVGElement>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
