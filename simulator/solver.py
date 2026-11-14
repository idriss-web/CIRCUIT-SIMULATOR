class CircuitError(Exception):
    pass


def solve_linear(A, z):
    n = len(z)
    M = [row[:] + [z[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-18:
            raise CircuitError(
                "Circuit is unsolvable (singular matrix). Check for a part "
                "that is not connected to anything, or a loop of ideal sources."
            )
        M[col], M[piv] = M[piv], M[col]
        p = M[col][col]
        for r in range(col + 1, n):
            f = M[r][col] / p
            if f:
                row_r, row_c = M[r], M[col]
                for c in range(col, n + 1):
                    row_r[c] -= f * row_c[c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = M[r][n] - sum(M[r][c] * x[c] for c in range(r + 1, n))
        x[r] = s / M[r][r]
    return x
