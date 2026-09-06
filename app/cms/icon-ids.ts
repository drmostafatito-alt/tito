/**
 * Controlled icon identifiers (never raw SVG). Split from the block registry so
 * public chrome (`<Icon>`) does not pull admin labels into the homepage bundle.
 */
export const ICON_IDS = [
  "book-open", "play-circle", "graduation-cap", "file-text", "check", "check-circle",
  "star", "phone", "mail", "map-pin", "clock", "calendar", "users", "user", "award",
  "target", "zap", "shield", "lock", "heart", "arrow-right", "arrow-left", "chevron-down",
  "chevron-up", "menu", "close", "search", "settings", "image", "video", "microphone",
  "download", "external-link", "quote", "help-circle", "info", "alert-triangle",
  "sparkles", "briefcase", "globe", "credit-card", "tag", "layers", "grid", "list",
  "monitor", "smartphone", "tablet", "sun", "moon", "palette", "message-circle",
  "send", "thumbs-up", "trophy", "medal", "chart", "whatsapp", "telegram", "facebook",
  "youtube", "instagram", "tiktok", "twitter", "linkedin",
  "brain", "scale", "lightbulb", "landmark", "pencil", "puzzle", "compass", "scroll",
] as const;
export type IconId = (typeof ICON_IDS)[number];

/** Common social networks — suggestions only, not a closed platform list. */
export const SOCIAL_NETWORKS = ["whatsapp", "telegram", "facebook", "youtube", "instagram", "tiktok", "twitter", "linkedin"] as const;
