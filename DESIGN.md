---
name: "Staaash"
description: "Open-source, self-hosted file drive with owned storage, clear recovery, and calm file work."
colors:
  background: "oklch(0.982 0.006 78)"
  foreground: "oklch(0.21 0.015 72)"
  card: "oklch(0.992 0.004 78)"
  card-foreground: "oklch(0.22 0.015 72)"
  popover: "oklch(0.992 0.004 78)"
  primary: "oklch(0.48 0.09 78)"
  primary-foreground: "oklch(0.98 0.004 78)"
  secondary: "oklch(0.955 0.007 78)"
  muted: "oklch(0.965 0.006 78)"
  muted-foreground: "oklch(0.48 0.014 72)"
  accent: "oklch(0.95 0.01 78)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.9 0.009 78)"
  input: "oklch(0.9 0.009 78)"
  ring: "oklch(0.68 0.06 80)"
  sidebar: "oklch(0.975 0.006 78)"
  dark-background: "oklch(0.12 0.008 70)"
  dark-foreground: "oklch(0.95 0.008 78)"
  dark-card: "oklch(0.18 0.01 72)"
  dark-popover: "oklch(0.23 0.012 72)"
  dark-primary: "oklch(0.74 0.08 78)"
  dark-border: "oklch(0.38 0.014 76 / 0.55)"
typography:
  display:
    fontFamily: "var(--font-cabinet), sans-serif"
    fontSize: "clamp(2.6rem, 5.5vw, 5rem)"
    fontWeight: 400
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "var(--font-cabinet), sans-serif"
    fontSize: "1.45rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "0"
  title:
    fontFamily: "var(--font-cabinet), sans-serif"
    fontSize: "1.05rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "var(--font-switzer), Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "var(--font-switzer), Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.04em"
  mono:
    fontFamily: "var(--font-jetbrains-mono), monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  panel: "20px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  page-x: "32px"
  page-y: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.xl}"
    padding: "0 18px"
    height: "44px"
    typography: "{typography.body}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "0 18px"
    height: "44px"
    typography: "{typography.body}"
  input-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "12px 14px"
    height: "44px"
    typography: "{typography.body}"
  nav-link-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
    typography: "{typography.body}"
  panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.panel}"
    padding: "24px"
  chip:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
    typography: "{typography.label}"
---

# Design System: Staaash

## 1. Overview

**Creative North Star: "The Owned Drive"**

Staaash should feel like a dependable file drive that happens to be open source, not a developer console with a file list attached. The visual system is calm, practical, and self-owned: warm neutral surfaces, bronze actions, compact navigation, flat rows, and direct status language. It should make install, upload, share, restore, upgrade, and admin health feel understandable.

The workspace is light-first and task-focused. Dark surfaces appear where the product asks for attention, such as entry, onboarding, public share locks, and explicit dark preference. The interface should not chase cloud-service gloss. It should feel release-ready through clarity, not decoration.

This system rejects Nextcloud-style clutter, generic SaaS polish, vague commercial-cloud hiding of ownership and backup risk, homelab hostility, and platform-sprawl aesthetics.

**Key Characteristics:**

- Warm light workspace with bronze actions and calm dark alternatives.
- Flat lists and rows by default, with borders and tonal fills doing most hierarchy work.
- Cabinet Grotesk for brand and page titles, Switzer for dense product UI.
- Compact controls, visible focus, restrained motion, and no decorative blur.
- Owner/admin states are operational, explicit, and scan-friendly.

## 2. Colors

The palette is a warm neutral system with a low-noise bronze primary. OKLCH is canonical in the codebase.

### Primary

- **Owned Bronze** (`primary`): Used for primary actions, active navigation, progress fills, focus-adjacent emphasis, and selected state accents. It should stay rare enough to mean action or selection.
- **Light Bronze Ink** (`primary-foreground`): Text on primary controls in light mode.
- **Entry Brass** (`dark-primary`): Dark-mode and entry-surface accent. It is brighter because the deep bronze-charcoal surface needs more lift.

### Secondary

- **Quiet Control Fill** (`secondary`): Low-priority buttons and control surfaces. It should support the primary action, not compete with it.

### Neutral

- **Warm Workspace Base** (`background`): Main workspace background. Keep it clean and open.
- **File Surface** (`card`): Major panels, popovers, cards, dialogs, and row containers that need a defined surface.
- **Soft Muted Layer** (`muted`): Gentle fills, empty states, filters, and inactive controls.
- **Bronze Sidebar Layer** (`sidebar`): Sidebar and shell chrome, slightly distinct from the content background.
- **Readable Ink** (`foreground`): Primary body and UI text.
- **Quiet Metadata Ink** (`muted-foreground`): Metadata, helper copy, and tertiary labels. Do not use it for essential warnings.
- **Line Neutral** (`border`): Dividers and borders. Most structure comes from this token plus whitespace.
- **Focus Bronze** (`ring`): Focus rings and focus-adjacent glows.
- **Deep Entry Charcoal** (`dark-background`): Entry, onboarding, and dark-mode app background.
- **Dark Surface** (`dark-card`, `dark-popover`): Dark cards, sheets, modals, and popovers.
- **Destructive Red** (`destructive`): Trash, revoke, delete, failure, and broken-state actions.

### Named Rules

**The Accent Means Action Rule.** Bronze is for primary actions, active state, focus, progress, and selected state. Do not use it as decoration.

**The Warm Neutral Rule.** Warm neutrals are structural, not nostalgic. They make the file content readable and owned, not paper-themed or cute.

**The Honest Red Rule.** Destructive red appears only when an action or state can harm, block, or permanently remove something.

## 3. Typography

**Display Font:** Cabinet Grotesk (`var(--font-cabinet), sans-serif`)
**Body Font:** Switzer (`var(--font-switzer), "Segoe UI", sans-serif`)
**Label/Mono Font:** JetBrains Mono (`var(--font-jetbrains-mono), monospace`) only for IDs, URLs, checksums, code, and technical values.

**Character:** Cabinet gives Staaash a recognizable, self-owned wordmark and page-title voice. Switzer keeps dense file and admin UI readable without becoming enterprise-gray.

### Hierarchy

- **Display** (400, `clamp(2.6rem, 5.5vw, 5rem)`, 1.06): Entry and onboarding moments only. Not for workspace panels or admin pages.
- **Headline** (500, `1.45rem`, 1.15): Workspace page titles, breadcrumbs, and primary content headings.
- **Title** (650, `1.05rem`, 1.2): Bottom sheets, dialogs, compact panel titles, and admin operation names.
- **Body** (400 to 600, `0.8125rem` to `0.9375rem`, 1.4 to 1.6): File rows, settings, admin content, helper copy, and table-like surfaces.
- **Label** (600 to 700, `0.625rem` to `0.75rem`, letter-spaced only when short): Section labels, sidebar groups, status metadata, and compact admin labels.
- **Mono** (400 to 600, `0.6875rem` to `0.75rem`, 1.4): IDs, URLs, checksums, code, archive IDs, and technical values.

### Named Rules

**The Product Type Rule.** Workspace and admin UI use fixed rem sizes. Fluid type belongs to entry/onboarding moments, not file lists, buttons, or settings.

**The Label Restraint Rule.** Uppercase labels are allowed only for short structural labels. Never use uppercase body copy.

## 4. Elevation

Staaash is flat by default. Depth comes from tonal surfaces, 1px borders, separators, sticky panels, and hover fills. Shadows are reserved for overlays, temporary panels, mobile selection bars, and panels that must sit above content.

### Shadow Vocabulary

- **Panel Shadow** (`0 16px 40px color-mix(in oklab, var(--foreground) 8%, transparent)`): Major panels and shortcut legend style overlays.
- **Dialog Shadow** (`0 4px 8px ... 5%, 0 16px 36px ... 12%`): Share dialog and modal surfaces.
- **Floating Transfer Shadow** (`0 4px 16px color-mix(in oklab, var(--foreground) 12%, transparent)`): Persistent transfer panel.
- **Selection Bar Shadow** (`0 10px 26px color-mix(in oklab, var(--foreground) 16%, transparent)`): Mobile selection affordance.
- **Properties Rail Shadow** (`-12px 0 40px color-mix(in oklab, var(--foreground) 8%, transparent)`): Right-side properties panel only.

### Named Rules

**The Flat-Until-Lifted Rule.** Lists, nav, rows, and page sections are flat at rest. Use tonal hover and border changes first; use shadow only when the object floats over the page.

**The No Glass Rule.** Decorative blur and glassmorphism are forbidden. Dialog overlays use tint, not blur.

## 5. Components

### Buttons

- **Shape:** Gently rounded product controls (`14px` for classic `.button`, shadcn rounded `4xl` for primitive buttons, `8px` to `10px` for compact row actions).
- **Primary:** Owned Bronze background with light text, minimum `44px` height in classic buttons, `9px` to `10px` height variants in shadcn primitives.
- **Hover / Focus:** Hover changes fill or text color only. Focus uses a 2px outline or `ring` tint. Active may translate down 1px in primitive buttons.
- **Secondary / Ghost:** Secondary fills are tonal and quiet. Ghost controls appear in topbars, row actions, and popovers, with subtle hover fills.
- **Destructive:** Red-tinted backgrounds and red text for delete, revoke, trash, and sign out. Never make destructive actions look like primary bronze actions.

### Chips

- **Style:** Pill radius (`999px`), compact padding, primary-tinted fill, and metadata-scale type.
- **State:** Status chips use semantic status color names and tight labels. Filter pills use selected-state fill, not heavy shadow.

### Cards / Containers

- **Corner Style:** Major panels use `14px` to `20px`. Repeated file rows and list items should not become cards.
- **Background:** `card`, `popover`, or color-mixed warm neutral surfaces.
- **Shadow Strategy:** Flat by default; use shadow only for overlays and floating panels.
- **Border:** 1px borders are normal. Colored side stripes are prohibited.
- **Internal Padding:** Major panels use `24px`; compact admin rows use `10px` to `18px`; file rows stay dense.

### Inputs / Fields

- **Style:** Rounded controls (`8px` to `14px`) with subtle borders and warm neutral fill.
- **Focus:** Focus uses the `ring` token through outline, border-color, or a small 2px to 3px halo.
- **Error / Disabled:** Errors use destructive tint and border. Disabled controls keep layout but drop opacity and cursor affordance.

### Navigation

The workspace shell uses a quiet left sidebar on desktop, a compact topbar search, and a bottom navigation plus bottom sheets on mobile. Active nav is bronze-tinted, inactive nav is muted, hover is tonal. Mobile actions use minimum `44px` touch targets and bottom-sheet grouping.

### File Rows

Rows are the core workspace component. They should feel like file-system rows, not cards: icon, name, metadata, state badges, and actions aligned for scanning. Hover and selected state use tonal fills. Selection and action affordances must not cover file metadata.

### Share Dialog

Share management is compact, bordered, and explicit. URLs use JetBrains Mono. Expiry, password, download disabling, copy, revoke, and public state must be visible without marketing language. The dialog can float because it interrupts normal file work.

### Admin Surfaces

Admin pages use flat strips, lists, tables, status chips, and operational labels. They should look slightly more authoritative than workspace pages without becoming a separate brand. Health, jobs, storage, updates, invites, users, and media previews should be scan-first.

### Mobile Bottom Sheets

Bottom sheets use `18px 18px 0 0` radius, no shadow, no blur, a visible drag handle, and clean grouped actions. They are functional replacements for desktop popovers and row menus, not decorative modals.

## 6. Do's and Don'ts

### Do:

- **Do** keep file content, filenames, metadata, and status more prominent than chrome.
- **Do** use warm neutral surfaces and 1px borders for hierarchy before adding shadow.
- **Do** reserve Owned Bronze for action, active state, focus, selected state, and progress.
- **Do** keep mobile and tablet actions complete: upload, navigation, selection, action sheets, sharing, and recovery all need coarse-pointer behavior.
- **Do** make admin health and beta-risk states explicit with direct labels and status chips.
- **Do** keep focus visible with the `ring` token and at least a 2px outline or halo.
- **Do** use Cabinet Grotesk for Staaash identity and page titles, then return to Switzer for dense task UI.

### Don't:

- **Don't** make Staaash feel like Nextcloud Files at its worst: crowded, gray, chrome-heavy, and hard to scan.
- **Don't** use generic SaaS productivity polish where operational clarity is needed.
- **Don't** hide ownership, storage, backup, restore, or upgrade risk behind vague commercial-cloud status text.
- **Don't** create a homelab tool that treats confusing setup, vague errors, or missing recovery guidance as acceptable because the user is technical.
- **Don't** imply platform scope before the core drive is dependable. Microservices, desktop sync, native mobile, S3-compatible storage, and complex collaboration permissions are not v1 default visual assumptions.
- **Don't** turn repeated rows into cards. Use flat rows, separators, and hover states.
- **Don't** use glassmorphism, decorative blur, gradient text, colored side stripes, oversized shadows, or ornamental motion.
- **Don't** put destructive actions in bronze or hide them behind ambiguous labels.
