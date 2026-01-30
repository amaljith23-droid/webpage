import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Equation from "../components/Equation";

/* -------------------------------- Types (shared with worker shape) ------------------------------- */
type Pol = "avg" | "s" | "p";

type MaterialKind = "CONST" | "CAUCHY" | "SELLMEIER" | "DRUDE" | "TABLE";

type MatCONST = { kind: "CONST"; name?: string; n: number; k: number };
type MatCAUCHY = { kind: "CAUCHY"; name?: string; A: number; B: number; C: number; kConst?: number };
type MatSELL = {
    kind: "SELLMEIER";
    name?: string;
    B1: number; C1: number;
    B2: number; C2: number;
    B3: number; C3: number;
    kConst?: number;
};
type DrudeLorentzTerm = { f: number; w0_eV: number; gamma_eV: number };
type MatDRUDE = {
    kind: "DRUDE";
    name?: string;
    epsInf: number;
    wp_eV: number;
    gamma_eV: number;
    lorentz?: DrudeLorentzTerm[];
};
type MatTABLE = { kind: "TABLE"; name?: string; lam_nm: number[]; n: number[]; k: number[] };

type MaterialDef = MatCONST | MatCAUCHY | MatSELL | MatDRUDE | MatTABLE;

type Layer = { id: string; d_nm: number; materialKey: string };

type Row = {
    lambda: number;
    R: number; T: number; A: number;
    Rs: number; Ts: number; As: number;
    Rp: number; Tp: number; Ap: number;
};

type WorkerPayload = {
    wavelengths: number[];
    thetaDeg: number;
    pol: Pol;
    ambient_n0: number;
    substrate: MaterialDef;
    layers: { d_nm: number; material: MaterialDef }[];
};

/* ----------------------------------- Helpers ----------------------------------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function linspace(a: number, b: number, n: number) {
    if (n <= 1) return [a];
    const arr = new Array(n);
    const step = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) arr[i] = a + i * step;
    return arr;
}

function download(filename: string, text: string) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
}

/* ------------------------- Default material library (editable) ------------------------- */
type MaterialMap = Record<string, MaterialDef>;

const DEFAULT_MATERIALS: MaterialMap = {
    Air: { kind: "CONST", name: "Air", n: 1.0, k: 0 },
    BK7_Cauchy: { kind: "CAUCHY", name: "BK7 (vis.)", A: 1.5046, B: 0.00420, C: 0.000000, kConst: 0 },
    SiO2_Cauchy: { kind: "CAUCHY", name: "SiO₂ (vis.)", A: 1.4580, B: 0.00354, C: 0.0, kConst: 0 },
    Si_CONST: { kind: "CONST", name: "Si (rough)", n: 3.5, k: 0.02 },
    Au_Drude: { kind: "DRUDE", name: "Au (rough)", epsInf: 9.5, wp_eV: 9.03, gamma_eV: 0.07 },
};

/* --------------------------------- Graph --------------------------------- */
function RTAGraph({ rows }: { rows: Row[] }) {
    if (!rows.length) return (
        <div className="h-80 w-full bg-gray-50 rounded border border-gray-200 flex items-center justify-center text-gray-400">
            <div className="text-center">
                <p>No simulation data</p>
                <p className="text-xs opacity-70">Configuration will auto-run</p>
            </div>
        </div>
    );

    return (
        <div className="w-full bg-white rounded border border-gray-100 p-2 relative" style={{ height: '320px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                        dataKey="lambda"
                        type="number"
                        domain={['auto', 'auto']}
                        tick={{ fontSize: 11 }}
                        label={{ value: 'Wavelength (nm)', position: 'insideBottom', offset: -10, fontSize: 12 }}
                    />
                    <YAxis
                        domain={[0, 1]}
                        tick={{ fontSize: 11 }}
                        label={{ value: 'R / T / A', angle: -90, position: 'insideLeft', fontSize: 12 }}
                    />
                    <Tooltip
                        contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        itemStyle={{ padding: 0 }}
                        labelFormatter={(v) => `${Number(v).toFixed(1)} nm`}
                    />
                    <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
                    <Line type="monotone" dataKey="R" stroke="#2563eb" dot={false} strokeWidth={2} name="Reflectance" animationDuration={300} />
                    <Line type="monotone" dataKey="T" stroke="#16a34a" dot={false} strokeWidth={2} name="Transmittance" animationDuration={300} />
                    <Line type="monotone" dataKey="A" stroke="#dc2626" dot={false} strokeWidth={2} name="Absorptance" animationDuration={300} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

/* --------------------------- Material Editor (inline, lightweight) --------------------------- */
function MaterialEditor({
    materialKey,
    materials,
    setMaterials
}: {
    materialKey: string;
    materials: MaterialMap;
    setMaterials: React.Dispatch<React.SetStateAction<MaterialMap>>;
}) {
    const mat = materials[materialKey];
    const [local, setLocal] = useState<MaterialDef>(mat);

    useEffect(() => setLocal(mat), [materialKey, mat]);

    function save() {
        const name = (local as any).name || materialKey;
        setMaterials(prev => ({ ...prev, [materialKey]: { ...local, name } as MaterialDef }));
    }

    function onCSVLoad(text: string) {
        // CSV with headers lam_nm,n,k or plain three columns
        const lines = text.trim().split(/\r?\n/).filter(Boolean);
        let lam: number[] = [], n: number[] = [], k: number[] = [];
        for (let i = 0; i < lines.length; i++) {
            const parts = lines[i].split(/[,\s;]+/).map(s => s.trim());
            if (i === 0 && /lam/i.test(parts[0])) continue;
            if (parts.length < 3) continue;
            const L = Number(parts[0]), N = Number(parts[1]), K = Number(parts[2]);
            if (Number.isFinite(L) && Number.isFinite(N) && Number.isFinite(K)) {
                lam.push(L); n.push(N); k.push(K);
            }
        }
        setLocal({ kind: "TABLE", name: (local as any).name || "Table", lam_nm: lam, n, k });
    }

    return (
        <div className="space-y-2">
            <div className="text-sm opacity-80">Editing: <b>{(local as any).name || materialKey}</b></div>

            {/* Kind selector */}
            <label className="block text-xs">Model</label>
            <select
                className="w-full"
                value={local.kind}
                onChange={(e) => {
                    const k = e.target.value as MaterialKind;
                    let next: MaterialDef = local;
                    if (k === "CONST") next = { kind: "CONST", name: (local as any).name, n: 1.5, k: 0 };
                    if (k === "CAUCHY") next = { kind: "CAUCHY", name: (local as any).name, A: 1.5, B: 0.004, C: 0, kConst: 0 };
                    if (k === "SELLMEIER") next = { kind: "SELLMEIER", name: (local as any).name, B1: 1, C1: 0.01, B2: 0, C2: 1, B3: 0, C3: 1, kConst: 0 };
                    if (k === "DRUDE") next = { kind: "DRUDE", name: (local as any).name, epsInf: 9, wp_eV: 9, gamma_eV: 0.07 };
                    if (k === "TABLE") next = { kind: "TABLE", name: (local as any).name, lam_nm: [400, 700], n: [1.5, 1.5], k: [0, 0] };
                    setLocal(next);
                }}
            >
                <option value="CONST">Constant (n,k)</option>
                <option value="CAUCHY">Cauchy (vis)</option>
                <option value="SELLMEIER">Sellmeier</option>
                <option value="DRUDE">Drude–Lorentz</option>
                <option value="TABLE">Table (CSV)</option>
            </select>

            {/* Parameter fields by kind */}
            {local.kind === "CONST" && (
                <>
                    <label className="block text-xs">n</label>
                    <input className="w-full" type="number" step="0.0001" value={local.n}
                        onChange={e => setLocal({ ...local, n: Number(e.target.value) })} />
                    <label className="block text-xs">k</label>
                    <input className="w-full" type="number" step="0.0001" value={local.k}
                        onChange={e => setLocal({ ...local, k: Number(e.target.value) })} />
                </>
            )}

            {local.kind === "CAUCHY" && (
                <>
                    <label className="block text-xs">A</label>
                    <input className="w-full" type="number" step="0.0001" value={local.A}
                        onChange={e => setLocal({ ...local, A: Number(e.target.value) })} />
                    <label className="block text-xs">B</label>
                    <input className="w-full" type="number" step="0.000001" value={local.B}
                        onChange={e => setLocal({ ...local, B: Number(e.target.value) })} />
                    <label className="block text-xs">C</label>
                    <input className="w-full" type="number" step="0.000001" value={local.C}
                        onChange={e => setLocal({ ...local, C: Number(e.target.value) })} />
                    <label className="block text-xs">k (const)</label>
                    <input className="w-full" type="number" step="0.0001" value={local.kConst ?? 0}
                        onChange={e => setLocal({ ...local, kConst: Number(e.target.value) })} />
                </>
            )}

            {local.kind === "SELLMEIER" && (
                <div className="grid grid-cols-2 gap-2">
                    {(["B1", "C1", "B2", "C2", "B3", "C3"] as const).map(key => (
                        <div key={key}>
                            <label className="block text-xs">{key}</label>
                            <input
                                className="w-full"
                                type="number"
                                step="0.000001"
                                value={local[key]}
                                onChange={e => setLocal({ ...local, [key]: Number(e.target.value) } as MatSELL)}
                            />
                        </div>
                    ))}
                    <div className="col-span-2">
                        <label className="block text-xs">k (const)</label>
                        <input className="w-full" type="number" step="0.0001" value={local.kConst ?? 0}
                            onChange={e => setLocal({ ...local, kConst: Number(e.target.value) })} />
                    </div>
                </div>
            )}

            {local.kind === "DRUDE" && (
                <>
                    <label className="block text-xs">ε∞</label>
                    <input className="w-full" type="number" step="0.01" value={local.epsInf}
                        onChange={e => setLocal({ ...local, epsInf: Number(e.target.value) })} />
                    <label className="block text-xs">ωp (eV)</label>
                    <input className="w-full" type="number" step="0.01" value={local.wp_eV}
                        onChange={e => setLocal({ ...local, wp_eV: Number(e.target.value) })} />
                    <label className="block text-xs">γ (eV)</label>
                    <input className="w-full" type="number" step="0.001" value={local.gamma_eV}
                        onChange={e => setLocal({ ...local, gamma_eV: Number(e.target.value) })} />
                    {/* Lorentz terms UI can be added later */}
                </>
            )}

            {local.kind === "TABLE" && (
                <>
                    <div className="text-xs opacity-80">Upload CSV: <code>lam_nm,n,k</code></div>
                    <input
                        type="file"
                        accept=".csv,.txt"
                        onChange={async e => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const text = await f.text();
                            onCSVLoad(text);
                        }}
                    />
                    <div className="text-xs opacity-70">
                        Loaded points: {(local as MatTABLE).lam_nm.length}
                    </div>
                </>
            )}

            <button className="w-full mt-2 px-3 py-1 rounded bg-black/10 hover:bg-black/20" onClick={save}>
                Save material
            </button>
        </div>
    );
}

/* --------------------------------- Schematic --------------------------------- */
function Schematic({
    layers, materials, substrateKey, ambient_n0
}: {
    layers: Layer[]; materials: MaterialMap; substrateKey: string; ambient_n0: number;
}) {
    return (
        <div className="w-full border border-gray-200 rounded overflow-hidden flex flex-col font-sans text-xs">
            {/* Analyte (Top) */}
            <div className="h-10 bg-blue-50/50 flex items-center justify-center border-b border-dashed border-blue-200 relative">
                <span className="z-10 bg-white/50 px-2 rounded">Analyte (n={ambient_n0})</span>
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-blue-100/20" />
            </div>

            {/* Layers */}
            {layers.length === 0 && <div className="p-2 text-center text-gray-400 italic">No layers</div>}
            <div className="flex flex-col-reverse">
                {/* Render in reverse order so first layer is on top of substrate? 
                    Wait, "Layers (top -> bottom)" in UI input usually means Index 0 is Top (closest to ambient).
                    So we should render Index 0 at the top.
                */}
                {[...layers].map((L, i) => (
                    <div key={L.id} className="h-12 bg-white flex items-center justify-between px-3 border-b border-gray-100 relative group">
                        <div className="flex flex-col">
                            <span className="font-semibold text-gray-700">{materials[L.materialKey]?.name || L.materialKey}</span>
                            <span className="text-gray-500 scale-90 origin-left opacity-60">Layer {i + 1}</span>
                        </div>
                        <span className="font-mono bg-gray-50 px-1 rounded border">{L.d_nm} nm</span>

                        {/* Hover highlight effect could go here */}
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                ))}
            </div>

            {/* Substrate (Bottom) */}
            <div className="h-12 bg-gray-100 flex items-center justify-center border-t border-gray-300 shadow-inner">
                <span className="font-semibold text-gray-600">Substrate: {materials[substrateKey]?.name || substrateKey}</span>
            </div>
        </div>
    );
}

/* ------------------------------------------- Main Page ------------------------------------------- */
export default function ThinFilm() {
    const navigate = useNavigate();
    /* ----- materials + layers ----- */
    const [materials, setMaterials] = useState<MaterialMap>({ ...DEFAULT_MATERIALS });
    const matKeys = Object.keys(materials);
    const [substrateKey, setSubstrateKey] = useState<string>("BK7_Cauchy");
    const [ambient_n0, setAmbient_n0] = useState<number>(1.0);

    const [layers, setLayers] = useState<Layer[]>([
        { id: uid(), d_nm: 100, materialKey: "SiO2_Cauchy" },
    ]);

    const [selectedMatKey, setSelectedMatKey] = useState<string>(matKeys[0] ?? "Air");

    /* ----- scan config ----- */
    const [lamStart, setLamStart] = useState(400);
    const [lamStop, setLamStop] = useState(800);
    const [lamPoints, setLamPoints] = useState(301);
    const [thetaDeg, setThetaDeg] = useState(0);
    const [pol, setPol] = useState<Pol>("avg");

    /* ----- results ----- */
    const [rows, setRows] = useState<Row[]>([]);
    const [busy, setBusy] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);

    /* ----- worker ----- */
    const workerRef = useRef<Worker | null>(null);
    useEffect(() => {
        const w = new Worker(new URL("../workers/tmm.worker.ts", import.meta.url), { type: "module" });
        workerRef.current = w;
        w.onmessage = (ev: MessageEvent) => {
            const { ok, rows, error } = ev.data || {};
            setBusy(false);
            if (ok) {
                setRows(rows as Row[]);
                setLastError(null);
            } else {
                setLastError(String(error || "Unknown worker error"));
            }
        };
        return () => { w.terminate(); };
    }, []);

    /* ----- wavelengths ----- */
    const wavelengths = useMemo(() => linspace(lamStart, lamStop, lamPoints), [lamStart, lamStop, lamPoints]);

    /* ----- run ----- */
    function run() {
        if (!workerRef.current) return;
        setBusy(true);

        const payload: WorkerPayload = {
            wavelengths,
            thetaDeg,
            pol,
            ambient_n0,
            substrate: materials[substrateKey],
            layers: layers.map(L => ({ d_nm: L.d_nm, material: materials[L.materialKey] })),
        };

        workerRef.current.postMessage(payload);
    }

    /* ----- auto-run on change ----- */
    useEffect(() => {
        const t = setTimeout(run, 50); // debounce
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lamStart, lamStop, lamPoints, thetaDeg, pol, ambient_n0, substrateKey, materials, layers]);

    /* ----- energy drift ----- */
    const drift = useMemo(() => {
        if (!rows.length) return 0;
        let max = 0;
        for (const r of rows) {
            const s = r.R + r.T + r.A;
            max = Math.max(max, Math.abs(1 - s));
        }
        return max;
    }, [rows]);

    /* ----- CSV export ----- */
    function exportCSV() {
        if (!rows.length) return;
        const head = "lambda_nm,R,T,A,Rs,Ts,As,Rp,Tp,Ap";
        const body = rows.map(r =>
            [r.lambda, r.R, r.T, r.A, r.Rs, r.Ts, r.As, r.Rp, r.Tp, r.Ap].join(",")
        ).join("\n");
        download("tmm_spectrum.csv", head + "\n" + body);
    }

    /* ----- wavelength import (one column CSV or first column) ----- */
    async function importWavelengthsFromFile(f: File) {
        const text = await f.text();
        const lines = text.trim().split(/\r?\n/).filter(Boolean);
        const vals: number[] = [];
        for (const L of lines) {
            const m = L.split(/[,\s;]+/)[0];
            const v = Number(m);
            if (Number.isFinite(v)) vals.push(v);
        }
        if (vals.length >= 2) {
            setLamStart(vals[0]);
            setLamStop(vals[vals.length - 1]);
            setLamPoints(vals.length);
        }
    }

    /* ------------------------------------------- UI ------------------------------------------- */
    return (
        <div className="thinfilm-page" style={{ padding: 16, display: "grid", gap: 16, gridTemplateColumns: "320px 1fr" }}>
            {/* LEFT: configuration */}
            <div className="left-panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>
                <button
                    className="mb-2 px-3 py-1 rounded bg-black/10 hover:bg-black/20 text-sm self-start"
                    onClick={() => navigate("/")}
                >
                    ← Back to Home
                </button>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-3">Structure</div>

                    {/* 1. Analyte */}
                    <div className="mb-4">
                        <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">1. Analyte / Ambient</label>
                        <div className="flex items-center gap-2 max-w-[200px]">
                            <label className="text-sm">Refractive Index (n₀):</label>
                            <input
                                type="number" step="0.0001"
                                value={ambient_n0}
                                onChange={e => setAmbient_n0(Number(e.target.value))}
                                className="flex-1 min-w-[80px]"
                            />
                        </div>
                    </div>

                    <div className="border-t border-gray-100 my-4"></div>

                    {/* 2. Layers */}
                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold">2. Thin Film Layers</label>
                            <button
                                className="px-2 py-0.5 rounded bg-black/5 hover:bg-black/10 text-xs text-blue-600 font-medium"
                                onClick={() => setLayers(ls => [...ls, { id: uid(), d_nm: 100, materialKey: "SiO2_Cauchy" }])}
                            >
                                + Add Layer
                            </button>
                        </div>

                        {/* Headers */}
                        <div className="grid grid-cols-[1fr_130px_35px] gap-2 mb-1 px-2">
                            <span className="text-[10px] uppercase font-bold text-gray-500">Material</span>
                            <span className="text-[10px] uppercase font-bold text-gray-500">Thickness</span>
                            <span className="text-[10px] uppercase font-bold text-gray-500"></span>
                        </div>

                        <div className="space-y-2 mb-2">
                            {layers.length === 0 && <div className="text-sm text-gray-400 italic py-2">No layers defined</div>}
                            {layers.map((L, idx) => (
                                <div key={L.id} className="grid grid-cols-[1fr_130px_auto] gap-2 items-center bg-gray-50 p-2 rounded border border-gray-100">
                                    {/* Material */}
                                    <select
                                        value={L.materialKey}
                                        onChange={e => {
                                            const v = e.target.value;
                                            setLayers(ls => ls.map(x => x.id === L.id ? { ...x, materialKey: v } : x));
                                        }}
                                        className="w-full text-sm py-1"
                                    >
                                        {matKeys.map(k => <option key={k} value={k}>{materials[k].name || k}</option>)}
                                    </select>

                                    {/* Thickness */}
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number" step="0.1" value={L.d_nm}
                                            onChange={e => setLayers(ls => ls.map(x => x.id === L.id ? { ...x, d_nm: Number(e.target.value) } : x))}
                                            className="w-full text-sm py-1"
                                            placeholder="nm"
                                        />
                                        <span className="text-xs text-gray-500">nm</span>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-1 mt-0">
                                        <button
                                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/10 text-gray-500"
                                            onClick={() => setLayers(ls => {
                                                const arr = [...ls];
                                                if (idx > 0) [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                                                return arr;
                                            })}
                                            title="Move Up"
                                            disabled={idx === 0}
                                        >↑</button>
                                        <button
                                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-100 text-red-500"
                                            onClick={() => setLayers(ls => ls.filter(x => x.id !== L.id))}
                                            title="Remove"
                                        >✕</button>
                                    </div>

                                    {/* Edit details */}
                                    <details className="col-span-3">
                                        <summary className="cursor-pointer text-xs opacity-60 hover:opacity-100">Edit material properties</summary>
                                        <div className="mt-2 pl-2 border-l-2 border-blue-200">
                                            <MaterialEditor materialKey={L.materialKey} materials={materials} setMaterials={setMaterials} />
                                        </div>
                                    </details>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-gray-100 my-4"></div>

                    {/* 3. Substrate */}
                    <div className="mb-2">
                        <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">3. Substrate</label>
                        <select value={substrateKey} onChange={e => setSubstrateKey(e.target.value)} className="w-full mb-2">
                            {matKeys.map(k => <option key={k} value={k}>{materials[k].name || k}</option>)}
                        </select>
                        <details>
                            <summary className="cursor-pointer text-xs opacity-60 hover:opacity-100">Edit substrate properties</summary>
                            <div className="mt-2 pl-2 border-l-2 border-blue-200">
                                <MaterialEditor materialKey={substrateKey} materials={materials} setMaterials={setMaterials} />
                            </div>
                        </details>
                    </div>

                    {/* New Material */}
                    <div className="mt-6 pt-4 border-t border-gray-200">
                        <label className="block text-xs opacity-70 mb-1">Define new material type</label>
                        <div className="flex gap-2">
                            <input
                                className="flex-1 text-sm"
                                placeholder="New Name (e.g. TiO2)"
                                value={selectedMatKey}
                                onChange={e => setSelectedMatKey(e.target.value)}
                            />
                            <button
                                className="px-3 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 text-sm font-medium"
                                onClick={() => {
                                    if (!selectedMatKey) return;
                                    setMaterials(m => {
                                        if (m[selectedMatKey]) return m;
                                        return { ...m, [selectedMatKey]: { kind: "CONST", name: selectedMatKey, n: 1.5, k: 0 } };
                                    });
                                }}
                            >
                                + Create
                            </button>
                        </div>
                    </div>
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-2">Simulation Config</div>
                    <div className="grid grid-cols-2 gap-2 items-end">
                        <div>
                            <label className="block text-xs opacity-80">λ start</label>
                            <input type="number" value={lamStart} onChange={e => setLamStart(Number(e.target.value))} className="w-full" />
                        </div>
                        <div>
                            <label className="block text-xs opacity-80">λ stop</label>
                            <input type="number" value={lamStop} onChange={e => setLamStop(Number(e.target.value))} className="w-full" />
                        </div>
                        <div>
                            <label className="block text-xs opacity-80">points</label>
                            <input type="number" value={lamPoints} min={2} onChange={e => setLamPoints(Number(e.target.value))} className="w-full" />
                        </div>
                        <div className="flex flex-col">
                            <label className="block text-xs opacity-80">Polarization</label>
                            <select value={pol} onChange={e => setPol(e.target.value as Pol)} className="w-full text-sm border border-gray-200 rounded p-1">
                                <option value="avg">Avg</option>
                                <option value="s">s-pol</option>
                                <option value="p">p-pol</option>
                            </select>
                        </div>
                    </div>

                    <div className="mt-4 border-t pt-2">
                        <label className="block text-xs opacity-80 font-medium mb-1">Angle of Incidence: <b>{thetaDeg}°</b></label>
                        <input
                            type="range"
                            min={0} max={89}
                            value={thetaDeg}
                            onChange={e => setThetaDeg(Number(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                            <span>0° (Normal)</span>
                            <span>89° (Grazing)</span>
                        </div>
                    </div>

                    <div className="mt-3 flex gap-2">
                        <button className="flex-1 px-3 py-1.5 rounded bg-black/5 hover:bg-black/10 text-sm" onClick={exportCSV} disabled={!rows.length}>
                            Download CSV
                        </button>
                    </div>

                    <div className="mt-2 text-xs opacity-60">
                        Drift: {drift.toExponential(1)}
                    </div>
                    {lastError && <div className="mt-2 text-xs text-red-500">Error: {lastError}</div>}
                </section>
            </div>

            {/* RIGHT: plot + table */}
            <div className="right-panel" style={{ display: "grid", gap: 12 }}>
                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="flex items-center justify-between">
                        <div className="text-lg font-semibold">R / T / A vs λ</div>
                        <div className="text-xs opacity-70">
                            {rows.length ? `Points: ${rows.length}` : "Run to compute"}
                        </div>
                    </div>
                    <div className="mt-2">
                        <RTAGraph rows={rows} />
                    </div>
                    {/* Visual Schematic */}
                    <div className="mt-4 border-t pt-4">
                        <div className="text-sm font-semibold mb-2">Layer Stack Schematic</div>
                        <Schematic layers={layers} materials={materials} substrateKey={substrateKey} ambient_n0={ambient_n0} />
                    </div>
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <details>
                        <summary className="cursor-pointer text-lg font-semibold">Physics & Math</summary>
                        <div className="mt-2 text-sm space-y-2 opacity-90">
                            <p>
                                This simulation uses the <b>Abeles Transfer Matrix Method (TMM)</b> to compute reflection and transmission through a stack of isotropic thin films.
                            </p>
                            <p>
                                For a single layer of thickness <Equation latex="d" /> and refractive index <Equation latex="n" />, the phase shift is <Equation latex="\delta = \frac{2\pi}{\lambda} n d \cos\theta" />.
                            </p>
                            <p>
                                The characteristic admittance <Equation latex="q" /> depends on polarization:
                            </p>
                            <ul className="list-disc pl-5">
                                <li>s-polarization: <Equation latex="q_s = n \cos\theta" /></li>
                                <li>p-polarization: <Equation latex="q_p = n / \cos\theta" /></li>
                            </ul>
                            <p>
                                The transfer matrix for the <Equation latex="j" />-th layer is:
                            </p>
                            <div className="my-2 flex justify-center">
                                <Equation block latex="M_j = \begin{bmatrix} \cos\delta_j & \frac{i}{q_j}\sin\delta_j \\ i q_j \sin\delta_j & \cos\delta_j \end{bmatrix}" />
                            </div>
                            <p>
                                The total matrix <Equation latex="M = \prod M_j" /> relates the fields at the ambient (`0`) and substrate (`s`) interfaces. The reflection coefficient <Equation latex="r" /> is given by:
                            </p>
                            <div className="my-2 flex justify-center">
                                <Equation block latex="r = \frac{q_0 (M_{11} + M_{12}q_s) - (M_{21} + M_{22}q_s)}{q_0 (M_{11} + M_{12}q_s) + (M_{21} + M_{22}q_s)}" />
                            </div>
                            <p>
                                Reflectance is <Equation latex="R = |r|^2" />. Transmittance <Equation latex="T" /> is calculated using energy conservation and substrate admittance.
                            </p>
                        </div>
                    </details>
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)", overflow: "auto", maxHeight: 360 }}>
                    <div className="text-lg font-semibold mb-2">Data</div>
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-black/10">
                            <tr>
                                <th className="text-left p-1">λ (nm)</th>
                                <th className="text-left p-1">R</th>
                                <th className="text-left p-1">T</th>
                                <th className="text-left p-1">A</th>
                                <th className="text-left p-1">Rs</th>
                                <th className="text-left p-1">Ts</th>
                                <th className="text-left p-1">As</th>
                                <th className="text-left p-1">Rp</th>
                                <th className="text-left p-1">Tp</th>
                                <th className="text-left p-1">Ap</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.lambda}>
                                    <td className="p-1">{r.lambda.toFixed(2)}</td>
                                    <td className="p-1">{r.R.toFixed(4)}</td>
                                    <td className="p-1">{r.T.toFixed(4)}</td>
                                    <td className="p-1">{r.A.toFixed(4)}</td>
                                    <td className="p-1">{r.Rs.toFixed(4)}</td>
                                    <td className="p-1">{r.Ts.toFixed(4)}</td>
                                    <td className="p-1">{r.As.toFixed(4)}</td>
                                    <td className="p-1">{r.Rp.toFixed(4)}</td>
                                    <td className="p-1">{r.Tp.toFixed(4)}</td>
                                    <td className="p-1">{r.Ap.toFixed(4)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                <section className="text-xs opacity-70">
                    Notes: Abeles transfer matrix, oblique incidence, s/p & unpolarized average. Models: CONST (n,k), Cauchy and Sellmeier (λ in μm), Drude–Lorentz (energies in eV), or TABLE via CSV.
                </section>
            </div>
        </div>
    );
}
