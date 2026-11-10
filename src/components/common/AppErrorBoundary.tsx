import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
  boundaryName?: string;
  onReset?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  public state: AppErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const message =
      error instanceof Error ? error.message : 'Terjadi kendala saat menampilkan halaman.';
    return {
      hasError: true,
      errorMessage: message,
    };
  }

  public componentDidCatch(error: unknown) {
    const safeMsg = error instanceof Error ? error.message : 'Unknown render error';
    console.warn(
      `[APP] Rendering fallback state (boundary=${this.props.boundaryName || 'app'}): ${safeMsg}`
    );
  }

  private handleRecover = () => {
    this.setState({ hasError: false, errorMessage: '' });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[260px] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#E5E5E3] rounded-xl p-5 shadow-2xs space-y-3 text-[#252525]">
            <div className="text-sm font-semibold text-[#1F2937]">
              Tampilan halaman perlu dimuat ulang
            </div>
            <p className="text-xs text-[#57564F] leading-relaxed">
              Sistem mendeteksi gangguan sementara saat menampilkan bagian ini. Data operasional Anda tetap aman.
            </p>
            {this.state.errorMessage && (
              <div className="text-[11px] font-mono bg-[#FAFAF9] border border-[#EAEAEA] rounded px-2.5 py-1.5 text-[#6B6B68] break-words">
                {this.state.errorMessage}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleRecover}
                className="px-3.5 py-1.5 rounded-lg bg-[#1F7A63] hover:bg-[#186350] text-white text-xs font-medium transition-colors cursor-pointer"
              >
                Coba Tampilkan Kembali
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
