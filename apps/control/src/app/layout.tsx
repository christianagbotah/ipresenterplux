import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iPresenterPlux",
  description: "AI-native church presentation, broadcast, interpretation and engagement platform",
  applicationName: "iPresenterPlux"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
