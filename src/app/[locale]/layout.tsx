import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import {
  Playfair_Display,
  Karla,
  JetBrains_Mono,
} from "next/font/google";
import "../globals.css";
import { FingerprintProvider } from "@/components/fingerprint-provider";
import { Toaster } from "sonner";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const karla = Karla({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export default async function LocaleLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const messages = await getMessages();

  return (
    <html
      lang="zh"
      className={`dark ${playfair.variable} ${karla.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <NextIntlClientProvider messages={messages}>
          <FingerprintProvider>{children}</FingerprintProvider>
          <Toaster position="top-center" theme="dark" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
