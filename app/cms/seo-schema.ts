import { z } from "zod";

const lstr = (max: number) =>
  z.object({ ar: z.string().max(max).default(""), en: z.string().max(max).default("") }).default({ ar: "", en: "" });

export const seoSchema = z.object({
  title: lstr(120),
  description: lstr(300),
  canonical: z.string().max(500).refine((s) => s === "" || /^https:\/\/[^\s]+$/i.test(s), "canonical must be an absolute https URL").default(""),
  ogTitle: lstr(120),
  ogDescription: lstr(300),
  ogImage: z.string().max(36).refine((s) => s === "" || /^[0-9a-f-]{36}$/i.test(s)).default(""),
  robots: z.enum(["index,follow", "noindex,follow", "noindex,nofollow", "index,nofollow"]).default("index,follow"),
});
export type PageSeo = z.infer<typeof seoSchema>;

export interface SnapshotComponent { id: string; type: string; props: Record<string, unknown>; visible: boolean }
export interface SnapshotSection extends SnapshotComponent { type: "section"; children: SnapshotComponent[] }
export interface PageSnapshot {
  v: 1;
  page: { slug: string; titleAr: string; titleEn: string; seo: PageSeo };
  sections: SnapshotSection[];
}
