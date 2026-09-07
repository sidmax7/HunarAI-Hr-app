import { describe, expect, it } from "vitest";
import { formatDuration, interestTone, normalizeScreeningResult } from "./screening";

describe("normalizeScreeningResult", () => {
  it("returns an empty result for null, undefined, and an empty object", () => {
    for (const input of [null, undefined, {}]) {
      const normalized = normalizeScreeningResult(input);
      expect(normalized.isEmpty).toBe(true);
      expect(normalized.fields).toEqual([]);
      expect(normalized.summary).toBeNull();
    }
  });

  it("orders known fields the way an HR user reads them, not the payload's key order", () => {
    const { fields } = normalizeScreeningResult({
      expected_ctc: "3.8 LPA",
      interest_level: "high",
      current_ctc: "3.2 LPA",
      notice_period_days: 15,
    });

    expect(fields.map((f) => f.key)).toEqual([
      "interest_level",
      "notice_period_days",
      "current_ctc",
      "expected_ctc",
    ]);
  });

  it("pulls the summary out of the field list and onto its own slot", () => {
    const { fields, summary } = normalizeScreeningResult({
      interest_level: "high",
      summary: "  Strong fit, immediate joiner.  ",
    });

    expect(summary).toBe("Strong fit, immediate joiner.");
    expect(fields.map((f) => f.key)).not.toContain("summary");
  });

  it("falls back to `notes` when there is no `summary`", () => {
    expect(normalizeScreeningResult({ notes: "Call dropped early." }).summary).toBe("Call dropped early.");
  });

  it("surfaces keys it does not recognize instead of dropping them", () => {
    const { fields } = normalizeScreeningResult({
      interest_level: "high",
      willing_to_relocate: true,
      preferred_shift: "night",
    });

    const unknown = fields.filter((f) => f.key !== "interest_level");
    expect(unknown).toEqual([
      { key: "willing_to_relocate", label: "Willing to relocate", value: "Yes", kind: "text" },
      { key: "preferred_shift", label: "Preferred shift", value: "night", kind: "text" },
    ]);
  });

  it("keeps a zero notice period, which means immediate, rather than treating it as blank", () => {
    const { fields, isEmpty } = normalizeScreeningResult({ notice_period_days: 0 });

    expect(isEmpty).toBe(false);
    expect(fields).toEqual([
      { key: "notice_period_days", label: "Notice period", value: "Immediate", kind: "mono" },
    ]);
  });

  it("drops null, undefined, and whitespace-only values", () => {
    const { fields, summary, isEmpty } = normalizeScreeningResult({
      interest_level: null,
      current_ctc: "   ",
      expected_ctc: undefined,
      summary: "  ",
    });

    expect(fields).toEqual([]);
    expect(summary).toBeNull();
    expect(isEmpty).toBe(true);
  });

  it("keeps `false` and `0`, which are real answers", () => {
    const { fields } = normalizeScreeningResult({ willing_to_relocate: false, years_at_current_job: 0 });

    expect(fields.map((f) => f.value)).toEqual(["No", "0"]);
  });

  it("singularizes a one-day notice period", () => {
    expect(normalizeScreeningResult({ notice_period_days: 1 }).fields[0].value).toBe("1 day");
    expect(normalizeScreeningResult({ notice_period_days: 60 }).fields[0].value).toBe("60 days");
  });

  it("renders a failed call's error payload rather than showing nothing", () => {
    const { fields, isEmpty } = normalizeScreeningResult({ error: "carrier_rejected" });

    expect(isEmpty).toBe(false);
    expect(fields).toEqual([{ key: "error", label: "Error", value: "carrier_rejected", kind: "mono" }]);
  });

  it("flattens arrays and stringifies nested objects so nothing renders as [object Object]", () => {
    const { fields } = normalizeScreeningResult({
      skills_confirmed: ["forklift", "scanning"],
      availability: { weekends: true },
    });

    expect(fields[0].value).toBe("forklift, scanning");
    expect(fields[1].value).toBe('{"weekends":true}');
  });

  it("marks interest as a pill and money as mono, so the panel can render them differently", () => {
    const { fields } = normalizeScreeningResult({ interest_level: "high", current_ctc: "3.2 LPA" });

    expect(fields[0].kind).toBe("pill");
    expect(fields[1].kind).toBe("mono");
  });
});

describe("interestTone", () => {
  it("maps positive interest onto the success tone", () => {
    for (const value of ["high", "High", "  STRONG  ", "interested"]) {
      expect(interestTone(value)).toBe("success");
    }
  });

  it("maps negative interest onto the warning tone, never danger", () => {
    // A disinterested candidate is an outcome, not a system failure — danger is
    // reserved for failed calls in this design system.
    for (const value of ["low", "weak", "not interested"]) {
      expect(interestTone(value)).toBe("warning");
    }
  });

  it("falls back to neutral for unknown, empty, and missing values", () => {
    for (const value of ["medium", "", null, undefined]) {
      expect(interestTone(value)).toBe("neutral");
    }
  });

  it("handles the live agent's free-text yes/no answers", () => {
    expect(interestTone("Yes")).toBe("success");
    expect(interestTone("no")).toBe("warning");
  });
});

describe("the live Hiring Screener agent's result schema", () => {
  // The deployed agent returns these keys, which differ from the mock payloads —
  // this pins that a real screening call renders as labeled fields, not raw JSON.
  const liveResult = {
    summary: "Candidate is interested and can join the night shift.",
    languages: "Hindi, English",
    qualified: "yes",
    interested: "yes",
    expected_ctc: "3.8 LPA",
    notice_period: "15 days",
    can_join_shift: "yes",
    recommendation: "Move to in-person round",
    current_location: "Bangalore",
    experience_years: "2",
  };

  it("labels every field the live agent returns", () => {
    const { fields, summary } = normalizeScreeningResult(liveResult);

    expect(summary).toBe("Candidate is interested and can join the night shift.");
    expect(fields.map((f) => f.label)).toEqual([
      "Interested",
      "Qualified",
      "Recommendation",
      "Notice period",
      "Can join shift",
      "Experience",
      "Expected CTC",
      "Location",
      "Languages",
    ]);
    // Known fields render in the curated order above; anything unmapped would instead
    // land at the end in payload order, which this ordering assertion would catch.
    expect(fields).toHaveLength(9);
  });

  it("renders the agent's yes/no interest as a pill", () => {
    const { fields } = normalizeScreeningResult(liveResult);
    const interested = fields.find((f) => f.key === "interested");

    expect(interested?.kind).toBe("pill");
    expect(interestTone(interested!.value)).toBe("success");
  });
});

describe("formatDuration", () => {
  it("formats sub-minute calls in seconds", () => {
    expect(formatDuration(38)).toBe("38s");
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats longer calls in minutes and seconds", () => {
    expect(formatDuration(224)).toBe("3m 44s");
    expect(formatDuration(410)).toBe("6m 50s");
  });

  it("omits the seconds part on an exact minute", () => {
    expect(formatDuration(120)).toBe("2m");
  });

  it("returns null for missing or nonsensical durations", () => {
    for (const value of [null, undefined, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDuration(value)).toBeNull();
    }
  });
});
