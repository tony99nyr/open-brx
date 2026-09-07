"""Conformance: the real and fake lane implementors actually satisfy interfaces.py's Protocols.

`typing.Protocol` is structural, not an ABC — nothing at import time stops one side of a lane
boundary from renaming a method the other side still calls by the old name. These tests are the
enforcement interfaces.py itself does not provide: for each Protocol, walk its declared methods
and check that every implementor has a same-named, compatibly-shaped method (inspect.signature,
compared by parameter NAME and required/optional-ness — deliberately pragmatic about *args/
**kwargs/defaults and about sync-vs-async, since interfaces.py itself notes "real server is async;
FakeNet may be sync").
"""
from __future__ import annotations

import inspect

from brx_mcp.mc import armory, compile as compile_mod, fakes, interfaces as I, net

# net.NetServer.resolve_gun/on_batch/evict are explicitly documented in interfaces.py as
# "optional on fakes", and mc/state.py only ever calls them behind hasattr() guards (state.py
# ~L259-265, ~L923) — a fake genuinely may omit them. Nothing else on any Protocol here is optional.
NETSERVER_OPTIONAL_ON_FAKES = {"resolve_gun", "on_batch", "evict"}


def _params(fn):
    """This method's parameters, excluding self/cls."""
    return [p for name, p in inspect.signature(fn).parameters.items() if name not in ("self", "cls")]


def _required_names(params):
    return {p.name for p in params
            if p.default is inspect.Parameter.empty
            and p.kind not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)}


def _accepts_arbitrary_kwargs(params):
    return any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params)


def _accepts_arbitrary_args(params):
    return any(p.kind is inspect.Parameter.VAR_POSITIONAL for p in params)


def _protocol_method_names(protocol):
    return [n for n, v in vars(protocol).items() if not n.startswith("_") and callable(v)]


def assert_implements(protocol, impl, label: str, optional: frozenset = frozenset()) -> None:
    """Assert `impl` (an instance or class) structurally satisfies `protocol`.

    For each Protocol method (skippable via `optional`, by name):
      1. `impl` must have an attribute of that name.
      2. `impl` must accept every parameter the Protocol declares as required (by name) — unless
         it takes **kwargs, in which case anything goes.
      3. `impl` must not REQUIRE a parameter the Protocol never mentions — that would break every
         caller written against the Protocol — unless it takes *args/**kwargs.
    """
    for name in _protocol_method_names(protocol):
        if name in optional and not hasattr(impl, name):
            continue
        assert hasattr(impl, name), f"{label} is missing {protocol.__name__}.{name}() entirely"
        proto_params = _params(getattr(protocol, name))
        impl_fn = getattr(impl, name)
        impl_params = _params(impl_fn)
        proto_names = {p.name for p in proto_params}
        impl_names = {p.name for p in impl_params}

        if not _accepts_arbitrary_kwargs(impl_params):
            missing = _required_names(proto_params) - impl_names
            assert not missing, (
                f"{label}.{name}{tuple(p.name for p in impl_params)} does not accept required "
                f"parameter(s) {sorted(missing)} that {protocol.__name__}.{name} declares")

        if not (_accepts_arbitrary_kwargs(impl_params) or _accepts_arbitrary_args(impl_params)):
            extra = _required_names(impl_params) - proto_names
            assert not extra, (
                f"{label}.{name}{tuple(p.name for p in impl_params)} REQUIRES parameter(s) "
                f"{sorted(extra)} that {protocol.__name__}.{name}{tuple(p.name for p in proto_params)} "
                f"never passes — every caller written against the Protocol would break")


# ---------------------------------------------------------------------------
# real + fake implementors, checked against each Protocol
# ---------------------------------------------------------------------------

def test_real_net_server_satisfies_the_netserver_protocol():
    assert_implements(I.NetServer, net.NetServer(), "net.NetServer")


def test_fake_net_satisfies_the_netserver_protocol_apart_from_the_documented_fake_exemptions():
    assert_implements(I.NetServer, fakes.FakeNet(), "fakes.FakeNet", optional=NETSERVER_OPTIONAL_ON_FAKES)


def test_fake_net_omits_exactly_the_documented_optional_methods_not_arbitrary_ones():
    # If a refactor added a NEW required NetServer method and FakeNet quietly didn't get it, the
    # test above would still pass it via `optional` unless the missing name is confirmed to be
    # ONLY the three known exemptions.
    fn = fakes.FakeNet()
    missing = {n for n in _protocol_method_names(I.NetServer) if not hasattr(fn, n)}
    assert missing == NETSERVER_OPTIONAL_ON_FAKES, missing


def test_real_compiler_satisfies_the_compiler_protocol():
    assert_implements(I.Compiler, compile_mod.Compiler(), "compile.Compiler")


def test_fake_compiler_satisfies_the_compiler_protocol():
    assert_implements(I.Compiler, fakes.FakeCompiler(), "fakes.FakeCompiler")


def test_real_local_armory_satisfies_the_armory_protocol():
    assert_implements(I.Armory, armory.LocalArmory(), "armory.LocalArmory")


def test_fake_armory_satisfies_the_armory_protocol():
    assert_implements(I.Armory, fakes.FakeArmory(), "fakes.FakeArmory")


# ---------------------------------------------------------------------------
# the checker itself: prove it actually fails on the mismatches it exists to catch
# ---------------------------------------------------------------------------

def test_assert_implements_catches_a_renamed_method():
    class RenamedPush:
        def list(self): return []
        async def scan(self, duration_s: int = 6): return []
        def bindplayer(self, gun_id, player_id): return None   # was bind_player

    try:
        assert_implements(I.Armory, RenamedPush(), "RenamedPush")
        assert False, "expected an AssertionError naming the missing method"
    except AssertionError as e:
        assert "bind_player" in str(e) and "RenamedPush" in str(e)


def test_assert_implements_catches_a_parameter_renamed_out_from_under_a_caller():
    class RenamedParam:
        def list(self): return []
        async def scan(self, duration_s: int = 6): return []
        def bind_player(self, gun_identifier, player_id): return None   # gun_id -> gun_identifier

    try:
        assert_implements(I.Armory, RenamedParam(), "RenamedParam")
        assert False, "expected an AssertionError naming the mismatched parameter"
    except AssertionError as e:
        assert "bind_player" in str(e)
        assert "gun_id" in str(e) or "gun_identifier" in str(e)


def test_assert_implements_tolerates_extra_optional_parameters_and_kwargs():
    class Permissive:
        def list(self, *, refresh: bool = False): return []
        async def scan(self, duration_s: int = 6, **kw): return []
        def bind_player(self, gun_id, player_id, *, force=False): return None

    assert_implements(I.Armory, Permissive(), "Permissive")   # must not raise
