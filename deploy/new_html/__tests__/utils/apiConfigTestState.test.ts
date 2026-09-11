import { describe, expect, it } from 'vitest';
import {
    isConnectivityOnlyConfigTest,
    mergeConfigTestPreservingVerification,
} from '../../utils/apiConfigTestState';

describe('API config test state', () => {
    it('keeps a verified generation result when a DB connectivity test finishes later', () => {
        const verified = {
            ok: true,
            status: 'generation_ok',
            real_generation: true,
            error: null,
        };
        const connectivity = {
            ok: false,
            status: 'connectivity_ok',
            real_generation: false,
            reachable: true,
            auth_ok: true,
            error: 'Metadata endpoint reachable, but generation is not verified.',
        };

        expect(mergeConfigTestPreservingVerification(verified, connectivity)).toBe(verified);
    });

    it('allows a new real generation result to replace the previous verification', () => {
        const previous = { ok: true, status: 'generation_ok', real_generation: true };
        const incoming = { ok: false, status: 'error', real_generation: true, error: 'HTTP 500' };

        expect(mergeConfigTestPreservingVerification(previous, incoming)).toBe(incoming);
    });

    it('recognizes metadata reachability as a warning instead of an error', () => {
        expect(isConnectivityOnlyConfigTest({
            ok: false,
            status: 'connectivity_ok',
            reachable: true,
            auth_ok: true,
        })).toBe(true);
    });
});
