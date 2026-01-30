// src/pages/SkinDepth.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend
} from "recharts";
import Equation from "../components/Equation";

// -------------------------
// Complex helpers
// -------------------------
type C = { re: number; im: number };
const c = (re = 0, im = 0): C => ({ re, im });
const cscale = (z: C, s: number): C => c(z.re * s, z.im * s);
const csqrt = (z: C): C => {
    const r = Math.hypot(z.re, z.im);
    const u = Math.sqrt((r + z.re) / 2);
    const v = Math.sqrt(Math.max(0, (r - z.re) / 2));
    return c(u, z.im < 0 ? -v : v);
};

// -------------------------
// CSV helpers
// -------------------------
function parseCSV3Cols(text: string) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return { x: [] as number[], y1: [] as number[], y2: [] as number[] };
    const maybeHeader = lines[0];
    const firstTokens = maybeHeader.split(/[,;\s]+/).filter(Boolean);
    const headerIsText = firstTokens.some((t) => isNaN(Number(t)));
    const startIdx = headerIsText ? 1 : 0;

    const x: number[] = [], y1: number[] = [], y2: number[] = [];
    for (let i = startIdx; i < lines.length; i++) {
        const toks = lines[i].split(/[,;\s]+/).filter(Boolean);
        if (toks.length < 3) continue;
        const a = Number(toks[0]);
        const b = Number(toks[1]);
        const d = Number(toks[2]);
        if ([a, b, d].every(Number.isFinite)) { x.push(a); y1.push(b); y2.push(d); }
    }
    const idx = x.map((_, i) => i).sort((i, j) => x[i] - x[j]);
    return { x: idx.map(i => x[i]), y1: idx.map(i => y1[i]), y2: idx.map(i => y2[i]) };
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function interp1(xs: number[], ys: number[], xq: number) {
    if (xs.length === 0) return NaN;
    if (xq <= xs[0]) return ys[0];
    if (xq >= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= xq) lo = mid; else hi = mid;
    }
    const t = (xq - xs[lo]) / (xs[hi] - xs[lo]);
    return lerp(ys[lo], ys[hi], t);
}

export default function SkinDepth() {
    const navigate = useNavigate();

    // Shared inputs
    const [c0, setC0] = useState(3e8);                  // m/s
    const [lambdaNm, setLambdaNm] = useState(1768.9018); // nm
    const fTHz = useMemo(() => (c0 / (lambdaNm * 1e-9)) / 1e12, [c0, lambdaNm]);

    // Tabs: "eps" (ε-form) | "cond" (conductor)
    const [tab, setTab] = useState<"eps" | "cond">("eps");

    // ε-form inputs
    const [useNK, setUseNK] = useState(false);
    const [reEps, setReEps] = useState(-148.1276);
    const [imEps, setImEps] = useState(20.5936);
    const [n, setN] = useState(0);
    const [k, setK] = useState(0);

    const eps_r_input: C = useMemo(() => {
        if (useNK) {
            const re = n * n - k * k;
            const im = -2 * n * k;
            return c(re, im);
        }
        return c(reEps, -imEps);
    }, [useNK, n, k, reEps, imEps]);

    // Conductor-form inputs
    const [sigma, setSigma] = useState(5.8e7);
    const [muR, setMuR] = useState(1);
    const mu0 = 4 * Math.PI * 1e-7;

    // CSV import
    type DataKind = "none" | "nk" | "eps";
    const [importFormat, setImportFormat] = useState<Exclude<DataKind, "none">>("nk");
    const [dataKind, setDataKind] = useState<DataKind>("none");
    const [lamCSV, setLamCSV] = useState<number[]>([]);
    const [col2CSV, setCol2CSV] = useState<number[]>([]);
    const [col3CSV, setCol3CSV] = useState<number[]>([]);
    const [useImportedForPoint, setUseImportedForPoint] = useState(true);

    const handleCSV = async (file: File | null) => {
        if (!file) return;
        const text = await file.text();
        const { x, y1, y2 } = parseCSV3Cols(text);
        setLamCSV(x); setCol2CSV(y1); setCol3CSV(y2);
        setDataKind(importFormat);
    };

    const eps_r_point: C = useMemo(() => {
        if (tab !== "eps" || !useImportedForPoint || dataKind === "none" || lamCSV.length === 0) return eps_r_input;
        const L = lambdaNm;
        if (dataKind === "nk") {
            const nL = interp1(lamCSV, col2CSV, L);
            const kL = interp1(lamCSV, col3CSV, L);
            if (!Number.isFinite(nL) || !Number.isFinite(kL)) return eps_r_input;
            return c(nL * nL - kL * kL, -2 * nL * kL);
        } else {
            const reL = interp1(lamCSV, col2CSV, L);
            const imL = interp1(lamCSV, col3CSV, L);
            if (!Number.isFinite(reL) || !Number.isFinite(imL)) return eps_r_input;
            return c(reL, -imL);
        }
    }, [tab, useImportedForPoint, dataKind, lamCSV, col2CSV, col3CSV, lambdaNm, eps_r_input]);

    const epsOut = useMemo(() => {
        const lambda = lambdaNm * 1e-9;
        const k0 = (2 * Math.PI) / lambda;
        const z = cscale(eps_r_point, -k0 * k0);
        const root = csqrt(z);
        const alpha = Math.max(0, root.re);
        const delta_m = alpha > 0 ? 1 / alpha : NaN;
        return { k0, root, alpha, delta_m };
    }, [lambdaNm, eps_r_point]);

    const condOut = useMemo(() => {
        const lambda = lambdaNm * 1e-9;
        const omega = 2 * Math.PI * (c0 / lambda);
        const mu = mu0 * muR;
        const denom = mu * sigma * omega;
        const delta_m = denom > 0 ? Math.sqrt(2 / denom) : NaN;
        return { omega, mu, delta_m };
    }, [lambdaNm, c0, mu0, muR, sigma]);

    const delta_m = tab === "eps" ? epsOut.delta_m : condOut.delta_m;
    const delta_nm = Number.isFinite(delta_m) ? delta_m * 1e9 : NaN;

    // Wavelength sweep
    const [lamStart, setLamStart] = useState(300);
    const [lamEnd, setLamEnd] = useState(3000);
    const [points, setPoints] = useState(200);

    const sweepData = useMemo(() => {
        const N = Math.max(2, Math.min(5000, Math.floor(points)));
        const a = Math.min(lamStart, lamEnd);
        const b = Math.max(lamStart, lamEnd);
        const arr = [];
        for (let i = 0; i < N; i++) {
            const L = a + (i * (b - a)) / (N - 1);
            let d_m = NaN;
            if (tab === "eps") {
                let eps_here: C = eps_r_input;
                if (dataKind !== "none" && lamCSV.length) {
                    if (dataKind === "nk") {
                        const nL = interp1(lamCSV, col2CSV, L);
                        const kL = interp1(lamCSV, col3CSV, L);
                        eps_here = (Number.isFinite(nL) && Number.isFinite(kL)) ? c(nL * nL - kL * kL, -2 * nL * kL) : eps_r_input;
                    } else {
                        const reL = interp1(lamCSV, col2CSV, L);
                        const imL = interp1(lamCSV, col3CSV, L);
                        eps_here = (Number.isFinite(reL) && Number.isFinite(imL)) ? c(reL, -imL) : eps_r_input;
                    }
                }
                const lambda = L * 1e-9;
                const k0 = (2 * Math.PI) / lambda;
                const z = cscale(eps_here, -k0 * k0);
                const root = csqrt(z);
                const alpha = Math.max(0, root.re);
                d_m = alpha > 0 ? 1 / alpha : NaN;
            } else {
                const lambda = L * 1e-9;
                const omega = 2 * Math.PI * (c0 / lambda);
                const mu = mu0 * muR;
                const denom = mu * sigma * omega;
                d_m = denom > 0 ? Math.sqrt(2 / denom) : NaN;
            }
            if (!Number.isFinite(d_m)) continue;
            arr.push({ lam: L, delta: d_m * 1e9 });
        }
        return arr;
    }, [tab, eps_r_input, dataKind, lamCSV, col2CSV, col3CSV, c0, mu0, muR, sigma, lamStart, lamEnd, points]);

    return (
        <div className="skindepth-page" style={{ padding: 16, display: "grid", gap: 16, gridTemplateColumns: "360px 1fr" }}>
            {/* LEFT PANEL: Controls */}
            <div className="left-panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>
                <button
                    className="mb-2 px-3 py-1 rounded bg-black/10 hover:bg-black/20 text-sm self-start"
                    onClick={() => navigate("/")}
                >
                    ← Back to Home
                </button>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-3">Model Type</div>
                    <div className="flex gap-2">
                        <button
                            className={`flex-1 py-1 px-2 rounded border text-sm ${tab === "eps" ? "bg-blue-600 text-white border-blue-600" : "bg-white/5 border-white/10"}`}
                            onClick={() => setTab("eps")}>ε-form</button>
                        <button
                            className={`flex-1 py-1 px-2 rounded border text-sm ${tab === "cond" ? "bg-blue-600 text-white border-blue-600" : "bg-white/5 border-white/10"}`}
                            onClick={() => setTab("cond")}>Conductor</button>
                    </div>
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-3">Parameters</div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                            <label className="text-xs opacity-70">λ (nm)</label>
                            <input type="number" step={1} value={lambdaNm} onChange={e => setLambdaNm(parseFloat(e.target.value))} className="w-full text-sm p-1 border rounded" />
                        </div>
                    </div>

                    {tab === "eps" ? (
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs opacity-70 block mb-1">Input Mode</label>
                                <select className="w-full text-sm p-1 border rounded" value={useNK ? "nk" : "eps"} onChange={(e) => setUseNK(e.target.value === "nk")}>
                                    <option value="eps">ε = ε′ − i ε″</option>
                                    <option value="nk">n, k</option>
                                </select>
                            </div>
                            {!useNK ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <div><label className="text-xs opacity-70">ε′</label><input type="number" value={reEps} onChange={e => setReEps(parseFloat(e.target.value))} className="w-full text-sm p-1 border rounded" /></div>
                                    <div><label className="text-xs opacity-70">ε″</label><input type="number" value={imEps} onChange={e => setImEps(parseFloat(e.target.value))} className="w-full text-sm p-1 border rounded" /></div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    <div><label className="text-xs opacity-70">n</label><input type="number" value={n} onChange={e => setN(parseFloat(e.target.value))} className="w-full text-sm p-1 border rounded" /></div>
                                    <div><label className="text-xs opacity-70">k</label><input type="number" value={k} onChange={e => setK(parseFloat(e.target.value))} className="w-full text-sm p-1 border rounded" /></div>
                                </div>
                            )}

                            {/* CSV Import */}
                            <div className="pt-2 border-t border-white/10">
                                <div className="text-xs font-semibold mb-2">Import Data (Optional)</div>
                                <input type="file" accept=".csv,.txt" onChange={(e) => handleCSV(e.target.files?.[0] ?? null)} className="w-full text-xs mb-2" />
                                <div className="text-xs opacity-60 mb-2">{dataKind === "none" ? "No data loaded" : `${lamCSV.length} pts loaded`}</div>
                                <label className="flex items-center gap-2 text-xs">
                                    <input type="checkbox" checked={useImportedForPoint} onChange={e => setUseImportedForPoint(e.target.checked)} />
                                    Use loaded data for calculations
                                </label>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs opacity-70">σ (S/m)</label>
                                <input type="number" step={1e5} value={sigma} onChange={e => setSigma(parseFloat(e.target.value))} className="w-full text-sm p-1 border rounded" />
                            </div>
                            <div>
                                <label className="text-xs opacity-70">μᵣ</label>
                                <input type="number" step={0.1} value={muR} onChange={e => setMuR(parseFloat(e.target.value))} className="w-full text-sm p-1 border rounded" />
                            </div>
                        </div>
                    )}
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-3">Sweep Config</div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                            <label className="text-xs opacity-70">λ Start</label>
                            <input type="number" value={lamStart} onChange={e => setLamStart(Number(e.target.value))} className="w-full text-sm p-1 border rounded" />
                        </div>
                        <div>
                            <label className="text-xs opacity-70">λ Stop</label>
                            <input type="number" value={lamEnd} onChange={e => setLamEnd(Number(e.target.value))} className="w-full text-sm p-1 border rounded" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs opacity-70">Points</label>
                        <input type="number" value={points} onChange={e => setPoints(Number(e.target.value))} className="w-full text-sm p-1 border rounded" />
                    </div>
                </section>
            </div>

            {/* RIGHT PANEL: Results & Graph */}
            <div className="right-panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>

                {/* Result Block */}
                <section className="card" style={{ padding: 16, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-4 text-center">Calculated Skin Depth</div>
                    <div className="flex justify-center gap-12 items-baseline">
                        <div className="text-center">
                            <div className="text-4xl font-bold font-mono text-blue-600 mb-1">
                                {Number.isFinite(delta_nm) ? delta_nm.toFixed(2) : "—"}
                            </div>
                            <div className="text-sm opacity-60">nm</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold font-mono text-gray-500 mb-1">
                                {Number.isFinite(delta_nm) ? (delta_nm / 1000).toFixed(4) : "—"}
                            </div>
                            <div className="text-sm opacity-60">μm</div>
                        </div>
                    </div>
                </section>

                {/* Graph Block */}
                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-2">Wavelength Sweep</div>
                    <div style={{ height: 400 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={sweepData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="lam" type="number" domain={["auto", "auto"]}
                                    label={{ value: "λ (nm)", position: "insideBottom", offset: -5 }} />
                                <YAxis dataKey="delta" type="number" domain={["auto", "auto"]}
                                    label={{ value: "δ (nm)", angle: -90, position: "insideLeft" }} />
                                <Tooltip formatter={(val: number) => val.toFixed(2)} labelFormatter={(lbl) => `λ: ${Number(lbl).toFixed(1)} nm`} />
                                <Legend />
                                <Line type="monotone" dataKey="delta" stroke="#2563eb" strokeWidth={2} dot={false} name="Skin Depth (nm)" isAnimationActive={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </section>

                {/* Equations Block */}
                <section className="panel eq-panel">
                    <h3>Equations</h3>
                    <div className="eq-katex">
                        <Equation block latex={"k_0=\\tfrac{2\\pi}{\\lambda}"} />
                        <Equation block latex={"\\textbf{ε-form: }\\quad \\delta = \\dfrac{1}{\\operatorname{Re}\\{\\sqrt{-k_0^2\\,\\varepsilon_r}\\}}"} />
                        <Equation block latex={"\\varepsilon_r = \\varepsilon' - i\\,\\varepsilon''\\quad(\\text{MATLAB convention})"} />
                        <Equation block latex={"\\textbf{Conductor: }\\quad \\delta = \\sqrt{\\tfrac{2}{\\mu\\,\\sigma\\,\\omega}}\\,,\\quad \\mu=\\mu_0\\,\\mu_r"} />
                    </div>
                </section>
            </div>
        </div>
    );
}
