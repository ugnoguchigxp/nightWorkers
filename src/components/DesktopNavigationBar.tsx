import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';

function navigateBack() {
  window.history.back();
}

function navigateForward() {
  window.history.forward();
}

function reloadWindow() {
  window.location.reload();
}

export function DesktopNavigationBar() {
  return (
    <nav className="nightworkers-desktop-nav" aria-label="Desktop navigation">
      <div className="nightworkers-desktop-nav-left">
        <div className="nightworkers-desktop-window-control-space" aria-hidden="true" />
        <button
          type="button"
          className="nightworkers-desktop-nav-button"
          onClick={navigateBack}
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="nightworkers-desktop-nav-button"
          onClick={navigateForward}
          aria-label="Forward"
          title="Forward"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="nightworkers-desktop-nav-button"
          onClick={reloadWindow}
          aria-label="Reload"
          title="Reload"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="nightworkers-desktop-nav-title">NightWorkers</div>
    </nav>
  );
}
