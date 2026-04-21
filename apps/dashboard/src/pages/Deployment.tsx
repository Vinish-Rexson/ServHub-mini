import React, { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { fetchApi } from "../lib/api";
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

export const DeploymentView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<BuildLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;

    let isSubscribed = true;

    const loadData = async () => {
      try {
        const depData = await fetchApi(`/deployments/${id}`);
        if (isSubscribed) {
          setDeployment(depData);
          setLogs(depData.buildLogs || []);
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
            setDeployment((prev) => prev ? { ...prev, ...payload.new as any } : null);
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
            setLogs((prev) => [...prev, payload.new as BuildLog]);
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
          {deployment.deployedUrl && (
            <a href={deployment.deployedUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
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
