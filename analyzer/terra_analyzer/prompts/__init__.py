"""Prompt modules for analyzer tasks."""

from .architecture import (MAX_DEPS_PER_MANIFEST, MAX_FILES_CHARS,
                           MAX_PROMPT_PATHS, SYSTEM_PROMPT, build_prompt,
                           file_section, sample_paths)

__all__ = [
    "MAX_DEPS_PER_MANIFEST",
    "MAX_FILES_CHARS",
    "MAX_PROMPT_PATHS",
    "SYSTEM_PROMPT",
    "build_prompt",
    "file_section",
    "sample_paths",
]
