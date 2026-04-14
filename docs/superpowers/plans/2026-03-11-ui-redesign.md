# AIComicBuilder UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete UI rewrite with "Modern Dark Cinema" theme — dark immersive design, hybrid navigation, timeline storyboard layout, and global language switcher.

**Architecture:** Replace the existing light-theme orange-gradient UI with a deep dark color system (purple primary, cyan accent, orange CTA). Dashboard keeps top nav; project editor switches to left sidebar + top bar layout. All components get rewritten with new design tokens. No changes to API routes, database, or business logic.

**Tech Stack:** Next.js 16, Tailwind CSS v4, @base-ui/react, shadcn/ui, Lucide icons, next-intl, Zustand

**Spec:** `docs/superpowers/specs/2026-03-11-ui-redesign-design.md`

---

## Chunk 1: Design Foundation (Theme + Base Components)

### Task 1: Rewrite globals.css with dark cinema color system

**Files:**
- Rewrite: `src/app/globals.css`

- [ ] **Step 1: Replace globals.css with new dark cinema theme**

Replace the entire file. The new theme uses hex values for the dark cinema palette. Remove the `.dark` variant since the app is always dark. Keep Tailwind CSS v4 imports and theme inline structure.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-geist-mono);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  /* Dark Cinema Theme - always dark */
  --background: #020203;
  --foreground: #EDEDEF;
  --card: #0a0a0c;
  --card-foreground: #EDEDEF;
  --popover: #0a0a0c;
  --popover-foreground: #EDEDEF;
  --primary: #7C3AED;
  --primary-foreground: #FFFFFF;
  --secondary: #1a1a2e;
  --secondary-foreground: #8A8F98;
  --muted: #272F42;
  --muted-foreground: #8A8F98;
  --accent: #0891B2;
  --accent-foreground: #FFFFFF;
  --destructive: #EF4444;
  --border: rgba(255, 255, 255, 0.08);
  --input: rgba(255, 255, 255, 0.08);
  --ring: rgba(124, 58, 237, 0.5);
  --chart-1: #7C3AED;
  --chart-2: #0891B2;
  --chart-3: #F97316;
  --chart-4: #22C55E;
  --chart-5: #EAB308;
  --radius: 1rem;

  /* Sidebar tokens */
  --sidebar: #020203;
  --sidebar-foreground: #EDEDEF;
  --sidebar-primary: #7C3AED;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: rgba(255, 255, 255, 0.05);
  --sidebar-accent-foreground: #EDEDEF;
  --sidebar-border: rgba(255, 255, 255, 0.08);
  --sidebar-ring: rgba(124, 58, 237, 0.5);

  /* Custom tokens */
  --bg-deep: #020203;
  --bg-base: #050506;
  --bg-elevated: #0a0a0c;
  --bg-surface: rgba(255, 255, 255, 0.05);
  --primary-hover: #6D28D9;
  --primary-glow: rgba(124, 58, 237, 0.2);
  --cta: #F97316;
  --cta-hover: #EA580C;
  --cta-glow: rgba(249, 115, 22, 0.2);
  --success: #22C55E;
  --warning: #EAB308;
  --text-primary: #EDEDEF;
  --text-secondary: #8A8F98;
  --text-muted: #5A5F6B;
  --border-hover: rgba(255, 255, 255, 0.15);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-[--bg-deep] text-foreground antialiased;
  }
  html {
    @apply font-sans;
  }
}
```

- [ ] **Step 2: Verify the app compiles**

Run: `cd /Users/chenhao/codes/myself/AIComicBuilder && npx next build 2>&1 | head -20`
Expected: Build starts without CSS errors

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: replace color system with dark cinema theme"
```

---

### Task 2: Update root and locale layouts with Inter font + dark body

**Files:**
- Rewrite: `src/app/layout.tsx`
- Modify: `src/app/[locale]/layout.tsx`

- [ ] **Step 1: Update root layout to add Inter font import**

```tsx
// src/app/layout.tsx
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

export { inter };
```

Note: We export `inter` so locale layout can use it on `<html>`.

- [ ] **Step 2: Update locale layout to apply Inter + dark class**

```tsx
// src/app/[locale]/layout.tsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Inter } from "next/font/google";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as "zh" | "en" | "ja" | "ko")) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} className={`dark ${inter.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-[--bg-deep] font-sans antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/chenhao/codes/myself/AIComicBuilder && npx next build 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/[locale]/layout.tsx
git commit -m "feat: apply Inter font and dark class to html root"
```

---

### Task 3: Update base UI components for dark theme

**Files:**
- Modify: `src/components/ui/button.tsx` (update CTA variant)
- Modify: `src/components/ui/card.tsx` (dark card styling)
- Modify: `src/components/ui/input.tsx` (dark input)
- Modify: `src/components/ui/textarea.tsx` (dark textarea)
- Modify: `src/components/ui/badge.tsx` (dark badge)
- Modify: `src/components/ui/dialog.tsx` (dark dialog)

- [ ] **Step 1: Add `cta` variant to button.tsx**

Add a new `cta` variant in the `buttonVariants` `variants.variant` object after the `link` variant:

```typescript
cta: "bg-[--cta] text-white font-semibold shadow-[0_0_20px_var(--cta-glow)] hover:bg-[--cta-hover] hover:shadow-[0_0_30px_var(--cta-glow)]",
```

- [ ] **Step 2: Update dialog overlay for darker scrim**

In `src/components/ui/dialog.tsx`, change the DialogOverlay className from:
```
bg-black/10
```
to:
```
bg-black/60
```

And in DialogContent, update the popup className from:
```
bg-background
```
to:
```
bg-[--bg-elevated] border border-[rgba(255,255,255,0.08)]
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/button.tsx src/components/ui/dialog.tsx
git commit -m "feat: add CTA button variant and darken dialog overlay"
```

---

## Chunk 2: Dashboard UI Rewrite

### Task 4: Rewrite dashboard layout with dark header

**Files:**
- Rewrite: `src/app/[locale]/(dashboard)/layout.tsx`

- [ ] **Step 1: Rewrite dashboard layout**

```tsx
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Clapperboard } from "lucide-react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");

  return (
    <div className="min-h-screen bg-[--bg-deep]">
      <header className="border-b border-[--border]">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-[0_0_20px_var(--primary-glow)]">
              <Clapperboard className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-[--text-primary]">
              {t("appName")}
            </h1>
          </div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/(dashboard)/layout.tsx
git commit -m "feat: rewrite dashboard layout with dark cinema header"
```

---

### Task 5: Rewrite project card component

**Files:**
- Rewrite: `src/components/project-card.tsx`

- [ ] **Step 1: Rewrite project card with dark theme**

```tsx
"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ChevronRight } from "lucide-react";

interface ProjectCardProps {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; class: string }> = {
  draft: { label: "draft", class: "bg-[--muted] text-[--text-secondary]" },
  processing: {
    label: "processing",
    class: "bg-[--warning]/15 text-[--warning] animate-pulse",
  },
  completed: { label: "completed", class: "bg-[--success]/15 text-[--success]" },
};

export function ProjectCard({ id, title, status, createdAt }: ProjectCardProps) {
  const t = useTranslations("dashboard.projectStatus");
  const locale = useLocale();
  const config = statusConfig[status] || statusConfig.draft;

  return (
    <Link href={`/${locale}/project/${id}/script`}>
      <div className="group cursor-pointer rounded-2xl border border-[--border] bg-[--bg-elevated] p-5 transition-all duration-200 hover:border-[--border-hover] hover:-translate-y-0.5 hover:shadow-[0_0_30px_var(--primary-glow)]">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <h3 className="text-lg font-semibold text-[--text-primary] group-hover:text-white">
              {title}
            </h3>
            <p className="text-sm text-[--text-muted]">
              {new Date(createdAt).toLocaleDateString()}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${config.class}`}
          >
            {t(status as "draft" | "processing" | "completed")}
          </span>
        </div>
        <div className="mt-4 flex items-center text-sm text-[--text-muted] transition-colors group-hover:text-primary">
          <span className="mr-1">编辑</span>
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/project-card.tsx
git commit -m "feat: rewrite project card with dark cinema styling"
```

---

### Task 6: Rewrite create project dialog

**Files:**
- Rewrite: `src/components/create-project-dialog.tsx`

- [ ] **Step 1: Rewrite create project dialog with dark theme**

```tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Plus, Loader2 } from "lucide-react";

export function CreateProjectDialog() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!title.trim()) return;
    setLoading(true);

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    const project = await res.json();
    setOpen(false);
    setTitle("");
    setLoading(false);
    router.push(`/${locale}/project/${project.id}/script`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="cta" className="rounded-xl px-4 py-2" />
        }
      >
        <Plus className="mr-1.5 h-4 w-4" />
        {t("dashboard.newProject")}
      </DialogTrigger>
      <DialogContent className="rounded-2xl border-[--border] bg-[--bg-elevated]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-[--text-primary]">
            {t("dashboard.newProject")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-medium text-[--text-secondary]">
              {t("project.title")}
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Comic"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="h-10 rounded-xl border-[--border] bg-[--bg-surface] text-[--text-primary] placeholder:text-[--text-muted] focus-visible:border-primary focus-visible:ring-[--ring]"
            />
          </div>
          <Button
            onClick={handleCreate}
            disabled={loading || !title.trim()}
            variant="cta"
            className="w-full rounded-xl py-2.5"
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : null}
            {loading ? t("common.loading") : t("common.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/create-project-dialog.tsx
git commit -m "feat: rewrite create project dialog with dark theme"
```

---

### Task 7: Rewrite dashboard page

**Files:**
- Rewrite: `src/app/[locale]/(dashboard)/page.tsx`

- [ ] **Step 1: Rewrite dashboard page with dark theme + project count subtitle**

```tsx
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ProjectCard } from "@/components/project-card";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { Clapperboard } from "lucide-react";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const allProjects = await db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt));

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-4xl font-bold tracking-tight text-[--text-primary]">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-[--text-muted]">
            {allProjects.length > 0
              ? `${allProjects.length} ${allProjects.length === 1 ? "project" : "projects"}`
              : ""}
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      {allProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 shadow-[0_0_40px_var(--primary-glow)]">
            <Clapperboard className="h-10 w-10 text-primary" />
          </div>
          <h3 className="mb-2 text-xl font-semibold text-[--text-primary]">
            {t("title")}
          </h3>
          <p className="mb-6 max-w-sm text-center text-[--text-secondary]">
            {t("noProjects")}
          </p>
          <CreateProjectDialog />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allProjects.map((project) => (
            <ProjectCard
              key={project.id}
              id={project.id}
              title={project.title}
              status={project.status}
              createdAt={project.createdAt.toISOString()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/(dashboard)/page.tsx
git commit -m "feat: rewrite dashboard page with dark cinema theme"
```

---

## Chunk 3: Project Editor Layout (Sidebar Navigation)

### Task 8: Rewrite project-nav as left sidebar

**Files:**
- Rewrite: `src/components/editor/project-nav.tsx`

- [ ] **Step 1: Rewrite project-nav as vertical sidebar**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { FileText, Users, Film, Play } from "lucide-react";

interface ProjectNavProps {
  projectId: string;
}

const icons = [FileText, Users, Film, Play];

export function ProjectNav({ projectId }: ProjectNavProps) {
  const t = useTranslations("project");
  const locale = useLocale();
  const pathname = usePathname();

  const tabs = [
    { key: "script", href: `/${locale}/project/${projectId}/script`, num: 1 },
    { key: "characters", href: `/${locale}/project/${projectId}/characters`, num: 2 },
    { key: "storyboard", href: `/${locale}/project/${projectId}/storyboard`, num: 3 },
    { key: "preview", href: `/${locale}/project/${projectId}/preview`, num: 4 },
  ] as const;

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden w-56 flex-shrink-0 border-r border-[--border] bg-[--bg-deep] lg:block xl:w-56">
        <div className="flex flex-col gap-1 p-3">
          {tabs.map((tab, i) => {
            const isActive = pathname === tab.href;
            const Icon = icons[i];
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-[--bg-surface] text-[--text-primary]"
                    : "text-[--text-secondary] hover:bg-[--bg-surface] hover:text-[--text-primary]"
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                )}
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition-colors",
                    isActive
                      ? "bg-primary text-white shadow-[0_0_12px_var(--primary-glow)]"
                      : "bg-[--muted] text-[--text-muted] group-hover:bg-primary/20 group-hover:text-primary"
                  )}
                >
                  {tab.num}
                </span>
                <Icon className="h-4 w-4" />
                <span>{t(tab.key)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[--border] bg-[--bg-deep]/95 backdrop-blur-sm lg:hidden">
        <div className="flex items-center justify-around py-2">
          {tabs.map((tab, i) => {
            const isActive = pathname === tab.href;
            const Icon = icons[i];
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-[--text-muted] active:text-[--text-secondary]"
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{t(tab.key)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/editor/project-nav.tsx
git commit -m "feat: rewrite project-nav as left sidebar with mobile bottom tabs"
```

---

### Task 9: Rewrite project editor layout (sidebar + top bar)

**Files:**
- Rewrite: `src/app/[locale]/project/[id]/layout.tsx`

- [ ] **Step 1: Rewrite project layout with sidebar structure**

```tsx
"use client";

import { useEffect, use } from "react";
import { useProjectStore } from "@/stores/project-store";
import { ProjectNav } from "@/components/editor/project-nav";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("common");
  const locale = useLocale();
  const { project, loading, fetchProject } = useProjectStore();

  useEffect(() => {
    fetchProject(id);
  }, [id, fetchProject]);

  if (loading || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[--bg-deep]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[--bg-deep]">
      {/* Top bar */}
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border] px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}`}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[--text-secondary] transition-colors hover:bg-[--bg-surface] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
          <div className="h-5 w-px bg-[--border]" />
          <h1 className="text-base font-semibold text-[--text-primary]">
            {project.title}
          </h1>
        </div>
        <LanguageSwitcher />
      </header>

      {/* Sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <ProjectNav projectId={id} />
        <main className="flex-1 overflow-y-auto bg-[--bg-base] p-6 pb-24 lg:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/project/[id]/layout.tsx
git commit -m "feat: rewrite project layout with sidebar navigation"
```

---

### Task 10: Update language switcher for dark theme

**Files:**
- Rewrite: `src/components/language-switcher.tsx`

- [ ] **Step 1: Rewrite language switcher with dark styling**

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Globe, Check } from "lucide-react";

const localeLabels: Record<string, string> = {
  zh: "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function switchLocale(newLocale: string) {
    const segments = pathname.split("/");
    segments[1] = newLocale;
    router.replace(segments.join("/"));
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-[--border] bg-[--bg-surface] px-3 py-1.5 text-sm font-medium text-[--text-secondary] transition-all hover:border-[--border-hover] hover:text-[--text-primary]"
      >
        <Globe className="h-4 w-4" />
        <span>{localeLabels[locale]}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[160px] overflow-hidden rounded-xl border border-[--border] bg-[--bg-elevated] shadow-xl shadow-black/40">
          {routing.locales.map((loc) => (
            <button
              key={loc}
              onClick={() => switchLocale(loc)}
              className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                loc === locale
                  ? "bg-primary/10 font-semibold text-primary"
                  : "text-[--text-secondary] hover:bg-[--bg-surface] hover:text-[--text-primary]"
              }`}
            >
              <span>{localeLabels[loc]}</span>
              {loc === locale && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/language-switcher.tsx
git commit -m "feat: rewrite language switcher with dark theme and checkmark"
```

---

## Chunk 4: Editor Pages Rewrite

### Task 11: Rewrite script editor

**Files:**
- Rewrite: `src/components/editor/script-editor.tsx`

- [ ] **Step 1: Rewrite script editor with dark theme**

```tsx
"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { useTranslations } from "next-intl";
import { Sparkles, Save, Loader2 } from "lucide-react";

export function ScriptEditor() {
  const t = useTranslations();
  const { project, updateScript, fetchProject } = useProjectStore();
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  if (!project) return null;

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: project.script }),
    });
    setSaving(false);
  }

  async function handleParseScript() {
    if (!project) return;
    setGenerating(true);
    await handleSave();

    await fetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "script_parse" }),
    });

    setGenerating(false);
    const pollInterval = setInterval(() => fetchProject(project.id), 5000);
    setTimeout(() => clearInterval(pollInterval), 120000);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[--text-primary]">
          {t("project.script")}
        </h2>
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            variant="outline"
            disabled={saving}
            className="rounded-xl border-[--border] text-[--text-secondary] hover:bg-[--bg-surface] hover:text-[--text-primary]"
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            {t("common.save")}
          </Button>
          <Button
            onClick={handleParseScript}
            disabled={generating}
            variant="cta"
            className="rounded-xl"
          >
            {generating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            {generating ? t("common.generating") : t("project.parseScript")}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-[--border] bg-[--bg-elevated] p-1">
        <Textarea
          value={project.script}
          onChange={(e) => updateScript(e.target.value)}
          placeholder={t("project.scriptPlaceholder")}
          rows={20}
          disabled={generating}
          className={`min-h-[60vh] rounded-xl border-0 bg-transparent p-4 font-mono text-sm text-[--text-primary] placeholder:text-[--text-muted] focus-visible:ring-0 ${
            generating ? "opacity-50" : ""
          }`}
        />
      </div>

      <p className="text-sm text-[--text-muted]">
        {t("project.scriptPlaceholder")}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/editor/script-editor.tsx
git commit -m "feat: rewrite script editor with dark cinema theme"
```

---

### Task 12: Rewrite character card

**Files:**
- Rewrite: `src/components/editor/character-card.tsx`

- [ ] **Step 1: Rewrite character card with dark theme**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { Sparkles, Loader2 } from "lucide-react";

interface CharacterCardProps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  referenceImage: string | null;
  onUpdate: () => void;
}

export function CharacterCard({
  id,
  projectId,
  name,
  description,
  referenceImage,
  onUpdate,
}: CharacterCardProps) {
  const t = useTranslations();
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description);
  const [generating, setGenerating] = useState(false);

  async function handleSave() {
    await fetch(`/api/projects/${projectId}/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc }),
    });
    onUpdate();
  }

  async function handleGenerateImage() {
    setGenerating(true);
    await fetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "character_image",
        payload: { characterId: id },
      }),
    });
    setGenerating(false);
    setTimeout(onUpdate, 5000);
  }

  return (
    <div className="group overflow-hidden rounded-2xl border border-[--border] bg-[--bg-elevated] transition-all duration-200 hover:border-[--border-hover]">
      {/* Avatar area */}
      <div className="flex items-center justify-center bg-gradient-to-b from-[--bg-surface] to-[--bg-elevated] p-6">
        {referenceImage ? (
          <img
            src={uploadUrl(referenceImage)}
            alt={name}
            className="h-32 w-full rounded-xl object-cover"
          />
        ) : generating ? (
          <div className="h-20 w-20 animate-pulse rounded-xl bg-primary/20" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-primary/15 text-2xl font-bold text-primary shadow-[0_0_20px_var(--primary-glow)]">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="space-y-3 p-4">
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSave}
          className="h-9 rounded-lg border-[--border] bg-[--bg-surface] text-base font-semibold text-[--text-primary] focus-visible:border-primary"
        />
        <Textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          onBlur={handleSave}
          rows={3}
          placeholder={t("character.description")}
          className="rounded-lg border-[--border] bg-[--bg-surface] text-sm text-[--text-secondary] placeholder:text-[--text-muted] focus-visible:border-primary"
        />
        {!referenceImage && (
          <Button
            onClick={handleGenerateImage}
            disabled={generating}
            variant="cta"
            className="w-full rounded-xl"
          >
            {generating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            {generating ? t("common.generating") : t("character.generateImage")}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/editor/character-card.tsx
git commit -m "feat: rewrite character card with dark cinema theme"
```

---

### Task 13: Rewrite characters page

**Files:**
- Rewrite: `src/app/[locale]/project/[id]/characters/page.tsx`

- [ ] **Step 1: Rewrite characters page**

```tsx
"use client";

import { useProjectStore } from "@/stores/project-store";
import { CharacterCard } from "@/components/editor/character-card";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";

export default function CharactersPage() {
  const t = useTranslations("character");
  const { project, fetchProject } = useProjectStore();

  if (!project) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-[--text-primary]">
        {t("name")} ({project.characters.length})
      </h2>

      {project.characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 shadow-[0_0_40px_var(--primary-glow)]">
            <Users className="h-10 w-10 text-primary" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-[--text-primary]">
            {t("name")}
          </h3>
          <p className="max-w-sm text-center text-[--text-secondary]">
            {t("noCharacters")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {project.characters.map((char) => (
            <CharacterCard
              key={char.id}
              id={char.id}
              projectId={project.id}
              name={char.name}
              description={char.description}
              referenceImage={char.referenceImage}
              onUpdate={() => fetchProject(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/project/[id]/characters/page.tsx
git commit -m "feat: rewrite characters page with dark theme"
```

---

### Task 14: Rewrite shot card with timeline layout

**Files:**
- Rewrite: `src/components/editor/shot-card.tsx`

- [ ] **Step 1: Rewrite shot card as horizontal timeline strip**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  VideoIcon,
} from "lucide-react";

interface Dialogue {
  id: string;
  text: string;
  characterName: string;
}

interface ShotCardProps {
  id: string;
  projectId: string;
  sequence: number;
  prompt: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  status: string;
  dialogues: Dialogue[];
  onUpdate: () => void;
}

const statusConfig: Record<string, { class: string }> = {
  pending: { class: "bg-[--muted] text-[--text-muted]" },
  generating: { class: "bg-[--warning]/15 text-[--warning] animate-pulse" },
  completed: { class: "bg-[--success]/15 text-[--success]" },
  failed: { class: "bg-[--destructive]/15 text-[--destructive]" },
};

export function ShotCard({
  id,
  projectId,
  sequence,
  prompt,
  duration,
  firstFrame,
  lastFrame,
  videoUrl,
  status,
  dialogues,
  onUpdate,
}: ShotCardProps) {
  const t = useTranslations();
  const [editPrompt, setEditPrompt] = useState(prompt);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[status] || statusConfig.pending;

  async function handleSave() {
    await fetch(`/api/projects/${projectId}/shots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: editPrompt }),
    });
  }

  async function handleGenerateFrames() {
    setGenerating(true);
    await fetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "frame_generate",
        payload: { shotId: id },
      }),
    });
    setGenerating(false);
    setTimeout(onUpdate, 10000);
  }

  async function handleGenerateVideo() {
    setGenerating(true);
    await fetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "video_generate",
        payload: { shotId: id },
      }),
    });
    setGenerating(false);
    setTimeout(onUpdate, 30000);
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[--border] bg-[--bg-elevated] transition-all duration-200 hover:border-[--border-hover]">
      {/* Timeline strip header */}
      <div className="flex items-center gap-4 p-4">
        {/* Sequence number */}
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-bold text-primary">
          #{sequence}
        </div>

        {/* Media previews */}
        <div className="flex gap-2">
          {firstFrame ? (
            <img
              src={uploadUrl(firstFrame)}
              alt={t("shot.firstFrame")}
              className="h-16 w-24 rounded-lg border border-[--border] object-cover"
            />
          ) : (
            <div className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-[--border] bg-[--bg-surface]">
              <ImageIcon className="h-5 w-5 text-[--text-muted]" />
            </div>
          )}
          {lastFrame ? (
            <img
              src={uploadUrl(lastFrame)}
              alt={t("shot.lastFrame")}
              className="h-16 w-24 rounded-lg border border-[--border] object-cover"
            />
          ) : (
            <div className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-[--border] bg-[--bg-surface]">
              <ImageIcon className="h-5 w-5 text-[--text-muted]" />
            </div>
          )}
          {videoUrl ? (
            <video
              className="h-16 w-24 rounded-lg border border-[--border] object-cover"
              src={uploadUrl(videoUrl)}
            />
          ) : (
            <div className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-[--border] bg-[--bg-surface]">
              <VideoIcon className="h-5 w-5 text-[--text-muted]" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[--text-primary]">{prompt}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-[--text-muted]">{duration}s</span>
            {dialogues.length > 0 && (
              <span className="text-xs text-[--text-muted]">
                {dialogues.length} {t("shot.dialogue")}
              </span>
            )}
          </div>
        </div>

        {/* Status + expand */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${config.class}`}
          >
            {status}
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-lg p-1.5 text-[--text-muted] transition-colors hover:bg-[--bg-surface] hover:text-[--text-primary]"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="space-y-4 border-t border-[--border] p-4">
          {/* Prompt editor */}
          <Textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            onBlur={handleSave}
            rows={3}
            placeholder={t("shot.prompt")}
            className="rounded-xl border-[--border] bg-[--bg-surface] text-sm text-[--text-primary] placeholder:text-[--text-muted] focus-visible:border-primary"
          />

          {/* Dialogues */}
          {dialogues.length > 0 && (
            <div className="space-y-1.5 rounded-xl bg-[--bg-surface] p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[--text-muted]">
                {t("shot.dialogue")}
              </p>
              {dialogues.map((d) => (
                <p key={d.id} className="text-sm">
                  <span className="font-semibold text-primary">
                    {d.characterName}:
                  </span>{" "}
                  <span className="text-[--text-secondary]">{d.text}</span>
                </p>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {!firstFrame && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateFrames}
                disabled={generating}
                className="rounded-lg border-[--border] text-[--text-secondary] hover:bg-[--bg-surface]"
              >
                {generating ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="mr-1 h-3.5 w-3.5" />
                )}
                {generating
                  ? t("common.generating")
                  : t("project.generateFrames")}
              </Button>
            )}
            {firstFrame && lastFrame && !videoUrl && (
              <Button
                size="sm"
                variant="cta"
                onClick={handleGenerateVideo}
                disabled={generating}
                className="rounded-lg"
              >
                {generating ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                )}
                {generating
                  ? t("common.generating")
                  : t("project.generateVideo")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/editor/shot-card.tsx
git commit -m "feat: rewrite shot card as timeline strip with expand/collapse"
```

---

### Task 15: Rewrite storyboard page

**Files:**
- Rewrite: `src/app/[locale]/project/[id]/storyboard/page.tsx`

- [ ] **Step 1: Rewrite storyboard page with dark theme + batch actions**

```tsx
"use client";

import { useProjectStore } from "@/stores/project-store";
import { ShotCard } from "@/components/editor/shot-card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Film, Sparkles, Loader2 } from "lucide-react";

export default function StoryboardPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const [generating, setGenerating] = useState(false);

  if (!project) return null;

  async function handleGenerateShots() {
    if (!project) return;
    setGenerating(true);
    await fetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "shot_split" }),
    });
    setGenerating(false);
    setTimeout(() => fetchProject(project.id), 5000);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[--text-primary]">
          {t("project.storyboard")} ({project.shots.length})
        </h2>
        {project.shots.length === 0 && (
          <Button
            onClick={handleGenerateShots}
            disabled={generating}
            variant="cta"
            className="rounded-xl"
          >
            {generating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            {generating ? t("common.generating") : t("project.generateShots")}
          </Button>
        )}
      </div>

      {project.shots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 shadow-[0_0_40px_var(--primary-glow)]">
            <Film className="h-10 w-10 text-primary" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-[--text-primary]">
            {t("project.storyboard")}
          </h3>
          <p className="max-w-sm text-center text-[--text-secondary]">
            {t("shot.noShots")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {project.shots.map((shot) => (
            <ShotCard
              key={shot.id}
              id={shot.id}
              projectId={project.id}
              sequence={shot.sequence}
              prompt={shot.prompt}
              duration={shot.duration}
              firstFrame={shot.firstFrame}
              lastFrame={shot.lastFrame}
              videoUrl={shot.videoUrl}
              status={shot.status}
              dialogues={shot.dialogues || []}
              onUpdate={() => fetchProject(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/project/[id]/storyboard/page.tsx
git commit -m "feat: rewrite storyboard page with dark theme"
```

---

### Task 16: Rewrite preview page with video player + thumbnail timeline

**Files:**
- Rewrite: `src/app/[locale]/project/[id]/preview/page.tsx`

- [ ] **Step 1: Rewrite preview page**

```tsx
"use client";

import { useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import {
  Sparkles,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function PreviewPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const [assembling, setAssembling] = useState(false);
  const [selectedShot, setSelectedShot] = useState(0);

  if (!project) return null;

  const shotsWithVideo = project.shots.filter((s) => s.videoUrl);
  const allShotsHaveVideo = project.shots.every((s) => s.videoUrl);
  const completedVideos = shotsWithVideo.length;
  const currentShot = shotsWithVideo[selectedShot];

  async function handleAssemble() {
    if (!project) return;
    setAssembling(true);
    await fetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "video_assemble" }),
    });
    setAssembling(false);
    setTimeout(() => fetchProject(project.id), 10000);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[--text-primary]">
          {t("project.preview")}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[--text-muted]">
            {t("project.shotsCompleted", {
              completed: completedVideos,
              total: project.shots.length,
            })}
          </span>
          <Button
            onClick={handleAssemble}
            disabled={!allShotsHaveVideo || assembling}
            variant="cta"
            className="rounded-xl"
          >
            {assembling ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            {assembling ? t("common.generating") : t("project.assembleVideo")}
          </Button>
        </div>
      </div>

      {/* Video player */}
      {shotsWithVideo.length > 0 && currentShot ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-[--border] bg-black">
            <video
              key={currentShot.id}
              controls
              autoPlay
              className="aspect-video w-full"
              src={uploadUrl(currentShot.videoUrl!)}
            />
          </div>

          {/* Shot navigation */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() =>
                setSelectedShot(Math.max(0, selectedShot - 1))
              }
              disabled={selectedShot === 0}
              className="rounded-lg p-2 text-[--text-muted] transition-colors hover:bg-[--bg-surface] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium text-[--text-secondary]">
              {t("shot.sequence", { number: currentShot.sequence })} /{" "}
              {shotsWithVideo.length}
            </span>
            <button
              onClick={() =>
                setSelectedShot(
                  Math.min(shotsWithVideo.length - 1, selectedShot + 1)
                )
              }
              disabled={selectedShot === shotsWithVideo.length - 1}
              className="rounded-lg p-2 text-[--text-muted] transition-colors hover:bg-[--bg-surface] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Thumbnail timeline */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {shotsWithVideo.map((shot, i) => (
              <button
                key={shot.id}
                onClick={() => setSelectedShot(i)}
                className={cn(
                  "flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all",
                  i === selectedShot
                    ? "border-primary shadow-[0_0_12px_var(--primary-glow)]"
                    : "border-[--border] hover:border-[--border-hover]"
                )}
              >
                <div className="relative h-16 w-24">
                  {shot.firstFrame ? (
                    <img
                      src={uploadUrl(shot.firstFrame)}
                      alt={`Shot ${shot.sequence}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[--bg-surface]">
                      <Play className="h-4 w-4 text-[--text-muted]" />
                    </div>
                  )}
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    #{shot.sequence}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 shadow-[0_0_40px_var(--primary-glow)]">
            <Play className="h-10 w-10 text-primary" />
          </div>
          <p className="max-w-sm text-center text-[--text-secondary]">
            {t("shot.noShots")}
          </p>
        </div>
      )}

      {/* Final video */}
      {project.status === "completed" && (
        <div className="border-t border-[--border] pt-6">
          <h3 className="mb-4 text-lg font-bold text-[--text-primary]">
            {t("project.finalVideo")}
          </h3>
          <p className="text-sm text-[--text-secondary]">
            {t("project.finalVideoHint")}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/project/[id]/preview/page.tsx
git commit -m "feat: rewrite preview page with video player and thumbnail timeline"
```

---

## Chunk 5: Script Page Wrapper + Final Verification

### Task 17: Update script page wrapper (no change needed, just verify)

**Files:**
- Verify: `src/app/[locale]/project/[id]/script/page.tsx`

The script page is a simple wrapper that renders `<ScriptEditor />`. No changes needed.

- [ ] **Step 1: Verify all pages build successfully**

Run: `cd /Users/chenhao/codes/myself/AIComicBuilder && npx next build 2>&1 | tail -30`
Expected: Build succeeds with no errors

- [ ] **Step 2: Start dev server and visually verify**

Run: `cd /Users/chenhao/codes/myself/AIComicBuilder && npx next dev`
Expected: Dark cinema theme visible on all pages

- [ ] **Step 3: Final commit for any remaining fixes**

```bash
git add -A
git commit -m "feat: complete UI redesign with dark cinema theme"
```
