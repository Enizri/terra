from terra_analyzer.models import Manifest, ScanResult
from terra_analyzer.prompt import (MAX_FILES_CHARS, SYSTEM_PROMPT, build_prompt,
                                   file_section, sample_paths)


def test_system_prompt_states_the_contract():
    for needle in ["parent_id", "FILES", "Relationships", "Return only the JSON object"]:
        assert needle in SYSTEM_PROMPT


def test_build_prompt_includes_facts(scan):
    p = build_prompt(scan)
    assert "name: notes" in p
    assert "repository: https://github.com/acme/notes" in p
    assert "source files: 3" in p
    assert "top-level dirs: web, server, store" in p
    assert "Go (2 files), TypeScript (1 files)" in p
    assert "DIRECTORIES" in p and "web  1  TypeScript" in p
    assert "web/package.json [npm]: react, vite" in p
    assert "web/src/: app.tsx" in p
    assert "server/: main.go" in p


def test_build_prompt_caps_deps(scan):
    scan.dependencies = [Manifest(manifest="go.mod", ecosystem="go",
                                  names=[f"dep{i}" for i in range(40)])]
    p = build_prompt(scan)
    assert "dep29" in p and "dep30" not in p
    assert "(+10 more)" in p


def test_file_section_groups_root_files_bare():
    s = file_section(["main.go", "go.mod", "web/app.tsx"])
    assert s.startswith("main.go, go.mod\n") or "main.go, go.mod\n" in s
    assert "web/: app.tsx" in s


def test_file_section_respects_char_budget():
    paths = [f"dir{i:04d}/{'x' * 200}.go" for i in range(200)]
    s = file_section(paths)
    assert len(s) < MAX_FILES_CHARS + 200
    assert "further files omitted" in s


def test_sample_paths_passthrough_when_small():
    files, note = sample_paths(["a/x.go", "b/y.go"], 10)
    assert files == ["a/x.go", "b/y.go"] and note == ""


def test_sample_paths_samples_per_directory():
    paths = [f"d{d}/f{i}.go" for d in range(4) for i in range(10)]
    files, note = sample_paths(paths, 8)
    assert len(files) <= 8
    # Every directory keeps at least one file.
    assert len({p.split("/")[0] for p in files}) == 4
    assert "showing" in note and "up to 2 per directory" in note
