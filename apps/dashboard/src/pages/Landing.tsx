import React from "react";
import { Link } from "react-router-dom";
import { Rocket, Server, Globe, Zap, GitBranch, ArrowRight } from "lucide-react";
import { Logo } from "../components/Logo";

export const Landing: React.FC = () => {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "var(--bg-primary)" }}>
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: "1200px", margin: "0 auto", padding: "1.5rem 2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Logo size={32} />
          <span style={{ fontWeight: 700, fontSize: "1.25rem", letterSpacing: "-0.05em" }}>ServHub</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link to="/login" style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-secondary)", textDecoration: "none" }}>
            Log in
          </Link>
          <Link to="/login" className="btn btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", textDecoration: "none" }}>
            Sign up
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "5rem 1.5rem", maxWidth: "1000px", margin: "0 auto", width: "100%" }}>
        <div className="mb-8 flex items-center gap-2" style={{ padding: "0.25rem 0.75rem", borderRadius: "9999px", fontSize: "0.875rem", fontWeight: 500, backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", display: "inline-flex" }}>
          <span style={{ display: "block", height: "8px", width: "8px", borderRadius: "50%", backgroundColor: "#22c55e" }}></span>
          ServHub Mini is now live
        </div>
        
        <h1 style={{ fontSize: "clamp(2.5rem, 8vw, 4.5rem)", fontWeight: 800, letterSpacing: "-0.05em", marginBottom: "2rem", lineHeight: 1.1, color: "var(--text-primary)" }}>
          Deploy your code in seconds.
        </h1>
        
        <p className="text-muted" style={{ fontSize: "clamp(1.125rem, 2vw, 1.5rem)", marginBottom: "3rem", maxWidth: "42rem", margin: "0 auto 3rem auto", lineHeight: 1.6 }}>
          The fastest way to deploy static sites and frontend frameworks. Connect your GitHub repository and we'll handle the rest.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "center", alignItems: "center", width: "100%" }}>
          <Link to="/login" className="btn btn-primary flex items-center gap-2" style={{ padding: "0.875rem 2rem", fontSize: "1.125rem", borderRadius: "8px", minWidth: "200px" }}>
            <Rocket size={20} />
            Start Deploying
          </Link>
          <a href="#features" className="btn btn-outline flex items-center gap-2" style={{ padding: "0.875rem 2rem", fontSize: "1.125rem", borderRadius: "8px", minWidth: "200px" }}>
            Explore Features
          </a>
        </div>

        {/* Feature grid */}
        <div id="features" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem", marginTop: "8rem", textAlign: "left", width: "100%" }}>
          <div className="card" style={{ padding: "2rem" }}>
            <div className="mb-4 flex items-center justify-center" style={{ width: "48px", height: "48px", borderRadius: "12px", backgroundColor: "var(--bg-tertiary)" }}>
              <GitBranch size={24} />
            </div>
            <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>GitHub Integration</h3>
            <p className="text-muted" style={{ lineHeight: 1.6, margin: 0 }}>Push to your repository and we automatically build and deploy your changes. Every commit gets a unique URL.</p>
          </div>
          
          <div className="card" style={{ padding: "2rem" }}>
            <div className="mb-4 flex items-center justify-center" style={{ width: "48px", height: "48px", borderRadius: "12px", backgroundColor: "var(--bg-tertiary)" }}>
              <Zap size={24} />
            </div>
            <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>Lightning Fast</h3>
            <p className="text-muted" style={{ lineHeight: 1.6, margin: 0 }}>Our optimized build pipeline ensures your site is live in seconds, not minutes. Instant rollbacks included.</p>
          </div>

          <div className="card" style={{ padding: "2rem" }}>
            <div className="mb-4 flex items-center justify-center" style={{ width: "48px", height: "48px", borderRadius: "12px", backgroundColor: "var(--bg-tertiary)" }}>
              <Globe size={24} />
            </div>
            <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>Global Edge</h3>
            <p className="text-muted" style={{ lineHeight: 1.6, margin: 0 }}>Your content is served from the edge, closer to your users, guaranteeing low latency and high availability worldwide.</p>
          </div>

          <div className="card" style={{ padding: "2rem" }}>
            <div className="mb-4 flex items-center justify-center" style={{ width: "48px", height: "48px", borderRadius: "12px", backgroundColor: "var(--bg-tertiary)" }}>
              <Server size={24} />
            </div>
            <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>Zero Configuration</h3>
            <p className="text-muted" style={{ lineHeight: 1.6, margin: 0 }}>Focus on writing code instead of managing infrastructure. We automatically detect your framework and configure the optimal build settings.</p>
          </div>
        </div>
      </main>

      <footer style={{ borderTop: "1px solid var(--border-color)", padding: "2rem", marginTop: "3rem", textAlign: "center", fontSize: "0.875rem", color: "var(--text-muted)" }}>
        <p>&copy; {new Date().getFullYear()} ServHub Mini. All rights reserved.</p>
      </footer>
    </div>
  );
};
