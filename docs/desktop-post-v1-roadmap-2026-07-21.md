# Nyx Desktop post-v1 roadmap

Date: 2026-07-21

Status: recommendations after the current launcher implementation. These are not
part of the present build unless explicitly marked complete.

## Product rule

Nyx remains the game shelf. It starts and observes games, shows trusted Pengo
content, and hands installs, updates, repairs, and pre-downloads to the official
launcher. Do not add hidden maintenance automation, automatic game restarts,
manual resource timers, or broader publisher-session access.

## Phase 1 — before public distribution

1. **Signing and release channel.** Keep the reproducible portable development
   package, then pilot a signed installer/update channel with rollback. Do not
   remove the current installer until install, direct launch, update, recovery,
   and uninstall all pass on a clean Windows user.
2. **Performance budget.** Record cold-start p50/p95, time to first usable frame,
   working set after 30 seconds, package bytes, and downloaded-art cache bytes.
   Block releases that regress those baselines without an approved reason.
3. **Payload budget.** The latest measured v1 payload was 94.72 MiB. The Nyx
   background plus five offline hero fallbacks account for 20.68 MiB. Trial
   visually lossless re-encoding and keep it only if side-by-side QA is clean;
   target a 20% package reduction after measurement, not by blindly trimming .NET.
4. **Accessibility gate.** Complete launch, selection, Settings, Add Game, code
   copy, exports, and account disconnect using only the keyboard. Verify Narrator,
   high contrast, focus order, 125%/150% DPI, reduced motion, and the supported
   narrow/wide layouts.
5. **Privacy and local-data page.** Show what Nyx stores and provide separate
   actions for publisher disconnect/profile clear, generated-art cache clear,
   exports, diagnostics, and launcher-state reset. Never combine publisher-profile
   deletion with unrelated Nyx data.
6. **Redacted support bundle.** Let the user preview and save an opt-in report with
   Nyx/Windows versions, capability states, discovery categories, cache totals, and
   sanitized errors. Secret scanning must reject cookies, tokens, account IDs,
   response bodies, and sensitive paths.
7. **Real-user pilot gates.** Before enabling account tools by default, pilot the
   visible login, resource refresh, daily claim, cancellation, logout, and profile
   clear flows with an ordinary test account. Keep the feature opt-in until those
   live-only boundaries pass.

## Phase 2 — high-value daily use

1. **Optional local notifications** for a newly published redemption code, trusted
   banner rollover, or trusted maintenance end. Start with notifications while Nyx
   is open; no background service.
2. **Taskbar quick launch** for the most recently used games and Settings after the
   final Windows package-identity choice.
3. **Local play history** using only observed game-process lifetimes: last played
   and per-game session totals, with per-game clear and a global off switch.
4. **Library health page** showing game found/not found, exact executable proof,
   official launcher availability, current running state, and a manual Locate Game
   repair action.
5. **Nyx migration assistant** for settings, custom games, local artwork choices,
   and local play history. Publisher browser profiles and session material are
   deliberately excluded.

## Phase 3 — only after demand is proven

1. Promote ZZZ or WuWa pull/achievement exports only when a repeatable,
   user-authorized local provider has golden fixtures, bounded failure behavior,
   import verification, and an independent security review. Keep the existing
   provider slots hidden until then.
2. Consider more publisher resource fields only after the present cards remain
   stable in normal use. New fields must reuse the sealed per-game proof boundary;
   they must not broaden hosts, routes, stored secrets, or background behavior.
3. Consider MSIX/differential distribution alongside—not in place of—the verified
   portable package until direct game launching and rollback are proven in both.

## Measurement order

1. Capture the current package/startup/memory/cache baseline.
2. Remove dead, debug, duplicate, and expired generated payload.
3. Optimize only the largest replaceable image assets with visual comparison.
4. Trial framework-dependent packaging separately.
5. Keep an optimization only when launch, account isolation, update, recovery,
   uninstall, and visual gates remain green.

Do not enable trimming or ReadyToRun just to chase a smaller number: trimming can
break reflection-dependent code, while ReadyToRun commonly trades a larger package
for startup speed.

## Primary references

- [Windows packaging overview](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/)
- [MSIX differential updates](https://learn.microsoft.com/en-us/windows/msix/desktop/managing-your-msix-deployment-update)
- [Windows App SDK deployment choices](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/deploy-overview)
- [Windows app notifications](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/)
- [Windows Jump Lists](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/jump-list)
- [Windows accessibility](https://learn.microsoft.com/en-us/windows/apps/design/accessibility/accessibility-overview)
- [.NET diagnostics](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/)
- [.NET trimming guidance](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trim-self-contained)
- [.NET ReadyToRun trade-offs](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run)
