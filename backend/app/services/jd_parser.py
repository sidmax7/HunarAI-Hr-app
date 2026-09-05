from app.services.llm_service import llm_service


class JDParser:
    async def parse_to_search_criteria(self, jd_text: str) -> dict:
        return await llm_service.parse_job_description(jd_text)

    def criteria_to_pdl_query(self, criteria: dict) -> dict:
        must: list[dict] = []

        title = criteria.get("title")
        if title:
            must.append({"match": {"job_title": title}})

        skills = criteria.get("skills") or []
        for skill in skills[:5]:
            must.append({"term": {"skills": skill.lower()}})

        location = criteria.get("location") or ""
        location_lower = location.lower()
        # crude split: assume a single city/locality name is present in the location string
        for token in location_lower.replace(",", " ").split():
            if len(token) > 3:
                must.append({"term": {"location_locality": token}})
                break

        seniority = criteria.get("seniority")
        if seniority and seniority != "unspecified":
            must.append({"term": {"job_title_levels": seniority}})

        if not must:
            must.append({"exists": {"field": "job_title"}})

        return {"bool": {"must": must}}


jd_parser = JDParser()
