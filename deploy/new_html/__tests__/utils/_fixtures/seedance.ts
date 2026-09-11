// Shared test fixture: a minimal-but-type-complete SeedanceParams factory.
// Used by the Seedance @-mention editor / tokens-row / candidate-builder specs.
// `baseParams(overrides?)` returns a fresh SeedanceParams every call so tests
// can mutate `media_inputs` etc. without bleeding state into the next test.
import type { SeedanceParams } from '../../../services/videoModelService';

export function baseParams(overrides: Partial<SeedanceParams> = {}): SeedanceParams {
    return {
        sub_model: 'standard',
        prompt: '',
        media_inputs: [],
        ...overrides,
    };
}
