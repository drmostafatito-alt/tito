import type { ReactNode } from "react";

/**
 * Admin information-architecture (Phase 1 admin shell).
 *
 * Central nav model shared by the desktop sidebar and the mobile drawer so the
 * two can never drift. Every destination points at an EXISTING route — Phase 1
 * regroups the current admin into sections; deeper module splits land in later
 * phases on top of these same hubs. Labels are i18n keys resolved via `t()`.
 */

export type AdminIconName =
  | "dashboard"
  | "content"
  | "video"
  | "media"
  | "assessment"
  | "assignment"
  | "search"
  | "users"
  | "entitlements"
  | "commerce"
  | "pages"
  | "announcements"
  | "analytics"
  | "security"
  | "audit"
  | "appearance"
  | "logo";

const PATHS: Record<AdminIconName, ReactNode> = {
  logo: (
    <>
      <path d="M22 10 12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  content: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m16 10 6-3v10l-6-3" />
    </>
  ),
  media: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  assessment: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  entitlements: (
    <>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  assignment: (
    <>
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M4 4v16h16" />
      <path d="M8 10h7" />
      <path d="M8 14h5" />
    </>
  ),
  commerce: (
    <>
      <path d="M6 6h15l-1.5 9h-12z" />
      <path d="M6 6 5 2H2" />
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
    </>
  ),
  pages: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </>
  ),
  announcements: (
    <>
      <path d="M14 3v14" />
      <path d="M14 17c-4 0-8 1-10 2v-6c2-1 6-2 10-2" />
      <path d="M14 20c2 0 3-2 3-5" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="5" />
      <rect x="12" y="8" width="3" height="9" />
      <rect x="17" y="5" width="3" height="12" />
    </>
  ),
  security: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  audit: (
    <>
      <path d="M12 8v4l3 3" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  appearance: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9c0-.5 0-1-.1-1.5" />
      <circle cx="7.5" cy="10.5" r="1.2" />
      <circle cx="12" cy="7.5" r="1.2" />
      <circle cx="16.5" cy="10" r="1.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
};

export function AdminIcon({ name, className = "h-5 w-5" }: { name: AdminIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export interface NavItem {
  /** Existing admin route (or route+query) this links to. */
  to: string;
  /** i18n key under the `nav` dictionary. */
  labelKey: string;
  /** Icon name. */
  icon: AdminIconName;
  /** Exact match only (e.g. the dashboard index route). */
  end?: boolean;
}

export interface NavSection {
  id: string;
  /** i18n key for the section heading. */
  labelKey: string;
  items: NavItem[];
}

export const ADMIN_NAV_SECTIONS: NavSection[] = [
  {
    id: "main",
    labelKey: "nav.section_main",
    items: [
      { to: "/admin", labelKey: "nav.dashboard", icon: "dashboard", end: true },
      { to: "/admin/search", labelKey: "nav.search", icon: "search" },
    ],
  },
  {
    id: "learning",
    labelKey: "nav.section_learning",
    items: [
      { to: "/admin/content", labelKey: "nav.content", icon: "content" },
      { to: "/admin/videos", labelKey: "nav.videos", icon: "video" },
      { to: "/admin/files", labelKey: "nav.media", icon: "media" },
    ],
  },
  {
    id: "assessment",
    labelKey: "nav.section_assessment",
    items: [
      { to: "/admin/assessment", labelKey: "nav.assessment", icon: "assessment" },
      { to: "/admin/assignments", labelKey: "nav.assignments", icon: "assignment" },
    ],
  },
  {
    id: "students",
    labelKey: "nav.section_students",
    items: [
      { to: "/admin/users", labelKey: "nav.users", icon: "users" },
      { to: "/admin/teachers", labelKey: "nav.teachers", icon: "users" },
      { to: "/admin/entitlements", labelKey: "nav.entitlements", icon: "entitlements" },
    ],
  },
  {
    id: "sales",
    labelKey: "nav.section_sales",
    items: [{ to: "/admin/commerce", labelKey: "nav.commerce", icon: "commerce" }],
  },
  {
    id: "website",
    labelKey: "nav.section_website",
    items: [{ to: "/admin/cms", labelKey: "nav.pages", icon: "pages" }],
  },
  {
    id: "communication",
    labelKey: "nav.section_communication",
    items: [{ to: "/admin/announcements", labelKey: "nav.announcements", icon: "announcements" }],
  },
  {
    id: "analytics",
    labelKey: "nav.section_analytics",
    items: [{ to: "/admin/analytics", labelKey: "nav.analytics", icon: "analytics" }],
  },
  {
    id: "administration",
    labelKey: "nav.section_administration",
    items: [
      { to: "/admin/security", labelKey: "nav.security", icon: "security" },
      { to: "/admin/audit", labelKey: "nav.audit", icon: "audit" },
    ],
  },
  {
    id: "settings",
    labelKey: "nav.section_settings",
    items: [{ to: "/admin/appearance", labelKey: "nav.appearance", icon: "appearance" }],
  },
];

/**
 * Minimal authoring-only navigation shown to a teacher (rank 2) admitted into
 * the question-bank area. A teacher holding assessment.* authoring permissions
 * only ever sees the question bank & exams hub — never users/sales/CMS/etc.
 */
export const TEACHER_NAV_SECTIONS: NavSection[] = [
  {
    id: "assessment",
    labelKey: "nav.section_assessment",
    items: [{ to: "/admin/assessment", labelKey: "nav.assessment", icon: "assessment" }],
  },
];

/** Pathname prefixes that share a nav destination with a hub route. */
const DETAIL_PREFIX: Array<{ prefix: string; hub: string }> = [
  { prefix: "/admin/content/", hub: "/admin/content" },
  { prefix: "/admin/cms/", hub: "/admin/cms" },
  { prefix: "/admin/assessment/", hub: "/admin/assessment" },
  { prefix: "/admin/assignments/", hub: "/admin/assignments" },
  { prefix: "/admin/students/", hub: "/admin/users" },
  { prefix: "/admin/users/", hub: "/admin/users" },
  { prefix: "/admin/commerce/", hub: "/admin/commerce" },
];

/** Resolve which nav item a pathname belongs to (used for breadcrumbs / title). */
export function resolveNavItem(pathname: string): { item: NavItem; section: NavSection } | null {
  let effective = pathname;
  for (const d of DETAIL_PREFIX) {
    if (pathname.startsWith(d.prefix)) {
      effective = d.hub;
      break;
    }
  }
  if (effective === "/admin" || effective === "/admin/") return null; // dashboard handled separately
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      const itemPath = item.to.split("?")[0];
      if (effective === itemPath || effective.startsWith(itemPath.endsWith("/") ? itemPath : itemPath + "/")) {
        return { item, section };
      }
    }
  }
  return null;
}
