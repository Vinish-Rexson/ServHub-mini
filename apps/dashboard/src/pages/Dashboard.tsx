import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, FolderGit2, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { fetchApi } from "../lib/api";

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
  const { user, signOut, isLoading: authLoading } = useAuth();
  const reposFetchedRef = React.useRef(false);
  const requestSeqRef = React.useRef(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
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
      if (timeout) {
        clearTimeout(timeout);
      }

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
        alert("Project imported, but initial deployment could not be started. Open the project and trigger deploy manually.");
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

  const filteredRepos = githubRepos.filter((repo) =>
    repo.full_name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <div className="container">
      <nav className="navbar" style={{ margin: "-2rem -2rem 2rem -2rem" }}>
        <div className="nav-brand">ServHub</div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted">{user?.email}</div>
          <button className="btn btn-outline" onClick={signOut}>Logout</button>
        </div>
      </nav>

      <div className="flex items-center justify-between mb-8">
        <h1>Projects</h1>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={16} />
          New Project
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center mt-8">
          <Loader2 className="animate-spin text-muted" size={32} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : projects.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-4" style={{ padding: "4rem 2rem", textAlign: "center" }}>
          <FolderGit2 size={48} className="text-muted" />
          <h3>No projects yet</h3>
          <p className="text-muted">Connect a GitHub repository to get started.</p>
          <button className="btn btn-primary mt-4" onClick={() => setIsModalOpen(true)}>
            Import Repository
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.5rem" }}>
          {projects.map((project) => (
            <Link to={`/projects/${project.id}`} key={project.id} className="card project-card-link" style={{ display: "block" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ margin: 0 }}>{project.name}</h3>
                <FolderGit2 size={20} className="text-muted" />
              </div>
              <p className="text-sm text-muted mb-4">{project.repoFullName}</p>
              <div className="text-sm">
                <span className="text-muted">Slug: </span>
                <span className="font-medium">{project.slug}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50
        }}>
          <div className="card" style={{ width: "100%", maxWidth: "600px", margin: "1rem", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ margin: 0 }}>Import Git Repository</h2>
              <button className="btn btn-outline" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setIsModalOpen(false)}>Close</button>
            </div>
            
            <input
              type="text"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mb-4"
              style={{ width: "100%", padding: "0.75rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)" }}
              autoFocus
            />

            <div style={{ overflowY: "auto", flex: 1, borderTop: "1px solid var(--border-color)", margin: "0 -2rem", padding: "0 2rem" }}>
              {isLoadingRepos ? (
                <div className="flex flex-col items-center my-8 gap-2">
                  <Loader2 className="animate-spin text-muted" size={24} />
                  <p className="text-sm text-muted">Loading repositories...</p>
                </div>
              ) : reposError ? (
                <div className="text-center my-8">
                  <p className="text-muted mb-4" style={{ color: "#e53e3e" }}>⚠️ {reposError}</p>
                  <button className="btn btn-outline" onClick={loadGithubRepos}>Retry</button>
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="text-center text-muted my-8">No repositories found.</div>
              ) : (
                <div className="flex flex-col gap-2 py-4">
                  {filteredRepos.map((repo) => (
                    <div key={repo.id} className="flex items-center justify-between p-3" style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", backgroundColor: "var(--bg-secondary)" }}>
                      <div className="flex items-center gap-3">
                        <FolderGit2 size={20} className="text-muted" />
                        <div>
                          <div className="font-medium">{repo.full_name}</div>
                          <div className="text-xs text-muted mt-1">{repo.private ? "Private" : "Public"} &bull; Updated {new Date(repo.updated_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleCreateProject(repo)}
                        disabled={isCreating !== null}
                      >
                        {isCreating === repo.full_name ? <Loader2 size={16} className="animate-spin" /> : "Import"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};
