import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; msg?: string };

export default class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false, msg: "" };

    static getDerivedStateFromError(err: any): State {
        return { hasError: true, msg: err?.message || String(err) };
    }

    componentDidCatch(error: any, info: any) {
        console.error("UI ErrorBoundary caught:", error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    margin: 24, padding: 16, borderRadius: 12,
                    border: "1px solid #f99", background: "#300", color: "#fee"
                }}>
                    <h2 style={{ marginTop: 0 }}>Something went wrong.</h2>
                    <div style={{ opacity: 0.9, marginBottom: 12 }}>{this.state.msg}</div>
                    <button
                        onClick={() => { this.setState({ hasError: false, msg: "" }); location.reload(); }}
                        style={{
                            padding: "8px 12px", borderRadius: 8, border: "1px solid #fdd",
                            background: "#600", color: "#fff", cursor: "pointer"
                        }}
                    >
                        Reload
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
