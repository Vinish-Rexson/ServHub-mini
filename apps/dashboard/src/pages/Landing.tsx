import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Rocket,
  GitBranch,
  Cpu,
  Radio,
  ShieldCheck,
  CheckCircle2,
  Terminal,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Layers,
  ArrowUpRight
} from "lucide-react";
import { Logo } from "../components/Logo";

export const Landing: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"terminal" | "architecture">("terminal");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative", overflowX: "hidden" }}>
      {/* Background ambient lighting */}
      <div className="mesh-glow" />

      {/* Top Navbar */}
      <header
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          position: "sticky",
          top: 0,
          background: "rgba(8, 9, 13, 0.8)",
          backdropFilter: "blur(16px)",
          zIndex: 40,
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "1rem 1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Logo size={32} />
            <span style={{ fontWeight: 800, fontSize: "1.25rem", letterSpacing: "-0.04em", color: "#ffffff" }}>
              ServHub
            </span>
            <span
              style={{
                fontSize: "0.65rem",
                padding: "0.15rem 0.5rem",
                borderRadius: "4px",
                background: "rgba(99, 102, 241, 0.15)",
                color: "#818cf8",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                fontWeight: 700,
                letterSpacing: "0.06em",
              }}
            >
              v2.0
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <a
              href="#features"
              className="nav-link"
            >
              Architecture
            </a>
            <Link to="/login" className="nav-link">
              Sign In
            </Link>
            <Link
              to="/login"
              className="btn btn-primary"
              style={{ padding: "0.45rem 1rem", fontSize: "0.85rem" }}
            >
              Deploy Now
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main style={{ flex: 1, position: "relative", zIndex: 1 }}>
        <section
          style={{
            padding: "5rem 1.5rem 3rem",
            maxWidth: "1100px",
            margin: "0 auto",
            textAlign: "center",
          }}
        >
          {/* Release Badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.35rem 0.9rem",
              borderRadius: "9999px",
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border-hover)",
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              marginBottom: "1.75rem",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "#10b981",
                boxShadow: "0 0 8px #10b981",
              }}
            />
            <span style={{ color: "#f8fafc", fontWeight: 600 }}>ServHub Engine</span>
            <span>&bull;</span>
            <span>Powered by AWS Graviton2 &amp; Node 24</span>
          </div>

          <h1
            style={{
              fontSize: "clamp(2.75rem, 6.5vw, 4.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.045em",
              lineHeight: 1.08,
              marginBottom: "1.5rem",
              background: "linear-gradient(180deg, #ffffff 30%, #94a3b8 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Deploy web apps at the speed of thought.
          </h1>

          <p
            style={{
              fontSize: "clamp(1.1rem, 2vw, 1.3rem)",
              color: "var(--text-secondary)",
              maxWidth: "46rem",
              margin: "0 auto 2.5rem auto",
              lineHeight: 1.6,
            }}
          >
            Connect your GitHub repository. ServHub builds on high-performance AWS Graviton2 ARM64 hardware, pushes directly to edge storage, and delivers instant SSL subdomains.
          </p>

          {/* Action Buttons */}
          <div
            style={{
              display: "flex",
              gap: "1rem",
              justifyContent: "center",
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: "4rem",
            }}
          >
            <Link
              to="/login"
              className="btn btn-primary"
              style={{
                padding: "0.85rem 2rem",
                fontSize: "1rem",
                borderRadius: "10px",
                gap: "0.6rem",
              }}
            >
              <Rocket size={18} />
              Start Building Free
            </Link>
            <a
              href="#architecture"
              className="btn btn-outline"
              style={{
                padding: "0.85rem 1.75rem",
                fontSize: "1rem",
                borderRadius: "10px",
                gap: "0.5rem",
              }}
            >
              <Terminal size={18} />
              Live Preview
            </a>
          </div>

          {/* Interactive Hero Preview Component */}
          <div
            id="architecture"
            style={{
              borderRadius: "16px",
              border: "1px solid var(--border-hover)",
              background: "rgba(10, 12, 18, 0.9)",
              boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 35px -10px rgba(99, 102, 241, 0.15)",
              overflow: "hidden",
              textAlign: "left",
              maxWidth: "960px",
              margin: "0 auto",
            }}
          >
            {/* Terminal Window Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.85rem 1.25rem",
                borderBottom: "1px solid var(--border-subtle)",
                background: "rgba(17, 20, 29, 0.8)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444" }} />
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#f59e0b" }} />
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981" }} />
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    marginLeft: "0.5rem",
                  }}
                >
                  servhub-builder // worker-arm64-t4g
                </span>
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => setActiveTab("terminal")}
                  className={activeTab === "terminal" ? "btn btn-outline" : "btn"}
                  style={{
                    padding: "0.25rem 0.7rem",
                    fontSize: "0.75rem",
                    background: activeTab === "terminal" ? "rgba(99, 102, 241, 0.15)" : "transparent",
                    color: activeTab === "terminal" ? "#818cf8" : "var(--text-muted)",
                    borderColor: activeTab === "terminal" ? "rgba(99, 102, 241, 0.3)" : "transparent",
                  }}
                >
                  Build Logs
                </button>
                <button
                  onClick={() => setActiveTab("architecture")}
                  className={activeTab === "architecture" ? "btn btn-outline" : "btn"}
                  style={{
                    padding: "0.25rem 0.7rem",
                    fontSize: "0.75rem",
                    background: activeTab === "architecture" ? "rgba(99, 102, 241, 0.15)" : "transparent",
                    color: activeTab === "architecture" ? "#818cf8" : "var(--text-muted)",
                    borderColor: activeTab === "architecture" ? "rgba(99, 102, 241, 0.3)" : "transparent",
                  }}
                >
                  Pipeline Flow
                </button>
              </div>
            </div>

            {/* Content Body */}
            {activeTab === "terminal" ? (
              <div
                style={{
                  padding: "1.5rem",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "0.82rem",
                  lineHeight: 1.7,
                  color: "#cbd5e1",
                  maxHeight: "340px",
                  overflowY: "auto",
                }}
              >
                <div style={{ color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  // Starting build for repository Vinish-Rexson/React-Boilerplate@main
                </div>
                <div><span style={{ color: "#38bdf8" }}>$</span> git clone --depth 1 https://github.com/Vinish-Rexson/React-Boilerplate.git</div>
                <div style={{ color: "var(--text-secondary)" }}>Cloning into '/tmp/servhub-mini-builds/8ee247e8'... done.</div>
                <div><span style={{ color: "#38bdf8" }}>$</span> npm ci --include=dev</div>
                <div style={{ color: "var(--text-secondary)" }}>added 142 packages, audited 143 packages in 1.48s</div>
                <div><span style={{ color: "#38bdf8" }}>$</span> npm run build</div>
                <div style={{ color: "#818cf8" }}>vite v6.2.2 building for production...</div>
                <div style={{ color: "#10b981" }}>✓ 48 modules transformed in 412ms</div>
                <div style={{ color: "#10b981" }}>✓ dist/index.html (0.46 kB)</div>
                <div style={{ color: "#10b981" }}>✓ dist/assets/index.js (142.18 kB gzip)</div>
                <div><span style={{ color: "#38bdf8" }}>$</span> servhub-edge-sync --destination s3://servhub-mini-deployments/8ee247e8/</div>
                <div style={{ color: "#10b981", fontWeight: 600 }}>
                  🚀 Deployment READY: <span style={{ textDecoration: "underline" }}>https://react-boilerplate-a1b2c3.4istudios.in</span> (100% healthy)
                </div>
              </div>
            ) : (
              <div style={{ padding: "2rem 1.5rem" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "1rem",
                  }}
                >
                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "12px",
                      padding: "1.25rem",
                    }}
                  >
                    <div style={{ color: "#818cf8", marginBottom: "0.5rem" }}><GitBranch size={20} /></div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#f8fafc" }}>1. GitHub Push</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      Instant webhook trigger on branch push or PR
                    </div>
                  </div>

                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "12px",
                      padding: "1.25rem",
                    }}
                  >
                    <div style={{ color: "#38bdf8", marginBottom: "0.5rem" }}><Cpu size={20} /></div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#f8fafc" }}>2. ARM64 Graviton2</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      Node 24 Alpine in isolated container runtime
                    </div>
                  </div>

                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "12px",
                      padding: "1.25rem",
                    }}
                  >
                    <div style={{ color: "#f59e0b", marginBottom: "0.5rem" }}><Radio size={20} /></div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#f8fafc" }}>3. Live Stream</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      Supabase Postgres replication to browser
                    </div>
                  </div>

                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "12px",
                      padding: "1.25rem",
                    }}
                  >
                    <div style={{ color: "#10b981", marginBottom: "0.5rem" }}><ShieldCheck size={20} /></div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#f8fafc" }}>4. Edge &amp; SSL</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      S3 static origin with Cloudflare TLS 1.3
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Feature Grid */}
        <section id="features" style={{ maxWidth: "1100px", margin: "4rem auto 6rem", padding: "0 1.5rem" }}>
          <div style={{ textAlign: "center", marginBottom: "3rem" }}>
            <h2 style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>Engineered for modern frontend stacks</h2>
            <p style={{ maxWidth: "34rem", margin: "0 auto" }}>
              Every layer of the ServHub platform is tailored for low build latency, high resilience, and zero maintenance.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "1.5rem",
            }}
          >
            <div className="card">
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "10px",
                  background: "rgba(99, 102, 241, 0.15)",
                  color: "#818cf8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "1rem",
                }}
              >
                <Cpu size={22} />
              </div>
              <h3 style={{ marginBottom: "0.5rem" }}>ARM64 Graviton2 Pipelines</h3>
              <p style={{ fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>
                Build your React, Vite, and Next.js applications on 64-bit ARM architecture. Faster package installation, lower energy footprint, and 40% faster compile speeds.
              </p>
            </div>

            <div className="card">
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "10px",
                  background: "rgba(56, 189, 248, 0.15)",
                  color: "#38bdf8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "1rem",
                }}
              >
                <Radio size={22} />
              </div>
              <h3 style={{ marginBottom: "0.5rem" }}>Real-time Log Streaming</h3>
              <p style={{ fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>
                Powered by Supabase Realtime Postgres replication. Inspect step-by-step build logs as they execute in your terminal window with sub-second websocket delivery.
              </p>
            </div>

            <div className="card">
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "10px",
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#10b981",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "1rem",
                }}
              >
                <GitBranch size={22} />
              </div>
              <h3 style={{ marginBottom: "0.5rem" }}>Git-Driven Automation</h3>
              <p style={{ fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>
                Every commit pushed to GitHub automatically generates an isolated preview deployment. Merge to main and your production endpoint updates with zero downtime.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border-subtle)",
          padding: "2.5rem 1.5rem",
          background: "var(--bg-surface)",
          fontSize: "0.85rem",
          color: "var(--text-muted)",
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <Logo size={22} />
            <span style={{ fontWeight: 600, color: "#f8fafc" }}>ServHub Mini</span>
            <span>&bull;</span>
            <span>AWS ap-southeast-2 (Sydney)</span>
          </div>
          <div>
            &copy; {new Date().getFullYear()} ServHub Cloud. High-performance Edge Infrastructure.
          </div>
        </div>
      </footer>
    </div>
  );
};
