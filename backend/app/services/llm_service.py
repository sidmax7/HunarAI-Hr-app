import asyncio
import json

from google import genai

from app.config import settings

MODEL_NAME = "gemini-3.5-flash-lite"

_client = genai.Client(api_key=settings.GEMINI_API_KEY)


def _generate_json_sync(prompt: str) -> dict:
    response = _client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config={"response_mime_type": "application/json"},
    )
    return json.loads(response.text)


async def _generate_json(prompt: str) -> dict:
    return await asyncio.to_thread(_generate_json_sync, prompt)


class LLMService:
    async def parse_job_description(self, jd_text: str) -> dict:
        prompt = f"""You are an expert technical recruiter. Extract structured information from this job description.

Job Description:
\"\"\"
{jd_text}
\"\"\"

Return a JSON object with exactly these keys:
- "title": string, the job title
- "company": string, company name if mentioned, else ""
- "skills": array of strings, key required skills
- "min_experience_years": number, minimum years of experience required (0 if not specified)
- "location": string, work location if mentioned, else ""
- "seniority": string, one of "junior", "mid", "senior", "lead", "unspecified"
- "responsibilities": array of strings, 3-6 key responsibilities summarized briefly
"""
        return await _generate_json(prompt)

    async def generate_agent_prompt(self, parsed_job: dict) -> dict:
        prompt = f"""You are configuring an AI voice agent on the Hunar Voice platform to conduct initial phone screening calls for a job opening.

Job details (JSON):
{json.dumps(parsed_job)}

The Hunar agent config requires these fields. Placeholders {{persona_name}}, {{callee_name}}, {{company}}, and {{role}} may be used inside agent_prompt and introduction.

Return a JSON object with exactly these keys:
- "name": string (3-64 chars), a short internal agent name like "Screener - <Job Title>"
- "persona_name": string (3-64 chars), a human first name for the AI caller to use, e.g. "Priya"
- "objective": string, one sentence describing the call's purpose
- "agent_prompt": string, the system prompt instructing the persona on how to conduct the screening call: verify interest, ask about relevant experience, check availability/notice period, assess basic fit against the job's key skills. Professional, concise, friendly tone.
- "introduction": string, the first thing the agent says when the call connects, using {{persona_name}} and {{callee_name}}
- "result_prompt": string, instructions for what to extract from the call transcript after it ends
- "result_schema": object, JSON schema (flat key -> type/description string) capturing at minimum: interested, years_experience, notice_period, salary_expectation, and a free-text summary/notes field
"""
        return await _generate_json(prompt)

    async def summarize_call_result(self, result: dict, job_title: str) -> str:
        prompt = f"""Summarize this candidate screening call result for the role "{job_title}" in 2-3 sentences for a recruiter reading a dashboard.

Result data (JSON):
{json.dumps(result)}

Return a JSON object with exactly one key: "summary" (string).
"""
        data = await _generate_json(prompt)
        return data.get("summary", "")


llm_service = LLMService()
