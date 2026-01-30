
// src/math/SparseMatrix.ts

/**
 * Represents a sparse matrix using a diagonal storage format, similar to MATLAB's spdiags.
 * Only stores non-zero diagonals.
 */
export class SparseDiagonalMatrix {
    public readonly rows: number;
    public readonly cols: number;
    // Map from diagonal index 'k' to the array of values for that diagonal.
    // k = 0 is main diagonal. k < 0 is below main, k > 0 is above.
    // The values array should be of length min(rows, cols) usually, or full length M.
    // In MATLAB spdiags(B, d, m, n):
    // Columns of B are diagonals.
    // Here we store each diagonal as a Float64Array.
    private diagonals: Map<number, Float64Array>;
    private complexDiagonals?: Map<number, Float64Array>; // For imaginary parts if needed

    constructor(rows: number, cols: number) {
        this.rows = rows;
        this.cols = cols;
        this.diagonals = new Map();
    }

    /**
     * Creates a sparse matrix from diagonals.
     * Equivalent to spdiags(data, diags, m, n).
     * @param data Array of arrays/Float64Arrays, each representing a diagonal.
     * @param diags Array of integers specifying which diagonal each data column corresponds to.
     * @param m Number of rows
     * @param n Number of cols
     */
    static fromDiagonals(data: (number[] | Float64Array)[], diags: number[], m: number, n: number): SparseDiagonalMatrix {
        const mat = new SparseDiagonalMatrix(m, n);
        for (let i = 0; i < diags.length; i++) {
            const k = diags[i];
            const colData = data[i];
            // In MATLAB spdiags, the columns are length min(m, n).
            // Actually MATLAB's spdiags takes a matrix B where columns are diagonals.
            // The logic relates elements B(i,j) to A.
            // A(i, i+d) = B(i, j) where d is the j-th diagonal index.
            // So for a given diagonal k: A(i, j) where j-i = k.
            // The value is taken from the input array.
            // We'll assume the input data is aligned such that index 'i' corresponds to row 'i'.

            const diagLen = Math.min(m, n); // Simplified, usually M=N for us
            const storedDiag = new Float64Array(m); // Store full row-aligned length for easier multiply

            // Fill storedDiag based on k
            // For A[i, i+k] = val
            // Valid i range: 0 <= i < m AND 0 <= i+k < n
            const minI = Math.max(0, -k);
            const maxI = Math.min(m, n - k);

            for (let r = minI; r < maxI; r++) {
                // In MATLAB spdiags, the input column 'j' corresponds to diagonals.
                // The mapping is A(i, i+d) = B(i, ...).
                // The exact mapping in MATLAB: A(i, i+d) = B(i, column_for_d).
                // So we just copy data[i] to our internal storage at index i.
                if (r < colData.length) {
                    storedDiag[r] = colData[r];
                }
            }
            mat.diagonals.set(k, storedDiag);
        }
        return mat;
    }

    // Helper to set a complex diagonal if needed later, but for now assuming real construct + complex scalar
    // Or we handle complex by having two matrices or separate storage.
    // The FDTD update equations usually split real/imaginary or we use real arithmetic.
    // However, yeeder3d produces complex matrices (derivative operator is -1i * k...).
    // So we definitely need complex support.

    setComplex(isComplex: boolean) {
        if (isComplex && !this.complexDiagonals) {
            this.complexDiagonals = new Map();
        }
    }

    addDiagonal(k: number, real: Float64Array | number[], imag?: Float64Array | number[]) {
        // Assume input is row-aligned for simplicity of implementation
        const rLen = real.length;
        const dRe = new Float64Array(this.rows);
        const dIm = imag ? new Float64Array(this.rows) : (this.complexDiagonals ? new Float64Array(this.rows) : undefined);

        // Copy with bounds check
        const minI = Math.max(0, -k);
        const maxI = Math.min(this.rows, this.cols - k);

        for (let i = minI; i < maxI; i++) {
            if (i < rLen) {
                dRe[i] = real[i];
                if (imag && dIm) dIm[i] = imag[i];
            }
        }

        this.diagonals.set(k, dRe);
        if (dIm) {
            if (!this.complexDiagonals) this.complexDiagonals = new Map();
            this.complexDiagonals.set(k, dIm);
        }
    }

    /**
     * Multiply this matrix by a vector x.
     * y = A * x
     * @param xReal Real part of vector x
     * @param xImag Imaginary part of vector x (optional)
     */
    multiply(xReal: Float64Array, xImag?: Float64Array): { re: Float64Array, im: Float64Array } {
        const yRe = new Float64Array(this.rows);
        const yIm = new Float64Array(this.rows);

        const xIsComplex = !!xImag;

        for (const [k, dRe] of this.diagonals) {
            const dIm = this.complexDiagonals?.get(k);

            // Loop range where diagonal is valid
            // A[i, j] is non-zero where j = i + k
            // So we iterate i, and j = i + k.
            // Check bounds: 0 <= i < rows, 0 <= j < cols
            const minI = Math.max(0, -k);
            const maxI = Math.min(this.rows, this.cols - k);

            for (let i = minI; i < maxI; i++) {
                const j = i + k;
                const valRe = dRe[i];
                const valIm = dIm ? dIm[i] : 0;

                const xr = xReal[j];
                const xi = xIsComplex && xImag ? xImag[j] : 0;

                // (a+bi)(c+di) = (ac - bd) + i(ad + bc)
                yRe[i] += valRe * xr - valIm * xi;
                yIm[i] += valRe * xi + valIm * xr;
            }
        }

        return { re: yRe, im: yIm };
    }

    /**
     * Returns the conjugate transpose of this matrix.
     * A'
     * Diagonal k becomes diagonal -k.
     * Values are conjugated.
     */
    conjugateTranspose(): SparseDiagonalMatrix {
        const tr = new SparseDiagonalMatrix(this.cols, this.rows); // Transpose dimensions

        for (const [k, dRe] of this.diagonals) {
            const dIm = this.complexDiagonals?.get(k);

            // New diagonal index
            const newK = -k;

            // The values need to be shifted because the indexing definition changes.
            // A[i, i+k] = v  -->  AT[j, j-k] = v
            // Let j = i+k. Then AT[i+k, i] = v.
            // In the new matrix, the diagonal index is -k.
            // Entry at row R' in new matrix corresponds to R' = i+k.
            // So value stored at 'i' in old logic should be at 'i+k' in new logic?
            // Wait, our storage is row-indexed. 
            // Old: d[i] stores A[i, i+k].
            // New: we want AT. AT[j, j-k] = conj(A[j-k, j]).
            // Let row index in new matrix be r. AT[r, r-k] = conj(A[r-k, r]).
            // So new_data[r] = conj(old_data[r-k]).

            const newDRe = new Float64Array(tr.rows);
            // If we have complex, we need new array for imaginary
            let newDIm: Float64Array | undefined;
            if (dIm || this.complexDiagonals) {
                if (!tr.complexDiagonals) tr.complexDiagonals = new Map();
                newDIm = new Float64Array(tr.rows);
                tr.complexDiagonals.set(newK, newDIm);
            }

            // Iterate over valid 'i' in old matrix
            const minI = Math.max(0, -k);
            const maxI = Math.min(this.rows, this.cols - k);

            for (let i = minI; i < maxI; i++) {
                const valRe = dRe[i];
                const valIm = dIm ? dIm[i] : 0;

                // Destination row index in transpose
                const r = i + k;

                // Conjugate
                if (r >= 0 && r < tr.rows) {
                    newDRe[r] = valRe;
                    if (newDIm) newDIm[r] = -valIm;
                }
            }
            tr.diagonals.set(newK, newDRe);
        }

        return tr;
    }
}
