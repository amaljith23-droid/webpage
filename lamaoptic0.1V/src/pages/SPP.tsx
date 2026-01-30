// src/pages/SPP.tsx
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, ReferenceLine
} from "recharts";
import { PRESETS, DIELECTRICS } from "../materials";
import { kSpp } from "../physics";
import Equation from "../components/Equation";

interface Point { energy: number; reKK0: number; }

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export default function SPP() {
    const navigate = useNavigate();

    // material
    const [matName, setMatName] = useState(PRESETS[0].name);
    const [epsInf, setEpsInf] = useState(PRESETS[0].epsInf);
    const [wp, setWp] = useState(PRESETS[0].wp_eV);
    const [gamma, setGamma] = useState(PRESETS[0].gamma_eV);

    // dielectric
    const [dieIdx, setDieIdx] = useState(0);
    const [epsD, setEpsD] = useState(DIELECTRICS[0].epsD);

    // domain & sampling
    const [emin, setEmin] = useState(1.2);
    const [emax, setEmax] = useState(3.0);
    const [npts, setNpts] = useState(500);
    const [onlyValid, setOnlyValid] = useState(true);

    // UI
    const [isDragging, setIsDragging] = useState(false);

    function onSelectMaterial(name: string) {
        setMatName(name);
        const m = PRESETS.find(p => p.name === name)!;
        setEpsInf(m.epsInf); setWp(m.wp_eV); setGamma(m.gamma_eV);
    }
    function onSelectDielectric(idx: number) {
        setDieIdx(idx); setEpsD(DIELECTRICS[idx].epsD);
    }

    const R = {
        epsInf: { min: 0.0, max: 20.0, step: 0.01 },
        wp: { min: 1.0, max: 20.0, step: 0.01 },   // eV
        gamma: { min: 0.0, max: 1.0, step: 0.001 },  // eV
        epsD: { min: 1.0, max: 6.0, step: 0.001 },
        emin: { min: 0.5, max: 5.0, step: 0.01 },   // eV
        emax: { min: 0.5, max: 5.0, step: 0.01 },   // eV
        npts: { min: 50, max: 2000, step: 50 },
    };

    // FPS-friendly while dragging
    const effectiveNpts = isDragging ? Math.min(npts, 400) : npts;

    const data: Point[] = useMemo(() => {
        try {
            const e0 = Math.min(emin, emax);
            const e1 = Math.max(emin, emax);
            const N = Math.max(2, Math.floor(effectiveNpts));
            const out: Point[] = [];
            const step = (e1 - e0) / (N - 1);
            for (let i = 0; i < N; i++) {
                const E = e0 + i * step;
                const { ks, k0, epsM } = kSpp(E, epsInf, wp, gamma, epsD);
                if (!Number.isFinite(ks.re) || !Number.isFinite(k0)) continue;
                if (onlyValid && !(epsM.re < -epsD)) continue; // SPP existence
                const reKK0 = ks.re / k0;
                if (!Number.isFinite(reKK0)) continue;
                out.push({ energy: E, reKK0 });
            }
            return out;
        } catch {
            return [];
        }
    }, [emin, emax, effectiveNpts, epsInf, wp, gamma, epsD, onlyValid]);

    const hasData = data.length > 0;

    // ===== exports (CSV + PNG) =====
    const chartWrapRef = useRef<HTMLDivElement>(null);

    function downloadCSV() {
        const header = ["energy_eV", "re_k_over_k0"].join(",");
        const rows = data.map(d => [d.energy.toFixed(6), d.reKK0.toExponential(6)].join(","));
        const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "spp_dispersion.csv"; a.click();
        URL.revokeObjectURL(url);
    }

    // common range events
    const rangeEvents = {
        onMouseDown: () => setIsDragging(true),
        onMouseUp: () => setIsDragging(false),
        onTouchStart: () => setIsDragging(true),
        onTouchEnd: () => setIsDragging(false),
        onMouseLeave: () => setIsDragging(false),
    };

    return (
        <div className="spp-page" style={{ padding: 16, display: "grid", gap: 16, gridTemplateColumns: "340px 1fr" }}>
            {/* LEFT PANEL: Controls */}
            <div className="left-panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>
                <button
                    className="mb-2 px-3 py-1 rounded bg-black/10 hover:bg-black/20 text-sm self-start"
                    onClick={() => navigate("/")}
                >
                    ← Back to Home
                </button>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-3">Model Parameters</div>

                    {/* Presets */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                        <div>
                            <label className="text-xs opacity-70 block mb-1">Metal</label>
                            <select className="w-full text-sm p-1 border rounded" value={matName} onChange={(e) => onSelectMaterial(e.target.value)}>
                                {PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs opacity-70 block mb-1">Dielectric</label>
                            <select className="w-full text-sm p-1 border rounded" value={dieIdx} onChange={(e) => onSelectDielectric(parseInt(e.target.value))}>
                                {DIELECTRICS.map((d, idx) => <option key={d.label} value={idx}>{d.label}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {/* epsInf */}
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <label>ε∞</label>
                                <span className="font-mono text-blue-600">{round(epsInf)}</span>
                            </div>
                            <input type="range" className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                min={R.epsInf.min} max={R.epsInf.max} step={R.epsInf.step}
                                value={epsInf} onChange={(e) => setEpsInf(parseFloat(e.target.value))}
                                {...rangeEvents}
                            />
                        </div>

                        {/* wp */}
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <label>ωp (eV)</label>
                                <span className="font-mono text-blue-600">{round(wp)}</span>
                            </div>
                            <input type="range" className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                min={R.wp.min} max={R.wp.max} step={R.wp.step}
                                value={wp} onChange={(e) => setWp(parseFloat(e.target.value))}
                                {...rangeEvents}
                            />
                        </div>

                        {/* gamma */}
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <label>γ (eV)</label>
                                <span className="font-mono text-blue-600">{round(gamma, 3)}</span>
                            </div>
                            <input type="range" className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                min={R.gamma.min} max={R.gamma.max} step={R.gamma.step}
                                value={gamma} onChange={(e) => setGamma(parseFloat(e.target.value))}
                                {...rangeEvents}
                            />
                        </div>

                        {/* epsD */}
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <label>εd (Dielectric)</label>
                                <span className="font-mono text-blue-600">{round(epsD, 3)}</span>
                            </div>
                            <input type="range" className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                min={R.epsD.min} max={R.epsD.max} step={R.epsD.step}
                                value={epsD} onChange={(e) => setEpsD(parseFloat(e.target.value))}
                                {...rangeEvents}
                            />
                        </div>
                    </div>
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-3">Simulation Config</div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                            <label className="text-xs opacity-70">Energy Min (eV)</label>
                            <input type="number" step={0.1} value={emin} onChange={e => setEmin(Number(e.target.value))} className="w-full text-sm p-1 border rounded" />
                        </div>
                        <div>
                            <label className="text-xs opacity-70">Energy Max (eV)</label>
                            <input type="number" step={0.1} value={emax} onChange={e => setEmax(Number(e.target.value))} className="w-full text-sm p-1 border rounded" />
                        </div>
                    </div>

                    <div className="mb-3">
                        <div className="flex justify-between text-xs mb-1">
                            <label>Points {npts}</label>
                        </div>
                        <input type="range" className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            min={R.npts.min} max={R.npts.max} step={R.npts.step}
                            value={npts} onChange={(e) => setNpts(Number(e.target.value))}
                            {...rangeEvents}
                        />
                    </div>

                    <div>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={onlyValid} onChange={e => setOnlyValid(e.target.checked)} className="rounded text-blue-600" />
                            <span>Show valid SPP only (Re(εm) &lt; −εd)</span>
                        </label>
                    </div>
                </section>
            </div>

            {/* RIGHT PANEL: Graph */}
            <div className="right-panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>
                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="flex justify-between items-center mb-2">
                        <div className="text-lg font-semibold">SPP Dispersion — ω vs Re(k)/k₀</div>
                        <button className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded" onClick={downloadCSV}>Download CSV</button>
                    </div>

                    <div className="chart-wrap" ref={chartWrapRef} style={{ height: 500 }}>
                        {hasData ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data} margin={{ top: 10, right: 24, bottom: 10, left: 12 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="reKK0" name="Re(k)/k0" tickCount={8}
                                        domain={["auto", "auto"]}
                                        label={{ value: "Re(k)/k₀", position: "insideBottom", offset: -5, fontSize: 12 }}
                                        tick={{ fontSize: 11 }}
                                    />
                                    <YAxis type="number" dataKey="energy" name="ω (eV)" tickCount={8}
                                        domain={["auto", "auto"]}
                                        label={{ value: "ω (eV)", angle: -90, position: "insideLeft", fontSize: 12 }}
                                        tick={{ fontSize: 11 }}
                                    />
                                    <Tooltip
                                        formatter={(val: any, name) => [Number(val).toFixed(3), name]}
                                        contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                    <ReferenceLine x={1} strokeDasharray="5 5" label={{ value: "light line", position: 'insideTopLeft', fontSize: 10, fill: '#888' }} />
                                    <Line type="monotone" dataKey="energy" dot={false} isAnimationActive={false} stroke="#2563eb" strokeWidth={2}
                                        name="ω vs Re(k)/k₀" />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <div>No valid SPP points in this range/config.</div>
                                <div className="text-xs mt-1 opacity-70">Try widening Emin/Emax or uncheck “Only show SPP region”.</div>
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 text-center">Vertical dashed line at Re(k)/k₀ = 1 is the light line.</p>
                </section>

                <section className="card" style={{ padding: 12, borderRadius: 12, border: "1px solid #3333", background: "var(--panel, #1111)" }}>
                    <div className="text-lg font-semibold mb-2">Physics Equations</div>
                    <div className="eq-katex opacity-90 text-sm overflow-x-auto">
                        <Equation
                            block
                            latex={`\\varepsilon_m(\\omega)=\\varepsilon_{\\infty}-\\dfrac{\\omega_p^{2}}{\\omega^{2}+i\\,\\gamma\\,\\omega}`}
                        />
                        <Equation
                            block
                            latex={`k_{\\mathrm{spp}}(\\omega)=\\dfrac{\\omega}{c}\\,\\sqrt{\\dfrac{\\varepsilon_m(\\omega)\\,\\varepsilon_d}{\\varepsilon_m(\\omega)+\\varepsilon_d}}`}
                        />
                        <Equation
                            block
                            latex={`\\text{SPP exists when }\\operatorname{Re}\\{\\varepsilon_m(\\omega)\\}<-\\varepsilon_d\\,.`}
                        />
                    </div>
                </section>
            </div>
        </div>
    );
}
