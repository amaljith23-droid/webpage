// src/pages/Home.tsx
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

/** Landing page with a LIGHT theme interference background. */
export default function Home() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d", { alpha: true })!;

        let w = 0, h = 0, dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        let raf = 0;
        let phase = 0;

        // === Your saved defaults ===
        const n0 = 1.0;   // air
        const n1 = 1.86;  // film
        const n2 = 1.50;  // substrate (glass)

        const t0 = 1;            // nm base thickness (↑ = slower bands)
        const A = 360;           // nm amplitude (↑ = stronger color swings)
        const globalAlpha = 0.7; // canvas blend strength
        const baseLift = 0.3;    // lift shadows toward white (0..1)
        const contrast = 1.9;    // contrast gain for the pattern
        const desat = 0.10;      // small desaturation so it stays tasteful
        const gamma = 1 / 1.85;  // gamma for punch on a light base

        // Representative wavelengths per RGB channel (nm)
        const λ = { r: 690, g: 540, b: 470 };

        function resize() {
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
        }

        // Normal-incidence single-layer reflectance
        function R_single(lambdaNm: number, tNm: number) {
            const λm = lambdaNm * 1e-9;
            const t = tNm * 1e-9;
            const r01 = (n0 - n1) / (n0 + n1);
            const r12 = (n1 - n2) / (n1 + n2);
            const δ = (2 * Math.PI * n1 * t) / λm;

            const c = Math.cos(2 * δ);
            const s = Math.sin(2 * δ);

            const a_re = r01 + r12 * c;
            const a_im = r12 * s;
            const b_re = 1 + r01 * r12 * c;
            const b_im = r01 * r12 * s;

            const den = b_re * b_re + b_im * b_im;
            const r_re = (a_re * b_re + a_im * b_im) / den;
            const r_im = (a_im * b_re - a_re * b_im) / den;
            return r_re * r_re + r_im * r_im; // |r|^2
        }

        // Low-res buffer for speed, then upscale
        const buf = document.createElement("canvas");
        const bctx = buf.getContext("2d", { willReadFrequently: true })!;

        function render() {
            const bw = Math.max(260, Math.floor(w / 2.8));
            const bh = Math.max(180, Math.floor(h / 2.8));
            buf.width = Math.floor(bw * dpr);
            buf.height = Math.floor(bh * dpr);

            const img = bctx.createImageData(buf.width, buf.height);
            const data = img.data;

            // Smooth spatial variation + drift
            const kx = (2 * Math.PI) / (0.65 * bw);
            const ky = (2 * Math.PI) / (0.85 * bh);
            const kd = (2 * Math.PI) / (0.60 * Math.hypot(bw, bh));

            let idx = 0;
            for (let y = 0; y < buf.height; y++) {
                for (let x = 0; x < buf.width; x++) {
                    const xf = x / dpr, yf = y / dpr;

                    const t =
                        t0 +
                        A * (
                            Math.sin(kx * xf + phase) +
                            Math.sin(ky * yf - 0.5 * phase) +
                            0.7 * Math.sin(kd * (xf + yf) + 0.3 * phase)
                        );

                    const Rr = R_single(λ.r, t);
                    const Rg = R_single(λ.g, t);
                    const Rb = R_single(λ.b, t);

                    // Increase dynamic range for a light base
                    const avg = (Rr + Rg + Rb) / 3;
                    let r = Rr * (1 - desat) + avg * desat;
                    let g = Rg * (1 - desat) + avg * desat;
                    let b = Rb * (1 - desat) + avg * desat;

                    // contrast + lift + gamma → bright pastel yet visible
                    r = Math.pow(baseLift + contrast * r, gamma);
                    g = Math.pow(baseLift + contrast * g, gamma);
                    b = Math.pow(baseLift + contrast * b, gamma);

                    data[idx++] = Math.max(0, Math.min(255, (r * 255) | 0));
                    data[idx++] = Math.max(0, Math.min(255, (g * 255) | 0));
                    data[idx++] = Math.max(0, Math.min(255, (b * 255) | 0));
                    data[idx++] = 255;
                }
            }
            bctx.putImageData(img, 0, 0);

            // Base (uses light --bg)
            const bg = (getComputedStyle(document.documentElement).getPropertyValue("--bg") || "#f7fafc").trim();
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw pattern on top (no multiply so it stays vivid on light base)
            ctx.globalAlpha = globalAlpha;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(buf, 0, 0, buf.width, buf.height, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
        }

        function tick() {
            phase += 0.004;
            render();
            raf = requestAnimationFrame(tick);
        }

        resize();
        window.addEventListener("resize", resize);
        raf = requestAnimationFrame(tick);
        return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(raf); };
    }, []);

    return (
        <div className="home">
            {/* Background */}
            <canvas ref={canvasRef} className="bg-canvas" aria-hidden />

            {/* Light overlay so the pattern isn’t muted */}
            <div
                className="overlay"
                style={{ background: "radial-gradient(700px 700px at 20% -10%, rgba(255,255,255,.18), rgba(255,255,255,0))" }}
            />

            {/* Foreground */}
            <div className="content">
                {/* Top nav */}
                <nav className="site-nav">
                    <div className="brand">
                        <span className="logo-dot" />
                        <span className="brand-text">Lama Verse</span>
                    </div>
                    <div className="nav-right">
                        <Link className="nav-link" to="/thin-film">Thin-Film</Link>
                        <Link className="nav-link" to="/spp">SPP</Link>
                        <Link className="nav-link" to="/emt-stack">EMT Stack</Link>
                        <Link className="nav-link" to="/skin-depth">Skin Depth</Link>

                    </div>
                </nav>

                {/* Hero */}
                <div className="hero">
                    <h1 className="title">Optics & EM — Interactive Tools</h1>
                    <p className="subtitle">Thin-film, SPP, EMT stacks, and skin-depth — fast, accurate, research-grade.</p>

                    <div className="tiles">
                        <Link className="tile" to="/thin-film">
                            <div className="tile-body">
                                <div className="tile-title">Thin-Film R/T vs λ</div>
                                <div className="tile-desc">Transfer-matrix; multilayer spectra & field maps.</div>
                            </div>
                        </Link>

                        <Link className="tile" to="/spp">
                            <div className="tile-body">
                                <div className="tile-title">SPP Dispersion</div>
                                <div className="tile-desc">Metal–dielectric modes, losses, and k-β diagrams.</div>
                            </div>
                        </Link>

                        <Link className="tile" to="/emt-stack">
                            <div className="tile-body">
                                <div className="tile-title">EMT Stack — T/R/A</div>
                                <div className="tile-desc">Maxwell–Garnett vs Bruggeman composite layers in a stack.</div>
                            </div>
                        </Link>

                        <Link className="tile" to="/skin-depth">
                            <div className="tile-body">
                                <div className="tile-title">Skin Depth</div>
                                <div className="tile-desc">ε-form & conductor-form calculators, CSV import, λ-sweep plots.</div>
                            </div>
                        </Link>


                    </div>

                    <footer className="site-footer">© 2025 Lama Verse · v0.1</footer>
                </div>
            </div>
        </div>
    );
}
