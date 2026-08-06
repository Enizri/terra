from terra_analyzer.models import Manifest, ScanResult
from terra_analyzer.prompt import (MAX_FILES_CHARS, SYSTEM_PROMPT, build_prompt,
                                   file_section, sample_paths)


def test_system_prompt_states_the_contract():
    for needle in ["parent_id", "FILES", "Relationships", "Return only the JSON object"]:
        assert needle in SYSTEM_PROMPT


def test_build_prompt_includes_facts(scan):
    prompt = build_prompt(scan)
    assert "name: notes" in prompt
    assert "repository: https://github.com/acme/notes" in prompt
    assert "source files: 3" in prompt
    assert "top-level dirs: web, server, store" in prompt
    assert "Go (2 files), TypeScript (1 files)" in prompt
    assert "DIRECTORIES" in prompt and "web  1  TypeScript" in prompt
    assert "web/package.json [npm]: react, vite" in prompt
    assert "web/src/: app.tsx" in prompt
    assert "server/: main.go" in prompt


def test_build_prompt_caps_deps(scan):
    scan.dependencies = [Manifest(manifest="go.mod", ecosystem="go",
                                  names=[f"dep{i}" for i in range(40)])]
    prompt = build_prompt(scan)
    assert "dep29" in prompt and "dep30" not in prompt
    assert "(+10 more)" in prompt


def test_file_section_groups_root_files_bare():
    section = file_section(["main.go", "go.mod", "web/app.tsx"])
    assert section.startswith("main.go, go.mod\n") or "main.go, go.mod\n" in section
    assert "web/: app.tsx" in section


def test_file_section_respects_char_budget():
    paths = [f"dir{i:04d}/{'x' * 200}.go" for i in range(200)]
    section = file_section(paths)
    assert len(section) < MAX_FILES_CHARS + 200
    assert "further files omitted" in section


def test_sample_paths_passthrough_when_small():
    files, note = sample_paths(["a/x.go", "b/y.go"], 10)
    assert files == ["a/x.go", "b/y.go"] and note == ""


def test_sample_paths_samples_per_directory():
    paths = [f"d{directory}/f{i}.go" for directory in range(4) for i in range(10)]
    files, note = sample_paths(paths, 8)
    assert len(files) <= 8
    # Every directory keeps at least one file.
    assert len({path.split("/")[0] for path in files}) == 4
    assert "showing" in note and "up to 2 per directory" in note
