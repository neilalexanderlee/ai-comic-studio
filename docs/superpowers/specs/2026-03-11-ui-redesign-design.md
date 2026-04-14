# AIComicBuilder UI Redesign - Design Spec

**Date:** 2026-03-11
**Style:** Modern Dark Cinema ("暗影影院")
**Approach:** Complete UI rewrite with dark immersive theme

## 1. Design Decisions

- **Style:** Dark immersive, similar to Runway/Midjourney professional AI creative tools
- **Navigation:** Hybrid — top header for dashboard, left sidebar + top bar for project editor
- **Language switcher:** Always visible in top-right corner across all pages
- **Shot layout:** Timeline/kanban-style horizontal strips instead of grid cards
- **Typography:** Inter single-family system with weight/tracking hierarchy

## 2. Color System

### Background Layers
| Token | Value | Usage |
|---|---|---|
| `--bg-deep` | `#020203` | Page base layer |
| `--bg-base` | `#050506` | Main content area |
| `--bg-elevated` | `#0a0a0c` | Cards, panels |
| `--bg-surface` | `rgba(255,255,255,0.05)` | Hover surface |

### Brand Colors
| Token | Value | Usage |
|---|---|---|
| `--primary` | `#7C3AED` | Brand (buttons, active tabs) |
| `--primary-hover` | `#6D28D9` | Primary hover |
| `--primary-glow` | `rgba(124,58,237,0.2)` | Button glow |
| `--accent` | `#0891B2` | Secondary accent (progress, links) |
| `--cta` | `#F97316` | Call to action (generate, publish) |
| `--cta-hover` | `#EA580C` | CTA hover |

### Semantic Colors
| Token | Value | Usage |
|---|---|---|
| `--success` | `#22C55E` | Completed state |
| `--warning` | `#EAB308` | In progress |
| `--destructive` | `#EF4444` | Delete, error |
| `--muted` | `#272F42` | Inactive areas |

### Text Colors
| Token | Value | Contrast |
|---|---|---|
| `--text-primary` | `#EDEDEF` | 15:1 (AAA) |
| `--text-secondary` | `#8A8F98` | 5.2:1 (AA) |
| `--text-muted` | `#5A5F6B` | 3.2:1 (large text only) |

### Border & Outline
| Token | Value |
|---|---|
| `--border` | `rgba(255,255,255,0.08)` |
| `--border-hover` | `rgba(255,255,255,0.15)` |
| `--ring` | `rgba(124,58,237,0.5)` |

### Radius
- Cards: 16px
- Buttons/Inputs: 12px
- Badges: 8px

## 3. Typography

**Font stack:** `'Inter', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', system-ui, sans-serif`

| Level | Size | Weight | Tracking | Usage |
|---|---|---|---|---|
| Display | 36px | 700 | -0.02em | Dashboard title |
| H1 | 28px | 700 | -0.015em | Page titles |
| H2 | 22px | 600 | -0.01em | Section titles |
| H3 | 18px | 600 | 0 | Card titles |
| Body | 15px | 400 | 0 | Body text |
| Body Small | 13px | 400 | 0.01em | Helper text |
| Label | 12px | 500 | 0.05em | Badges (uppercase EN) |
| Mono | 14px | 400 | 0 | Sequence numbers |

Line heights: headings 1.2, body 1.6, compact 1.4.
CJK text: no negative letter-spacing.

## 4. Navigation & Layout

### Dashboard (Project List)
- Top nav bar: h-16, bg-deep, logo left, language switcher + "New" button right
- Content: Display title + project count subtitle
- Grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, last card can be "+New" placeholder
- Card hover: border brightness up + translateY(-2px)
- Status badges: Draft(muted), Processing(warning+pulse), Completed(success)
- Empty state: centered icon + heading + CTA button

### Project Editor
- Top bar: h-14, back button left, project title center, language switcher + menu right
- Left sidebar: w-56, bg-deep, 4 nav items with icons + text
  - Active item: 3px left purple indicator + bg-surface
  - Steps: number dots — completed=success, current=primary, pending=muted
- Main content area: bg-base, padded
- Bottom progress bar: linear progress + step text + "Next" button
- Responsive:
  - >=1280px: full layout
  - 1024-1279px: sidebar collapses to icon-only w-16
  - <1024px: sidebar becomes bottom tab bar (4 icons), bottom progress hidden

### Language Switcher (Global)
- Position: top-right, always visible on all pages
- Display: current language text + dropdown arrow
- Dropdown: language names in native script (中文/English/日本語/한국어)
- Current item: checkmark + primary color highlight
- URL updates without page reload (next-intl)

## 5. Page Designs

### 5.1 Script Editor
- Large textarea: min-h-[60vh], bg-elevated, monospace optional
- Top actions: Save (secondary) + "AI Parse" (CTA orange with glow)
- Parsing state: button shows spinner + "Parsing...", textarea becomes read-only with reduced opacity
- Completion: toast notification + auto-navigate to Characters page
- Helper text below textarea with usage tip

### 5.2 Characters Page
- Grid: `grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
- Card: avatar area (square rounded) + name + description + action button
- No avatar: show initial letter on gradient background
- Name/description: inline-editable (click to edit)
- "Generate Image" button: primary color, generating shows skeleton shimmer on avatar
- Generated avatar: click to enlarge preview

### 5.3 Storyboard (Timeline Layout)
- Each shot is a horizontal strip, sequence number on left vertical line
- Strip contents: first-frame | last-frame | video preview | text info (prompt, duration, dialogue)
- Empty previews: dashed border + "click to generate" placeholder
- Status badge top-right: pending(muted) → generating(warning+pulse) → completed(success) → failed(destructive)
- Expandable: compact by default, click to expand for editing prompt/dialogue
- Batch actions toolbar at top: "Generate Shots" / "Batch Generate Frames" / "Batch Generate Videos"

### 5.4 Preview Page
- Large video player: centered, 16:9 aspect ratio, dark background
- Shot navigation: prev/next buttons + "Shot 3/12" indicator
- Thumbnail timeline: horizontal scroll, selected item has purple border
- "Assemble Final Video" CTA button (orange)
- Assembly progress: progress bar + percentage + estimated time

## 6. Interaction & Animation

### Transitions
- Page content: fade + translateY(8px), 200ms, ease-out
- Sidebar toggle: width transition 300ms, cubic-bezier(0.16, 1, 0.3, 1)

### Micro-interactions
- Button hover: background transition 150ms
- CTA hover: glow expansion (box-shadow)
- Card hover: border brightness + translateY(-2px) 200ms
- Tab indicator: slide transition 200ms

### Loading States
- Skeleton: shimmer animation on bg-elevated (left-to-right gradient sweep)
- AI generating: pulse animation (opacity 0.5↔1.0, 1.5s cycle) + progress text
- Button loading: spinner icon replaces text, button disabled

### Feedback
- Success: green toast slides in from top-right, auto-dismiss 3s
- Error: red toast + retry button, manual dismiss
- Generation complete: card border flashes success green once

### Accessibility
- All animations respect `prefers-reduced-motion`
- Focus ring: 2px --ring color, offset 2px
- Keyboard: Tab traverses all interactive elements, Enter/Space activates
- Touch targets: minimum 44x44px
