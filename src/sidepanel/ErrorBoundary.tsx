import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

// Keeps a render-time crash from blanking the whole side panel. Shows the error
// and a reset button instead of an empty window.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Picanthon side panel crashed:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-medium text-destructive">Algo se rompió en el panel</p>
          <pre className="max-w-full overflow-auto rounded bg-muted p-2 text-left font-mono text-[11px] text-muted-foreground">
            {this.state.error.message}
          </pre>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => this.setState({ error: null })}
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
