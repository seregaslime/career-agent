import pytest
from pydantic import TypeAdapter, ValidationError

from app.facts import FactIn, evidence_found, item_key, normalize, validate_data

facts = TypeAdapter(list[FactIn])
source = "Учусь в МГТУ на «Программной инженерии». Сделал Telegram-бота на Python, ещё изучаю SQL."


def test_evidence_must_quote_the_users_message() -> None:
    assert evidence_found("бота на python", source)
    assert evidence_found("Программной   инженерии", source)
    assert evidence_found("telegram бота", source)  # punctuation and case are ignored
    assert not evidence_found("работал с Docker", source)
    assert not evidence_found("ython", source)  # only whole words count
    assert not evidence_found(" . ", source)
    assert evidence_found("Ещё изучаю", "ещё изучаю SQL")
    assert evidence_found("еще изучаю", "ЕЩЁ ИЗУЧАЮ SQL")


def test_item_keys_detect_duplicates_case_insensitively() -> None:
    assert item_key("skill", {"name": "Python"}) == item_key("skill", {"name": " python "})
    assert item_key("project", {"title": "Бот"}) != item_key("project", {"title": "Сайт"})
    first = {"position": "Стажёр", "organization": "ООО «Пример»"}
    assert item_key("experience", first) == item_key(
        "experience", {"position": "стажер", "organization": "ООО Пример"}
    )
    assert item_key("education", {"institution": "МГТУ", "program": ""}) == "мгту|"
    assert normalize("C++ / C#") == "c c"


def test_data_is_validated_per_kind() -> None:
    assert validate_data("skill", {"name": "  SQL ", "level": None}) == {
        "name": "SQL",
        "level": None,
    }
    project = validate_data(
        "project", {"title": "Бот", "technologies": ["Python", "python", "aiogram"]}
    )
    assert project["technologies"] == ["Python", "aiogram"]
    assert project["description"] == "" and project["role"] == ""
    for kind, data in [
        ("skill", {"name": "SQL", "is_admin": True}),
        ("skill", {"name": "   "}),
        ("skill", {"name": "SQL", "level": "expert"}),
        ("experience", {"organization": "Без должности"}),
        ("education", {"institution": "x" * 161}),
        ("project", {"title": "Бот", "technologies": ["x"] * 21}),
    ]:
        with pytest.raises(ValidationError):
            validate_data(kind, data)


def test_extracted_facts_are_discriminated_by_kind() -> None:
    parsed = facts.validate_python(
        [
            {"kind": "skill", "evidence": "на Python", "data": {"name": "Python"}},
            {
                "kind": "education",
                "evidence": "в МГТУ",
                "data": {"institution": "МГТУ", "program": "Программная инженерия"},
            },
        ]
    )
    assert [fact.kind for fact in parsed] == ["skill", "education"]
    for broken in [
        [{"kind": "skill", "data": {"name": "Python"}}],
        [{"kind": "skill", "evidence": "x", "data": {"name": "Python"}}],
        [{"kind": "hobby", "evidence": "на Python", "data": {"name": "Python"}}],
        [{"kind": "skill", "evidence": "на Python", "data": {"title": "Python"}}],
        [{"kind": "skill", "evidence": "на Python", "data": {"name": "Python"}, "status": "x"}],
    ]:
        with pytest.raises(ValidationError):
            facts.validate_python(broken)
