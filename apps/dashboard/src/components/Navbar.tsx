import React from "react";
import { Link } from "react-router-dom";
import { LogOut, ExternalLink, Activity, Terminal } from "lucide-react";
import { Logo } from "./Logo";
import { useAuth } from "../contexts/AuthContext";

type NavbarProps = {
  breadcrumbs?: Array<{ label: string; href?: string }>;
};

export const Navbar: React.FC<NavbarProps> = ({ breadcrumbs }) => {
  const { user, signOut } = useAuth();
  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "SH";

  return (
    <nav className="navbar">
      <div className="flex items-center gap-4">
        <Link to="/dashboard" className="nav-brand">
          <Logo size={28} />
          <span>ServHub</span>
          <span
            style={{
              fontSize: "0.65rem",
              padding: "0.15rem 0.45rem",
              borderRadius: "4px",
              background: "rgba(99, 102, 241, 0.15)",
              color: "#818cf8",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Cloud
          </span>
        </Link>

        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-2 text-sm" style={{ borderLeft: "1px solid var(--border-subtle)", paddingLeft: "1rem" }}>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="text-muted">/</span>}
                {crumb.href ? (
                  <Link to={crumb.href} className="text-secondary nav-link" style={{ padding: "0.2rem 0.4rem" }}>
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-semibold text-primary">{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-2 text-xs text-muted"
          style={{
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
            padding: "0.25rem 0.6rem",
            borderRadius: "9999px",
            color: "#34d399",
            fontWeight: 500,
          }}
        >
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
          <span>ap-southeast-2</span>
        </div>

        {user && (
          <div className="flex items-center gap-3" style={{ borderLeft: "1px solid var(--border-subtle)", paddingLeft: "1rem" }}>
            <div
              title={user.email}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #374151 0%, #1f2937 100%)",
                border: "1px solid var(--border-hover)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#e2e8f0",
              }}
            >
              {initials}
            </div>

            <button
              onClick={signOut}
              className="btn btn-outline"
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem", gap: "0.35rem" }}
              title="Sign Out"
            >
              <LogOut size={13} />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};
