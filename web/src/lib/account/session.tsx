"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError } from "@/lib/api";
import { getMe, logout, type Me } from "./api";

/** A signed-in player and the way out. */
export interface Session {
  user: Me;
  signOut: () => Promise<void>;
}

/** What the provider holds, including while it is still resolving. */
interface SessionState {
  user?: Me;
  loading: boolean;
  signOut: () => Promise<void>;
}

/** Carries the session {@link SessionProvider} resolved. */
const SessionContext = createContext<SessionState | undefined>(undefined);

/**
 * Resolves who is signed in, once, for the whole app. It renders its children
 * either way: nothing in the app requires a session yet.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    getMe()
      .then((me) => {
        if (live) setUser(me);
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.warn(err);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setUser(undefined);
  }, []);

  const state = useMemo(
    () => ({ user, loading, signOut }),
    [user, loading, signOut],
  );

  return (
    <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
  );
}

/** Reports whether the session is still being resolved. */
export function useSessionLoading(): boolean {
  return useContext(SessionContext)?.loading ?? true;
}

/** Returns the session, or undefined when nobody is signed in. */
export function useOptionalSession(): Session | undefined {
  const state = useContext(SessionContext);
  if (!state?.user) return undefined;
  return { user: state.user, signOut: state.signOut };
}
