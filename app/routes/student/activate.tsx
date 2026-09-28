import type { Route } from "./+types/activate";
import { Form, useActionData, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { redeemActivationCode, type RedeemErrorReason } from "~server/commerce/service.server";
import { checkRateLimit, clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Alert } from "~/components/ui/Alert";
import { SubmitButton } from "~/components/ui/Button";
import { FIELD_LABEL } from "~/components/ui/Input";
import { WorkHead } from "~/components/tito/page";
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
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  if (String(form.get("_action") ?? "") !== "redeem") return { error: "generic" as const };

  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER);
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

/**
 * One field, one verdict. The code is checked by the server against a hash and
 * either grants real entitlements or does not — there is no optimistic state
 * and no success message that is not the server's.
 */
export default function ActivatePage({}: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();

  return (
    <div className="mx-auto w-full max-w-xl">
      <WorkHead eyebrow={t(locale, "commerce.myOrders")} title={t(locale, "commerce.activateTitle")} lede={t(locale, "commerce.redeemNotice")} />

      {actionData && "error" in actionData && (
        <div data-testid="redeem-error" className="mb-6">
          <Alert kind="error">{t(locale, `commerce.redeem_${actionData.error}` as never)}</Alert>
        </div>
      )}
      {actionData && "ok" in actionData && (
        <div data-testid="redeem-success" className="mb-6">
          <Alert kind="success">{t(locale, "commerce.redeemSuccess")}</Alert>
        </div>
      )}

      <Form method="post" className="flex flex-col gap-5">
        <input type="hidden" name="_action" value="redeem" />
        <div>
          <label htmlFor="activation-code" className={FIELD_LABEL}>
            {t(locale, "commerce.codeLabel")}
          </label>
          {/* The code is the hero of this page: oversized, monospaced, LTR. */}
          <input
            id="activation-code"
            name="code"
            required
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            className="mt-2 block w-full rounded-pub-md border-2 border-pub-ink bg-pub-sheet px-4 py-3.5 text-center font-mono text-pub-md font-bold uppercase tracking-[0.18em] text-pub-ink placeholder:font-normal placeholder:tracking-[0.12em] placeholder:text-ink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-ink"
            placeholder="TITO-XXXX-XXXX-XXXX"
            data-testid="code-input"
          />
        </div>
        <SubmitButton name="_action" value="redeem" size="lg" className="w-full">
          {t(locale, "commerce.redeemButton")}
        </SubmitButton>
      </Form>
    </div>
  );
}
