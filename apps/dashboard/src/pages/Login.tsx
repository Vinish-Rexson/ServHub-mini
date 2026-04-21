import React from "react";
import { Navigate } from "react-router-dom";
import { GitPullRequest } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export const Login: React.FC = () => {
  const { user, signInWithGithub } = useAuth();

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: "100vh" }}>
      <div className="card flex flex-col items-center gap-4" style={{ width: "100%", maxWidth: "400px", padding: "3rem 2rem" }}>
        <div style={{ padding: "1rem", backgroundColor: "var(--bg-tertiary)", borderRadius: "50%", marginBottom: "1rem" }}>
          <GitPullRequest size={48} />
        </div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Welcome to ServHub</h1>
        <p className="text-muted" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          Sign in to deploy your projects instantly.
        </p>
        <button className="btn btn-primary" onClick={signInWithGithub} style={{ width: "100%", padding: "0.75rem" }}>
          <GitPullRequest size={20} />
          Continue with GitHub
        </button>
      </div>
    </div>
  );
};
