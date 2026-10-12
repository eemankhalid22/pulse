import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Pulse · Incident Management",
  description: "Real-time incident management platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
