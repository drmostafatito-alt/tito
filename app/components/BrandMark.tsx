export function BrandMark({
  name,
  compact = false,
  logoUrl,
  avatarUrl,
  tagline,
}: {
  name: string;
  compact?: boolean;
  logoUrl?: string | null;
  avatarUrl?: string | null;
  tagline?: string | null;
}) {
  const imgSrc = logoUrl || avatarUrl || "/tito-avatar.webp";

  // Format title: highlight teacher name in brand purple/indigo
  let prefix = "";
  let highlight = name;
  if (name.includes("مصطفى تيتو")) {
    const parts = name.split("مصطفى تيتو");
    prefix = parts[0]?.trim() ? `${parts[0].trim()} ` : "د/ ";
    highlight = "مصطفى تيتو";
  } else if (name.toLowerCase().includes("mostafa tito")) {
    const parts = name.split(/mostafa tito/i);
    prefix = parts[0]?.trim() ? `${parts[0].trim()} ` : "Dr. ";
    highlight = "Mostafa Tito";
  }

  return (
    <span className="inline-flex items-center gap-3">
      <span
        className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/90 bg-indigo-50 shadow-sm"
        aria-hidden="true"
      >
        <img
          src={imgSrc}
          alt={name}
          width={44}
          height={44}
          className="h-full w-full object-cover"
          loading="eager"
        />
      </span>
      {!compact && (
        <span className="flex flex-col text-start leading-tight">
          <span className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
            {prefix && <span>{prefix}</span>}
            <span className="font-extrabold text-indigo-600">{highlight}</span>
          </span>
          <span className="mt-0.5 truncate text-[11px] font-medium text-slate-400 sm:text-xs">
            {tagline || "منصة الفلسفة وعلم النفس للثانوية العامة"}
          </span>
        </span>
      )}
    </span>
  );
}
