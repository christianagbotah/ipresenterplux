export type StudioNavigationCapabilities = {
  canTranslations: boolean;
  canStreaming: boolean;
  canSettings: boolean;
};

export type StudioIconKey =
  | "dashboard"
  | "scripture"
  | "media"
  | "camera"
  | "ai"
  | "translations"
  | "streaming"
  | "audience"
  | "archive"
  | "settings";

export type StudioRoute = {
  label: string;
  href: string;
  icon: StudioIconKey;
  capability?: keyof StudioNavigationCapabilities;
  placement: "primary" | "settings";
};

export const studioRoutes: readonly StudioRoute[] = [
  { label: "Control Room", href: "/", icon: "dashboard", placement: "primary" },
  { label: "Scripture", href: "/scripture", icon: "scripture", placement: "primary" },
  { label: "Songs & Media", href: "/media", icon: "media", placement: "primary" },
  { label: "Cameras", href: "/cameras", icon: "camera", placement: "primary" },
  { label: "AI Director", href: "/ai-director", icon: "ai", placement: "primary" },
  { label: "Translations", href: "/translations", icon: "translations", capability: "canTranslations", placement: "primary" },
  { label: "Streaming", href: "/streaming", icon: "streaming", capability: "canStreaming", placement: "primary" },
  { label: "Audience", href: "/audience", icon: "audience", placement: "primary" },
  { label: "Archive", href: "/archive", icon: "archive", placement: "primary" },
  { label: "Settings", href: "/settings", icon: "settings", capability: "canSettings", placement: "settings" }
];

export function visibleStudioRoutes(capabilities: StudioNavigationCapabilities) {
  return studioRoutes.filter((route) => !route.capability || capabilities[route.capability]);
}

export function isStudioRouteActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
