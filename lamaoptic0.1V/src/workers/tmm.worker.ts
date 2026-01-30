/* eslint-disable no-restricted-globals */
/// <reference lib="webworker" />

export type Pol = "avg" | "s" | "p";
export type MaterialKind = "CONST" | "CAUCHY" | "SELLMEIER" | "DRUDE" | "TABLE";
export type MatCONST = { kind: "CONST"; name?: string; n: number; k: number };
export type MatCAUCHY = { kind: "CAUCHY"; name?: string; A: number; B: number; C: number; kConst?: number };
export type MatSELL = {
    kind: "SELLMEIER"; name?: string;
    B1: number; C1: number; B2: number; C2: number; B3: number; C3: number; kConst?: number;
};
export type DrudeLorentzTerm = { f: number; w0_eV: number; gamma_eV: number };
export type MatDRUDE = { kind: "DRUDE"; name?: string; epsInf: number; wp_eV: number; gamma_eV: number; lorentz?: DrudeLorentzTerm[] };
export type MatTABLE = { kind: "TABLE"; name?: string; lam_nm: number[]; n: number[]; k: number[] };
export type MaterialDef = MatCONST | MatCAUCHY | MatSELL | MatDRUDE | MatTABLE;

export type Row = {
    lambda: number;
    R: number; T: number; A: number;
    Rs: number; Ts: number; As: number;
    Rp: number; Tp: number; Ap: number;
};

type C = { re: number; im: number };
const c = (re = 0, im = 0): C => ({ re, im });
const add = (a: C, b: C) => c(a.re + b.re, a.im + b.im);
const sub = (a: C, b: C) => c(a.re - b.re, a.im - b.im);
const mul = (a: C, b: C) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: C, b: C) => {
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

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const isFiniteNum = (x: number) => Number.isFinite(x) && !Number.isNaN(x);

/* ------------------------- Dispersion ------------------------- */
function interpClamped(xs: number[], ys: number[], xq: number): number {
    const n = xs.length;
    if (!n) return NaN;
    if (xq <= xs[0]) return ys[0];
    if (xq >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= xq) lo = mid; else hi = mid;
    }
    const t = (xq - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + (ys[hi] - ys[lo]) * t;
}

function nFromMaterial(mat: MaterialDef, lambda_nm: number): C {
    switch (mat.kind) {
        case "CONST": return c(mat.n, clamp(mat.k, 0, 1e9));
        case "CAUCHY": {
            const l_um = lambda_nm * 1e-3;
            const n = mat.A + mat.B / (l_um * l_um) + mat.C / (l_um ** 4);
            const k = clamp(mat.kConst ?? 0, 0, 1e9);
            return c(n, k);
        }
        case "SELLMEIER": {
            const l_um = lambda_nm * 1e-3;
            const l2 = l_um * l_um;
            const n2 =
                1 +
                (mat.B1 * l2) / (l2 - mat.C1) +
                (mat.B2 * l2) / (l2 - mat.C2) +
                (mat.B3 * l2) / (l2 - mat.C3);
            const n = Math.sqrt(Math.max(0, n2));
            const k = clamp(mat.kConst ?? 0, 0, 1e9);
            return c(n, k);
        }
        case "DRUDE": {
            const E = 1240 / Math.max(1e-12, lambda_nm); // eV
            const i = c(0, 1);
            let eps = c(mat.epsInf, 0);
            const den = mul(c(E, 0), add(c(E, 0), mul(i, c(mat.gamma_eV, 0))));
            eps = sub(eps, div(c(mat.wp_eV * mat.wp_eV, 0), den));
            if (mat.lorentz) {
                for (const L of mat.lorentz) {
                    const num = c(L.f * L.w0_eV * L.w0_eV, 0);
                    const denL = sub(c(L.w0_eV * L.w0_eV - E * E, 0), mul(i, c(L.gamma_eV * E, 0)));
                    eps = add(eps, div(num, denL));
                }
            }
            const s = csqrt(eps);
            return c(s.re, Math.abs(s.im));
        }
        case "TABLE": {
            const n = interpClamped(mat.lam_nm, mat.n, lambda_nm);
            const k = interpClamped(mat.lam_nm, mat.k, lambda_nm);
            return c(Number.isFinite(n) ? n : 1, clamp(Number.isFinite(k) ? k : 0, 0, 1e9));
        }
    }
}

/* ------------------------- Abeles matrix ------------------------- */
type M2 = [C, C, C, C];
const I = c(0, 1);
const Meye: M2 = [c(1, 0), c(0, 0), c(0, 0), c(1, 0)];

const mmul = (A: M2, B: M2): M2 => ([
    add(mul(A[0], B[0]), mul(A[1], B[2])),
    add(mul(A[0], B[1]), mul(A[1], B[3])),
    add(mul(A[2], B[0]), mul(A[3], B[2])),
    add(mul(A[2], B[1]), mul(A[3], B[3])),
]);

function layerMatrix(delta: C, q: C): M2 {
    const cd = ccos(delta);
    const sd = csin(delta);
    return [cd, div(mul(I, sd), q), mul(mul(I, q), sd), cd];
}

function cosThetaInLayer(n0: C, n: C, sinTheta0: number): C {
    const s = mul(div(n0, n), c(sinTheta0, 0));
    return csqrt(sub(c(1, 0), mul(s, s)));
}

function stackRT(
    lambda_nm: number,
    theta0_deg: number,
    n0: C,
    ns: C,
    nLayers: C[],
    dLayers_nm: number[]
) {
    const lambda_m = lambda_nm * 1e-9;
    const k0 = (2 * Math.PI) / lambda_m;
    const sin0 = Math.sin((theta0_deg * Math.PI) / 180);

    const cos0 = c(Math.sqrt(1 - sin0 * sin0), 0);
    const cosL = nLayers.map(nj => cosThetaInLayer(n0, nj, sin0));
    const cosS = cosThetaInLayer(n0, ns, sin0);

    function solve(pol: "s" | "p") {
        const q0 = pol === "s" ? mul(n0, cos0) : div(n0, cos0);
        const qs = pol === "s" ? mul(ns, cosS) : div(ns, cosS);

        let M = Meye;
        for (let i = 0; i < nLayers.length; i++) {
            const nj = nLayers[i];
            const cj = cosL[i];
            const dj_m = dLayers_nm[i] * 1e-9;
            const delta = mul(c(k0 * dj_m, 0), mul(nj, cj)); // (2π/λ) * n * d * cosθ
            const qj = pol === "s" ? mul(nj, cj) : div(nj, cj);
            M = mmul(M, layerMatrix(delta, qj));
        }
        const [M11, M12, M21, M22] = M;
        const topL = add(M11, mul(M12, qs));
        const botL = add(M21, mul(M22, qs));
        const den = add(mul(q0, topL), botL);
        const num_r = sub(mul(q0, topL), botL);
        const r = div(num_r, den);
        const t = div(mul(c(2, 0), q0), den);

        const R = abs2(r);
        const Re = (z: C) => z.re;
        const T = (Math.max(1e-30, Re(qs)) / Math.max(1e-30, Re(q0))) * abs2(t);
        const A = Math.max(0, 1 - R - T);
        return { R, T, A };
    }

    const s = solve("s");
    const p = solve("p");
    return { Rs: s.R, Ts: s.T, As: s.A, Rp: p.R, Tp: p.T, Ap: p.A };
}

/* ------------------------- Job plumbing ------------------------- */
type Payload = {
    wavelengths: number[];
    thetaDeg: number;
    pol: Pol;
    ambient_n0: number;
    substrate: MaterialDef;
    layers: { d_nm: number; material: MaterialDef }[];
};

function toC(nr: number, ki = 0): C { return c(nr, ki); }

function computeRows(payload: Payload): Row[] {
    const { wavelengths, thetaDeg, ambient_n0, substrate, layers } = payload;
    const rows: Row[] = [];
    const n0 = toC(ambient_n0, 0);

    for (const lam of wavelengths) {
        if (!(Number.isFinite(lam) && lam > 0)) continue;
        const ns = nFromMaterial(substrate, lam);
        const nLayers = layers.map(L => nFromMaterial(L.material, lam));
        const dLayers = layers.map(L => Math.max(0, L.d_nm));

        const { Rs, Ts, As, Rp, Tp, Ap } = stackRT(lam, thetaDeg, n0, ns, nLayers, dLayers);
        const R = 0.5 * (Rs + Rp);
        const T = 0.5 * (Ts + Tp);
        const A = Math.max(0, 1 - R - T);
        rows.push({ lambda: lam, R, T, A, Rs, Ts, As, Rp, Tp, Ap });
    }
    return rows;
}

function safeCompute(payload: Payload) {
    try {
        const rows = computeRows(payload);
        (self as any).postMessage({ ok: true, rows });
    } catch (e: any) {
        (self as any).postMessage({ ok: false, error: e?.message || String(e) });
    }
}

self.addEventListener("message", (ev: MessageEvent) => {
    safeCompute(ev.data as Payload);
});
