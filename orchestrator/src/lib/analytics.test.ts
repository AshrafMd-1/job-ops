import {
  __resetAnalyticsTestState,
  bucketQueryLength,
  trackProductEvent,
} from "./analytics";

describe("analytics", () => {
  const track = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T12:00:00Z"));
    track.mockReset();
    __resetAnalyticsTestState();
    Object.defineProperty(window, "umami", {
      configurable: true,
      value: { track },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedupes identical product events within the dedupe window", () => {
    trackProductEvent("tracer_drilldown_mode_changed", { mode: "human" });
    trackProductEvent("tracer_drilldown_mode_changed", { mode: "human" });

    expect(track).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_001);
    trackProductEvent("tracer_drilldown_mode_changed", { mode: "human" });

    expect(track).toHaveBeenCalledTimes(2);
  });

  it("drops disallowed keys and non-primitive payload values", () => {
    trackProductEvent("jobs_pipeline_run_started", {
      mode: "automatic",
      source_count: 2,
      top_n: 10,
      min_suitability_score: 50,
      country: "uk",
      has_city_locations: true,
      search_terms_count: 3,
      query: "software engineer",
      destination_url: "https://example.com",
      extra: { nested: true },
    } as any);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("jobs_pipeline_run_started", {
      mode: "automatic",
      source_count: 2,
      top_n: 10,
      min_suitability_score: 50,
      country: "uk",
      has_city_locations: true,
      search_terms_count: 3,
    });
  });

  it("buckets query lengths without sending raw query text", () => {
    expect(bucketQueryLength("")).toBe("0");
    expect(bucketQueryLength("abc")).toBe("1_3");
    expect(bucketQueryLength("hello world")).toBe("11_30");
  });
});
