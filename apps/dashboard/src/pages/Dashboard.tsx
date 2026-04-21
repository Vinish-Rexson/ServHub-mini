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

export const Dashboard: React.FC = () => {
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const loadProjects = async () => {
    try {
      setIsLoading(true);
      const data = await fetchApi("/projects");
      setProjects(data);
    } catch (error) {
      console.error("Failed to load projects:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepoName.trim()) return;

    try {
      setIsCreating(true);
      const parts = newRepoName.split("/");
      const name = parts[parts.length - 1];
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Math.random().toString(36).substring(2, 8);
      const repoUrl = `https://github.com/${newRepoName}`;

      await fetchApi("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: name,
          slug: slug,
          repoUrl: repoUrl,
          repoFullName: newRepoName,
          branch: "main",
        }),
      });

      setIsModalOpen(false);
      setNewRepoName("");
      loadProjects();
    } catch (error) {
      alert("Failed to create project. Ensure the repo exists and the app has access.");
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

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
            <Link to={`/projects/${project.id}`} key={project.id} className="card" style={{ display: "block" }}>
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
          <div className="card" style={{ width: "100%", maxWidth: "500px", margin: "1rem" }}>
            <h2 className="mb-4">Import Git Repository</h2>
            <form onSubmit={handleCreateProject}>
              <div className="mb-4">
                <label className="text-sm font-medium" style={{ display: "block", marginBottom: "0.5rem" }}>
                  Repository Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. facebook/react"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  autoFocus
                  required
                />
                <p className="text-sm text-muted mt-2">Enter the full name of a public repository.</p>
              </div>
              <div className="flex justify-between mt-8">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isCreating || !newRepoName.trim()}>
                  {isCreating ? <Loader2 size={16} className="animate-spin" /> : "Import"}
                </button>
              </div>
            </form>
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
