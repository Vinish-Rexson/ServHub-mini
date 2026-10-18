import React, { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { GitPullRequest, Mail, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { Logo } from "../components/Logo";

export const Login: React.FC = () => {
  const { user, signInWithGithub } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

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
      setError(err.message || "An error occurred during authentication.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: "100vh" }}>
      <div className="mb-8">
        <Link to="/" className="flex items-center justify-center gap-2 hover:opacity-80 transition-opacity">
          <Logo size={40} className="text-primary" />
          <span className="font-bold text-2xl tracking-tight" style={{ color: "var(--text-primary)" }}>ServHub</span>
        </Link>
      </div>

      <div className="card flex flex-col items-center gap-4" style={{ width: "100%", maxWidth: "400px", padding: "3rem 2rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-muted" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          {isSignUp ? "Sign up to start deploying" : "Sign in to your account"}
        </p>

        {error && (
          <div style={{ width: "100%", padding: "0.75rem", backgroundColor: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "var(--radius-md)", color: "#ef4444", fontSize: "0.875rem", marginBottom: "1rem" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleEmailAuth} style={{ width: "100%", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width: "100%", padding: "0.75rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)" }}
              required
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: "100%", padding: "0.75rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)" }}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem" }} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : (isSignUp ? "Sign Up" : "Sign In")}
          </button>
        </form>

        <div style={{ width: "100%", display: "flex", alignItems: "center", margin: "1rem 0" }}>
          <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-color)" }}></div>
          <span style={{ padding: "0 1rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>or</span>
          <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-color)" }}></div>
        </div>

        <button className="btn btn-outline" onClick={signInWithGithub} style={{ width: "100%", padding: "0.75rem" }} disabled={isLoading}>
          <GitPullRequest size={20} />
          Continue with GitHub
        </button>

        <div style={{ marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
          {isSignUp ? "Already have an account?" : "Don't have an account?"}
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
            style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", marginLeft: "0.5rem", fontWeight: 500 }}
          >
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};
