
// src/pages/FDTD.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import Worker from "../workers/fdtd.worker?worker";
import { useNavigate } from "react-router-dom";

export default function FDTD() {
    const navigate = useNavigate();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const workerRef = useRef<Worker | null>(null);

    const [running, setRunning] = useState(false);

    // Simulation Params
    const [Nx, setNx] = useState(100);
    const [Ny, setNy] = useState(100);
    const [Nz, setNz] = useState(1); // 2D by default for speed
    const [dx, setDx] = useState(1e-6); // 1 micron

    const [sourceLambda, setSourceLambda] = useState(1550); // nm
    const [contrast, setContrast] = useState(0.5); // Visualization limit
    const [hasObject, setHasObject] = useState(false); // Quick toggle for a test object

    // Derived
    const c0 = 3e8;
    const sourceFreq = c0 / (sourceLambda * 1e-9);

    // Stats
    const [simTime, setSimTime] = useState(0);

    const initWorker = useCallback(() => {
        if (workerRef.current) workerRef.current.terminate();

        const w = new Worker();
        workerRef.current = w;

        w.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === "FRAME") {
                draw(msg.fields.ez);
                setSimTime(msg.time);
            }
        };

        // Init
        // Stability condition: dt <= 1 / (c * sqrt(1/dx^2 + ...))
        const cournat = 0.5; // Safety factor
        const dt = cournat / (c0 * Math.sqrt(1 / (dx * dx) + 1 / (dx * dx))); // Assuming dy=dx

        // Prepare Object Map
        let eps: Float32Array | undefined;
        if (hasObject) {
            eps = new Float32Array(Nx * Ny * Nz).fill(1);
            // Add a block in the middle right
            const midX = Math.floor(Nx * 0.6);
            const midY = Math.floor(Ny / 2);
            const wBlock = Math.floor(Nx * 0.1);
            const hBlock = Math.floor(Ny * 0.4);

            for (let j = midY - hBlock; j < midY + hBlock; j++) {
                for (let i = midX; i < midX + wBlock; i++) {
                    if (i >= 0 && i < Nx && j >= 0 && j < Ny) {
                        const idx = i + j * Nx;
                        eps[idx] = 4.0; // Index n=2
                    }
                }
            }
            // Circle 
            const cx = Math.floor(Nx * 0.3);
            const cy = Math.floor(Ny * 0.7);
            const R = Math.floor(Nx * 0.05);
            for (let j = 0; j < Ny; j++) {
                for (let i = 0; i < Nx; i++) {
                    if ((i - cx) ** 2 + (j - cy) ** 2 < R ** 2) {
                        eps[i + j * Nx] = 9.0; // Index n=3
                    }
                }
            }
        }

        w.postMessage({
            type: "INIT",
            payload: {
                Nx, Ny, Nz,
                dx, dy: dx, dz: dx,
                bc: [0, 0, 0],
                kinc: [0, 0, 0],
                dt,
                epsRel: eps
            }
        });

        setRunning(false);
    }, [Nx, Ny, Nz, dx, hasObject, c0]);

    useEffect(() => {
        initWorker();
        return () => workerRef.current?.terminate();
    }, [initWorker]);

    const draw = (data: Float32Array) => {
        const cvs = canvasRef.current;
        if (!cvs) return;
        const ctx = cvs.getContext("2d");
        if (!ctx) return;

        const w = cvs.width;
        const h = cvs.height;
        const imgData = ctx.createImageData(Nx, Ny);
        const buf = imgData.data;

        const limit = contrast;

        for (let i = 0; i < data.length; i++) {
            const val = data[i];
            const norm = Math.max(-1, Math.min(1, val / limit));

            // Colormap: Red (positive) - Black (zero) - Blue (negative)
            let r = 0, g = 0, b = 0;
            if (norm > 0) {
                r = Math.floor(norm * 255);
            } else {
                b = Math.floor(-norm * 255);
            }

            const p = i * 4;
            buf[p] = r;
            buf[p + 1] = g;
            buf[p + 2] = b;
            buf[p + 3] = 255;
        }

        createImageBitmap(imgData).then(bmp => {
            ctx.clearRect(0, 0, w, h);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(bmp, 0, 0, w, h);
        });
    };

    const toggleRun = () => {
        const next = !running;
        setRunning(next);
        workerRef.current?.postMessage({
            type: "UPDATE_PARAMS",
            payload: {
                sourcePos: [Math.floor(Nx / 2), Math.floor(Ny / 2), 0],
                sourceFreq,
                running: next
            }
        });
    };

    const reset = () => {
        initWorker();
    };

    return (
        <div className="p-4 h-full grid grid-cols-[300px_1fr] gap-4">
            <div className="flex flex-col gap-4">
                <button className="btn btn-secondary self-start" onClick={() => navigate("/")}>← Back</button>

                <div className="card p-4 space-y-4">
                    <h2 className="text-xl font-bold">FDTD Config</h2>

                    <div className="grid grid-cols-2 gap-2">
                        <label className="text-sm">Nx
                            <input type="number" value={Nx} onChange={e => setNx(Number(e.target.value))} className="input w-full" />
                        </label>
                        <label className="text-sm">Ny
                            <input type="number" value={Ny} onChange={e => setNy(Number(e.target.value))} className="input w-full" />
                        </label>
                    </div>

                    <label className="text-sm block">Wavelength (nm)
                        <input type="number" step={50} value={sourceLambda} onChange={e => setSourceLambda(Number(e.target.value))} className="input w-full" />
                    </label>

                    <div className="flex gap-2 items-center">
                        <label className="text-sm">Objects:</label>
                        <label className="flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={hasObject} onChange={e => setHasObject(e.target.checked)} />
                            Add Obstacles
                        </label>
                    </div>

                    <label className="text-sm block">Contrast
                        <input type="range" min="0.01" max="2" step="0.01" value={contrast} onChange={e => setContrast(Number(e.target.value))} className="w-full" />
                    </label>

                    <div className="flex gap-2">
                        <button className={`btn flex-1 ${running ? "btn-error" : "btn-primary"}`} onClick={toggleRun}>
                            {running ? "Stop" : "Start"}
                        </button>
                        <button className="btn btn-ghost" onClick={reset}>Reset</button>
                    </div>

                    <div className="text-xs font-mono opacity-70">
                        Time: {(simTime * 1e15).toFixed(1)} fs
                    </div>
                </div>

                <div className="card p-4 text-xs opacity-70">
                    <p>Displays Ez field component.</p>
                    <p>Using <code>yeeder3d</code> derivative matrices.</p>
                </div>
            </div>

            <div className="card p-4 bg-black flex items-center justify-center overflow-hidden">
                <canvas
                    ref={canvasRef}
                    width={500}
                    height={500}
                    className="w-full h-full object-contain image-pixelated"
                />
            </div>
        </div>
    );
}
