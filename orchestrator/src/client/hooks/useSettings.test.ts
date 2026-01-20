import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettings, _resetSettingsCache } from './useSettings';
import * as api from '../api';

vi.mock('../api', () => ({
    getSettings: vi.fn(),
}));

describe('useSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetSettingsCache();
    });

    it('fetches settings on mount if not already cached', async () => {
        const mockSettings = { showSponsorInfo: false };
        (api.getSettings as any).mockResolvedValue(mockSettings);

        const { result } = renderHook(() => useSettings());

        // Should start in loading state
        expect(result.current.settings).toBeNull();

        await waitFor(() => {
            expect(result.current.settings).toEqual(mockSettings);
        });

        expect(result.current.showSponsorInfo).toBe(false);
        expect(api.getSettings).toHaveBeenCalledTimes(1);
    });

    it('uses default values when settings are null', async () => {
        (api.getSettings as any).mockResolvedValue(null);

        const { result } = renderHook(() => useSettings());

        await waitFor(() => {
            // settings is null, so showSponsorInfo should default to true
            expect(result.current.showSponsorInfo).toBe(true);
        });
    });

    it('provides a refresh function that updates settings', async () => {
        const initialSettings = { showSponsorInfo: true };
        const updatedSettings = { showSponsorInfo: false };

        (api.getSettings as any).mockResolvedValueOnce(initialSettings);
        (api.getSettings as any).mockResolvedValueOnce(updatedSettings);

        const { result } = renderHook(() => useSettings());

        await waitFor(() => {
            expect(result.current.settings).toEqual(initialSettings);
        });

        let refreshed;
        await waitFor(async () => {
            refreshed = await result.current.refreshSettings();
        });

        expect(refreshed).toEqual(updatedSettings);
        expect(result.current.settings).toEqual(updatedSettings);
        expect(result.current.showSponsorInfo).toBe(false);
    });

    it('handles errors when fetching settings', async () => {
        const mockError = new Error('Failed to fetch');
        (api.getSettings as any).mockRejectedValue(mockError);

        const { result } = renderHook(() => useSettings());

        await waitFor(() => {
            expect(result.current.error).toEqual(mockError);
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.settings).toBeNull();
    });
});
