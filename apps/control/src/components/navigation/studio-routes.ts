export type StudioNavigationCapabilities = {
  canMedia: boolean;
  canCameras: boolean;
  canAIDirector: boolean;
  canTranslations: boolean;
  canStreaming: boolean;
  canArchive: boolean;
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
  { label: "Songs & Media", href: "/media", icon: "media", capability: "canMedia", placement: "primary" },
  { label: "Cameras", href: "/cameras", icon: "camera", capability: "canCameras", placement: "primary" },
  { label: "AI Director", href: "/ai-director", icon: "ai", capability: "canAIDirector", placement: "primary" },
  { label: "Translations", href: "/translations", icon: "translations", capability: "canTranslations", placement: "primary" },
  { label: "Streaming", href: "/streaming", icon: "streaming", capability: "canStreaming", placement: "primary" },
  { label: "Audience", href: "/audience", icon: "audience", placement: "primary" },
  { label: "Archive", href: "/archive", icon: "archive", capability: "canArchive", placement: "primary" },
  { label: "Settings", href: "/settings", icon: "settings", capability: "canSettings", placement: "settings" }
];

export function visibleStudioRoutes(capabilities: StudioNavigationCapabilities) {
  return studioRoutes.filter((route) => !route.capability || capabilities[route.capability]);
}

export function isStudioRouteActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
