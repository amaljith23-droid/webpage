// src/pages/EMTStack.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import Equation from "../components/Equation";

/** ---------- Complex utilities ---------- */
type C = { re: number; im: number };
const c = (re = 0, im = 0): C => ({ re, im });
const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
const sub = (a: C, b: C): C => c(a.re - b.re, a.im - b.im);
const mul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: C, b: C): C => {
    const d = b.re * b.re + b.im * b.im || 1e-30;
    return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const abs2 = (z: C) => z.re * z.re + z.im * z.im;
const csqrt = (z: C): C => {
    const r = Math.hypot(z.re, z.im);
    const u = Math.sqrt((r + z.re) / 2);
    const v = Math.sqrt(Math.max(0, (r - z.re) / 2));
    return c(u, z.im < 0 ? -v : v);
};
const csin = (z: C): C => {
    const x = z.re, y = z.im;
    return c(Math.sin(x) * Math.cosh(y), Math.cos(x) * Math.sinh(y));
};
const ccos = (z: C): C => {
    const x = z.re, y = z.im;
    return c(Math.cos(x) * Math.cosh(y), -Math.sin(x) * Math.sinh(y));
};
const I = c(0, 1);
const toEps = (n: number, k: number): C => c(n * n - k * k, 2 * n * k);
const epsToN = (eps: C): C => {
    const s = csqrt(eps);
    return c(s.re, Math.abs(s.im)); // enforce k >= 0
};

/** ---------- EMT mixing ---------- */
function epsMG(f: number, ei: C, eh: C): C {
    const ei_m_eh = sub(ei, eh);
    const num = add(add(ei, mul(c(2, 0), eh)), mul(c(2 * f, 0), ei_m_eh));
    const den = add(add(ei, mul(c(2, 0), eh)), mul(c(-f, 0), ei_m_eh));
    return mul(eh, div(num, den));
}
function epsBruggeman(f: number, ei: C, eh: C, prev?: C): C {
    const A = c(2, 0);
    const B = add(mul(c(1 - 3 * f, 0), ei), mul(c(3 * f - 2, 0), eh));
    const Cc = mul(c(-1, 0), mul(ei, eh));
    const fourAC = mul(c(4, 0), mul(A, Cc));
    const disc = sub(mul(B, B), fourAC);
    const sdisc = csqrt(disc);
    const negB = c(-B.re, -B.im);
    const r1 = div(add(negB, sdisc), mul(c(2, 0), A));
    const r2 = div(sub(negB, sdisc), mul(c(2, 0), A));
    if (!prev) return r1;
    return abs2(sub(r1, prev)) <= abs2(sub(r2, prev)) ? r1 : r2;
}

/** ---------- Transfer-Matrix (Oblique incidence) ---------- */
type M2 = [C, C, C, C];
const Meye: M2 = [c(1, 0), c(0, 0), c(0, 0), c(1, 0)];
const mmul = (A: M2, B: M2): M2 => ([
    add(mul(A[0], B[0]), mul(A[1], B[2])),
    add(mul(A[0], B[1]), mul(A[1], B[3])),
    add(mul(A[2], B[0]), mul(A[3], B[2])),
    add(mul(A[2], B[1]), mul(A[3], B[3])),
]);

// Compute kz = (2*pi/lam) * n * cos(theta)
// Snells law: n0 sin0 = n sin
// cos(theta) = sqrt(1 - sin^2) = sqrt(1 - (n0/n * sin0)^2)
function getCosTheta(n: C, n0: C, theta0Rad: number): C {
    // S0 = n0 * sin(theta0) -- real number typically, but n0 can be complex?
    // Usually ambient is air/dielectric (real). Let's treat n0 as complex general case.
    const sin0 = Math.sin(theta0Rad);
    const S0 = mul(n0, c(sin0, 0)); // n0 sin0

    // sinTheta = S0 / n
    const sinT = div(S0, n);
    const sinT2 = mul(sinT, sinT);

    // cos = sqrt(1 - sin^2)
    return csqrt(sub(c(1, 0), sinT2));
}

function layerMatrix(n: C, d_nm: number, lam_nm: number, cosTheta: C, pol: "s" | "p"): M2 {
    // phase delta = (2*pi * d / lam) * n * cosTheta
    // Actually, kz = (2pi/lam) * n * cosTheta is the z-component of wave vector
    // Delta = kz * d

    const k0 = 2 * Math.PI / lam_nm;
    // n * cosTheta
    const nz = mul(n, cosTheta);
    const delta = mul(c(k0 * d_nm, 0), nz);

    const cd = ccos(delta);
    const sd = csin(delta);
    const i = c(0, 1);

    // Admittance q
    // qs = n * cosTheta
    // qp = n / cosTheta
    let q: C;
    if (pol === "s") {
        q = mul(n, cosTheta);
    } else {
        q = div(n, cosTheta);
    }

    // M = [ cos   (i/q)sin ]
    //     [ iq sin   cos   ]
    return [
        cd,
        div(mul(i, sd), q),
        mul(mul(i, q), sd),
        cd
    ];
}

function stackRT(n0: C, ns: C, nLayers: C[], dLayers_nm: number[], lam_nm: number, thetaDeg: number, pol: "s" | "p") {
    const thetaRad = thetaDeg * Math.PI / 180;

    // Ambient admittance
    const cos0 = getCosTheta(n0, n0, thetaRad); // cos(theta0)
    let q0: C;
    if (pol === "s") q0 = mul(n0, cos0);
    else q0 = div(n0, cos0);

    // Substrate admittance
    const cosS = getCosTheta(ns, n0, thetaRad);
    let qs: C;
    if (pol === "s") qs = mul(ns, cosS);
    else qs = div(ns, cosS);

    // Build Matrix
    let M = Meye;
    for (let i = 0; i < nLayers.length; i++) {
        const cosT = getCosTheta(nLayers[i], n0, thetaRad);
        M = mmul(M, layerMatrix(nLayers[i], dLayers_nm[i], lam_nm, cosT, pol));
    }

    // r = (q0(M11 + M12 qs) - (M21 + M22 qs)) / (q0(M11 + M12 qs) + (M21 + M22 qs))
    // Terms:
    const M11 = M[0], M12 = M[1], M21 = M[2], M22 = M[3];

    // B = M11 + M12*qs
    const B = add(M11, mul(M12, qs));
    // C = M21 + M22*qs
    const C_mx = add(M21, mul(M22, qs));

    const q0B = mul(q0, B);
    const num = sub(q0B, C_mx);
    const den = add(q0B, C_mx);

    const r = div(num, den);

    // t = 2 q0 / den
    const t = div(mul(c(2, 0), q0), den);

    const R = abs2(r);

    // T = (Re(qs) / Re(q0)) * |t|^2  <-- generalized for admittance
    // Note: Re(q0) corresponds to input power. If total reflection region, Re(qs)=0.
    const T_val = (Math.max(0, qs.re) / Math.max(1e-20, n0.re > 0 ? q0.re : 1)) * abs2(t);

    const T = Math.max(0, T_val);
    const A = Math.max(0, 1 - R - T);

    return { R, T, A };
}

/** ---------- UI state ---------- */
type Pure = { kind: "pure"; d: number; n: number; k: number; name?: string };
type Composite = { kind: "composite"; d: number; f: number; nh: number; kh: number; ni: number; ki: number; name?: string };
type Layer = Pure | Composite;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const nz = (x: number, def = 0) => (Number.isFinite(x) ? x : def);

/** ---------- Schematic (Local for EMT) ---------- */
function Schematic({
    layers, ns, n0
}: {
    layers: Layer[]; ns: number; n0: number;
}) {
    return (
        <div className="w-full border border-gray-200 rounded overflow-hidden flex flex-col font-sans text-xs mt-4">
            {/* Analyte (Top) */}
            <div className="h-10 bg-blue-50/50 flex items-center justify-center border-b border-dashed border-blue-200 relative">
                <span className="z-10 bg-white/50 px-2 rounded">Analyte (n≈{n0})</span>
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-blue-100/20" />
            </div>

            {/* Layers */}
            {layers.length === 0 && <div className="p-2 text-center text-gray-400 italic">No layers</div>}
            <div className="flex flex-col-reverse">
                {[...layers].map((L, i) => (
                    <div key={i} className="h-12 bg-white flex items-center justify-between px-3 border-b border-gray-100 relative group">
                        <div className="flex flex-col">
                            <span className="font-semibold text-gray-700">
                                {L.name || (L.kind === "pure" ? "Pure Layer" : "Composite")}
                            </span>
                            <span className="text-gray-500 scale-90 origin-left opacity-60">
                                {L.kind === "pure"
                                    ? `n=${L.n}`
                                    : `Mix: ${(L.f * 100).toFixed(0)}% Inc.`}
                            </span>
                        </div>
                        <span className="font-mono bg-gray-50 px-1 rounded border">{L.d} nm</span>
                        {/* Pattern for composite */}
                        {L.kind === "composite" && (
                            <div className="absolute inset-0 opacity-5 pointer-events-none"
                                style={{ backgroundImage: "radial-gradient(#000 1px, transparent 1px)", backgroundSize: "4px 4px" }}
                            />
                        )}
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                ))}
            </div>

            {/* Substrate (Bottom) */}
            <div className="h-12 bg-gray-100 flex items-center justify-center border-t border-gray-300 shadow-inner">
                <span className="font-semibold text-gray-600">Substrate (n≈{ns})</span>
            </div>
        </div>
    );
}

/* --------------------------------- Graph --------------------------------- */
function RTAGraph({ data, showMG, showBR }: { data: any[]; showMG: boolean; showBR: boolean }) {
    if (!data.length) return (
        <div className="h-80 w-full bg-gray-50 rounded border border-gray-200 flex items-center justify-center text-gray-400">
            <div className="text-center">
                <p>No simulation data</p>
            </div>
        </div>
    );

    return (
        <div className="w-full bg-white rounded border border-gray-100 p-2 relative" style={{ height: '360px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 10, right: 24, bottom: 10, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                        type="number"
                        dataKey="lam"
                        domain={['auto', 'auto']}
                        tick={{ fontSize: 11 }}
                        label={{ value: "Wavelength (nm)", position: "insideBottom", offset: -10, fontSize: 12 }}
                    />
                    <YAxis
                        type="number"
                        domain={[0, 1]}
                        ticks={[0, 0.25, 0.5, 0.75, 1]}
                        tick={{ fontSize: 11 }}
                        label={{ value: "T, R, A", angle: -90, position: "insideLeft", fontSize: 12 }}
                    />
                    <Tooltip
                        contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        formatter={(v: number) => v.toFixed(3)}
                        labelFormatter={(v) => `${Number(v).toFixed(1)} nm`}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    {showMG && <Line type="monotone" dataKey="T_MG" name="T (MG)" stroke="#22c55e" dot={false} strokeWidth={2} animationDuration={300} />}
                    {showMG && <Line type="monotone" dataKey="R_MG" name="R (MG)" stroke="#3b82f6" dot={false} strokeWidth={2} animationDuration={300} />}
                    {showMG && <Line type="monotone" dataKey="A_MG" name="A (MG)" stroke="#f59e0b" dot={false} strokeWidth={2} animationDuration={300} />}

                    {showBR && <Line type="monotone" dataKey="T_BR" name="T (Br)" stroke="#16a34a" dot={false} strokeDasharray="4 4" strokeWidth={1.5} animationDuration={300} />}
                    {showBR && <Line type="monotone" dataKey="R_BR" name="R (Br)" stroke="#2563eb" dot={false} strokeDasharray="4 4" strokeWidth={1.5} animationDuration={300} />}
                    {showBR && <Line type="monotone" dataKey="A_BR" name="A (Br)" stroke="#d97706" dot={false} strokeDasharray="4 4" strokeWidth={1.5} animationDuration={300} />}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

export default function EMTStack() {
    const navigate = useNavigate();
    // State
    const [n0, setN0] = useState(1.0);
    const [k0, setK0] = useState(0.0);
    const [ns, setNs] = useState(1.52);
    const [ks, setKs] = useState(0.0);

    const [lamStart, setLamStart] = useState(400);
    const [lamStop, setLamStop] = useState(900);
    const [nPts, setNPts] = useState(301);

    // New State for Oblique Incidence
    const [thetaDeg, setThetaDeg] = useState(0);
    const [pol, setPol] = useState<"s" | "p">("s");

    const [layers, setLayers] = useState<Layer[]>([
        { kind: "composite", name: "Layer 1 (EMT)", d: 100, f: 0.35, nh: 1.5, kh: 0.0, ni: 2.5, ki: 0.5 },
        { kind: "pure", name: "Layer 2", d: 50, n: 1.45, k: 0.0 },
    ]);

    const [showMG, setShowMG] = useState(true);
    const [showBR, setShowBR] = useState(false); // Default to MG to be cleaner

    const n0c = useMemo(() => c(n0, k0), [n0, k0]);
    const nsc = useMemo(() => c(ns, ks), [ns, ks]);

    const lambdaGrid = useMemo(() => {
        const a = Math.min(lamStart, lamStop), b = Math.max(lamStart, lamStop);
        const N = Math.max(3, Math.floor(nPts));
        const step = (b - a) / (N - 1);
        return Array.from({ length: N }, (_, i) => a + i * step);
    }, [lamStart, lamStop, nPts]);

    function nForLayerMG(L: Layer): C {
        if (L.kind === "pure") return c(L.n, L.k);
        const eh = toEps(L.nh, L.kh), ei = toEps(L.ni, L.ki);
        return epsToN(epsMG(clamp01(L.f), ei, eh));
    }
    function nForLayerBR(L: Layer, prev?: C): { n: C; picked: C } {
        if (L.kind === "pure") return { n: c(L.n, L.k), picked: c(0, 0) };
        const eh = toEps(L.nh, L.kh), ei = toEps(L.ni, L.ki);
        const picked = epsBruggeman(clamp01(L.f), ei, eh, prev);
        return { n: epsToN(picked), picked };
    }

    const data = useMemo(() => {
        const nMG = layers.map(nForLayerMG);
        let prev: C | undefined = undefined;
        const nBR = layers.map(L => {
            const out = nForLayerBR(L, prev);
            prev = out.picked;
            return out.n;
        });
        const dnm = layers.map(L => L.d);

        return lambdaGrid.map(lam => {
            const rtMG = stackRT(n0c, nsc, nMG, dnm, lam, thetaDeg, pol);
            const rtBR = stackRT(n0c, nsc, nBR, dnm, lam, thetaDeg, pol);
            return { lam, T_MG: rtMG.T, R_MG: rtMG.R, A_MG: rtMG.A, T_BR: rtBR.T, R_BR: rtBR.R, A_BR: rtBR.A };
        });
    }, [layers, n0c, nsc, lambdaGrid, thetaDeg, pol]);

    function upLayer(i: number, patch: Partial<Layer>) {
        setLayers(ls => ls.map((L, j) => (j === i ? { ...L, ...patch } as Layer : L)));
    }
    function addPure() { setLayers(ls => [...ls, { kind: "pure", name: `Layer ${ls.length + 1}`, d: 100, n: 1.5, k: 0 }]); }
    function addComposite() { setLayers(ls => [...ls, { kind: "composite", name: `Layer ${ls.length + 1} (Mix)`, d: 100, f: 0.5, nh: 1.5, kh: 0, ni: 2.5, ki: 0.1 }]); }
    function removeLayer(i: number) { setLayers(ls => ls.filter((_, j) => j !== i)); }
    function move(i: number, dir: -1 | 1) {
        setLayers(ls => { const j = i + dir; if (j < 0 || j >= ls.length) return ls; const copy = ls.slice();[copy[i], copy[j]] = [copy[j], copy[i]]; return copy; });
    }

    return (
        <div className="emt-page" style={{ padding: 16, display: "grid", gap: 16, gridTemplateColumns: "360px 1fr" }}>
            {/* LEFT: Config */}
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
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs">n₀</label>
                                <input type="number" step="0.01" value={n0} onChange={e => setN0(nz(parseFloat(e.target.value), 1))} className="w-full text-sm p-1 border rounded" />
                            </div>
                            <div>
                                <label className="text-xs">k₀</label>
                                <input type="number" step="0.01" value={k0} onChange={e => setK0(nz(parseFloat(e.target.value), 0))} className="w-full text-sm p-1 border rounded" />
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-100 my-4"></div>

                    {/* 2. Layers */}
                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold">2. Thin Film Layers</label>
                            <div className="flex gap-1">
                                <button className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-xs font-medium hover:bg-blue-100" onClick={addPure}>+ Pure</button>
                                <button className="px-2 py-0.5 rounded bg-purple-50 text-purple-600 text-xs font-medium hover:bg-purple-100" onClick={addComposite}>+ Mix</button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {layers.map((L, i) => (
                                <div key={i} className="bg-gray-50 p-2 rounded border border-gray-200">
                                    <div className="flex justify-between items-center mb-1">
                                        <input
                                            className="text-sm font-semibold bg-transparent border-none p-0 focus:ring-0 w-32"
                                            value={L.name || ""}
                                            onChange={e => upLayer(i, { name: e.target.value })}
                                            placeholder="Layer Name"
                                        />
                                        <div className="flex gap-1">
                                            <button className="text-gray-400 hover:text-black px-1" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                                            <button className="text-gray-400 hover:text-black px-1" onClick={() => move(i, 1)} disabled={i === layers.length - 1}>↓</button>
                                            <button className="text-red-400 hover:text-red-600 px-1" onClick={() => removeLayer(i)}>×</button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-[1fr_80px] gap-2 mb-2">
                                        <div className="text-xs text-gray-500">{L.kind === "pure" ? "Pure Material" : "Effective Medium"}</div>
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number" value={L.d}
                                                onChange={e => upLayer(i, { d: Math.max(0, parseFloat(e.target.value)) })}
                                                className="w-full text-sm p-1 border rounded text-right"
                                            />
                                            <span className="text-xs text-gray-400">nm</span>
                                        </div>
                                    </div>

                                    {L.kind === "pure" ? (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div><label className="text-[10px]">n</label><input type="number" step="0.01" value={L.n} onChange={e => upLayer(i, { n: parseFloat(e.target.value) })} className="w-full text-sm p-1 border rounded" /></div>
                                            <div><label className="text-[10px]">k</label><input type="number" step="0.01" value={L.k} onChange={e => upLayer(i, { k: parseFloat(e.target.value) })} className="w-full text-sm p-1 border rounded" /></div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div>
                                                <div className="flex justify-between"><label className="text-[10px]">Fraction f ({((L.f) * 100).toFixed(0)}%)</label></div>
                                                <input type="range" min={0} max={1} step={0.01} value={L.f} onChange={e => upLayer(i, { f: parseFloat(e.target.value) })} className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                                                <div className="bg-gray-100 p-1 rounded">
                                                    <div className="font-bold opacity-70 mb-1">Host</div>
                                                    <div className="flex gap-1">
                                                        <input placeholder="n" value={L.nh} onChange={e => upLayer(i, { nh: parseFloat(e.target.value) })} className="w-full p-0.5 border rounded" type="number" step="0.01" />
                                                        <input placeholder="k" value={L.kh} onChange={e => upLayer(i, { kh: parseFloat(e.target.value) })} className="w-full p-0.5 border rounded" type="number" step="0.01" />
                                                    </div>
                                                </div>
                                                <div className="bg-gray-100 p-1 rounded">
                                                    <div className="font-bold opacity-70 mb-1">Inclusion</div>
                                                    <div className="flex gap-1">
                                                        <input placeholder="n" value={L.ni} onChange={e => upLayer(i, { ni: parseFloat(e.target.value) })} className="w-full p-0.5 border rounded" type="number" step="0.01" />
                                                        <input placeholder="k" value={L.ki} onChange={e => upLayer(i, { ki: parseFloat(e.target.value) })} className="w-full p-0.5 border rounded" type="number" step="0.01" />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-gray-100 my-4"></div>

                    {/* 3. Substrate */}
                    <div className="mb-2">
                        <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">3. Substrate</label>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs">nₛ</label>
                                <input type="number" step="0.01" value={ns} onChange={e => setNs(nz(parseFloat(e.target.value), 1.5))} className="w-full text-sm p-1 border rounded" />
                            </div>
                            <div>
                                <label className="text-xs">kₛ</label>
                                <input type="number" step="0.01" value={ks} onChange={e => setKs(nz(parseFloat(e.target.value), 0))} className="w-full text-sm p-1 border rounded" />
                            </div>
                        </div>
                    </div>
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-2">Simulation Config</div>
                    <div className="grid grid-cols-2 gap-2 items-end">
                        <div>
                            <label className="block text-xs opacity-80">λ start</label>
                            <input type="number" value={lamStart} onChange={e => setLamStart(Number(e.target.value))} className="w-full text-sm p-1 border rounded" />
                        </div>
                        <div>
                            <label className="block text-xs opacity-80">λ stop</label>
                            <input type="number" value={lamStop} onChange={e => setLamStop(Number(e.target.value))} className="w-full text-sm p-1 border rounded" />
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
                            <span>89°</span>
                        </div>
                    </div>

                    <div className="mt-2">
                        <label className="block text-xs opacity-80 mb-1">Polarization</label>
                        <div className="flex gap-2">
                            <button className={`flex-1 py-1 text-xs rounded border ${pol === 's' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200'}`} onClick={() => setPol('s')}>s-pol</button>
                            <button className={`flex-1 py-1 text-xs rounded border ${pol === 'p' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200'}`} onClick={() => setPol('p')}>p-pol</button>
                        </div>
                    </div>
                </section>
            </div>

            {/* RIGHT: Graph & Results */}
            <div className="right-panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>
                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-lg font-semibold">T / R / A Spectra</div>
                        <div className="flex gap-2 text-xs">
                            <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={showMG} onChange={e => setShowMG(e.target.checked)} /> Show Maxwell-Garnett
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={showBR} onChange={e => setShowBR(e.target.checked)} /> Show Bruggeman
                            </label>
                        </div>
                    </div>

                    <RTAGraph data={data} showMG={showMG} showBR={showBR} />

                    <Schematic layers={layers} ns={ns} n0={n0} />
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-2">Physics Models</div>
                    <div className="text-sm space-y-2 opacity-90 overflow-x-auto">
                        <Equation block latex={`\\textbf{Maxwell–Garnett:}\\quad \\varepsilon_{\\rm eff}=\\varepsilon_h\\,\\frac{\\varepsilon_i+2\\varepsilon_h+2f(\\varepsilon_i-\\varepsilon_h)}{\\varepsilon_i+2\\varepsilon_h-f(\\varepsilon_i-\\varepsilon_h)}`} />
                        <Equation block latex={`\\textbf{Bruggeman:}\\quad f\\,\\frac{\\varepsilon_i-\\varepsilon_{\\rm eff}}{\\varepsilon_i+2\\varepsilon_{\\rm eff}} +(1-f)\\,\\frac{\\varepsilon_h-\\varepsilon_{\\rm eff}}{\\varepsilon_h+2\\varepsilon_{\\rm eff}}=0`} />
                    </div>
                </section>
            </div>
        </div>
    );
}
