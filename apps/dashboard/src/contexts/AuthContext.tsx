import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");

async function syncProviderToken(session: Session): Promise<void> {
  if (!session.provider_token || !session.access_token) {
    return;
  }

  const response = await fetch(`${API_BASE_URL}/auth/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ providerToken: session.provider_token }),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Token sync failed (${response.status})`);
    }

    const text = await response.text().catch(() => "");
    throw new Error(text || `Token sync failed (${response.status})`);
  }
}

type AuthContextType = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isSynced: boolean;
  signInWithGithub: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSynced, setIsSynced] = useState(false);
  const lastSyncedProviderTokenRef = useRef<string | null>(null);

  const trySyncProviderToken = async (nextSession: Session | null): Promise<void> => {
    if (!nextSession) {
      lastSyncedProviderTokenRef.current = null;
      setIsSynced(false);
      return;
    }

    if (!nextSession.provider_token || !nextSession.access_token) {
      setIsSynced(true);
      return;
    }

    if (lastSyncedProviderTokenRef.current === nextSession.provider_token) {
      setIsSynced(true);
      return;
    }

    try {
      await syncProviderToken(nextSession);
      lastSyncedProviderTokenRef.current = nextSession.provider_token;
      setIsSynced(true);
    } catch (error) {
      console.error("Failed to sync provider token", error);
      setIsSynced(false);
    }
  };

  useEffect(() => {
    // Initial session load - this is the source of truth on page reload
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        setIsLoading(false);
        void trySyncProviderToken(session);
      })
      .catch((error) => {
        console.error("Failed to load auth session", error);
        setSession(null);
        setUser(null);
        setIsSynced(false);
        setIsLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);

      // Run outside the callback stack to avoid auth event re-entrancy issues.
      setTimeout(() => {
        void trySyncProviderToken(session);
      }, 0);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGithub = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: window.location.origin,
        scopes: "repo admin:repo_hook",
      },
    });
  };

  const signOut = async () => {
    // Clear state immediately so ProtectedRoute redirects right away
    setUser(null);
    setSession(null);
    setIsSynced(false);
    lastSyncedProviderTokenRef.current = null;
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, isLoading, isSynced, signInWithGithub, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
