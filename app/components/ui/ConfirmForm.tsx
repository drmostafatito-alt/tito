import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Form } from "react-router";
import { Modal } from "~/components/ui/Modal";
import { Button } from "~/components/ui/Button";
import { t, type Locale } from "~/lib/i18n";

/** Intercepts a POST Form with an accessible confirm dialog instead of window.confirm. */
export function ConfirmForm({
  locale,
  message,
  children,
  className,
}: {
  locale: Locale;
  message: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const skip = useRef(false);
  const pending = useRef<HTMLFormElement | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    e.preventDefault();
    pending.current = e.currentTarget;
    setOpen(true);
  };

  return (
    <>
      <Form method="post" onSubmit={onSubmit} className={className}>
        {children}
      </Form>
      <Modal open={open} onClose={() => setOpen(false)} title={message}>
        <p className="mb-4 text-sm text-slate-600">{message}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t(locale, "common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              skip.current = true;
              setOpen(false);
              pending.current?.requestSubmit();
            }}
          >
            {t(locale, "common.confirm")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
