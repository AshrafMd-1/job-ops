/**
 * Service for interacting with the Reactive Resume API.
 */

export interface RxResumeResponse {
    id: string;
    name: string;
    slug: string;
    data: any;
    [key: string]: any;
}

/**
 * Generic fetch helper for Reactive Resume API
 */
export async function fetchRxResume(path: string, options: RequestInit = {}): Promise<any> {
    const apiKey = process.env.RXRESUME_API_KEY;
    if (!apiKey) {
        throw new Error('RXRESUME_API_KEY not configured in environment');
    }

    const baseUrl = process.env.RXRESUME_URL || 'https://rxresu.me';
    let cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    // Handle cases where the base URL already includes /api or /api/openapi
    if (cleanBaseUrl.endsWith('/api/openapi')) {
        cleanBaseUrl = cleanBaseUrl.slice(0, -12);
    } else if (cleanBaseUrl.endsWith('/api')) {
        cleanBaseUrl = cleanBaseUrl.slice(0, -4);
    }

    const url = `${cleanBaseUrl}/api/openapi${path}`;

    const headers = {
        'x-api-key': apiKey,
        // intentionally removed because it doesn't work with this added...
        // 'Content-Type': 'application/json',
        ...(options.headers || {}),
    } as Record<string, string>;

    const response = await fetch(url, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Reactive Resume API error (${response.status}): ${errorData.message || response.statusText}`);
    }

    // Handle cases where the response might not be JSON (though usually it is)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return response.json();
    }
    return response.text();
}

/**
 * Fetch a resume by its ID.
 */
export async function getResume(id: string): Promise<RxResumeResponse> {
    return fetchRxResume(`/resume/${id}`);
}

/**
 * Import a resume.
 */
export async function importResume(payload: { name: string; slug: string; data: any }): Promise<string> {
    const result = await fetchRxResume('/resume/import', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    // Reactive Resume returns the full resume object on import in v4+, or just ID in v5.
    return typeof result === 'string' ? result : result.id;
}

/**
 * Delete a resume.
 */
export async function deleteResume(id: string): Promise<void> {
    await fetchRxResume(`/resume/${id}`, { method: 'DELETE' });
}

/**
 * Export a resume as PDF. Returns the URL.
 */
export async function exportResumePdf(id: string): Promise<string> {
    const result = await fetchRxResume(`/printer/resume/${id}/pdf`);
    return result.url;
}

/**
 * List all resumes.
 * According to official OpenAPI spec, the endpoint is /resume/list
 */
export async function listResumes(): Promise<{ id: string; name: string }[]> {
    return fetchRxResume('/resume/list');
}
