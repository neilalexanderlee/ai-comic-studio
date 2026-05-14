import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["zh"],
  defaultLocale: "zh",
  // Always include the locale prefix so middleware never strips /zh/ from URLs.
  // Without this, next-intl v4 defaults to "as-needed" which redirects /zh/...
  // to /... for the default locale, breaking nested App Router pages.
  localePrefix: "always",
});
