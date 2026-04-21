import React, { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { fetchApi } from "../lib/api";
import { resolveDeploymentUrl } from "../lib/deploymentUrl";
import { supabase } from "../lib/supabase";

type Deployment = {
  id: string;
  projectId: string;
  commitSha: string;
  status: string;
  deployedUrl: string | null;
  createdAt: string;
  project: { name: string };
};

type BuildLog = {
  id: string;
  message: string;
  level: "INFO" | "WARN" | "ERROR";
  timestamp: string;
};

type DeploymentResponse = Deployment & {
  buildLogs?: BuildLog[];
};

type DeploymentRealtimeRow = {
  status?: string;
  deployed_url?: string | null;
  project_id?: string;
  commit_sha?: string;
  created_at?: string;
};

type BuildLogRealtimeRow = {
  id?: string;
  message?: string;
  level?: string;
  timestamp?: string;
};

function mergeDeploymentRealtimeUpdate(current: Deployment, row: DeploymentRealtimeRow): Deployment {
  return {
    ...current,
    status: typeof row.status === "string" ? row.status : current.status,
    deployedUrl: typeof row.deployed_url === "string" || row.deployed_url === null ? row.deployed_url : current.deployedUrl,
    projectId: typeof row.project_id === "string" ? row.project_id : current.projectId,
    commitSha: typeof row.commit_sha === "string" ? row.commit_sha : current.commitSha,
    createdAt: typeof row.created_at === "string" ? row.created_at : current.createdAt,
  };
}

function normalizeRealtimeBuildLog(row: BuildLogRealtimeRow): BuildLog | null {
  if (typeof row.id !== "string" || typeof row.message !== "string") {
    return null;
  }

  const normalizedLevel: BuildLog["level"] =
    row.level === "WARN" || row.level === "ERROR" || row.level === "INFO" ? row.level : "INFO";

  return {
    id: row.id,
    message: row.message,
    level: normalizedLevel,
    timestamp: typeof row.timestamp === "string" ? row.timestamp : new Date().toISOString(),
  };
}

export const DeploymentView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<BuildLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) {
      setIsLoading(false);
      return;
    }

    let isSubscribed = true;

    const loadData = async () => {
      try {
        const depData = await fetchApi<DeploymentResponse>(`/deployments/${id}`);
        if (isSubscribed) {
          setDeployment(depData);
          setLogs(Array.isArray(depData.buildLogs) ? depData.buildLogs : []);
        }
      } catch (error) {
        console.error("Failed to load deployment:", error);
      } finally {
        if (isSubscribed) setIsLoading(false);
      }
    };

    loadData();

    // Subscribe to deployment status changes
    const depSubscription = supabase
      .channel(`deployment-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deployments", filter: `id=eq.${id}` },
        (payload) => {
          if (isSubscribed) {
            const row = payload.new as DeploymentRealtimeRow;
            setDeployment((prev) => (prev ? mergeDeploymentRealtimeUpdate(prev, row) : null));
          }
        }
      )
      .subscribe();

    // Subscribe to new build logs
    const logsSubscription = supabase
      .channel(`logs-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "build_logs", filter: `deployment_id=eq.${id}` },
        (payload) => {
          if (isSubscribed) {
            const parsed = normalizeRealtimeBuildLog(payload.new as BuildLogRealtimeRow);
            if (parsed) {
              setLogs((prev) => [...prev, parsed]);
            }
          }
        }
      )
      .subscribe();

    return () => {
      isSubscribed = false;
      depSubscription.unsubscribe();
      logsSubscription.unsubscribe();
    };
  }, [id]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  if (isLoading) {
    return (
      <div className="container flex justify-center mt-8">
        <Loader2 className="animate-spin text-muted" size={32} />
      </div>
    );
  }

  if (!deployment) {
    return <div className="container text-center mt-8">Deployment not found</div>;
  }

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    return <span className={`badge badge-${s}`}>{status}</span>;
  };

  const liveUrl = resolveDeploymentUrl(deployment.id, deployment.deployedUrl);

  return (
    <div className="container">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to={`/projects/${deployment.projectId}`} className="btn btn-outline" style={{ padding: "0.5rem" }}>
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 style={{ margin: 0 }}>Deployment</h1>
            <p className="text-muted" style={{ margin: 0 }}>
              {deployment.project.name} &bull; {deployment.commitSha.slice(0, 7)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {getStatusBadge(deployment.status)}
          {liveUrl && (
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              Visit Live Site <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "1rem", backgroundColor: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#ff5f56" }} />
          <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#ffbd2e" }} />
          <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#27c93f" }} />
          <span className="text-sm font-medium ml-2 text-muted">Build Logs</span>
        </div>
        <div className="terminal-window" ref={terminalRef}>
          {logs.length === 0 ? (
            <div className="text-muted italic">Waiting for build to start...</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className={`log-line log-${log.level.toLowerCase()}`}>
                <span style={{ opacity: 0.5, marginRight: "1rem", fontSize: "0.75rem" }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                {log.message}
              </div>
            ))
          )}
          {["QUEUED", "BUILDING", "UPLOADING"].includes(deployment.status) && (
            <div className="mt-4 flex items-center gap-2 log-info" style={{ opacity: 0.7 }}>
              <Loader2 size={14} className="animate-spin" />
              Building...
            </div>
          )}
        </div>
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};
