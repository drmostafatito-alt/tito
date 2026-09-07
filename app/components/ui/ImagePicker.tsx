import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { t, type Locale } from "~/lib/i18n";

type UploadResult = { ok?: boolean; id?: string; error?: string };

/**
 * Reusable bilingual image field with a media-picker experience and inline
 * upload. Used for course/subject thumbnails and identity/branding images so
 * an admin is never stuck with an empty field and no workflow.
 *
 * - `name`/`value`/`images` stay compatible with server-rendered forms: the
 *   chosen file id is carried on a hidden input named `name`, and the
 *   surrounding <Form method="post"> submits it unchanged (FileId contract
 *   preserved).
 * - Inline "Upload image" posts through the EXISTING validated `/admin/files`
 *   action (same R2/validation/audit pipeline — no duplicated storage logic),
 *   then automatically selects the returned media id. "Choose from library",
 *   remove/change remain available.
 */
export function ImagePicker({
  name,
  value,
  images,
  locale,
  label,
  compact = false,
}: {
  name: string;
  value: string;
  images: Array<{ id: string; label: string }>;
  locale: Locale;
  label: string;
  compact?: boolean;
}) {
  const [val, setVal] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher<UploadResult>();
  const uploading = fetcher.state !== "idle";

  const current =
    images.find((i) => i.id === val) ??
    (uploadName && val ? { id: val, label: uploadName } : undefined);

  // On a completed upload, auto-select the new media item.
  useEffect(() => {
    const data = fetcher.data;
    if (!data || fetcher.state !== "idle") return;
    if (data.ok && data.id) {
      setVal(data.id);
      setError(null);
      if (fileRef.current) fileRef.current.value = "";
    } else if (data.error) {
      setError(t(locale, "media.uploadFailed"));
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [fetcher.data, fetcher.state, locale]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadName(file.name);
    setError(null);
    const fd = new FormData();
    fd.set("_action", "upload");
    fd.set("file", file);
    fd.set("visibility", "public");
    fd.set("downloadAllowed", "off");
    // Posts through the validated /admin/files media action (same pipeline).
    fetcher.submit(fd, { method: "post", action: "/admin/files", encType: "multipart/form-data" });
  }

  const previewCls = compact ? "h-14 w-24" : "h-16 w-28";

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input type="hidden" name={name} value={val} />
      {current ? (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2">
          <img
            src={`/files/${val}`}
            alt={current.label}
            className={`${previewCls} shrink-0 rounded-md border border-slate-100 bg-slate-50 object-cover`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{current.label}</p>
            <p className="truncate text-xs text-slate-500" dir="ltr">{val}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center">
          <span className="text-2xl text-slate-300" aria-hidden="true">🖼️</span>
          <span className="text-sm font-medium text-slate-600">{t(locale, "media.noImage")}</span>
          <span className="text-xs text-slate-500">{t(locale, "media.noImageHint")}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t(locale, "media.chooseFromLibrary")}
        </button>
        <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">
          {uploading ? t(locale, "media.uploading") : t(locale, "media.uploadImage")}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={t(locale, "media.uploadImage")}
            disabled={uploading}
            onChange={handleFile}
          />
        </label>
        {val && (
          <button
            type="button"
            onClick={() => setVal("")}
            className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            {t(locale, "media.removeImage")}
          </button>
        )}
        <a
          href="/admin/files"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-brand-700 hover:bg-brand-50"
        >
          {t(locale, "media.manageLibrary")}
        </a>
      </div>

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}

      {open && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <p className="mb-2 text-xs text-slate-500">{t(locale, "media.uploadNote")}</p>
          <ul
            className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4"
            role="listbox"
            aria-label={label}
          >
            {images.length === 0 ? (
              <li className="col-span-full p-3 text-center text-xs text-slate-500">
                {t(locale, "media.noLibraryItems")}
              </li>
            ) : (
              images.map((img) => (
                <li key={img.id}>
                  <button
                    type="button"
                    onClick={() => { setVal(img.id); setOpen(false); }}
                    aria-selected={val === img.id}
                    className={`flex w-full flex-col gap-1 rounded-lg border p-1.5 text-start hover:bg-white ${
                      val === img.id ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <img src={`/files/${img.id}`} alt={img.label} className="h-16 w-full rounded-md object-cover" loading="lazy" />
                    <span className="truncate text-[11px] text-slate-600">{img.label}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
