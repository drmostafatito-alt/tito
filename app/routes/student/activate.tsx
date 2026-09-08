import type { Route } from "./+types/activate";
import { Form, useActionData, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { redeemActivationCode, type RedeemErrorReason } from "~server/commerce/service.server";
import { checkRateLimit, clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, type Locale } from "~/lib/i18n";

/**
 * Activation-code redemption (PAYMENTS.md §3). Logged-in students only and
 * rate-limited; the code itself is looked up by hash (plaintext never stored),
 * redeemed atomically (conditional use-count claim + UNIQUE(code, student)),
 * and grants entitlements through the same table the resolver reads — a
 * redeemed code is real access, a typed guess is nothing.
 */
export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const form = await request.formData();
  if (String(form.get("_action") ?? "") !== "redeem") return { error: "generic" as const };

  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  const rl = await checkRateLimit(db, "code_redeem", `${auth.user.id}:${ipHash}`, 10, 3_600_000);
  if (!rl.ok) return { error: "rate_limited" as const };

  const result = await redeemActivationCode(db, {
    studentId: auth.user.id,
    code: String(form.get("code") ?? ""),
    ipHash,
  });
  if (result.ok) return { ok: true as const, grants: result.grantsCount };
  return { error: result.reason as RedeemErrorReason };
}

export default function ActivatePage({}: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold text-ink">{t(locale, "commerce.activateTitle")}</h1>

      {actionData && "error" in actionData && (
        <div data-testid="redeem-error">
          <Alert kind="error">{t(locale, `commerce.redeem_${actionData.error}` as never)}</Alert>
        </div>
      )}
      {actionData && "ok" in actionData && (
        <div data-testid="redeem-success">
          <Alert kind="success">{t(locale, "commerce.redeemSuccess")}</Alert>
        </div>
      )}

      <Card>
        <CardHeader title={t(locale, "commerce.activateTitle")} />
        <CardBody>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="_action" value="redeem" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "commerce.codeLabel")}</span>
              <input
                name="code"
                required
                dir="ltr"
                autoComplete="off"
                maxLength={40}
                className="rounded-lg border border-line px-3 py-2 font-mono uppercase"
                placeholder="EDU-XXXX-XXXX-XXXX"
                data-testid="code-input"
              />
            </label>
            <SubmitButton name="_action" value="redeem">{t(locale, "commerce.redeemButton")}</SubmitButton>
            <p className="text-xs text-ink-muted">{t(locale, "commerce.redeemNotice")}</p>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
}
