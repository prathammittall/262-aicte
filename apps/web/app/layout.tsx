import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AICTE | Approval Operations",
  description: "Synthetic demonstration of approval workflow and compliance operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
