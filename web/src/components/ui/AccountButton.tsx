"use client";

import { signIn } from "@/lib/account/api";
import { useOptionalSession, useSessionLoading } from "@/lib/account/session";
import { RailButton } from "./BrandRail";

/** Rail control that signs in with Google, or out once signed in. */
export function AccountRailButton() {
  const session = useOptionalSession();
  const loading = useSessionLoading();
  if (loading) return <RailButton icon="user" label="ACCOUNT" disabled />;
  if (!session)
    return <RailButton icon="user" label="SIGN IN" onClick={signIn} />;
  return (
    <RailButton
      icon="user"
      label={`SIGN OUT · ${firstName(session.user)}`}
      onClick={() => void session.signOut()}
    />
  );
}

/** Header control for pages outside the builder, such as Explore. */
export function AccountHeaderButton() {
  const session = useOptionalSession();
  const loading = useSessionLoading();
  const className =
    "flex items-center gap-2 rounded-xl border border-line px-3 py-2 font-mono text-[10.5px] tracking-[0.14em] text-muted transition-colors hover:text-text disabled:opacity-30";
  if (!session)
    return (
      <button onClick={signIn} disabled={loading} className={className}>
        SIGN IN
      </button>
    );
  return (
    <button onClick={() => void session.signOut()} className={className}>
      {session.user.picture_url && (
        // biome-ignore lint/performance/noImgElement: static export serves no image optimiser
        <img
          src={session.user.picture_url}
          alt=""
          referrerPolicy="no-referrer"
          className="h-4 w-4 rounded-full"
        />
      )}
      SIGN OUT
    </button>
  );
}

/** The part of a player's name the rail has room for. */
function firstName(user: { name: string; email: string }): string {
  const name = user.name.trim() || user.email.split("@")[0];
  return name.split(/\s+/)[0].toUpperCase();
}
