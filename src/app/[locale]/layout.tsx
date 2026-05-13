import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { FingerprintProvider } from "@/components/fingerprint-provider";
import { ModelStoreServerSync } from "@/components/model-store-server-sync";
import { Toaster } from "sonner";

export default async function LocaleLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <FingerprintProvider>
        <ModelStoreServerSync />
        {children}
      </FingerprintProvider>
      <Toaster position="top-center" theme="dark" />
    </NextIntlClientProvider>
  );
}
