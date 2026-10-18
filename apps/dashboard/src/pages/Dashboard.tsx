import React, { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  FolderGit2,
  Loader2,
  Search,
  ExternalLink,
  GitBranch,
  Lock,
  Globe,
  Clock,
  ArrowUpRight,
  Sparkles,
  Server,
  Layers,
  X
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { fetchApi } from "../lib/api";
import { Navbar } from "../components/Navbar";

type Project = {
  id: string;
  name: string;
  slug: string;
  repoFullName: string;
  createdAt: string;
};

type CreatedProject = {
  id: string;
};

type GitHubRepo = {
  id: number;
  full_name: string;
  private: boolean;
  updated_at: string;
  default_branch?: string;
};

export const Dashboard: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth();
  const reposFetchedRef = useRef(false);
  const requestSeqRef = useRef(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [isCreating, setIsCreating] = useState<string | null>(null);

  const loadProjects = async () => {
    const requestSeq = ++requestSeqRef.current;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      setIsLoading(true);
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 10_000);
      const data = await fetchApi<Project[]>("/projects", { signal: controller.signal });
      if (requestSeq === requestSeqRef.current) {
        setProjects(data);
      }
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        console.error("Failed to load projects:", error);
      }
      if (requestSeq === requestSeqRef.current) {
        setProjects([]);
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (requestSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!authLoading) {
      loadProjects();
    }
  }, [authLoading]);

  const loadGithubRepos = async () => {
    try {
      setIsLoadingRepos(true);
      setReposError(null);
      const data = await fetchApi<GitHubRepo[]>("/auth/repos");
      if (!Array.isArray(data)) {
        throw new Error("Unexpected response from server");
      }
      const validRepos = data.filter((repo) => typeof repo?.full_name === "string");
      setGithubRepos(validRepos);
    } catch (error: any) {
      console.error("Failed to load GitHub repos:", error);
      setReposError(error?.message || "Failed to load repositories");
    } finally {
      setIsLoadingRepos(false);
    }
  };

  useEffect(() => {
    if (isModalOpen && !reposFetchedRef.current) {
      reposFetchedRef.current = true;
      loadGithubRepos();
    }
    if (!isModalOpen) {
      reposFetchedRef.current = false;
    }
  }, [isModalOpen]);

  const handleCreateProject = async (repo: GitHubRepo) => {
    try {
      const repoFullName = repo.full_name;
      setIsCreating(repoFullName);
      const parts = repoFullName.split("/");
      const name = parts[parts.length - 1] || repoFullName;
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Math.random().toString(36).substring(2, 8);
      const repoUrl = `https://github.com/${repoFullName}`;
      const branch = repo.default_branch || "main";

      const project = await fetchApi<CreatedProject>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: name,
          slug: slug,
          repoUrl: repoUrl,
          repoFullName: repoFullName,
          branch,
        }),
      });

      if (!project?.id) {
        throw new Error("Project import succeeded but no project id was returned");
      }

      try {
        await fetchApi(`/projects/${project.id}/deploy`, {
          method: "POST",
          body: JSON.stringify({
            branch,
            commitMessage: "Initial deployment after import",
          }),
        });
      } catch (deployError) {
        console.error("Initial deployment trigger failed:", deployError);
      }

      setIsModalOpen(false);
      loadProjects();
    } catch (error) {
      alert("Failed to create project. Make sure you gave ServHub access to this repository in GitHub.");
      console.error(error);
    } finally {
      setIsCreating(null);
    }
  };

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
      p.repoFullName.toLowerCase().includes(projectSearch.toLowerCase()) ||
      p.slug.toLowerCase().includes(projectSearch.toLowerCase())
  );

  const filteredRepos = githubRepos.filter((repo) =>
    repo.full_name.toLowerCase().includes(repoSearch.trim().toLowerCase())
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar breadcrumbs={[{ label: "Projects" }]} />

      <main className="container" style={{ flex: 1, paddingBottom: "4rem" }}>
        {/* Metric Ribbon */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
            marginBottom: "2.5rem",
          }}
        >
          <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
            <div className="flex items-center justify-between text-muted text-xs font-semibold mb-2" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <span>Total Projects</span>
              <Layers size={16} style={{ color: "#818cf8" }} />
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#ffffff" }}>
              {isLoading ? "..." : projects.length}
            </div>
            <div className="text-xs text-muted mt-1">Live edge applications</div>
          </div>

          <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
            <div className="flex items-center justify-between text-muted text-xs font-semibold mb-2" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <span>Compute Architecture</span>
              <Server size={16} style={{ color: "#38bdf8" }} />
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#ffffff" }}>
              ARM64
            </div>
            <div className="text-xs text-muted mt-1">AWS Graviton2 &bull; Node 24</div>
          </div>

          <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
            <div className="flex items-center justify-between text-muted text-xs font-semibold mb-2" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <span>Edge Origin</span>
              <Globe size={16} style={{ color: "#10b981" }} />
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#ffffff" }}>
              Active
            </div>
            <div className="text-xs text-muted mt-1">Cloudflare TLS 1.3 + S3</div>
          </div>
        </div>

        {/* Action Header & Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
            marginBottom: "1.75rem",
          }}
        >
          <div style={{ position: "relative", minWidth: "280px", flex: "1 1 300px" }}>
            <Search
              size={16}
              style={{
                position: "absolute",
                left: "1rem",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
              }}
            />
            <input
              type="text"
              placeholder="Search projects by name, repo, or slug..."
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              style={{ paddingLeft: "2.5rem" }}
            />
          </div>

          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            <Plus size={16} />
            <span>New Project</span>
          </button>
        </div>

        {/* Project List */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center" style={{ padding: "6rem 0", gap: "1rem" }}>
            <Loader2 className="animate-spin" size={32} style={{ color: "var(--accent-primary)" }} />
            <p className="text-sm text-muted">Loading your cloud projects...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          projects.length === 0 ? (
            <div
              className="card"
              style={{
                padding: "4rem 2rem",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "14px",
                  background: "rgba(99, 102, 241, 0.12)",
                  color: "#818cf8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <FolderGit2 size={28} />
              </div>
              <h2 style={{ fontSize: "1.25rem", margin: 0 }}>No projects deployed yet</h2>
              <p style={{ maxWidth: "26rem", margin: "0 auto", fontSize: "0.9rem" }}>
                Connect a GitHub repository to trigger your first automated build and deploy to the edge.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => setIsModalOpen(true)}
                style={{ marginTop: "0.75rem" }}
              >
                <Plus size={16} />
                Import Repository
              </button>
            </div>
          ) : (
            <div className="card text-center" style={{ padding: "3rem" }}>
              <p className="text-muted" style={{ margin: 0 }}>
                No projects matched your search "<strong>{projectSearch}</strong>".
              </p>
            </div>
          )
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: "1.25rem",
            }}
          >
            {filteredProjects.map((project) => (
              <Link
                to={`/projects/${project.id}`}
                key={project.id}
                className="card card-interactive"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  padding: "1.5rem",
                }}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontFamily: "JetBrains Mono, monospace",
                        color: "var(--text-muted)",
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid var(--border-subtle)",
                        padding: "0.2rem 0.5rem",
                        borderRadius: "6px",
                      }}
                    >
                      {project.slug}
                    </span>
                    <ArrowUpRight size={18} style={{ color: "var(--text-muted)" }} />
                  </div>

                  <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem", color: "#f8fafc" }}>
                    {project.name}
                  </h3>

                  <div className="flex items-center gap-2 text-xs text-muted mb-4">
                    <FolderGit2 size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {project.repoFullName}
                    </span>
                  </div>
                </div>

                <div
                  className="flex items-center justify-between pt-3"
                  style={{
                    borderTop: "1px solid var(--border-subtle)",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "#10b981",
                        boxShadow: "0 0 6px #10b981",
                      }}
                    />
                    <span>Production</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock size={12} />
                    <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Modal: Import Git Repository */}
        {isModalOpen && (
          <div className="modal-overlay">
            <div className="modal-content">
              {/* Modal Header */}
              <div
                style={{
                  padding: "1.25rem 1.5rem",
                  borderBottom: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <FolderGit2 size={20} style={{ color: "var(--accent-primary)" }} />
                  <h2 style={{ fontSize: "1.15rem", margin: 0 }}>Import Git Repository</h2>
                </div>
                <button
                  className="btn btn-outline"
                  style={{ padding: "0.3rem 0.5rem" }}
                  onClick={() => setIsModalOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Body */}
              <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                <div style={{ position: "relative", marginBottom: "1rem" }}>
                  <Search
                    size={16}
                    style={{
                      position: "absolute",
                      left: "1rem",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--text-muted)",
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Search repositories in your GitHub account..."
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    style={{ paddingLeft: "2.5rem" }}
                    autoFocus
                  />
                </div>

                <div
                  style={{
                    overflowY: "auto",
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    paddingRight: "0.25rem",
                  }}
                >
                  {isLoadingRepos ? (
                    <div className="flex flex-col items-center justify-center my-10 gap-3">
                      <Loader2 className="animate-spin" size={24} style={{ color: "var(--accent-primary)" }} />
                      <p className="text-xs text-muted">Fetching repositories from GitHub...</p>
                    </div>
                  ) : reposError ? (
                    <div className="text-center my-8">
                      <p className="text-sm mb-3" style={{ color: "#fb7185" }}>{reposError}</p>
                      <button className="btn btn-outline" onClick={loadGithubRepos}>
                        Retry Fetch
                      </button>
                    </div>
                  ) : filteredRepos.length === 0 ? (
                    <div className="text-center text-muted my-10 text-sm">
                      {githubRepos.length === 0
                        ? "No repositories found. Ensure ServHub has GitHub authorization."
                        : `No repositories match "${repoSearch}".`}
                    </div>
                  ) : (
                    filteredRepos.map((repo) => (
                      <div
                        key={repo.id}
                        className="flex items-center justify-between p-3"
                        style={{
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "var(--radius-md)",
                          transition: "border-color 0.15s ease",
                        }}
                      >
                        <div style={{ overflow: "hidden", paddingRight: "1rem" }}>
                          <div className="flex items-center gap-2">
                            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#f8fafc" }}>
                              {repo.full_name}
                            </span>
                            {repo.private ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.2rem",
                                  fontSize: "0.65rem",
                                  background: "rgba(255,255,255,0.06)",
                                  padding: "0.1rem 0.4rem",
                                  borderRadius: "4px",
                                  color: "var(--text-muted)",
                                }}
                              >
                                <Lock size={10} /> Private
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: "0.65rem",
                                  background: "rgba(99, 102, 241, 0.12)",
                                  padding: "0.1rem 0.4rem",
                                  borderRadius: "4px",
                                  color: "#818cf8",
                                }}
                              >
                                Public
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted mt-1">
                            <span className="flex items-center gap-1">
                              <GitBranch size={12} /> {repo.default_branch || "main"}
                            </span>
                            <span>&bull;</span>
                            <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <button
                          className="btn btn-primary"
                          onClick={() => handleCreateProject(repo)}
                          disabled={isCreating !== null}
                          style={{ padding: "0.45rem 1rem", fontSize: "0.8rem", flexShrink: 0 }}
                        >
                          {isCreating === repo.full_name ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            "Import & Deploy"
                          )}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
