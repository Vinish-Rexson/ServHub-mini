import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, GitBranch, Globe2, ShieldCheck } from "lucide-react";
import { Logo } from "../components/Logo";

export const Landing: React.FC = () => (
  <div className="marketing-page">
    <nav className="marketing-nav">
      <Link to="/" className="marketing-brand" aria-label="ServHub home"><Logo size={28} /><span>ServHub</span></Link>
      <div className="marketing-actions"><Link to="/login" className="marketing-login">Log in</Link><Link to="/login" className="btn btn-primary">Create account <ArrowRight size={15} /></Link></div>
    </nav>
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker"><span /> A simpler way to ship client work</p>
          <h1>Deploy small projects on infrastructure you already own.</h1>
          <p className="hero-summary">ServHub gives studios a focused place to publish prototypes, landing pages, and client sites through their own domain, CDN, and cloud resources.</p>
          <div className="hero-actions"><Link to="/login" className="btn btn-primary">Open your workspace <ArrowRight size={16} /></Link><a href="#workflow" className="btn btn-outline">How ServHub fits in</a></div>
          <p className="hero-note">Built for the practical work between idea and a live client link.</p>
        </div>
        <div className="hero-panel" aria-label="ServHub workflow">
          <div className="panel-topline"><span>One studio workflow</span><span>ServHub</span></div>
          <div className="infrastructure-list">
            <div><GitBranch size={18} /><span><strong>Your repositories</strong><small>Projects stay connected to the source you work from.</small></span></div>
            <div><Globe2 size={18} /><span><strong>Your domain and CDN</strong><small>Publish under the web presence your studio already manages.</small></span></div>
            <div><ShieldCheck size={18} /><span><strong>Your cloud resources</strong><small>Keep deployment ownership close to the client work.</small></span></div>
          </div>
          <p className="panel-caption">A lightweight deployment layer for teams delivering many small, polished web projects.</p>
        </div>
      </section>
      <section className="confidence-row" aria-label="Platform capabilities"><span><GitBranch size={16} /> Built around GitHub repositories</span><span><Globe2 size={16} /> Made for your domain and delivery setup</span><span><ShieldCheck size={16} /> Clear ownership for client releases</span></section>
      <section id="workflow" className="workflow-section">
        <div className="section-intro"><p className="section-label">A straightforward release loop</p><h2>Keep client deployment work in your own ecosystem.</h2></div>
        <div className="workflow-grid">
          <article><span>01</span><h3>Bring in the project</h3><p>Connect a GitHub repository when a prototype or client page is ready to move beyond a local preview.</p></article>
          <article><span>02</span><h3>Deploy to your stack</h3><p>Trigger a release while keeping delivery on the domain, CDN, and cloud resources your studio controls.</p></article>
          <article><span>03</span><h3>Hand over a live link</h3><p>Use the deployment history to keep a clean record of what is live for each client project.</p></article>
        </div>
      </section>
    </main>
    <footer className="marketing-footer"><span>© {new Date().getFullYear()} ServHub</span><span>A deployment workspace for studio client work.</span></footer>
  </div>
);
