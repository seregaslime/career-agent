"""Structured profile facts: schemas, normalization and grounding checks.

Model output arrives from the browser and is untrusted. The server accepts an extracted
fact only if its quoted evidence occurs in the user's own saved message.
"""

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Kind = Literal["skill", "project", "experience", "education"]
KINDS: tuple[str, ...] = ("skill", "project", "experience", "education")
STATUSES: tuple[str, ...] = ("suggested", "confirmed", "rejected")
MAX_FACTS_PER_TURN = 10
MAX_ITEMS_PER_USER = 300


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Technology = Annotated[str, Field(min_length=1, max_length=60)]


class SkillData(Strict):
    name: str = Field(min_length=1, max_length=80)
    level: Literal["beginner", "intermediate", "advanced"] | None = None


class ProjectData(Strict):
    title: str = Field(min_length=1, max_length=120)
    role: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=1000)
    technologies: list[Technology] = Field(default_factory=list, max_length=20)

    @field_validator("technologies")
    @classmethod
    def unique_technologies(cls, values: list[str]) -> list[str]:
        seen: set[str] = set()
        result = []
        for value in values:
            key = normalize(value)
            if key and key not in seen:
                seen.add(key)
                result.append(value)
        return result


class ExperienceData(Strict):
    position: str = Field(min_length=1, max_length=120)
    organization: str = Field(default="", max_length=120)
    period: str = Field(default="", max_length=60)
    description: str = Field(default="", max_length=1000)


class EducationData(Strict):
    institution: str = Field(min_length=1, max_length=160)
    program: str = Field(default="", max_length=160)
    period: str = Field(default="", max_length=60)


DATA_MODELS: dict[str, type[Strict]] = {
    "skill": SkillData,
    "project": ProjectData,
    "experience": ExperienceData,
    "education": EducationData,
}


class SkillItem(Strict):
    kind: Literal["skill"]
    data: SkillData


class ProjectItem(Strict):
    kind: Literal["project"]
    data: ProjectData


class ExperienceItem(Strict):
    kind: Literal["experience"]
    data: ExperienceData


class EducationItem(Strict):
    kind: Literal["education"]
    data: EducationData


Evidence = Annotated[str, Field(min_length=2, max_length=300)]


class SkillFact(SkillItem):
    evidence: Evidence


class ProjectFact(ProjectItem):
    evidence: Evidence


class ExperienceFact(ExperienceItem):
    evidence: Evidence


class EducationFact(EducationItem):
    evidence: Evidence


FactIn = Annotated[
    SkillFact | ProjectFact | ExperienceFact | EducationFact, Field(discriminator="kind")
]


def validate_data(kind: str, data: Any) -> dict[str, Any]:
    """Validate free-form data against the schema of an existing item's kind."""
    return DATA_MODELS[kind].model_validate(data).model_dump()


_SEPARATORS = re.compile(r"[\W_]+")


def normalize(text: str) -> str:
    """Case-, punctuation- and whitespace-insensitive form used for matching."""
    return " ".join(_SEPARATORS.sub(" ", text.casefold().replace("ё", "е")).split())


def evidence_found(evidence: str, source: str) -> bool:
    quote = normalize(evidence)
    return len(quote) >= 2 and f" {quote} " in f" {normalize(source)} "


def item_key(kind: str, data: dict[str, Any]) -> str:
    """Identity of an item for duplicate detection within one user's profile."""
    if kind == "skill":
        parts = [data["name"]]
    elif kind == "project":
        parts = [data["title"]]
    elif kind == "experience":
        parts = [data["position"], data.get("organization", "")]
    else:
        parts = [data["institution"], data.get("program", "")]
    return "|".join(normalize(str(part)) for part in parts)[:400]
