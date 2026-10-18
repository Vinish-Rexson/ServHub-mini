import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  GitCommit,
  Loader2,
  Trash2,
  Globe,
  RefreshCw,
  FolderGit2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Clock,
  ChevronRight
} from "lucide-react";
import { fetchApi } from "../lib/api";
import { resolveDeploymentUrl } from "../lib/deploymentUrl";
import { Navbar } from "../components/Navbar";

type Deployment = {
  id: string;
  commitSha: string;
  commitMessage: string | null;
  branch: string;
  status: string;
  deployedUrl: string | null;
  createdAt: string;
};

type Project = {
  id: string;
  name: string;
  repoFullName: string;
  branch: string;
};

export const ProjectDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const requestSeqRef = useRef(0);
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (!id) {
      setErrorMessage("Missing project id in route.");
      setIsLoading(false);
      return;
    }

    const loadData = async () => {
      const requestSeq = ++requestSeqRef.current;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);

      try {
        setIsLoading(true);
        setErrorMessage(null);
        const [projData, depData] = await Promise.all([
          fetchApi<Project>(`/projects/${id}`, { signal: controller.signal }),
          fetchApi<Deployment[]>(`/projects/${id}/deployments`, { signal: controller.signal }),
        ]);

        if (requestSeq === requestSeqRef.current) {
          setProject(projData);
          setDeployments(depData);
        }
      } catch (error) {
        console.error("Failed to load project details:", error);
        if (requestSeq === requestSeqRef.current) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load project details");
        }
      } finally {
        clearTimeout(timeout);
        if (requestSeq === requestSeqRef.current) {
          setIsLoading(false);
        }
      }
    };

    loadData();
  }, [id]);

  const handleDeleteProject = async () => {
    if (!project) return;
    try {
      setIsDeleting(true);
      await fetchApi(`/projects/${project.id}`, { method: "DELETE" });
      navigate("/dashboard");
    } catch (error) {
      console.error("Failed to delete project:", error);
      alert(error instanceof Error ? error.message : "Failed to delete project");
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleDeploy = async () => {
    if (!project) return;
    const isRedeploy = deployments.length > 0;

    try {
      setIsDeploying(true);
      setDeployError(null);

      const deployment = await fetchApi<Deployment>(`/projects/${project.id}/deploy`, {
        method: "POST",
        body: JSON.stringify({
          commitMessage: isRedeploy ? "Manual redeploy triggered from dashboard" : "Initial deployment",
          branch: project.branch || "main",
        }),
      });

      setDeployments((prev) => [deployment, ...prev]);
    } catch (error) {
      console.error("Failed to start deployment:", error);
      setDeployError(error instanceof Error ? error.message : "Failed to start deployment");
    } finally {
      setIsDeploying(false);
    }
  };

  const latestLiveDeployment = deployments.find(
    (d) => d.status === "READY" && resolveDeploymentUrl(d.id, d.deployedUrl) !== null
  ) ?? null;
  const latestLiveUrl = latestLiveDeployment
    ? resolveDeploymentUrl(latestLiveDeployment.id, latestLiveDeployment.deployedUrl)
    : null;

  const copyLiveUrl = () => {
    if (latestLiveUrl) {
      navigator.clipboard.writeText(latestLiveUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    return (
      <span className={`badge badge-${s}`}>
        <span className="badge-dot" />
        {status}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Navbar breadcrumbs={[{ label: "Projects", href: "/dashboard" }, { label: "Loading..." }]} />
        <div className="container flex flex-col items-center justify-center" style={{ flex: 1, padding: "6rem 0" }}>
          <Loader2 className="animate-spin" size={32} style={{ color: "var(--accent-primary)" }} />
          <p className="text-sm text-muted mt-4">Loading project details...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Navbar breadcrumbs={[{ label: "Projects", href: "/dashboard" }, { label: "Not Found" }]} />
        <div className="container text-center mt-8">
          <p className="text-secondary">{errorMessage || "Project not found"}</p>
          <Link to="/dashboard" className="btn btn-primary mt-4">Return to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar
        breadcrumbs={[
          { label: "Projects", href: "/dashboard" },
          { label: project.name },
        ]}
      />

      <main className="container" style={{ flex: 1, paddingBottom: "4rem" }}>
        {/* Project Header Banner */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1.5rem",
            marginBottom: "2rem",
          }}
        >
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 style={{ fontSize: "2rem", margin: 0, color: "#ffffff" }}>{project.name}</h1>
              {latestLiveUrl && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    fontSize: "0.7rem",
                    padding: "0.2rem 0.55rem",
                    borderRadius: "9999px",
                    background: "rgba(16, 185, 129, 0.12)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    color: "#34d399",
                    fontWeight: 600,
                  }}
                >
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                  Live Edge
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-sm text-muted">
              <a
                href={`https://github.com/${project.repoFullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 nav-link"
                style={{ padding: "0.2rem 0.5rem", background: "rgba(255,255,255,0.04)", borderRadius: "6px" }}
              >
                <FolderGit2 size={14} />
                <span>{project.repoFullName}</span>
                <ExternalLink size={12} />
              </a>

              <span className="flex items-center gap-1">
                <GitBranch size={14} /> {project.branch || "main"}
              </span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-3">
            {latestLiveUrl && (
              <a
                href={latestLiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                <span>Visit Production</span>
                <ExternalLink size={15} />
              </a>
            )}

            <button
              className="btn btn-outline"
              onClick={handleDeploy}
              disabled={isDeploying}
            >
              <RefreshCw size={15} className={isDeploying ? "animate-spin" : ""} />
              <span>{isDeploying ? "Triggering..." : "Redeploy"}</span>
            </button>

            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteProject}
                  disabled={isDeleting}
                >
                  {isDeleting ? <Loader2 size={14} className="animate-spin" /> : "Confirm Delete"}
                </button>
                <button
                  className="btn btn-outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn btn-outline"
                style={{ color: "#fb7185", borderColor: "rgba(244, 63, 94, 0.2)" }}
                onClick={() => setConfirmDelete(true)}
                title="Delete Project"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        {deployError && (
          <div
            style={{
              padding: "0.85rem 1.25rem",
              background: "rgba(244, 63, 94, 0.12)",
              border: "1px solid rgba(244, 63, 94, 0.3)",
              borderRadius: "var(--radius-md)",
              color: "#fb7185",
              fontSize: "0.875rem",
              marginBottom: "1.5rem",
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
            }}
          >
            <AlertCircle size={16} />
            <span>{deployError}</span>
          </div>
        )}

        {/* Live URL Info Banner (if deployed) */}
        {latestLiveUrl && (
          <div
            className="card mb-6"
            style={{
              padding: "1.25rem 1.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "1rem",
              background: "linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, rgba(16, 185, 129, 0.05) 100%)",
              border: "1px solid rgba(99, 102, 241, 0.25)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#34d399",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Globe size={18} />
              </div>
              <div>
                <div className="text-xs text-muted">Active Production Domain</div>
                <a
                  href={latestLiveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontWeight: 600,
                    color: "#ffffff",
                    fontSize: "0.95rem",
                  }}
                >
                  {latestLiveUrl}
                </a>
              </div>
            </div>

            <button
              className="btn btn-outline"
              onClick={copyLiveUrl}
              style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", gap: "0.4rem" }}
            >
              <Copy size={13} />
              <span>{copiedUrl ? "Copied!" : "Copy Domain"}</span>
            </button>
          </div>
        )}

        {/* Deployments History Card */}
        <div className="card" style={{ padding: "1.5rem" }}>
          <div className="flex items-center justify-between mb-5">
            <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Deployments</h2>
            <span className="text-xs text-muted">{deployments.length} total builds</span>
          </div>

          {deployments.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-muted text-sm mb-4">No deployments recorded yet.</p>
              <button className="btn btn-primary" onClick={handleDeploy} disabled={isDeploying}>
                Deploy Now
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {deployments.map((dep) => {
                const liveUrl = resolveDeploymentUrl(dep.id, dep.deployedUrl);
                const isLatestLive = latestLiveDeployment?.id === dep.id;

                return (
                  <div
                    key={dep.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "1rem 1.25rem",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-md)",
                      transition: "all 0.18s ease",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <div className="flex items-center gap-3">
                        <Link
                          to={`/deployments/${dep.id}`}
                          style={{
                            fontWeight: 600,
                            color: "#f8fafc",
                            fontSize: "0.95rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                          }}
                        >
                          <span>{dep.commitMessage || `Commit ${dep.commitSha.slice(0, 7)}`}</span>
                        </Link>
                        {getStatusBadge(dep.status)}
                        {isLatestLive && (
                          <span
                            style={{
                              fontSize: "0.65rem",
                              background: "rgba(16, 185, 129, 0.15)",
                              color: "#34d399",
                              border: "1px solid rgba(16, 185, 129, 0.3)",
                              padding: "0.15rem 0.5rem",
                              borderRadius: "4px",
                              fontWeight: 700,
                            }}
                          >
                            CURRENT
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted">
                        <span className="flex items-center gap-1 font-mono">
                          <GitCommit size={12} /> {dep.commitSha.slice(0, 7)}
                        </span>
                        <span>&bull;</span>
                        <span className="flex items-center gap-1">
                          <GitBranch size={12} /> {dep.branch}
                        </span>
                        <span>&bull;</span>
                        <span className="flex items-center gap-1">
                          <Clock size={12} /> {new Date(dep.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {liveUrl && (
                        <a
                          href={liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-outline"
                          style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
                        >
                          Visit <ExternalLink size={12} />
                        </a>
                      )}
                      <Link
                        to={`/deployments/${dep.id}`}
                        className="btn btn-outline"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
                      >
                        Logs <ChevronRight size={13} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
