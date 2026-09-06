import type { LStr } from "./l10n";

/**
 * View-models handed from the page loader to the CMS renderers.
 * CONTENT vs PRESENTATION separation (owner brief): resolvers in
 * server/cms/render.server.ts merge content rows with the admin presentation
 * settings into these neutral shapes — renderer components contain structure
 * only and never query data or make access decisions.
 */

export interface CardView {
  id: string;
  href: string;                    // internal link (always authorized at the target route)
  title: LStr;
  desc: LStr;
  image: string | null;            // fileId (resolved through ctx.images; missing → omitted)
  badge: LStr | null;
  meta: LStr | null;               // composed per presentation toggles (teacher/lesson count/…)
  cta: LStr | null;
}

export interface FormFieldView {
  name: string;
  type: string;
  label: LStr;
  placeholder: LStr;
  help: LStr;
  required: boolean;
  options: Array<{ value: string; label: LStr }>;
}

export interface FormView {
  slug: string;
  title: LStr;
  fields: FormFieldView[];
  consentRequired: boolean;
  consent: LStr;
  success: LStr;
  failure: LStr;
}

export interface FormResultView {
  ok: boolean;
  errors: Record<string, string>;
}

export interface IdentityView {
  platformName: LStr;
  shortName: LStr;
  tagline: LStr;
  ownerName: LStr;
  ownerTitle: LStr;
  ownerPhoto: string | null;       // resolved URL or null (never a placeholder)
  logo: string | null;
  contactPhone: string;
  contactEmail: string;
  contactAddress: LStr;
  whatsapp: string;                // digits or ""
  telegram: string;                // https URL or ""
  socials: Array<{ network: string; url: string; labelAr?: string; labelEn?: string; showHeader?: boolean; showFooter?: boolean; showHome?: boolean; showContact?: boolean }>;
  copyright: LStr;
}

export interface CmsRenderCtx {
  locale: "ar" | "en";
  /** fileId → public URL (only existing PUBLIC files; missing entries → element omitted). */
  images: Record<string, string>;
  /** blockId → resolved card rows (dynamic blocks only). */
  dynamic: Record<string, CardView[]>;
  /** formSlug → definition (only forms referenced by blocks on this page). */
  forms: Record<string, FormView>;
  /** actionData feedback for form submissions on this page. */
  formResults: Record<string, FormResultView>;
  identity: IdentityView;
  now: number;
}
