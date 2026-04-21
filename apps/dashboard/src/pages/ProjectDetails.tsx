import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, GitBranch, GitCommit, Loader2 } from "lucide-react";
import { fetchApi } from "../lib/api";
import { resolveDeploymentUrl } from "../lib/deploymentUrl";

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
  const requestSeqRef = useRef(0);
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

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
          fetchApi<Deployment[]>(`/projects/${id}/deployments`, { signal: controller.signal })
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

  if (isLoading) {
    return (
      <div className="container flex justify-center mt-8">
        <Loader2 className="animate-spin text-muted" size={32} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container text-center mt-8">
        {errorMessage || "Project not found"}
      </div>
    );
  }

  const handleDeploy = async () => {
    const isRedeploy = deployments.length > 0;

    try {
      setIsDeploying(true);
      setDeployError(null);

      const deployment = await fetchApi<Deployment>(`/projects/${project.id}/deploy`, {
        method: "POST",
        body: JSON.stringify({
          commitMessage: isRedeploy ? "Manual redeploy" : "Initial deployment",
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
          <button
            className="btn btn-primary"
            onClick={handleDeploy}
            disabled={isDeploying}
          >
            {isDeploying ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {deployments.length > 0 ? "Redeploying..." : "Deploying..."}
              </>
            ) : deployments.length > 0 ? (
              "Redeploy"
            ) : (
              "Deploy"
            )}
          </button>
        </div>

        {deployError && (
          <p className="text-sm" style={{ color: "#dc2626", marginTop: "-0.5rem", marginBottom: "1rem" }}>
            {deployError}
          </p>
        )}

        {deployments.length === 0 ? (
          <div className="text-center text-muted" style={{ padding: "3rem" }}>
            <p>No deployments yet. Click Deploy to start the first build.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {deployments.map((dep) => {
              const liveUrl = resolveDeploymentUrl(dep.id, dep.deployedUrl);

              return (
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

                  {liveUrl && (
                    <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                      Visit <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              );
            })}
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
