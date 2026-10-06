"use client";

export interface AccountOption {
  id: string;
  username: string;
  instagramId: string;
  name?: string | null;
  /** INSTAGRAM | FACEBOOK | THREADS | YOUTUBE */
  platform?: string;
}

export const PLATFORM_ICON: Record<string, string> = { INSTAGRAM: "📸", FACEBOOK: "📘", THREADS: "🧵", YOUTUBE: "▶️" };
export const PLATFORM_NAME: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", THREADS: "Threads", YOUTUBE: "YouTube" };
export const accountLabel = (a: AccountOption) =>
  `${PLATFORM_ICON[a.platform ?? "INSTAGRAM"] ?? ""} ${a.platform && a.platform !== "INSTAGRAM" ? a.username : "@" + a.username}`;

interface AccountSelectProps {
  accounts: AccountOption[];
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  label?: string;
}

export default function AccountSelect({
  accounts,
  value,
  onChange,
  includeAll = true,
  label = "Account",
}: AccountSelectProps) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-52 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
      >
        {includeAll && <option value="all">All accounts</option>}
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {accountLabel(account)}
          </option>
        ))}
      </select>
    </label>
  );
}

