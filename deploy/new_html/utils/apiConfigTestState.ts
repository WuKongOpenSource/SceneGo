export interface ApiConfigTestState {
    ok?: boolean;
    status?: string | null;
    error?: string | null;
    reachable?: boolean;
    auth_ok?: boolean;
    real_generation?: boolean;
}

export function isVerifiedRealGeneration(test?: ApiConfigTestState): boolean {
    return Boolean(test?.ok && test.real_generation);
}

export function isConnectivityOnlyConfigTest(test?: ApiConfigTestState): boolean {
    if (!test || test.ok || test.real_generation) return false;
    if (String(test.status || '').trim().toLowerCase() === 'connectivity_ok') return true;
    const error = String(test.error || '').toLowerCase();
    return Boolean(
        test.reachable
        && test.auth_ok
        && error.includes('generation is not verified')
    );
}

export function mergeConfigTestPreservingVerification<T extends ApiConfigTestState>(
    previous: T | undefined,
    incoming: T,
): T {
    if (isVerifiedRealGeneration(previous) && !incoming.real_generation) {
        return previous as T;
    }
    return incoming;
}
