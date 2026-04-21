import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, GitBranch, GitCommit, Loader2 } from "lucide-react";
import { fetchApi } from "../lib/api";

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
};

export const ProjectDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const [projData, depData] = await Promise.all([
          fetchApi(`/projects/${id}`),
          fetchApi(`/projects/${id}/deployments`)
        ]);
        setProject(projData);
        setDeployments(depData);
      } catch (error) {
        console.error("Failed to load project details:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (id) loadData();
  }, [id]);

  if (isLoading) {
    return (
      <div className="container flex justify-center mt-8">
        <Loader2 className="animate-spin text-muted" size={32} />
      </div>
    );
  }

  if (!project) {
    return <div className="container text-center mt-8">Project not found</div>;
  }

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    return <span className={`badge badge-${s}`}>{status}</span>;
  };

  return (
    <div className="container">
      <div className="mb-8 flex items-center gap-4">
        <Link to="/" className="btn btn-outline" style={{ padding: "0.5rem" }}>
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 style={{ margin: 0 }}>{project.name}</h1>
          <p className="text-muted" style={{ margin: 0 }}>{project.repoFullName}</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 style={{ margin: 0 }}>Deployments</h2>
        </div>

        {deployments.length === 0 ? (
          <div className="text-center text-muted" style={{ padding: "3rem" }}>
            No deployments yet. Push to your repository to trigger a build.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {deployments.map((dep) => (
              <div key={dep.id} className="flex items-center justify-between" style={{ padding: "1rem", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)" }}>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <Link to={`/deployments/${dep.id}`} className="font-medium" style={{ fontSize: "1.125rem" }}>
                      {dep.commitMessage || `Commit ${dep.commitSha.slice(0, 7)}`}
                    </Link>
                    {getStatusBadge(dep.status)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted">
                    <span className="flex items-center gap-1"><GitBranch size={14} /> {dep.branch}</span>
                    <span className="flex items-center gap-1"><GitCommit size={14} /> {dep.commitSha.slice(0, 7)}</span>
                    <span>{new Date(dep.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                
                {dep.deployedUrl && (
                  <a href={dep.deployedUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                    Visit <ExternalLink size={14} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};
