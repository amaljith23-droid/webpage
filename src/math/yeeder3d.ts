
// src/math/yeeder3d.ts
import { SparseDiagonalMatrix } from "./SparseMatrix";

type Vector3 = [number, number, number];

/**
 * Port of yeeder3d.m
 * 
 * [DEX,DEY,DEZ,DHX,DHY,DHZ] = yeeder3d(NS,RES,BC,kinc)
 */
export function yeeder3d(
    NS: Vector3,
    RES: Vector3,
    BC: Vector3,
    kinc: Vector3 = [0, 0, 0]
): {
    DEX: SparseDiagonalMatrix, DEY: SparseDiagonalMatrix, DEZ: SparseDiagonalMatrix,
    DHX: SparseDiagonalMatrix, DHY: SparseDiagonalMatrix, DHZ: SparseDiagonalMatrix
} {
    // EXTRACT GRID PARAMETERS
    const Nx = NS[0]; const dx = RES[0];
    const Ny = NS[1]; const dy = RES[1];
    const Nz = NS[2]; const dz = RES[2];

    // DETERMINE MATRIX SIZE
    const M = Nx * Ny * Nz;

    // Helper to create ones/zeros arrays efficiently
    const ones = (len: number) => new Float64Array(len).fill(1);
    const zeros = (len: number) => new Float64Array(len);

    // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    // %% BUILD DEX
    // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    let DEX: SparseDiagonalMatrix;

    if (Nx === 1) {
        // DEX = -1i*kinc(1)*speye(M,M);
        DEX = new SparseDiagonalMatrix(M, M);
        // Diagonal 0, value -i * kinc[0]
        const valIm = -kinc[0];
        DEX.addDiagonal(0, zeros(M), new Float64Array(M).fill(valIm));
    } else {
        DEX = new SparseDiagonalMatrix(M, M);

        // Center Diagonal (-1/dx)
        const d0 = new Float64Array(M).fill(-1 / dx);
        // Upper Diagonal (1/dx)
        const d1 = new Float64Array(M).fill(1 / dx);
        // d1(Nx+1:Nx:M) = 0; -> In 0-indexed: indices Nx, 2Nx, ...
        // These are the boundaries in X where the wrap-around shouldn't happen for the main derivative
        // unless it's periodic, but standard diff matrix zeros these.
        for (let i = Nx - 1; i < M; i += Nx) {
            d1[i] = 0;
        }

        DEX.addDiagonal(0, d0);
        DEX.addDiagonal(1, d1);

        // Incorporate Periodic Boundary Conditions
        if (BC[0] === 1) {
            // d1 = zeros(M,1);
            // d1(1:Nx:M) = exp(-1i*kinc(1)*Nx*dx)/dx;
            // DEX = spdiags(d1,1-Nx,DEX);
            // Diagonal index is 1 - Nx.

            const pbcRe = new Float64Array(M);
            const pbcIm = new Float64Array(M);

            const phase = -kinc[0] * Nx * dx; // The exponent argument
            const valRe = Math.cos(phase) / dx;
            const valIm = Math.sin(phase) / dx;

            // 1:Nx:M in 1-based is 1, 1+Nx, ... -> 0-based: 0, Nx, 2Nx...
            for (let i = 0; i < M; i += Nx) {
                pbcRe[i] = valRe;
                pbcIm[i] = valIm;
            }

            DEX.addDiagonal(1 - Nx, pbcRe, pbcIm);
        }
    }

    // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    // %% BUILD DEY
    // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    let DEY: SparseDiagonalMatrix;

    if (Ny === 1) {
        DEY = new SparseDiagonalMatrix(M, M);
        const valIm = -kinc[1];
        DEY.addDiagonal(0, zeros(M), new Float64Array(M).fill(valIm));
    } else {
        DEY = new SparseDiagonalMatrix(M, M);

        // Center Diagonal (-1/dy)
        const d0 = new Float64Array(M).fill(-1 / dy);

        // Upper Diagonal (1/dy)
        // d1 = [ ones((Ny-1)*Nx,1) ; zeros(Nx,1) ];
        // d1 = repmat(d1,[Nz-1 1]);
        // d1 = [ zeros(Nx,1) ; d1 ; ones((Ny-1)*Nx,1) ]; -- Wait, logic check.

        // MATLAB:
        // d1 = [ ones((Ny-1)*Nx,1) ; zeros(Nx,1) ]; repeated Nz-1 times? No.
        // It builds a pattern.
        // Let's decode the pattern directly.
        // It's the derivative in Y. Y stride is Nx.
        // So we expect diagonal at +Nx.
        // Zeros should be where wrapping Y occurs.
        // In grid (i, j, k), next y is (i, j+1, k). Index diff is Nx.
        // If j = Ny-1, we shouldn't diff with next unless PBC.
        // Indices where j=Ny-1 are those where floor(idx/Nx) % Ny == Ny-1.

        const d1 = new Float64Array(M).fill(1 / dy);

        // Manually zero out the boundaries
        for (let idx = 0; idx < M; idx++) {
            // Coordinate extraction
            // idx = i + Nx*j + Nx*Ny*k
            const j = Math.floor(idx / Nx) % Ny;
            if (j === Ny - 1) {
                d1[idx] = 0; // Don't connect to next block
            }
        }

        DEY.addDiagonal(0, d0);
        DEY.addDiagonal(Nx, d1);

        // Incorporate Periodic Boundary Conditions
        if (BC[1] === 1) {
            // ph = exp(-1i*kinc(2)*Ny*dy)/dy;
            const phase = -kinc[1] * Ny * dy;
            const phRe = Math.cos(phase) / dy;
            const phIm = Math.sin(phase) / dy;

            const pbcRe = new Float64Array(M);
            const pbcIm = new Float64Array(M);

            // d1 mask in MATLAB: [ ones(Nx) ; zeros((Ny-1)Nx) ] repeated
            // Essentially only for j=0 (first Y row in a Z-plane).
            // Connects j=0 to j=Ny-1 (but wrapped).
            // Diagonal is -Nx*(Ny-1).

            for (let idx = 0; idx < M; idx++) {
                const j = Math.floor(idx / Nx) % Ny;
                if (j === 0) {
                    pbcRe[idx] = phRe;
                    pbcIm[idx] = phIm;
                }
            }

            DEY.addDiagonal(-Nx * (Ny - 1), pbcRe, pbcIm);
        }
    }

    // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    // %% BUILD DEZ
    // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    let DEZ: SparseDiagonalMatrix;

    if (Nz === 1) {
        DEZ = new SparseDiagonalMatrix(M, M);
        const valIm = -kinc[2];
        DEZ.addDiagonal(0, zeros(M), new Float64Array(M).fill(valIm));
    } else {
        DEZ = new SparseDiagonalMatrix(M, M);

        const d0 = new Float64Array(M).fill(1 / dz); // Note: MATLAB uses [-d0 +d0] so center is -1/dz, upper is +1/dz?
        // MATLAB: DEZ = spdiags([-d0 +d0]/dz,[0 Nx*Ny],Z);
        // yes, center is -1/dz (from -d0), upper is +1/dz (from +d0 at diagonal Nx*Ny)

        // Center
        DEZ.addDiagonal(0, new Float64Array(M).fill(-1 / dz));

        // Upper: +Nx*Ny. This is correct for Z-derivative.
        // Boundary: k = Nz-1.
        const upper = new Float64Array(M).fill(1 / dz);
        for (let idx = 0; idx < M; idx++) {
            const k = Math.floor(idx / (Nx * Ny));
            if (k === Nz - 1) {
                upper[idx] = 0;
            }
        }
        DEZ.addDiagonal(Nx * Ny, upper);

        // Incorporate Periodic Boundary Conditions
        if (BC[2] === 1) {
            // Diagonal: -Nx*Ny*(Nz-1)
            const phase = -kinc[2] * Nz * dz;
            const phRe = Math.cos(phase) / dz;
            const phIm = Math.sin(phase) / dz;

            const pbcRe = new Float64Array(M);
            const pbcIm = new Float64Array(M);

            // Mask: d0 = ... ones(M,1) in MATLAB code??
            // if BC(3)==1, d0 = (phase)*ones(M,1).
            // Meaning all entries in that diagonal are filled?
            // Actually yes, because for the wrap-around diagonal (-stride), the valid row indices 
            // are i where i-stride is valid? No.
            // Diagonal k': A[i, i+k']
            // If k' is large negative, i starts appearing late.
            // BUT wait. In MATLAB: spdiags(col, d, ...)
            // The column is aligned to the matrix rows.
            // If the code says `ones(M,1)`, it means for every row i, if the diagonal exists there, use value.
            // Z-wrap connects k=0 to k=Nz-1.
            // row i (where k=0) connects to col j (where k=Nz-1).
            // j = i + diag. diag = -Nx*Ny*(Nz-1).
            // So j < i. This is a lower diagonal.
            // i must be large enough. i corresponds to k=Nz-1? No.
            // Let's trace.
            // Forward diff: f(x+h) - f(x).
            // Boundary: f(0) - f(L)? No, f(L) wraps to f(0).
            // D * u. row i is grid point i.
            // (D*E) at boundary k=Nz-1: wants E(k=Nz) which is E(k=0)*phase.
            // Equation for k=Nz-1: (E[0]*phase - E[Nz-1])/dz.
            // So coefficient for E[0] is phase/dz.
            // E[0] is at index i' = i - Nx*Ny*(Nz-1).
            // So we want A[i, i - stride] = phase/dz.
            // This is diagonal -stride.
            // And this is only for rows i where k=Nz-1.
            // MATLAB code `d0 = ... ones(M,1)` suggests it puts it everywhere.
            // `spdiags` will truncate/ignore values that fall outside the matrix.
            // So we can just fill the array.

            // Wait, my `SparseMatrix` implementation assumes `addDiagonal` takes an array aligned to rows 0..M-1.
            // If I pass an array of all constants, it will pick the values for the valid rows.
            // So filling the array is correct.

            pbcRe.fill(phRe);
            pbcIm.fill(phIm);

            DEZ.addDiagonal(-Nx * Ny * (Nz - 1), pbcRe, pbcIm);
        }
    }

    // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    // %% BUILD DHX, DHY AND DHZ
    // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    const DHX = DEX.conjugateTranspose();
    // DHX = -DEX'  -- Wait, MATLAB code says DHX = -DEX'.
    // Negate the values.
    negateMatrix(DHX);

    const DHY = DEY.conjugateTranspose();
    negateMatrix(DHY);

    const DHZ = DEZ.conjugateTranspose();
    negateMatrix(DHZ);

    return { DEX, DEY, DEZ, DHX, DHY, DHZ };
}

function negateMatrix(bat: SparseDiagonalMatrix) {
    // In-place negation
    // Access private via any (or add method)
    // For now, let's just cheat bits or add a method.
    // I'll assume I can iterate.
    // Or better, add a scale method to SparseMatrix?
    // Or just public access.

    // Since I can't easily modify the class now without rewrite, I'll allow `any` access or rely on `fromDiagonals`.
    // Actually, I can just reimplement or use `any`.

    // Let's cast to any to access diagonals map for in-place negation.
    const mat = bat as any;
    for (const val of (mat.diagonals as Map<number, Float64Array>).values()) {
        for (let i = 0; i < val.length; i++) val[i] = -val[i];
    }
    if (mat.complexDiagonals) {
        for (const val of (mat.complexDiagonals as Map<number, Float64Array>).values()) {
            for (let i = 0; i < val.length; i++) val[i] = -val[i];
        }
    }
}
