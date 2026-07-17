# HoYo live-version and pre-download publisher signal

Date: 2026-07-14

Status: sanitized fake transport/parser phase passed; no App wiring or real request was performed

## Result

Nyx now has an isolated read-only service that can ask one fixed publisher branch
endpoint for Genshin, HSR, and ZZZ together. It reports only publisher version facts.
It cannot launch, update, download, stage, repair, elevate, inspect local files, or
change local launch readiness.

The only production request target is:

`https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameBranches?game_ids%5B%5D=gopR6Cufr3&game_ids%5B%5D=4ziysqXOQ8&game_ids%5B%5D=U5hbdsT9W7&launcher_id=VYTpXlbWo8`

The HTTPS scheme, host, path, ordered three-game query, IDs, and launcher ID are
constants. No caller can supply a host, URL, path, query, game ID, header, or body.

## Projected publisher facts

The bounded parser accepts exactly one response containing exactly these identities:

- `gopR6Cufr3` + `hk4e_global` -> Genshin
- `4ziysqXOQ8` + `hkrpg_global` -> HSR
- `U5hbdsT9W7` + `nap_global` -> ZZZ

It projects only:

- `retcode`;
- `game.id` and `game.biz`;
- exact `main.branch=main` and a strict `major.minor.patch` tag;
- a null pre-download or exact `pre_download.branch=predownload` with a strict newer
  tag;
- optional `main.diff_tags`, `pre_download.diff_tags`, and
  `enable_base_pkg_predownload` as non-authoritative detail signals.

Missing, extra, duplicate, or wrong identities reject the batch. Duplicate critical
JSON keys, malformed/deep/oversized JSON, wrong branches, and malformed live versions
also reject it. Unknown fields are ignored and never enter a result object.

Malformed optional diff/base details do not erase a valid live version or valid
pre-download offer. They make only their optional detail `Unknown`.

The frozen sanitized HSR fixture reports live `4.3.0` and pre-download `4.4.0`.
A pre-download is `Offered` only when its branch is exactly `predownload` and its
strict version is newer than `main`. A true base-package capability flag with a null
`pre_download` remains `NotOffered`.

## Local-version comparison

For each game:

- local equals publisher live -> `Current`;
- local is older -> `UpdateOffered`;
- local is missing/malformed -> update state `Unknown`, while valid publisher facts
  remain available;
- publisher live is older than local -> that game's publisher observation is
  `Unknown`, never incorrectly `Current`.

Publisher offer, local staged-data presence, and verified-complete staged data are
three different facts. This service produces only the first. Its public DTOs contain
no staging, progress, package, completion, launch, or update-execution field.

## Failure and cache behavior

Timeout, caller cancellation, shutdown, TLS/network failure, redirect/status error,
wrong content type, oversized body, malformed response, stale identity, and parser
failure return three current `Unknown` game observations.

A previous successful observation may be returned separately as an explicitly
advisory remote-facts snapshot with its original timestamp. That DTO has publisher
live/pre-download facts only: it has no local comparison, `Current`,
`UpdateOffered`, observation, or current-known field. It is never substituted for
the failed current request. A failed refresh therefore displays current `Unknown`
even when advisory history exists.

Local launch status is not an input or output of this service. Tests keep a validated
local `Ready` state unchanged while TLS/network and malformed current checks become
publisher `Unknown`.

Concurrent checks share one in-flight branch request, but each caller compares the
shared publisher result with its own local versions. Canceling one waiter does not
cancel the shared request. Service shutdown does cancel it. Manual refreshes have a
five-second debounce; 4.999 seconds is blocked and the exact five-second boundary is
allowed. Automatic refresh is independent of that manual debounce.

An already-canceled caller is rejected before the service lock, debounce, request,
or advisory cache. It makes no request, consumes no manual-debounce window, and does
not expose cached advisory data. A following immediate manual request remains
eligible.

## Result and version hardening

Local and publisher versions use the same allocation-free span parser. It rejects
input before trimming or splitting, with a 32-character total ceiling and ten digits
per segment. Multi-megabyte digit strings and multi-megabyte pathological segments
therefore take the cheap length-rejection path and never enter output DTOs.

Current status, remote advisory facts, advisory snapshots, and batch results have no
public constructors. Internal construction enforces exact distinct GI/HSR/ZZZ sets,
copies input collections, validates enum and pre-download combinations, and prevents
an `Unknown` game from carrying versions or offers. A failed current result cannot
contain an authoritative current observation. `IsCurrentKnown` is derived from both
`Failure=None` and all three current observations being available; callers cannot
set it independently.

## Transport and privacy boundary

The production transport:

- uses HTTPS GET with no request body;
- accepts JSON only and HTTP 200 only;
- disables redirects, cookies, and automatic decompression;
- has a ten-second total timeout;
- stops above 256 KiB and parses with depth 16;
- sends no account, authentication, cookie, local-path, or caller-built header.

Raw response bytes exist only in bounded memory for the current parse. They are not
returned, cached, persisted, or logged. The cache contains only the sanitized remote
projection and timestamp. Password, package, category, account, message, headers,
credentials, and unknown response fields do not exist in public DTOs.

The stale package endpoint is absent. There is no package request or download code.

## Verification

- Focused PublisherMaintenance tests: corrected run `56/56` passed.
- Full Desktop tests: corrected run `345/345` passed.
- Core, Infrastructure, and App win-x64 Release builds: zero warnings and zero
  errors.
- Scoped formatter verification passed with only the existing non-failing solution
  workspace-load warning.
- DTO/logging, capability, fixed-endpoint, bounded-version, no-new-friend-exposure,
  personal-path, queue JSON, and diff scans passed and are recorded in the handoff.
- Every network case used a fake handler or fake transport. No real endpoint, game,
  official launcher, package, process, UAC prompt, registry, game file, or user path
  was touched.

## Still out of scope

App/UI wiring, local staging detection, complete-download proof, update execution,
launcher self-update, remote maintenance notices, WuWa, Endfield, and real endpoint
pilots remain separate reviewed tasks.

## In-process threat-model boundary

Nyx has no plugin loader and does not dynamically load untrusted assemblies. This
task added no `InternalsVisibleTo` entry and did not widen existing friend-assembly
access. The public API prevents ordinary external callers from constructing trusted
result objects or injecting transport dependencies.

This is not a claim of cryptographic authenticity against hostile code already
executing inside the Nyx process. Existing unsigned friend-assembly declarations
elsewhere in the Desktop solution could be name-spoofed by a hostile dynamically
loaded assembly, and reflection can bypass normal visibility. Such hostile in-process
execution is outside the present product model because no loading route exists. Any
future plugin or extension loader must reopen this boundary and require signed
assembly identity or, preferably, process isolation before loading untrusted code.
