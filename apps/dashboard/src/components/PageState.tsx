import React from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

type StateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export const PageLoader: React.FC<{ label?: string }> = ({ label = "Loading" }) => (
  <div className="page-state" role="status" aria-live="polite">
    <Loader2 className="animate-spin" size={28} />
    <span>{label}</span>
  </div>
);

export const FullPageLoader: React.FC<{ label?: string }> = ({ label = "Preparing your workspace" }) => (
  <div className="full-page-state" role="status" aria-live="polite">
    <Loader2 className="animate-spin" size={30} />
    <span>{label}</span>
  </div>
);

export const StateNotice: React.FC<StateProps> = ({
  title = "Something went wrong",
  message = "We couldn’t load this page. Please try again.",
  onRetry,
}) => (
  <div className="state-notice" role="alert">
    <AlertCircle size={22} />
    <div>
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry && <button className="btn btn-outline" onClick={onRetry}><RefreshCw size={15} /> Try again</button>}
    </div>
  </div>
);
