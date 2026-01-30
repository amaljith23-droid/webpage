export type DrudeMaterial = {
    name: string;
    epsInf: number;   // ε∞
    wp_eV: number;    // plasma energy (eV)
    gamma_eV: number; // damping (eV)
};

// Typical literature-style parameters (approximate; vary with film quality)
export const PRESETS: DrudeMaterial[] = [
    { name: "Gold (Au)", epsInf: 9.84, wp_eV: 9.03, gamma_eV: 0.071 },
    { name: "Silver (Ag)", epsInf: 5.45, wp_eV: 9.01, gamma_eV: 0.021 },
    { name: "Aluminum (Al)", epsInf: 1.00, wp_eV: 15.00, gamma_eV: 0.150 },
    { name: "Custom", epsInf: 9.0, wp_eV: 9.0, gamma_eV: 0.05 },
];

export const DIELECTRICS = [
    { label: "Air (n≈1.0)", epsD: 1.0 },
    { label: "Water (n≈1.33)", epsD: 1.7689 },
    { label: "Glass BK7 (n≈1.5)", epsD: 2.25 },
    { label: "Custom", epsD: 2.25 },
];
