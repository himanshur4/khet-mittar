"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, MessageSquare, Sprout, Tractor } from "lucide-react";
import { LANGUAGES, LANGUAGE_IDS } from "@config/languages";
import { useApp } from "./app-context";
import { HealthIndicator } from "./health-indicator";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, language, setLanguage } = useApp();
  const pathname = usePathname();
  const nav = [
    { href: "/", label: t.navChat, icon: MessageSquare },
    { href: "/alerts", label: t.navAlerts, icon: Bell },
    { href: "/profile", label: t.navProfile, icon: Tractor },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Sprout className="size-6 text-primary" aria-hidden />
            <span className="text-lg">KhetMitra</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-muted",
                  pathname === item.href && "bg-accent font-medium text-accent-foreground",
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <HealthIndicator />
            <div className="flex rounded-lg border p-0.5" role="group" aria-label="Language">
              {LANGUAGE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLanguage(id)}
                  aria-pressed={language === id}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-sm",
                    language === id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {LANGUAGES[id].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-20 md:pb-6">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t bg-background md:hidden"
        aria-label="Main"
      >
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-xs",
              pathname === item.href ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-5" aria-hidden />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
