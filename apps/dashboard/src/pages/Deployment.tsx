import React, { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Terminal,
  Copy,
  Check,
  RotateCcw,
  GitCommit,
  Clock,
  Radio,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { fetchApi } from "../lib/api";
import { resolveDeploymentUrl } from "../lib/deploymentUrl";
import { supabase } from "../lib/supabase";
import { Navbar } from "../components/Navbar";

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
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setDeployment(null);
    setLogs([]);

    const loadData = async () => {
      try {
        const depData = await fetchApi<DeploymentResponse>(`/deployments/${id}`);
        if (mountedRef.current) {
          setDeployment(depData);
          setLogs(Array.isArray(depData.buildLogs) ? depData.buildLogs : []);
        }
      } catch (error) {
        console.error("Failed to load deployment:", error);
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };

    void loadData();

    // Subscribe to deployment status updates
    const depSubscription = supabase
      .channel(`deployment-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deployments", filter: `id=eq.${id}` },
        (payload) => {
          if (mountedRef.current) {
            const row = payload.new as DeploymentRealtimeRow;
            setDeployment((prev) => (prev ? mergeDeploymentRealtimeUpdate(prev, row) : null));
          }
        }
      )
      .subscribe();

    // Subscribe to live build logs
    const logsSubscription = supabase
      .channel(`logs-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "build_logs", filter: `deployment_id=eq.${id}` },
        (payload) => {
          if (mountedRef.current) {
            const parsed = normalizeRealtimeBuildLog(payload.new as BuildLogRealtimeRow);
            if (parsed) {
              setLogs((prev) => [...prev, parsed]);
            }
          }
        }
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      void depSubscription.unsubscribe();
      void logsSubscription.unsubscribe();
    };
  }, [id]);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const copyAllLogs = () => {
    const raw = logs.map((l) => `[${l.timestamp}] [${l.level}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(raw);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
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
        <Navbar breadcrumbs={[{ label: "Projects", href: "/dashboard" }, { label: "Deployment" }]} />
        <div className="container flex flex-col items-center justify-center" style={{ flex: 1, padding: "6rem 0" }}>
          <Loader2 className="animate-spin" size={32} style={{ color: "var(--accent-primary)" }} />
          <p className="text-sm text-muted mt-4">Connecting to real-time build stream...</p>
        </div>
      </div>
    );
  }

  if (!deployment) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Navbar breadcrumbs={[{ label: "Projects", href: "/dashboard" }, { label: "Not Found" }]} />
        <div className="container text-center mt-8">
          <p className="text-secondary">Deployment not found</p>
          <Link to="/dashboard" className="btn btn-primary mt-4">Return to Dashboard</Link>
        </div>
      </div>
    );
  }

  const liveUrl = resolveDeploymentUrl(deployment.id, deployment.deployedUrl);
  const isBuilding = ["QUEUED", "BUILDING", "UPLOADING"].includes(deployment.status);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar
        breadcrumbs={[
          { label: "Projects", href: "/dashboard" },
          { label: deployment.project.name, href: `/projects/${deployment.projectId}` },
          { label: `Deploy #${deployment.commitSha.slice(0, 7)}` },
        ]}
      />

      <main className="container" style={{ flex: 1, paddingBottom: "4rem" }}>
        {/* Header Bar */}
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
          <div className="flex items-center gap-3">
            <Link
              to={`/projects/${deployment.projectId}`}
              className="btn btn-outline"
              style={{ padding: "0.45rem", borderRadius: "8px" }}
              title="Back to Project"
            >
              <ArrowLeft size={18} />
            </Link>

            <div>
              <div className="flex items-center gap-2">
                <h1 style={{ fontSize: "1.5rem", margin: 0, color: "#ffffff" }}>
                  Deployment Details
                </h1>
                {getStatusBadge(deployment.status)}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted mt-1">
                <span className="flex items-center gap-1 font-mono">
                  <GitCommit size={13} /> {deployment.commitSha.slice(0, 7)}
                </span>
                <span>&bull;</span>
                <span className="flex items-center gap-1">
                  <Clock size={13} /> {new Date(deployment.createdAt).toLocaleString()}
                </span>
                <span>&bull;</span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <Radio size={12} /> Supabase Realtime Active
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {liveUrl && (
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                <span>Visit Live Site</span>
                <ExternalLink size={15} />
              </a>
            )}
          </div>
        </div>

        {/* Terminal Window Card */}
        <div
          className="card"
          style={{
            padding: 0,
            overflow: "hidden",
            border: "1px solid var(--border-hover)",
            background: "#06070a",
          }}
        >
          {/* Terminal Window Chrome */}
          <div
            style={{
              padding: "0.75rem 1.25rem",
              background: "rgba(18, 21, 30, 0.95)",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <div className="flex items-center gap-2">
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
                servhub-build-worker // stdout &bull; {logs.length} lines
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="btn btn-outline"
                onClick={() => setAutoScroll(!autoScroll)}
                style={{
                  padding: "0.25rem 0.6rem",
                  fontSize: "0.75rem",
                  background: autoScroll ? "rgba(99, 102, 241, 0.15)" : "transparent",
                  color: autoScroll ? "#818cf8" : "var(--text-muted)",
                  borderColor: autoScroll ? "rgba(99, 102, 241, 0.3)" : "var(--border-subtle)",
                }}
              >
                Auto-scroll: {autoScroll ? "ON" : "OFF"}
              </button>

              <button
                className="btn btn-outline"
                onClick={copyAllLogs}
                style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem", gap: "0.3rem" }}
              >
                {copiedLogs ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedLogs ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>

          {/* Terminal Logs Output */}
          <div className="terminal-window" ref={terminalRef}>
            {logs.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontStyle: "italic", padding: "1rem 0" }}>
                Waiting for build worker to pick up job from SQS queue...
              </div>
            ) : (
              logs.map((log) => {
                const isCommand = log.message.startsWith("$");
                const isSuccess = log.message.includes("✓") || log.message.toLowerCase().includes("ready") || log.message.toLowerCase().includes("healthy");

                return (
                  <div key={log.id} className={`log-line log-${log.level.toLowerCase()}`}>
                    <span className="log-timestamp">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      style={{
                        color: isCommand ? "#38bdf8" : isSuccess ? "#34d399" : undefined,
                        fontWeight: isCommand ? 600 : undefined,
                      }}
                    >
                      {log.message}
                    </span>
                  </div>
                );
              })
            )}

            {isBuilding && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  color: "#818cf8",
                  marginTop: "0.75rem",
                  paddingTop: "0.75rem",
                  borderTop: "1px dashed rgba(255,255,255,0.08)",
                }}
              >
                <Loader2 size={14} className="animate-spin" />
                <span style={{ fontSize: "0.75rem", fontFamily: "JetBrains Mono, monospace" }}>
                  Build in progress on AWS Graviton2 ARM64...
                </span>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
