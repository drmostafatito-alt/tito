import type { Route } from "./+types/admin.content";
import { Form, Link, useActionData, useLoaderData, useRouteLoaderData, useNavigation } from "react-router";
import { z } from "zod";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { adminTree, createProgram, type AdminTreeNode } from "~server/content/service.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, type Locale } from "~/lib/i18n";

/** Admin content tree: full hierarchy, create programs, jump to node editors. */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const tree = await adminTree(db);
  return { tree };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  if (intent === "create-program") {
    const parsed = z
      .object({
        titleAr: z.string().trim().min(1).max(200),
        titleEn: z.string().trim().min(1).max(200),
        status: z.enum(["draft", "published"]).catch("draft"),
      })
      .safeParse({
        titleAr: form.get("titleAr"),
        titleEn: form.get("titleEn"),
        status: form.get("status") ?? "draft",
      });
    if (!parsed.success) return { error: "validation" as const };
    await createProgram(
      db,
      { ...parsed.data, descriptionAr: null, descriptionEn: null, sortOrder: 0, slug: undefined },
      { userId: auth.user.id, role: auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") }
    );
    return { ok: true as const };
  }
  return { error: "generic" as const };
}

function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  const tone = status === "published" ? "success" : status === "archived" ? "neutral" : "warning";
  const key = status === "published" ? "content.statusPublished" : status === "archived" ? "content.statusArchived" : "content.statusDraft";
  return <Badge tone={tone}>{t(locale, key)}</Badge>;
}

function TreeNode({ node, locale, depth = 0 }: { node: AdminTreeNode; locale: Locale; depth?: number }) {
  const label = locale === "ar" ? node.titleAr : node.titleEn;
  return (
    <li className={depth === 0 ? "mb-3" : "mb-1.5"}>
      <div className={`flex items-center gap-2 py-0.5 ${["", "ps-5", "ps-10", "ps-14", "ps-20", "ps-24", "ps-28", "ps-32"][Math.min(depth, 7)]}`}>
        <StatusBadge status={node.status} locale={locale} />
        <Link
          to={`/admin/content/${node.type}/${node.id}`}
          className="text-sm font-medium text-slate-800 hover:underline"
        >
          {label}
        </Link>
        {node.slug && <span className="text-xs text-slate-400">/{node.slug}</span>}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} locale={locale} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function AdminContent({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t(locale, "admin.navContent")} description="Program → Grade → Subject → Course → Unit → Lesson" />
        <CardBody>
          {loaderData.tree.length === 0 ? (
            <p className="text-sm text-slate-400">{t(locale, "content.catalogEmpty")}</p>
          ) : (
            <ul>{loaderData.tree.map((n) => <TreeNode key={n.id} node={n} locale={locale} />)}</ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "content.addProgram")} />
        <CardBody>
          <Form method="post" className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="_action" value="create-program" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleAr")}</span>
              <input name="titleAr" required dir="rtl" className="rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleEn")}</span>
              <input name="titleEn" required dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.status")}</span>
              <select name="status" className="rounded-lg border border-slate-300 px-3 py-2">
                <option value="draft">{t(locale, "content.statusDraft")}</option>
                <option value="published">{t(locale, "content.statusPublished")}</option>
              </select>
            </label>
            <div className="sm:col-span-3">
              <SubmitButton>{t(locale, "content.addProgram")}</SubmitButton>
              {actionData?.ok && <span className="ms-2 text-sm text-green-600">{t(locale, "content.created")}</span>}
            </div>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
}
