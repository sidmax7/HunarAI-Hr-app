"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createJob, ApiError } from "@/lib/api";
import { PageHeader, Panel, Textarea, Button, ErrorText, Label } from "@/components/ui";

export default function NewJobPage() {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const job = await createJob(description);
      router.push(`/hiring/${job.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader
        title="New job"
        description="Paste the full job description. Gemini will extract the screening criteria and generate a calling agent for you."
      />
      <Panel>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label>Job description</Label>
            <Textarea
              rows={16}
              placeholder="Paste the job description here…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
            />
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button type="submit" disabled={submitting || !description.trim()}>
              {submitting ? "Creating agent…" : "Create job"}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
