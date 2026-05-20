import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateBanner } from "@/components/desktop/update-banner";
import { SearchKeybind } from "@/components/search/search-keybind";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale, getMessages } from "@/lib/i18n/server";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spread Journal",
  description: "Private trading journal for crypto-spread specialists.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-app text-text">
        {/*
          Skip-to-content link — visually hidden until focused. Screen-reader
          and keyboard users Tab once to skip the sidebar navigation and land
          directly on the main content area. The target `id="main-content"` is
          placed on the <main> element rendered by each section layout.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-[13px] focus:font-medium focus:text-text focus:ring-2 focus:ring-ring focus:outline-none"
        >
          Skip to content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <LocaleProvider locale={locale} messages={messages}>
            {/* No-op in webapp mode; renders only when window.electronAPI is present. */}
            <UpdateBanner />
            <TooltipProvider>{children}</TooltipProvider>
            {/* Global ⌘K palette — mounts a document-level keybind and an
                overlay dialog. Renders nothing when closed. */}
            <SearchKeybind />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
