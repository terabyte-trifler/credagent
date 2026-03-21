import React, { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-boundary p-8">
          <AlertTriangle size={32} className="text-amber-500 mb-3" />
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Something went wrong</h3>
          <p className="text-xs text-gray-500 mb-3">{this.state.error?.message || 'Unknown error'}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-lg bg-surface-3 text-xs text-gray-300 hover:bg-surface-2 transition-colors">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
