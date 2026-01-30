// Physical constants and complex math + SPP dispersion utilities
export const C = 2.99792458e8;        // m/s
export const HBAR = 6.582119569e-16;  // eV·s

export type Complex = { re: number; im: number };

export function cadd(a: Complex, b: Complex): Complex {
    return { re: a.re + b.re, im: a.im + b.im };
}
export function csub(a: Complex, b: Complex): Complex {
    return { re: a.re - b.re, im: a.im - b.im };
}
export function cmul(a: Complex, b: Complex): Complex {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}
export function cdiv(a: Complex, b: Complex): Complex {
    const den = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / den, im: (a.im * b.re - a.re * b.im) / den };
}
export function csqrt(z: Complex): Complex {
    const r = Math.hypot(z.re, z.im);
    const t = Math.atan2(z.im, z.re);
    const s = Math.sqrt(r);
    return { re: s * Math.cos(t / 2), im: s * Math.sin(t / 2) };
}

// Drude permittivity: ε(ω) = ε∞ − ωp^2 / (ω^2 + i γ ω)
// Inputs in eV; internally convert to rad/s via ħ.
export function epsDrude(E_eV: number, epsInf: number, wp_eV: number, gamma_eV: number): Complex {
    const omega = E_eV / HBAR;       // rad/s
    const wp = wp_eV / HBAR;         // rad/s
    const gamma = gamma_eV / HBAR;   // rad/s
    const denom: Complex = { re: omega * omega, im: gamma * omega };
    const frac = cdiv({ re: wp * wp, im: 0 }, denom);
    return { re: epsInf - frac.re, im: -frac.im };
}

// k_spp(ω) = (ω/c) * sqrt( εm εd / (εm + εd) )
export function kSpp(E_eV: number, epsInf: number, wp_eV: number, gamma_eV: number, epsD: number) {
    const omega = E_eV / HBAR; // rad/s
    const epsM = epsDrude(E_eV, epsInf, wp_eV, gamma_eV);
    const num = cmul(epsM, { re: epsD, im: 0 });
    const den = cadd(epsM, { re: epsD, im: 0 });
    const frac = cdiv(num, den);
    const root = csqrt(frac);
    const k0 = omega / C; // free-space wave number
    return { ks: { re: k0 * root.re, im: k0 * root.im }, k0, epsM };
}
