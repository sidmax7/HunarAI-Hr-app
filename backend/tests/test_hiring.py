from types import SimpleNamespace

from app.routers.hiring import _build_custom_data, normalize_candidate_csv_rows


def test_normalize_drops_rows_missing_name_or_phone():
    rows = [
        {"Name": "Asha", "Phone": "+919000000001"},
        {"Name": "  ", "Phone": "+919000000002"},
        {"Name": "Ravi", "Phone": ""},
        {"Name": "Deepa", "Phone": "+919000000003", "Email": "deepa@example.com"},
    ]
    total, kept = normalize_candidate_csv_rows(rows)
    assert total == 4
    assert len(kept) == 2
    assert kept[0] == {"name": "Asha", "phone": "+919000000001"}
    assert kept[1] == {"name": "Deepa", "phone": "+919000000003", "email": "deepa@example.com"}


def test_normalize_trims_whitespace_and_lowercases_column_names():
    rows = [{" NAME ": "  Asha  ", " PHONE ": " +919000000001 "}]
    _, kept = normalize_candidate_csv_rows(rows)
    assert kept == [{"name": "Asha", "phone": "+919000000001"}]


def test_normalize_handles_none_values():
    rows = [{"name": "Asha", "phone": "+919000000001", "email": None}]
    _, kept = normalize_candidate_csv_rows(rows)
    assert kept[0]["email"] == ""


def test_build_custom_data_maps_known_variables():
    job = SimpleNamespace(title="Backend Engineer", parsed_criteria={"company": "Acme", "location": "Bengaluru"})
    result = _build_custom_data(["company", "role", "title", "location"], job)
    assert result == {
        "company": "Acme",
        "role": "Backend Engineer",
        "title": "Backend Engineer",
        "location": "Bengaluru",
    }


def test_build_custom_data_falls_back_when_criteria_missing():
    job = SimpleNamespace(title="Backend Engineer", parsed_criteria=None)
    result = _build_custom_data(["company", "location"], job)
    assert result == {"company": "our company", "location": ""}


def test_build_custom_data_unknown_variable_becomes_empty_string():
    job = SimpleNamespace(title="Backend Engineer", parsed_criteria={})
    result = _build_custom_data(["some_unmapped_variable"], job)
    assert result == {"some_unmapped_variable": ""}
