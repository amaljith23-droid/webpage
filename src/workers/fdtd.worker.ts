
// src/workers/fdtd.worker.ts
import { yeeder3d } from "../math/yeeder3d";
import { SparseDiagonalMatrix } from "../math/SparseMatrix";

/* eslint-disable no-restricted-globals */
const ctx: Worker = self as any;

// Message Types
type InitMessage = {
    type: "INIT";
    payload: {
        Nx: number; Ny: number; Nz: number;
        dx: number; dy: number; dz: number;
        bc: [number, number, number];
        kinc: [number, number, number];
        dt: number;
        epsRel?: Float32Array; // Optional material map
    };
};


type StepMessage = {
    type: "STEP";
    count: number;
};

type ParamsMessage = {
    type: "UPDATE_PARAMS";
    payload: {
        sourcePos: [number, number, number]; // Index coordinates
        sourceFreq: number; // Hz
        running: boolean;
    };
};

type IncomingMessage = InitMessage | StepMessage | ParamsMessage;

// State
let M: number;
let Nx: number, Ny: number, Nz: number;
let DEX: SparseDiagonalMatrix, DEY: SparseDiagonalMatrix, DEZ: SparseDiagonalMatrix;
let DHX: SparseDiagonalMatrix, DHY: SparseDiagonalMatrix, DHZ: SparseDiagonalMatrix;

// Fields (Real part only for visualization simplicity unless we go full complex FDTD which requires complex field arrays)
// The yeeder3d produces complex matrices (with -1i * kinc).
// If kinc=0, matrices are real (except possible -1 multiplier, effectively real).
// If kinc!=0, we MUST use complex arithmetic.
// Let's assume complex fields to support PBC fully.
let exRe: Float64Array, exIm: Float64Array;
let eyRe: Float64Array, eyIm: Float64Array;
let ezRe: Float64Array, ezIm: Float64Array;
let epsRel: Float32Array; // Relative permittivity map

let hxRe: Float64Array, hxIm: Float64Array;
let hyRe: Float64Array, hyIm: Float64Array;
let hzRe: Float64Array, hzIm: Float64Array;

// Simulation params
let dt = 0;
let t = 0;
let stepCount = 0;
let isRunning = false;
let animationFrameId: number;

// Source
let sourcePos = [0, 0, 0];
let sourceFreq = 0;
// e.g. a soft source at center

const c0 = 3e8;
const mu0 = 4 * Math.PI * 1e-7;
const eps0 = 8.854187817e-12;

// We assume normalized grid in yeeder3d usually, but here we passed physical d.
// Maxwell Curl Equations:
// dE/dt = (1/eps) * curl(H)
// dH/dt = -(1/mu) * curl(E)
// Update:
// E_new = E_old + (dt/eps) * curl(H)
// H_new = H_old - (dt/mu) * curl(E)

// yeeder3d returns D matrices which are essentially the curl operator components?
// No, they are partial derivatives d/dx, d/dy, d/dz.
// Curl H = (dHz/dy - dHy/dz) x_hat + ...
// We need to construct curl from derivatives.

function curl(
    fxRe: Float64Array, fxIm: Float64Array,
    fyRe: Float64Array, fyIm: Float64Array,
    fzRe: Float64Array, fzIm: Float64Array,
    DX: SparseDiagonalMatrix, DY: SparseDiagonalMatrix, DZ: SparseDiagonalMatrix
) {
    // Cx = dFz/dy - dFy/dz
    // Cy = dFx/dz - dFz/dx
    // Cz = dFy/dx - dFx/dy

    // We reuse temp arrays to avoid allocation? No, straightforward for now.

    const dFz_dy = DY.multiply(fzRe, fzIm);
    const dFy_dz = DZ.multiply(fyRe, fyIm);
    const cxRe = new Float64Array(M);
    const cxIm = new Float64Array(M);
    for (let i = 0; i < M; i++) {
        cxRe[i] = dFz_dy.re[i] - dFy_dz.re[i];
        cxIm[i] = dFz_dy.im[i] - dFy_dz.im[i];
    }

    const dFx_dz = DZ.multiply(fxRe, fxIm);
    const dFz_dx = DX.multiply(fzRe, fzIm);
    const cyRe = new Float64Array(M);
    const cyIm = new Float64Array(M);
    for (let i = 0; i < M; i++) {
        cyRe[i] = dFx_dz.re[i] - dFz_dx.re[i];
        cyIm[i] = dFx_dz.im[i] - dFz_dx.im[i];
    }

    const dFy_dx = DX.multiply(fyRe, fyIm);
    const dFx_dy = DY.multiply(fxRe, fxIm);
    const czRe = new Float64Array(M);
    const czIm = new Float64Array(M);
    for (let i = 0; i < M; i++) {
        czRe[i] = dFy_dx.re[i] - dFx_dy.re[i];
        czIm[i] = dFy_dx.im[i] - dFx_dy.im[i];
    }

    return { cxRe, cxIm, cyRe, cyIm, czRe, czIm };
}

ctx.onmessage = (e: MessageEvent<IncomingMessage>) => {
    const msg = e.data;

    if (msg.type === "INIT") {
        const p = msg.payload;
        Nx = p.Nx; Ny = p.Ny; Nz = p.Nz;
        M = Nx * Ny * Nz;
        dt = p.dt;

        // Reset fields
        exRe = new Float64Array(M); exIm = new Float64Array(M);
        eyRe = new Float64Array(M); eyIm = new Float64Array(M);
        ezRe = new Float64Array(M); ezIm = new Float64Array(M);

        hxRe = new Float64Array(M); hxIm = new Float64Array(M);
        hyRe = new Float64Array(M); hyIm = new Float64Array(M);
        hzRe = new Float64Array(M); hzIm = new Float64Array(M);

        if (p.epsRel) {
            epsRel = p.epsRel;
        } else {
            epsRel = new Float32Array(M).fill(1);
        }

        t = 0;
        stepCount = 0;

        // Build matrices
        const mats = yeeder3d(
            [Nx, Ny, Nz],
            [p.dx, p.dy, p.dz],
            p.bc,
            p.kinc
        );
        DEX = mats.DEX; DEY = mats.DEY; DEZ = mats.DEZ;
        DHX = mats.DHX; DHY = mats.DHY; DHZ = mats.DHZ;

        // Also setup complex handling for sparse matrices if needed
        // The yeeder3d implementation automatically adds complex diagonals if needed.

        // Default source at center
        sourcePos = [Math.floor(Nx / 2), Math.floor(Ny / 2), Math.floor(Nz / 2)];

        ctx.postMessage({ type: "INIT_DONE" });
    }
    else if (msg.type === "UPDATE_PARAMS") {
        sourcePos = msg.payload.sourcePos;
        sourceFreq = msg.payload.sourceFreq;
        if (msg.payload.running !== undefined) {
            isRunning = msg.payload.running;
            if (isRunning) loop();
        }
    }
};

function loop() {
    if (!isRunning) return;

    // Perform multiple steps per frame to speed up
    const stepsPerFrame = 5;

    for (let s = 0; s < stepsPerFrame; s++) {
        step();
    }

    // Send data back for visualization
    // We send Ez magnitude usually relative to Z-plane
    // For 3D, we might want a slice.
    // Let's send a slice at z = Nz/2 (or index Nz/2).
    const sliceIdx = Math.floor(Nz / 2);
    const start = sliceIdx * Nx * Ny;
    const end = start + Nx * Ny;

    // Helper to extract magnitude
    const extractSlice = (re: Float64Array, im: Float64Array) => {
        const arr = new Float32Array(Nx * Ny); // smaller for transfer
        for (let i = 0; i < Nx * Ny; i++) {
            const idx = start + i;
            arr[i] = Math.hypot(re[idx], im[idx]);
            // or just Real part for instantaneous view
            // arr[i] = re[idx];
        }
        return arr;
    }

    // Send Ez slice
    // Actually typically we view Ez in TMz, or similar.
    const ezSlice = new Float32Array(Nx * Ny);
    for (let i = 0; i < Nx * Ny; i++) {
        // Just real part for wave animation
        ezSlice[i] = ezRe[start + i];
    }

    ctx.postMessage({
        type: "FRAME",
        fields: {
            ez: ezSlice
        },
        time: t
    }, [ezSlice.buffer]);

    if (isRunning) {
        setTimeout(loop, 0); // or requestAnimationFrame if in main thread, but in worker setTimeout is fine
    }
}

function step() {
    // 1. Update H from E
    // dH/dt = -(1/mu) * curl(E)
    // H_new = H_old - (dt/mu0) * curl_E
    // curl_E uses DEX, DEY, DEZ acting on E

    const curlE = curl(exRe, exIm, eyRe, eyIm, ezRe, ezIm, DEX, DEY, DEZ);
    const ch = dt / mu0;

    for (let i = 0; i < M; i++) {
        hxRe[i] -= ch * curlE.cxRe[i];
        hxIm[i] -= ch * curlE.cxIm[i];

        hyRe[i] -= ch * curlE.cyRe[i];
        hyIm[i] -= ch * curlE.cyIm[i];

        hzRe[i] -= ch * curlE.czRe[i];
        hzIm[i] -= ch * curlE.czIm[i];
    }

    // 2. Update E from H
    // dE/dt = (1/eps) * curl(H)
    // E_new = E_old + (dt/(eps0*eps_r)) * curl_H
    // curl_H uses DHX, DHY, DHZ acting on H
    // Note: Use the DH operators which are negative transpose of DE

    const curlH = curl(hxRe, hxIm, hyRe, hyIm, hzRe, hzIm, DHX, DHY, DHZ);
    const ce = dt / eps0;

    for (let i = 0; i < M; i++) {
        const invEps = 1.0 / epsRel[i];

        exRe[i] += ce * curlH.cxRe[i] * invEps;
        exIm[i] += ce * curlH.cxIm[i] * invEps;

        eyRe[i] += ce * curlH.cyRe[i] * invEps;
        eyIm[i] += ce * curlH.cyIm[i] * invEps;

        ezRe[i] += ce * curlH.czRe[i] * invEps;
        ezIm[i] += ce * curlH.czIm[i] * invEps;



    }

    // 3. Source Injection (Soft Source)
    // Add to Ez at sourcePos
    t += dt;
    stepCount++;

    const srcIdx = sourcePos[0] + sourcePos[1] * Nx + sourcePos[2] * Nx * Ny;
    if (srcIdx >= 0 && srcIdx < M) {
        // Gaussian pulse or Sine wave
        // J_z source term -> acts on Ez
        // dE/dt = ... - (1/eps) * J
        // So update is E -= (dt/eps)*J
        // Or hard source: E = value.
        // Let's use hard source sine wave for continuous visualization
        // or gaussian pulse.

        if (sourceFreq === 0) {
            // Gaussian Pulse
            // Hard source: E = val
            const t0 = 40 * dt;
            const width = 12 * dt;
            const val = 2.0 * Math.exp(-Math.pow((t - t0) / width, 2));

            // Hard source override (prevents reflection from source point, but clearer wave launch)
            ezRe[srcIdx] = val;
        } else {
            // Sine Continuous
            const omega = 2 * Math.PI * sourceFreq;
            // Ramp up to avoid high freq transients
            const ramp = Math.min(1.0, t / (50 * dt));
            const val = Math.sin(omega * t) * ramp;
            ezRe[srcIdx] = val; // Hard source
        }
    }
}
