import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iPresenterPlux",
  description: "AI-native church presentation, broadcast, interpretation and engagement platform",
  applicationName: "iPresenterPlux"
};

// Early inline script: apply the manual reduce-motion class before first
// paint so booth machines (where the OS prefers-reduced-motion pref isn't
// set) don't see a flash of animation. Reads the same key the Settings
// MotionPreferences toggle writes. Runs synchronously in <head>.
const reduceMotionBootstrap = `(function(){try{if(localStorage.getItem('ipresenterplux:reduce-motion')==='1'){document.documentElement.classList.add('ip-reduce-motion');}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: reduceMotionBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
