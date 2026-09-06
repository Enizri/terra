"""Unit tests for the local OpenAI-compatible server helpers (no model load)."""

import subprocess

from terra_local_llm.server import (
    ChatCompletionRequest,
    ChatMessage,
    JsonSchemaFormat,
    ResponseFormat,
    _grammar_for,
    _messages_for_generate,
    pick_device,
    root,
)


def test_root():
    assert root()["service"] == "terra-llm"
    assert root()["status"] == "ok"



def test_json_schema_hint_appended_to_system():
    req = ChatCompletionRequest(
        messages=[
            ChatMessage(role="system", content="You are helpful."),
            ChatMessage(role="user", content="map this"),
        ],
        response_format=ResponseFormat(
            type="json_schema",
            json_schema=JsonSchemaFormat(
                name="terra_map",
                schema_={"type": "object", "properties": {"kind": {"type": "string"}}},
            ),
        ),
    )
    msgs = _messages_for_generate(req)
    assert msgs[0]["role"] == "system"
    assert "JSON Schema" in msgs[0]["content"]
    assert '"kind"' in msgs[0]["content"]
    assert msgs[1]["content"] == "map this"


def test_json_schema_hint_prepends_system_when_missing():
    req = ChatCompletionRequest(
        messages=[ChatMessage(role="user", content="hi")],
        response_format=ResponseFormat(
            type="json_schema",
            json_schema=JsonSchemaFormat(schema_={"type": "object"}),
        ),
    )
    msgs = _messages_for_generate(req)
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"


def test_response_format_parses_schema_alias():
    raw = {
        "messages": [{"role": "user", "content": "x"}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "terra_map",
                "strict": True,
                "schema": {"type": "object"},
            },
        },
    }
    req = ChatCompletionRequest.model_validate(raw)
    assert req.response_format.json_schema.schema_ == {"type": "object"}


# --- /admin/load state machine -------------------------------------------
# These drive the module state directly: a real load pulls gigabytes of
# weights, and what matters here is the transitions Go polls on.

import threading

import pytest
from fastapi import HTTPException
from terra_local_llm import server as local

SMALL = "Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf"


def _reset_state():
    local.state.model_id = ""
    local.state.loaded = False
    local.state.loading = ""
    local.state.load_error = ""
    local.state.load_gen = 0
    local.state.model = None


@pytest.fixture(autouse=True)
def reset_state():
    _reset_state()
    yield
    _reset_state()


def test_status_reports_empty_before_any_load():
    assert local.admin_status()["state"] == "empty"


def test_load_spawns_a_worker_and_reports_ready(monkeypatch):
    done = threading.Event()

    def fake_load(model_id="", device="", gen=None):
        local.state.model_id = model_id
        local.state.loaded = True
        done.set()

    monkeypatch.setattr(local, "load_model", fake_load)
    out = local.admin_load(local.LoadRequest(model_id=SMALL))
    assert out["state"] == "loading"
    assert done.wait(2)
    # The worker's finally clears `loading`; give the thread a beat to land.
    for _ in range(100):
        if local.admin_status()["state"] == "ready":
            break
        threading.Event().wait(0.01)
    status = local.admin_status()
    assert status["state"] == "ready"
    assert status["model_id"] == SMALL


def test_load_is_a_noop_when_the_model_is_already_serving():
    local.state.model_id = SMALL
    local.state.loaded = True
    out = local.admin_load(local.LoadRequest(model_id=SMALL))
    assert out["state"] == "ready"


def test_reloading_the_model_already_in_flight_is_a_noop():
    local.state.loading = "Qwen/Qwen2.5-7B-Instruct"
    out = local.admin_load(local.LoadRequest(model_id="Qwen/Qwen2.5-7B-Instruct"))
    assert out["state"] == "loading"


def test_load_requires_a_model_id():
    with pytest.raises(HTTPException) as excinfo:
        local.admin_load(local.LoadRequest(model_id="  "))
    assert excinfo.value.status_code == 400


def test_failed_load_surfaces_as_error_and_allows_a_retry(monkeypatch):
    def boom(model_id="", device="", gen=None):
        raise RuntimeError("no such model")

    monkeypatch.setattr(local, "load_model", boom)
    local.admin_load(local.LoadRequest(model_id="nope/nope"))
    for _ in range(200):
        if local.admin_status()["state"] == "error":
            break
        threading.Event().wait(0.01)
    status = local.admin_status()
    assert status["state"] == "error"
    assert "no such model" in status["error"]
    # A failure must not wedge the sidecar: the next load is accepted.
    monkeypatch.setattr(local, "load_model", lambda model_id="", device="", gen=None: None)
    assert local.admin_load(local.LoadRequest(model_id="other/model"))["state"] == "loading"


def test_chat_refuses_to_serve_while_loading():
    local.state.loading = "Qwen/Qwen2.5-7B-Instruct"
    with pytest.raises(HTTPException) as excinfo:
        local._ensure_loaded()
    assert excinfo.value.status_code == 503
    assert "loading" in excinfo.value.detail


# --- load generation: cancel and supersede -------------------------------
#
# hf_hub_download cannot be interrupted, so "cancel" means the result is
# discarded rather than the download stopped. These pin that contract.

import sys
import types


def _fake_backends(monkeypatch, on_download=None, on_load=None):
    """Lets load_model run without llama_cpp or huggingface_hub installed."""
    def fake_download(repo, filename, **_kw):
        if on_download:
            on_download()
        return f"/fake/{repo}/{filename}"

    class FakeLlama:
        def __init__(self, model_path, **_kw):
            if on_load:
                on_load()
            self.model_path = model_path

    monkeypatch.setitem(sys.modules, "huggingface_hub",
                        types.SimpleNamespace(hf_hub_download=fake_download))
    monkeypatch.setitem(sys.modules, "llama_cpp", types.SimpleNamespace(Llama=FakeLlama))
    monkeypatch.setattr(local, "pick_device", lambda _requested="": "cpu")


GOOD = "Qwen/Good-GGUF/good-q4_k_m.gguf"
ABANDONED = "Qwen/Abandoned-GGUF/abandoned-q4_k_m.gguf"


def test_model_id_must_name_a_gguf_file():
    assert local._split_model_id(GOOD) == ("Qwen/Good-GGUF", "good-q4_k_m.gguf")
    with pytest.raises(RuntimeError):
        local._split_model_id("Qwen/Qwen2.5-0.5B-Instruct")


def test_n_gpu_layers_defaults_to_the_whole_accelerator(monkeypatch):
    monkeypatch.delenv("TERRA_N_GPU_LAYERS", raising=False)
    assert local.n_gpu_layers_for("mps") == -1
    assert local.n_gpu_layers_for("cuda") == -1
    assert local.n_gpu_layers_for("cpu") == 0


def test_n_gpu_layers_env_overrides_default(monkeypatch):
    monkeypatch.setenv("TERRA_N_GPU_LAYERS", "-1")
    assert local.n_gpu_layers_for("mps") == -1
    monkeypatch.setenv("TERRA_N_GPU_LAYERS", "0")
    assert local.n_gpu_layers_for("cuda") == 0


def test_offload_plan_steps_down_from_the_whole_accelerator(monkeypatch):
    monkeypatch.delenv("TERRA_N_GPU_LAYERS", raising=False)
    assert local.offload_plan("cuda") == local.GPU_LAYER_STEPS
    assert local.offload_plan("cpu") == (0,)


def test_offload_plan_honours_an_explicit_split(monkeypatch):
    monkeypatch.setenv("TERRA_N_GPU_LAYERS", "8")
    assert local.offload_plan("cuda") == (8,)


def test_load_model_installs_its_weights(monkeypatch):
    _fake_backends(monkeypatch)
    assert local.load_model(GOOD, gen=local.state.load_gen) is True
    assert local.state.model_id == GOOD
    assert local.state.loaded is True


def _capture_llama(monkeypatch, device, fail_until=0):
    """Install fake backends and return the kwargs of each Llama attempt."""
    attempts = []

    def capture(repo, filename, **_kw):
        return f"/fake/{repo}/{filename}"

    class FakeLlama:
        def __init__(self, model_path, **kw):
            attempts.append(kw)
            if len(attempts) <= fail_until:
                raise RuntimeError("not enough device memory")
            self.model_path = model_path

    monkeypatch.setitem(sys.modules, "huggingface_hub",
                        types.SimpleNamespace(hf_hub_download=capture))
    monkeypatch.setitem(sys.modules, "llama_cpp", types.SimpleNamespace(Llama=FakeLlama))
    monkeypatch.setattr(local, "pick_device", lambda _requested="": device)
    monkeypatch.delenv("TERRA_N_GPU_LAYERS", raising=False)
    return attempts


def test_load_model_offloads_every_layer_on_metal(monkeypatch):
    attempts = _capture_llama(monkeypatch, "mps")
    assert local.load_model(GOOD, gen=local.state.load_gen) is True
    assert [a["n_gpu_layers"] for a in attempts] == [-1]


def test_load_model_steps_down_when_the_card_is_too_small(monkeypatch):
    attempts = _capture_llama(monkeypatch, "cuda", fail_until=1)
    assert local.load_model(GOOD, gen=local.state.load_gen) is True
    assert [a["n_gpu_layers"] for a in attempts] == [-1, 16]


def test_load_model_reports_the_failure_when_even_the_cpu_load_fails(monkeypatch):
    _capture_llama(monkeypatch, "cuda", fail_until=len(local.GPU_LAYER_STEPS))
    with pytest.raises(RuntimeError, match="device memory"):
        local.load_model(GOOD, gen=local.state.load_gen)


def test_load_model_gives_up_when_cancelled_during_the_download(monkeypatch):
    _fake_backends(monkeypatch, on_download=lambda: local.admin_cancel())
    assert local.load_model(ABANDONED, gen=local.state.load_gen) is False
    assert local.state.loaded is False
    assert local.state.model_id == ""


def test_load_model_discards_weights_a_cancel_superseded(monkeypatch):
    _fake_backends(monkeypatch, on_load=lambda: local.admin_cancel())
    assert local.load_model(ABANDONED, gen=local.state.load_gen) is False
    assert local.state.loaded is False
    assert local.state.model_id == ""


def test_admin_cancel_reports_what_it_abandoned(monkeypatch):
    monkeypatch.setattr(local, "_load_worker", lambda model_id, gen: None)
    local.admin_load(local.LoadRequest(model_id="Qwen/Big"))
    out = local.admin_cancel()
    assert out["cancelled"] == "Qwen/Big"
    # Nothing in flight and nothing loaded: a fresh EnsureModel starts a load
    # rather than waiting on the abandoned one.
    assert out["state"] == "empty"
    assert local.state.loading == ""


def test_admin_load_supersedes_a_load_in_flight(monkeypatch):
    monkeypatch.setattr(local, "_load_worker", lambda model_id, gen: None)
    local.admin_load(local.LoadRequest(model_id="Qwen/Big"))
    first = local.state.load_gen
    out = local.admin_load(local.LoadRequest(model_id="Qwen/Small"))
    assert out == {"model_id": "Qwen/Small", "state": "loading"}
    assert local.state.loading == "Qwen/Small"
    assert local.state.load_gen > first


def test_a_superseded_worker_leaves_the_new_load_alone(monkeypatch):
    def boom(model_id="", device="", gen=None):
        raise RuntimeError("the download died")

    monkeypatch.setattr(local, "load_model", boom)
    local.state.load_gen = 5
    local.state.loading = "Qwen/New"
    local._load_worker("Qwen/Abandoned", gen=4)
    assert local.state.loading == "Qwen/New", "a stale worker must not clear the new marker"
    assert local.state.load_error == "", "a stale worker's failure is nobody's problem"


def test_cancelling_a_switch_leaves_the_resident_model_serving(monkeypatch):
    """A model already in RAM must survive a cancelled switch to another one.

    Clearing `loaded` when the switch starts would strand it: the worker that
    would have restored it has been abandoned, so nothing ever sets it back.
    """
    monkeypatch.setattr(local, "_load_worker", lambda model_id, gen: None)
    local.state.model_id = "Qwen/Resident"
    local.state.loaded = True
    local.state.model = object()

    local.admin_load(local.LoadRequest(model_id="Qwen/Big"))
    assert local.admin_status()["state"] == "loading"

    local.admin_cancel()
    assert local.admin_status()["state"] == "ready"
    assert local.admin_status()["model_id"] == "Qwen/Resident"
    local._ensure_loaded()  # must not raise: the weights never left memory


def test_cancel_clears_a_stale_load_error(monkeypatch):
    """Otherwise the sidecar reports "error" forever with nothing in flight."""
    monkeypatch.setattr(local, "_load_worker", lambda model_id, gen: None)
    local.state.load_error = "loading Qwen/Old failed: boom"
    local.admin_load(local.LoadRequest(model_id="Qwen/Big"))
    local.admin_cancel()
    assert local.state.load_error == ""
    assert local.admin_status()["state"] == "empty"


def test_asking_for_the_resident_model_abandons_a_competing_switch(monkeypatch):
    """Reporting "ready" must mean it stays ready.

    The resident model now survives a switch, so "already serving it" can be
    true while a load of something else is still in flight. Returning ready
    without abandoning that load would let it overwrite the caller's choice.
    """
    monkeypatch.setattr(local, "_load_worker", lambda model_id, gen: None)
    local.state.model_id = "Qwen/Resident"
    local.state.loaded = True

    local.admin_load(local.LoadRequest(model_id="Qwen/Other"))
    assert local.state.loading == "Qwen/Other"

    out = local.admin_load(local.LoadRequest(model_id="Qwen/Resident"))
    assert out["state"] == "ready"
    assert local.state.loading == ""


def _fake_nvidia(monkeypatch, *, present: bool, returncode: int = 0):
    monkeypatch.setattr(local.shutil, "which", lambda _n: "/usr/bin/nvidia-smi" if present else None)

    def run(*_a, **_kw):
        return subprocess.CompletedProcess(args=[], returncode=returncode)

    monkeypatch.setattr(local.subprocess, "run", run)


def test_pick_device_explicit_request_wins(monkeypatch):
    _fake_nvidia(monkeypatch, present=True)
    assert pick_device("cpu") == "cpu"


def test_pick_device_auto_detects_cuda(monkeypatch):
    """Regression: `auto` used to fall straight to cpu on Linux, so an NVIDIA
    box served every token from the CPU while /host/capabilities said cuda."""
    monkeypatch.setattr(local.sys, "platform", "linux")
    monkeypatch.delenv("TERRA_DEVICE", raising=False)
    _fake_nvidia(monkeypatch, present=True)
    assert pick_device("auto") == "cuda"


def test_pick_device_auto_falls_back_to_cpu_without_nvidia_smi(monkeypatch):
    monkeypatch.setattr(local.sys, "platform", "linux")
    monkeypatch.delenv("TERRA_DEVICE", raising=False)
    _fake_nvidia(monkeypatch, present=False)
    assert pick_device("auto") == "cpu"


def test_pick_device_auto_ignores_broken_nvidia_smi(monkeypatch):
    """A stray nvidia-smi with no working driver must not claim cuda."""
    monkeypatch.setattr(local.sys, "platform", "linux")
    monkeypatch.delenv("TERRA_DEVICE", raising=False)
    _fake_nvidia(monkeypatch, present=True, returncode=9)
    assert pick_device("auto") == "cpu"


def test_grammar_compiles_for_the_architecture_schema():
    """The draft schema must stay GBNF-compilable: if it silently stops
    compiling, generation falls back to prompt-only and small models overrun
    the output cap again.

    CI uses `make venv` (no llama-cpp-python). This assertion needs the real
    LlamaGrammar compiler from `make venv-local`.
    """
    import json

    pytest.importorskip("llama_cpp")
    schema = {
        "type": "object",
        "properties": {
            "files": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
        },
        "required": ["files"],
    }
    assert _grammar_for(json.dumps(schema)) is not None


def test_grammar_returns_none_for_uncompilable_schema():
    assert _grammar_for("not json at all") is None


# --- Chat Completions tools (fake Llama, no weights) ---------------------

LOOKUP_TOOL = {
    "type": "function",
    "function": {
        "name": "lookup_component",
        "description": "Find a map component",
        "parameters": {"type": "object", "properties": {"q": {"type": "string"}}},
    },
}

TOOL_CALL = {
    "id": "call_1",
    "type": "function",
    "function": {"name": "lookup_component", "arguments": '{"q":"web"}'},
}


def _install_llama(reply: dict) -> dict:
    seen: dict = {}

    class FakeLlama:
        def create_chat_completion(self, **kwargs):
            seen.clear()
            seen.update(kwargs)
            return reply

    local.state.loaded = True
    local.state.model_id = SMALL
    local.state.model = FakeLlama()
    return seen


def test_chat_request_accepts_tools_and_tool_messages():
    raw = {
        "messages": [
            {"role": "assistant", "content": None, "tool_calls": [TOOL_CALL]},
            {"role": "tool", "tool_call_id": "call_1", "content": "the web app"},
        ],
        "tools": [LOOKUP_TOOL],
        "tool_choice": "auto",
    }
    req = ChatCompletionRequest.model_validate(raw)
    assert req.messages[0].content is None
    assert req.messages[0].tool_calls[0]["function"]["name"] == "lookup_component"
    assert req.messages[1].tool_call_id == "call_1"
    assert req.tools == [LOOKUP_TOOL]
    msgs = _messages_for_generate(req)
    assert msgs[0]["tool_calls"] == [TOOL_CALL]
    assert msgs[1] == {"role": "tool", "tool_call_id": "call_1", "content": "the web app"}


def test_generate_chat_forwards_tools_to_llama():
    seen = _install_llama({
        "choices": [{
            "message": {"role": "assistant", "content": None, "tool_calls": [TOOL_CALL]},
            "finish_reason": "tool_calls",
        }],
    })
    req = ChatCompletionRequest(
        messages=[ChatMessage(role="user", content="where is web?")],
        tools=[LOOKUP_TOOL],
    )
    content, finish, tool_calls = local.generate_chat(req)
    assert content == ""
    assert finish == "tool_calls"
    assert tool_calls == [TOOL_CALL]
    assert seen["tools"] == [LOOKUP_TOOL]
    assert seen["tool_choice"] == "auto"
    assert seen["messages"][0]["content"] == "where is web?"


def test_generate_chat_without_tools_omits_them():
    seen = _install_llama({
        "choices": [{
            "message": {"role": "assistant", "content": "hello"},
            "finish_reason": "stop",
        }],
    })
    req = ChatCompletionRequest(messages=[ChatMessage(role="user", content="hi")])
    content, finish, tool_calls = local.generate_chat(req)
    assert content == "hello"
    assert finish == "stop"
    assert tool_calls is None
    assert "tools" not in seen


def test_chat_completions_includes_tool_calls_in_response():
    _install_llama({
        "choices": [{
            "message": {"role": "assistant", "content": None, "tool_calls": [TOOL_CALL]},
            "finish_reason": "tool_calls",
        }],
    })
    req = ChatCompletionRequest(
        messages=[ChatMessage(role="user", content="where is web?")],
        tools=[LOOKUP_TOOL],
        tool_choice="auto",
    )
    out = local.chat_completions(req)
    choice = out["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["tool_calls"] == [TOOL_CALL]
    assert choice["message"]["content"] is None
