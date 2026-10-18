import React, { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { Loader2, ArrowRight, Lock, Mail, Shield } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { Logo } from "../components/Logo";

// GitHub icon SVG component
const GitHubIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

export const Login: React.FC = () => {
  const { user, signInWithGithub } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleGitHubAuth = async () => {
    try {
      setIsGithubLoading(true);
      setError(null);
      await signInWithGithub();
    } catch (err: any) {
      setError(err?.message || "Failed to initiate GitHub sign in");
      setIsGithubLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        alert("Check your email for the confirmation link.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      setError(err?.message || "An error occurred during authentication.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1rem",
        position: "relative",
      }}
    >
      <div className="mesh-glow" />

      {/* Brand Logo Header */}
      <div className="mb-6" style={{ position: "relative", zIndex: 1 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Logo size={36} />
          <span style={{ fontWeight: 800, fontSize: "1.5rem", letterSpacing: "-0.04em", color: "#ffffff" }}>
            ServHub
          </span>
        </Link>
      </div>

      {/* Card */}
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "2.5rem 2rem",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.4rem" }}>
            {isSignUp ? "Create developer account" : "Sign in to ServHub"}
          </h1>
          <p style={{ fontSize: "0.875rem", margin: 0 }}>
            {isSignUp ? "Connect repositories & deploy to AWS edge" : "Manage your projects and deployments"}
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "rgba(244, 63, 94, 0.12)",
              border: "1px solid rgba(244, 63, 94, 0.3)",
              borderRadius: "var(--radius-md)",
              color: "#fb7185",
              fontSize: "0.825rem",
              marginBottom: "1.25rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>{error}</span>
          </div>
        )}

        {/* Primary GitHub Auth Action */}
        <button
          className="btn btn-outline"
          onClick={handleGitHubAuth}
          disabled={isGithubLoading || isLoading}
          style={{
            width: "100%",
            padding: "0.75rem 1rem",
            background: "#ffffff",
            color: "#0f172a",
            fontWeight: 600,
            border: "none",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
            gap: "0.6rem",
            marginBottom: "1.5rem",
          }}
        >
          {isGithubLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <GitHubIcon size={18} />
          )}
          <span>Continue with GitHub</span>
        </button>

        {/* Subtle Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "1.5rem",
            color: "var(--text-muted)",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)" }} />
          <span style={{ padding: "0 0.85rem" }}>or with email</span>
          <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)" }} />
        </div>

        {/* Email Form */}
        <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "0.35rem",
              }}
            >
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              required
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "0.35rem",
              }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", padding: "0.7rem", marginTop: "0.5rem" }}
            disabled={isLoading || isGithubLoading}
          >
            {isLoading ? (
              <Loader2 className="animate-spin" size={18} />
            ) : isSignUp ? (
              "Create Account"
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* Toggle sign in / sign up */}
        <div
          style={{
            marginTop: "1.5rem",
            paddingTop: "1.25rem",
            borderTop: "1px solid var(--border-subtle)",
            textAlign: "center",
            fontSize: "0.825rem",
            color: "var(--text-muted)",
          }}
        >
          {isSignUp ? "Already have an account?" : "Need a new account?"}{" "}
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#818cf8",
              cursor: "pointer",
              fontWeight: 600,
              padding: 0,
            }}
          >
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </div>
      </div>

      {/* Security Footer Callout */}
      <div
        style={{
          marginTop: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          zIndex: 1,
        }}
      >
        <Shield size={14} style={{ color: "#10b981" }} />
        <span>Secured via Supabase OAuth with PKCE &amp; TLS 1.3 encryption</span>
      </div>
    </div>
  );
};
