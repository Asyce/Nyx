using System.Text;
using Nyx.Desktop.Core.AccountStatus;

namespace Nyx.Desktop.Tests.AccountStatus;

public sealed class PublisherAccountHardeningTests
{
    [Fact]
    public void Publisher_account_consent_is_default_off_independent_and_unknown_fails_closed()
    {
        var gate = new PublisherAccountConsentGate();

        Assert.False(gate.IsEnabled("HoYoLAB"));
        Assert.False(gate.IsEnabled("SKPORT"));
        Assert.False(gate.IsEnabled("lookalike"));
        Assert.True(gate.Set("HoYoLAB", enabled: true));
        Assert.True(gate.IsEnabled("HoYoLAB"));
        Assert.False(gate.IsEnabled("SKPORT"));
        Assert.False(gate.Set("lookalike", enabled: true));
        Assert.False(gate.IsEnabled("lookalike"));
        Assert.True(gate.Set("HoYoLAB", enabled: false));
        Assert.False(gate.IsEnabled("HoYoLAB"));
    }

    [Theory]
    [InlineData("gi", """{"retcode":0,"message":"OK","data":{"current_resin":124,"max_resin":200,"resin_recovery_time":"36480"}}""", 124, 200)]
    [InlineData("hsr", """{"retcode":0,"message":"OK","data":{"current_stamina":221,"max_stamina":300,"stamina_recover_time":23700,"current_reserve_stamina":840}}""", 221, 300)]
    [InlineData("zzz", """{"retcode":0,"message":"OK","data":{"energy":{"progress":{"current":87,"max":240},"restore":44100}}}""", 87, 240)]
    public void Per_game_resource_parsers_accept_complete_bounded_official_page_responses(
        string gameId,
        string json,
        int expectedCurrent,
        int expectedMaximum)
    {
        var observedAt = DateTimeOffset.Parse("2026-07-21T12:00:00Z");

        Assert.True(PublisherAccountCatalog.TryParseResourceResponse(
            gameId,
            Encoding.UTF8.GetBytes(json),
            observedAt,
            out var snapshot));
        Assert.NotNull(snapshot);
        Assert.Equal(expectedCurrent, snapshot.Current);
        Assert.Equal(expectedMaximum, snapshot.Maximum);
        Assert.Equal(observedAt, snapshot.ObservedAt);
    }

    [Theory]
    [InlineData("gi", """{"retcode":0,"data":{"current_resin":201,"max_resin":200,"resin_recovery_time":0}}""")]
    [InlineData("gi", """{"retcode":0,"data":{"current_resin":100,"max_resin":200}}""")]
    [InlineData("hsr", """{"retcode":0,"data":{"current_stamina":100,"max_stamina":300,"stamina_recover_time":1}}""")]
    [InlineData("zzz", """{"retcode":0,"data":{"energy":{"progress":{"current":1,"max":240}}}}""")]
    [InlineData("zzz", """{"retcode":-100,"data":{"energy":{"progress":{"current":1,"max":240},"restore":1}}}""")]
    [InlineData("zzz", """{"retcode":0,"data":{"energy":{"progress":{"current":240,"max":240},"restore":1}}}""")]
    [InlineData("gi", """{"retcode":0,"data":{"current_resin":124,"current_resin":125,"max_resin":200,"resin_recovery_time":36480}}""")]
    [InlineData("gi", """{"retcode":0,"retcode":0,"data":{"current_resin":124,"max_resin":200,"resin_recovery_time":36480}}""")]
    [InlineData("zzz", "not-json")]
    public void Per_game_resource_parsers_fail_closed_on_partial_impossible_or_failed_responses(
        string gameId,
        string json)
    {
        Assert.False(PublisherAccountCatalog.TryParseResourceResponse(
            gameId,
            Encoding.UTF8.GetBytes(json),
            DateTimeOffset.UtcNow,
            out var snapshot));
        Assert.Null(snapshot);
    }

    [Fact]
    public void Resource_parser_rejects_oversized_content_before_parsing()
    {
        var oversized = new byte[PublisherAccountCatalog.MaximumResourceResponseBytes + 1];

        Assert.False(PublisherAccountCatalog.TryParseResourceResponse(
            "gi",
            oversized,
            DateTimeOffset.UtcNow,
            out _));
    }

    [Theory]
    [InlineData("gi", "GET", "https://sg-hk4e-api.hoyolab.com/event/sol/info?uid=123456789&region=os_euro&lang=en-us&act_id=e202102251931481")]
    [InlineData("hsr", "GET", "https://sg-act-public-api.hoyolab.com/event/luna/hkrpg/os/info?act_id=e202303301540311&lang=en-us&region=prod_official_eur&uid=123456789")]
    [InlineData("zzz", "GET", "https://sg-act-public-api.hoyolab.com/event/luna/zzz/os/info?lang=en-us&uid=123456789&region=prod_gf_eu&act_id=e202406031448091")]
    [InlineData("gi", "POST", "https://sg-hk4e-api.hoyolab.com/event/sol/sign")]
    [InlineData("hsr", "POST", "https://sg-act-public-api.hoyolab.com/event/luna/hkrpg/os/sign")]
    [InlineData("zzz", "POST", "https://sg-act-public-api.hoyolab.com/event/luna/zzz/os/sign")]
    [InlineData("ae", "GET", "https://zonai.skport.com/web/v1/game/endfield/attendance")]
    [InlineData("ae", "POST", "https://zonai.skport.com/web/v1/game/endfield/attendance")]
    public void Check_in_response_filter_accepts_only_the_reviewed_method_and_exact_endpoint(
        string gameId,
        string method,
        string value)
    {
        var uri = new Uri(value);
        Assert.True(PublisherAccountCatalog.IsExactCheckInResponseUri(gameId, uri, method));
        Assert.Equal(
            gameId == "ae",
            PublisherAccountCatalog.IsExactCheckInResponseUri(gameId, uri, method == "GET" ? "POST" : "GET"));
        Assert.False(PublisherAccountCatalog.IsExactCheckInResponseUri(gameId, new Uri(value + (value.Contains('?') ? "&extra=1" : "?extra=1")), method));
    }

    [Fact]
    public void Endfield_session_probe_requires_bounded_authenticated_JSON_not_status_alone()
    {
        var exact = new Uri("https://web-api.skport.com/cookie_store/account_token");
        Assert.True(PublisherAccountCatalog.IsExactSkportSessionProbeUri(exact, "GET"));
        Assert.False(PublisherAccountCatalog.IsExactSkportSessionProbeUri(exact, "POST"));
        Assert.False(PublisherAccountCatalog.IsExactSkportSessionProbeUri(
            new Uri("https://web-api.skport.com/cookie_store/account_token?extra=1"),
            "GET"));
        var authenticated = Encoding.UTF8.GetBytes(
            """{"code":0,"data":{"content":"test-only-nonempty-proof"}}""");
        Assert.True(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            200,
            "application/json; charset=utf-8",
            authenticated));
        Assert.False(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            401,
            "application/json",
            authenticated));
        Assert.False(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            200,
            "text/plain",
            authenticated));
        Assert.False(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            200,
            "application/json",
            Encoding.UTF8.GetBytes("""{"code":0,"data":{}}""")));
        Assert.False(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            200,
            "application/json",
            Encoding.UTF8.GetBytes("""{"code":0,"data":{"calendar":[]}}""")));
        Assert.False(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            200,
            "application/json",
            Encoding.UTF8.GetBytes("not-json")));
        Assert.False(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            200,
            "application/json",
            Encoding.UTF8.GetBytes("""{"code":"0","data":{"content":"test-only-nonempty-proof"}}""")));
        Assert.False(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            200,
            "application/json",
            Encoding.UTF8.GetBytes("""{"code":0,"code":0,"data":{"content":"test-only-nonempty-proof"}}""")));
        Assert.False(PublisherAccountCatalog.IsAuthenticatedSkportSessionResponse(
            200,
            "application/json",
            new byte[PublisherAccountCatalog.MaximumResourceResponseBytes + 1]));
        Assert.Equal(
            PublisherSessionProof.Authenticated,
            PublisherAccountCatalog.ClassifySkportSessionResponse(
                200,
                "application/json",
                authenticated));
        Assert.Equal(
            PublisherSessionProof.LoginRequired,
            PublisherAccountCatalog.ClassifySkportSessionResponse(
                401,
                "application/json",
                ReadOnlyMemory<byte>.Empty));
        Assert.Equal(
            PublisherSessionProof.NeedsReview,
            PublisherAccountCatalog.ClassifySkportSessionResponse(
                200,
                "application/json",
                Encoding.UTF8.GetBytes("""{"code":0,"data":{}}""")));
        Assert.Equal(
            PublisherConnectionState.NeedsReview,
            PublisherAccountStatePolicy.ForSessionProof(PublisherSessionProof.NeedsReview));
        Assert.False(PublisherAccountCatalog.IsExactCheckInResponseUri(
            "ae",
            new Uri("https://game.skport.com/web/v1/game/endfield/attendance"),
            "GET"));
    }

    [Fact]
    public void Hoyo_info_uses_positive_current_day_state_and_never_prior_day_DOM_inference()
    {
        Assert.Equal(
            PublisherCheckInProof.Ready,
            ParseProof("hsr", "GET", """{"retcode":0,"data":{"is_sign":false,"total_sign_day":20,"today":"2026-07-21","history":[{"claimed":true}]}}"""));
        Assert.Equal(
            PublisherCheckInProof.Claimed,
            ParseProof("zzz", "GET", """{"retcode":0,"data":{"is_sign":true,"total_sign_day":21,"today":"2026-07-21"}}"""));
        Assert.Equal(
            PublisherCheckInProof.LoginNeeded,
            ParseProof("gi", "GET", """{"retcode":-100,"data":null,"message":"Not logged in"}"""));
    }

    [Theory]
    [InlineData("""{"retcode":0,"data":{"total_sign_day":21,"today":"2026-07-21"}}""")]
    [InlineData("""{"retcode":0,"data":{"is_sign":"true","total_sign_day":21,"today":"2026-07-21"}}""")]
    [InlineData("""{"retcode":0,"data":{"is_sign":true,"is_sign":false,"total_sign_day":21,"today":"2026-07-21"}}""")]
    [InlineData("""{"retcode":0,"data":{"is_sign":true,"total_sign_day":21,"today":"2026-07-21","today":"2026-07-20"}}""")]
    [InlineData("""{"retcode":0,"data":null}""")]
    [InlineData("not-json")]
    public void Hoyo_missing_role_or_layout_change_fails_closed(string json)
    {
        Assert.Equal(PublisherCheckInProof.Invalid, ParseProof("hsr", "GET", json));
    }

    [Fact]
    public void Malformed_check_in_requires_review_while_explicit_expiry_requires_login()
    {
        Assert.Equal(
            PublisherCheckInProof.LoginNeeded,
            PublisherAccountCatalog.ClassifyCheckInResponse(
                401,
                "text/html",
                "gi",
                "GET",
                ReadOnlyMemory<byte>.Empty,
                new DateOnly(2026, 7, 21),
                DateTimeOffset.Parse("2026-07-21T12:00:00Z")));
        Assert.Equal(
            PublisherCheckInProof.Invalid,
            PublisherAccountCatalog.ClassifyCheckInResponse(
                500,
                "application/json",
                "gi",
                "GET",
                Encoding.UTF8.GetBytes("""{"retcode":-100}"""),
                new DateOnly(2026, 7, 21),
                DateTimeOffset.Parse("2026-07-21T12:00:00Z")));
        Assert.Equal(
            PublisherConnectionState.NeedsReview,
            PublisherAccountStatePolicy.ForCheckIn(DailyCheckInState.CouldNotCheck));
        Assert.Equal(
            PublisherConnectionState.LoginRequired,
            PublisherAccountStatePolicy.ForCheckIn(DailyCheckInState.LoginNeeded));
    }

    [Theory]
    [InlineData("2026-07-20")]
    [InlineData("2026-07-22")]
    [InlineData("2026-02-30")]
    [InlineData("2026-7-21")]
    [InlineData("garbage")]
    public void Hoyo_today_must_be_the_exact_injected_operation_date(string today)
    {
        var json = """{"retcode":0,"data":{"is_sign":false,"total_sign_day":20,"today":"DATE"}}"""
            .Replace("DATE", today, StringComparison.Ordinal);

        Assert.Equal(PublisherCheckInProof.Invalid, ParseProof("hsr", "GET", json));
    }

    [Fact]
    public void Endfield_attendance_GET_proves_current_ready_or_current_claimed()
    {
        const string ready = """
            {"code":0,"data":{"currentTs":"1784635200","hasToday":false,
            "calendar":[{"awardId":"item-1","available":true,"done":false},{"awardId":"item-2","available":false,"done":false}],
            "first":[],"resourceInfoMap":{}}}
            """;
        const string claimed = """
            {"code":0,"data":{"currentTs":"1784635200","hasToday":true,
            "calendar":[{"awardId":"item-1","available":false,"done":true},{"awardId":"item-2","available":false,"done":false}],
            "first":[],"resourceInfoMap":{}}}
            """;

        Assert.Equal(PublisherCheckInProof.Ready, ParseProof("ae", "GET", ready));
        Assert.Equal(PublisherCheckInProof.Claimed, ParseProof("ae", "GET", claimed));
    }

    [Theory]
    [InlineData("""{"code":0,"data":{"currentTs":"1","hasToday":false,"calendar":[],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"currentTs":"1","hasToday":false,"calendar":[{"awardId":"a","available":true,"done":false},{"awardId":"b","available":true,"done":false}],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"currentTs":"1","hasToday":false,"calendar":[{"awardId":"a","available":true,"done":true}],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"hasToday":false,"calendar":[{"awardId":"a","available":true,"done":false}],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"currentTs":"1","hasToday":true,"calendar":[{"awardId":"a","available":true,"done":false}],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"currentTs":"1","hasToday":true,"calendar":[{"awardId":"a","available":false,"done":false}],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"currentTs":"1784635200","hasToday":false,"hasToday":true,"calendar":[{"awardId":"a","available":true,"done":false}],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"currentTs":"1784635200","hasToday":false,"calendar":[{"awardId":"a","available":true,"available":false,"done":false}],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"currentTs":"1784635200","hasToday":false,"calendar":[{"awardId":"a","available":false,"done":false}],"first":[],"resourceInfoMap":{}}}""")]
    [InlineData("""{"code":0,"data":{"currentTs":"1784635200","hasToday":false,"calendar":[{"awardId":"a","available":true,"done":false},{"awardId":"a","available":false,"done":false}],"first":[],"resourceInfoMap":{}}}""")]
    public void Endfield_malformed_or_ambiguous_attendance_fails_closed(string json)
    {
        Assert.Equal(PublisherCheckInProof.Invalid, ParseProof("ae", "GET", json));
    }

    [Fact]
    public void Endfield_POST_requires_a_complete_bounded_claim_response()
    {
        const string accepted = """
            {"code":0,"data":{"ts":"1784635200","awardIds":[{"id":"item-1","type":1}],
            "tomorrowAwardIds":[],"resourceInfoMap":{"item-1":{"name":"Reward","icon":"https://example.invalid/i.png","count":1}}}}
            """;
        const string malformed = """{"code":0,"data":{"ts":"1784635200","awardIds":[],"tomorrowAwardIds":[],"resourceInfoMap":{}}}""";

        Assert.Equal(PublisherCheckInProof.ClaimAccepted, ParseProof("ae", "POST", accepted));
        Assert.Equal(PublisherCheckInProof.Invalid, ParseProof("ae", "POST", malformed));
    }

    [Theory]
    [InlineData("GET", "1784635079")]
    [InlineData("GET", "1784635231")]
    [InlineData("POST", "1784635079")]
    [InlineData("POST", "1784635231")]
    public void Endfield_GET_and_POST_reject_stale_or_future_server_timestamps(
        string method,
        string timestamp)
    {
        var json = method == "GET"
            ? """
                {"code":0,"data":{"currentTs":"TIMESTAMP","hasToday":false,
                "calendar":[{"awardId":"item-1","available":true,"done":false}],
                "first":[],"resourceInfoMap":{}}}
                """
            : """
                {"code":0,"data":{"ts":"TIMESTAMP","awardIds":[{"id":"item-1","type":1}],
                "tomorrowAwardIds":[],"resourceInfoMap":{}}}
                """;

        Assert.Equal(
            PublisherCheckInProof.Invalid,
            ParseProof("ae", method, json.Replace("TIMESTAMP", timestamp, StringComparison.Ordinal)));
    }

    [Theory]
    [InlineData("2026-07-21T20:00:30Z")]
    [InlineData("2026-07-21T09:00:30Z")]
    public void Endfield_timestamp_must_not_cross_either_possible_server_reset_day(
        string expectedText)
    {
        var expectedInstant = DateTimeOffset.Parse(expectedText);
        var responseTimestamp = expectedInstant.AddMinutes(-1).ToUnixTimeSeconds().ToString();
        var json = """
            {"code":0,"data":{"currentTs":"TIMESTAMP","hasToday":false,
            "calendar":[{"awardId":"item-1","available":true,"done":false}],
            "first":[],"resourceInfoMap":{}}}
            """.Replace("TIMESTAMP", responseTimestamp, StringComparison.Ordinal);

        Assert.Equal(
            PublisherCheckInProof.Invalid,
            PublisherAccountCatalog.ParseCheckInResponse(
                "ae",
                "GET",
                Encoding.UTF8.GetBytes(json),
                DateOnly.FromDateTime(expectedInstant.DateTime),
                expectedInstant));
    }

    [Fact]
    public void Endfield_available_field_remains_the_primary_claim_state()
    {
        const string noAvailableReward = """
            {"code":0,"data":{"currentTs":"1784635200","hasToday":false,
            "calendar":[{"awardId":"item-1","available":false,"done":true},{"awardId":"item-2","available":false,"done":false}],
            "first":[],"resourceInfoMap":{}}}
            """;

        Assert.Equal(PublisherCheckInProof.Claimed, ParseProof("ae", "GET", noAvailableReward));
    }

    [Fact]
    public void Authenticated_resource_expiry_is_a_distinct_login_needed_proof()
    {
        var proof = PublisherAccountCatalog.ParseResourceResponse(
            "gi",
            Encoding.UTF8.GetBytes("""{"retcode":-100,"message":"expired","data":null}"""),
            DateTimeOffset.Parse("2026-07-21T12:00:00Z"),
            out var snapshot);

        Assert.Equal(PublisherResourceProof.LoginNeeded, proof);
        Assert.Null(snapshot);
    }

    [Fact]
    public void Resource_capture_accepts_one_binding_and_rejects_mixed_roles_or_servers_in_any_order()
    {
        var observedAt = DateTimeOffset.Parse("2026-07-21T12:00:00Z");
        var older = new PublisherResourceSnapshot("gi", "Original Resin", 124, 200, observedAt, RecoverySeconds: 36480);
        var newer = older with { ObservedAt = observedAt.AddSeconds(1) };
        var firstBinding = new PublisherRoleBinding("123456789", "os_euro");
        var otherRole = new PublisherRoleBinding("987654321", "os_euro");
        var otherServer = new PublisherRoleBinding("123456789", "os_usa");
        PublisherResourceCandidate[] sameBinding =
        [
            new(firstBinding, older),
            new(firstBinding, newer),
        ];

        Assert.Equal(newer, PublisherAccountCatalog.SelectUnambiguousResource(sameBinding));

        PublisherResourceCandidate[] mixedRole =
        [
            new(firstBinding, older),
            new(otherRole, newer),
        ];
        Assert.Null(PublisherAccountCatalog.SelectUnambiguousResource(mixedRole));
        Assert.Null(PublisherAccountCatalog.SelectUnambiguousResource(mixedRole.Reverse().ToArray()));

        PublisherResourceCandidate[] mixedServer =
        [
            new(firstBinding, older),
            new(otherServer, newer),
        ];
        Assert.Null(PublisherAccountCatalog.SelectUnambiguousResource(mixedServer));
        Assert.Null(PublisherAccountCatalog.SelectUnambiguousResource(mixedServer.Reverse().ToArray()));
        Assert.Null(PublisherAccountCatalog.SelectUnambiguousResource(
            Enumerable.Repeat(new PublisherResourceCandidate(firstBinding, older), 9).ToArray()));
    }

    [Fact]
    public void Resource_response_is_ignored_until_its_request_was_reserved()
    {
        const long generation = 17;
        var binding = new PublisherRoleBinding("123456789", "os_euro");
        var snapshot = new PublisherResourceSnapshot(
            "gi",
            "Original Resin",
            124,
            200,
            DateTimeOffset.Parse("2026-07-21T12:00:00Z"),
            RecoverySeconds: 36480);
        var capture = new PublisherResourceCaptureAuthority("gi", generation);

        Assert.True(capture.Open(generation));
        Assert.False(capture.TryBeginResponse(generation, binding));
        Assert.True(capture.TryReserve(generation, "gi", binding));
        Assert.True(capture.TryBeginResponse(generation, binding));
        Assert.True(capture.CompleteResponse(generation, binding, PublisherResourceProof.Valid, snapshot));

        var result = capture.Seal(generation);
        Assert.Equal(PublisherResourceReadOutcome.Valid, result.Outcome);
        Assert.Equal(snapshot, result.Snapshot);
    }

    [Fact]
    public void Multiple_roles_require_explicit_selection_and_never_auto_pick()
    {
        const long generation = 18;
        var firstBinding = new PublisherRoleBinding("123456789", "os_euro");
        var delayedBinding = new PublisherRoleBinding("987654321", "os_euro");
        var snapshot = new PublisherResourceSnapshot(
            "gi",
            "Original Resin",
            124,
            200,
            DateTimeOffset.Parse("2026-07-21T12:00:00Z"),
            RecoverySeconds: 36480);
        var capture = new PublisherResourceCaptureAuthority("gi", generation);
        Assert.True(capture.Open(generation));
        Assert.True(capture.TryReserve(generation, "gi", firstBinding));
        Assert.True(capture.TryBeginResponse(generation, firstBinding));
        Assert.True(capture.CompleteResponse(generation, firstBinding, PublisherResourceProof.Valid, snapshot));

        // This request arrives after the first response, but before the
        // bounded observation is sealed. It must still make the result fail.
        Assert.True(capture.TryReserve(generation, "gi", delayedBinding));
        Assert.True(capture.TryBeginResponse(generation, delayedBinding));
        Assert.True(capture.CompleteResponse(
            generation,
            delayedBinding,
            PublisherResourceProof.Valid,
            snapshot));
        var result = capture.Seal(generation);

        Assert.Equal(PublisherResourceReadOutcome.SelectionRequired, result.Outcome);
        Assert.Null(result.Snapshot);
        Assert.Equal(2, result.Candidates!.Count);
        Assert.Equal(PublisherConnectionState.Connected, PublisherAccountStatePolicy.ForResourceRead(result));
    }

    [Fact]
    public void Stored_role_blocks_other_role_requests_and_cannot_be_rendered_unmasked()
    {
        const long generation = 19;
        var selected = new PublisherRoleBinding("123456789", "os_euro");
        var other = new PublisherRoleBinding("987654321", "os_usa");
        var snapshot = new PublisherResourceSnapshot(
            "gi",
            "Original Resin",
            124,
            200,
            DateTimeOffset.Parse("2026-07-21T12:00:00Z"),
            RecoverySeconds: 36480);
        var capture = new PublisherResourceCaptureAuthority("gi", generation, selected);

        Assert.True(capture.Open(generation));
        Assert.False(capture.TryReserve(generation, "gi", other));
        Assert.True(capture.TryReserve(generation, "gi", selected));
        Assert.True(capture.TryBeginResponse(generation, selected));
        Assert.True(capture.CompleteResponse(generation, selected, PublisherResourceProof.Valid, snapshot));
        Assert.Equal(PublisherResourceReadOutcome.Valid, capture.Seal(generation).Outcome);

        var choices = PublisherAccountCatalog.CreateRoleChoices(
            "gi",
            [
                new(selected, snapshot),
                new(other, snapshot),
            ]);
        Assert.Equal(2, choices.Count);
        Assert.All(choices, choice => Assert.DoesNotContain(choice.Binding.RoleId, choice.DisplayText, StringComparison.Ordinal));
        Assert.Contains(choices, choice => choice.DisplayText.Contains("Europe", StringComparison.Ordinal));
        Assert.DoesNotContain(selected.RoleId, selected.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Stored_role_capture_bounds_rejected_role_attempts()
    {
        const long generation = 20;
        var selected = new PublisherRoleBinding("123456789", "os_euro");
        var capture = new PublisherResourceCaptureAuthority("gi", generation, selected);
        Assert.True(capture.Open(generation));

        for (var index = 0; index < 9; index++)
        {
            var other = new PublisherRoleBinding((900000000 + index).ToString(), "os_usa");
            Assert.False(capture.TryReserve(generation, "gi", other));
        }

        Assert.Equal(PublisherResourceReadOutcome.NeedsReview, capture.Seal(generation).Outcome);
    }

    [Fact]
    public void Previous_generation_requests_are_ignored_and_pending_timeout_fails_closed()
    {
        const long generation = 22;
        var binding = new PublisherRoleBinding("123456789", "os_euro");
        var capture = new PublisherResourceCaptureAuthority("gi", generation);

        Assert.True(capture.Open(generation));
        Assert.False(capture.TryReserve(generation - 1, "gi", binding));
        Assert.True(capture.TryReserve(generation, "gi", binding));
        Assert.False(capture.TryBeginResponse(generation - 1, binding));

        var result = capture.Seal(generation);
        Assert.Equal(PublisherResourceReadOutcome.NeedsReview, result.Outcome);
        Assert.Null(result.Snapshot);
    }

    [Fact]
    public void Resource_schema_drift_demotes_to_review_but_explicit_auth_rejection_demotes_to_login()
    {
        var binding = new PublisherRoleBinding("123456789", "os_euro");
        var malformed = new PublisherResourceCaptureAuthority("gi", 30);
        Assert.True(malformed.Open(30));
        Assert.True(malformed.TryReserve(30, "gi", binding));
        Assert.True(malformed.TryBeginResponse(30, binding));
        Assert.True(malformed.CompleteResponse(30, binding, PublisherResourceProof.Invalid, null));
        var malformedResult = malformed.Seal(30);
        Assert.Equal(PublisherResourceReadOutcome.NeedsReview, malformedResult.Outcome);
        Assert.Equal(
            PublisherConnectionState.NeedsReview,
            PublisherAccountStatePolicy.ForResourceRead(malformedResult));

        var rejected = new PublisherResourceCaptureAuthority("gi", 31);
        Assert.True(rejected.Open(31));
        Assert.True(rejected.TryReserve(31, "gi", binding));
        Assert.True(rejected.TryBeginResponse(31, binding));
        Assert.True(rejected.CompleteResponse(31, binding, PublisherResourceProof.LoginNeeded, null));
        var rejectedResult = rejected.Seal(31);
        Assert.Equal(PublisherResourceReadOutcome.LoginRequired, rejectedResult.Outcome);
        Assert.Equal(
            PublisherConnectionState.LoginRequired,
            PublisherAccountStatePolicy.ForResourceRead(rejectedResult));

        Assert.Equal(
            PublisherConnectionState.NeedsReview,
            PublisherAccountStatePolicy.ForResourceRead(
                new PublisherResourceReadResult(null, PublisherResourceReadOutcome.Valid)));
    }

    [Fact]
    public void Mixed_valid_and_login_resource_proofs_are_ambiguous_and_need_review()
    {
        const long generation = 32;
        var binding = new PublisherRoleBinding("123456789", "os_euro");
        var snapshot = new PublisherResourceSnapshot(
            "gi",
            "Original Resin",
            124,
            200,
            DateTimeOffset.Parse("2026-07-21T12:00:00Z"),
            RecoverySeconds: 36480);
        var capture = new PublisherResourceCaptureAuthority("gi", generation);

        Assert.True(capture.Open(generation));
        Assert.True(capture.TryReserve(generation, "gi", binding));
        Assert.True(capture.TryReserve(generation, "gi", binding));
        Assert.True(capture.TryBeginResponse(generation, binding));
        Assert.True(capture.CompleteResponse(generation, binding, PublisherResourceProof.Valid, snapshot));
        Assert.True(capture.TryBeginResponse(generation, binding));
        Assert.True(capture.CompleteResponse(generation, binding, PublisherResourceProof.LoginNeeded, null));

        var result = capture.Seal(generation);
        Assert.Equal(PublisherResourceReadOutcome.NeedsReview, result.Outcome);
        Assert.Equal(PublisherConnectionState.NeedsReview, PublisherAccountStatePolicy.ForResourceRead(result));
    }

    [Fact]
    public void Resource_binding_is_taken_from_the_exact_authenticated_endpoint_query()
    {
        Assert.True(PublisherAccountCatalog.TryGetResourceBinding(
            "gi",
            new Uri("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=123456789&server=os_euro"),
            out var binding));
        Assert.Equal(new PublisherRoleBinding("123456789", "os_euro"), binding);
        Assert.False(PublisherAccountCatalog.TryGetResourceBinding(
            "gi",
            new Uri("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=123456789&server=os_euro&role_id=987654321"),
            out _));
    }

    [Theory]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481", "GET", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Resource, "gi", "https://act.hoyolab.com/app/community-game-records-sea/index.html", "GET", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Connect, "gi", "https://account.hoyoverse.com/passport/index.html?origin=account", "GET", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Connect, "gi", "https://account.hoyoverse.com/single-page?origin=account", "GET", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Connect, "gi", "https://account.hoyoverse.com/passport/assets/main.js", "GET", PublisherWebResourceContext.Script)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://webstatic.hoyoverse.com/dora/biz/mihoyo-account-sdk/main.js", "GET", PublisherWebResourceContext.Script)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "hsr", "https://upload-static.hoyoverse.com/event/2023/04/21/reward.png", "GET", PublisherWebResourceContext.Image)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "zzz", "https://act-webstatic.hoyoverse.com/event-static/2024/06/17/reward.png", "GET", PublisherWebResourceContext.Image)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Resource, "gi", "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=123456789&server=os_euro", "GET", PublisherWebResourceContext.Fetch)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://sg-hk4e-api.hoyolab.com/event/sol/sign", "OPTIONS", PublisherWebResourceContext.Fetch)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Connect, "gi", "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/getSwitchStatus?app_id=c9oqaq3s3gu8&platform=4", "GET", PublisherWebResourceContext.XmlHttpRequest)]
    [InlineData("SKPORT", PublisherSessionPurpose.CheckIn, "ae", "https://game.skport.com/endfield/sign-in", "GET", PublisherWebResourceContext.Document)]
    [InlineData("SKPORT", PublisherSessionPurpose.CheckIn, "ae", "https://static.skport.com/skport-fe-static/skport-game-tools/1412.js", "GET", PublisherWebResourceContext.Script)]
    [InlineData("SKPORT", PublisherSessionPurpose.CheckIn, "ae", "https://web-api.skport.com/cookie_store/account_token", "GET", PublisherWebResourceContext.Fetch)]
    [InlineData("SKPORT", PublisherSessionPurpose.CheckIn, "ae", "https://zonai.skport.com/web/v1/game/endfield/attendance", "OPTIONS", PublisherWebResourceContext.Other)]
    [InlineData("SKPORT", PublisherSessionPurpose.Connect, "ae", "https://as.gryphline.com/user/info/v1/basic?token=opaque-token", "GET", PublisherWebResourceContext.XmlHttpRequest)]
    [InlineData("SKPORT", PublisherSessionPurpose.Connect, "ae", "https://binding-api-account-prod.gryphline.com/account/binding/v1/binding_list?token=opaque-token&appCode=endfield", "GET", PublisherWebResourceContext.XmlHttpRequest)]
    public void Publisher_request_policy_preserves_only_reviewed_required_requests(
        string provider,
        PublisherSessionPurpose purpose,
        string gameId,
        string value,
        string method,
        PublisherWebResourceContext context)
    {
        Assert.True(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            provider,
            purpose,
            gameId,
            new Uri(value),
            method,
            context));
    }

    [Theory]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://account.hoyoverse.com/passport/index.html", "GET", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://account.hoyoverse.com/passport/assets/main.js", "GET", PublisherWebResourceContext.Script)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://act.hoyolab.com.evil.example/ys/event/signin-sea-v3/index.html", "GET", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "http://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481", "GET", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://act.hoyolab.com:444/ys/event/signin-sea-v3/index.html?act_id=e202102251931481", "GET", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://act.hoyolab.com/unreviewed/script.js", "GET", PublisherWebResourceContext.Script)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "hsr", "https://upload-static.hoyoverse.com/unreviewed/script.js", "GET", PublisherWebResourceContext.Script)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "zzz", "https://act-webstatic.hoyoverse.com/event-static/2024/06/17/script.js", "GET", PublisherWebResourceContext.Script)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.CheckIn, "gi", "https://google-analytics.com/g/collect", "POST", PublisherWebResourceContext.Fetch)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Resource, "gi", "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=123456789&server=os_euro", "GET", PublisherWebResourceContext.Script)]
    [InlineData("SKPORT", PublisherSessionPurpose.CheckIn, "ae", "https://web-api.skport.com/cookie_store/other", "GET", PublisherWebResourceContext.Fetch)]
    [InlineData("SKPORT", PublisherSessionPurpose.CheckIn, "ae", "https://static.skport.com/unreviewed/main.js", "GET", PublisherWebResourceContext.Script)]
    [InlineData("SKPORT", PublisherSessionPurpose.CheckIn, "ae", "https://game.skport.com/endfield/sign-in", "POST", PublisherWebResourceContext.Document)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Resource, "gi", "https://sg-hk4e-api.hoyolab.com/event/sol/sign", "OPTIONS", PublisherWebResourceContext.Fetch)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Connect, "gi", "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/deleteAccount", "OPTIONS", PublisherWebResourceContext.Fetch)]
    [InlineData("HoYoLAB", PublisherSessionPurpose.Connect, "gi", "https://api-account-os.hoyoverse.com/account/auth/api/webLoginByPassword", "OPTIONS", PublisherWebResourceContext.Fetch)]
    [InlineData("SKPORT", PublisherSessionPurpose.Connect, "ae", "https://as.gryphline.com/user/auth/v1/register", "OPTIONS", PublisherWebResourceContext.Fetch)]
    [InlineData("SKPORT", PublisherSessionPurpose.Connect, "ae", "https://binding-api-account-prod.gryphline.com/account/binding/v1/set_default_role", "OPTIONS", PublisherWebResourceContext.Fetch)]
    [InlineData("SKPORT", PublisherSessionPurpose.Connect, "ae", "https://web-api.skport.com/cookie_store/other", "OPTIONS", PublisherWebResourceContext.Fetch)]
    public void Publisher_request_policy_blocks_unreviewed_hosts_paths_ports_methods_and_contexts(
        string provider,
        PublisherSessionPurpose purpose,
        string gameId,
        string value,
        string method,
        PublisherWebResourceContext context)
    {
        Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            provider,
            purpose,
            gameId,
            new Uri(value),
            method,
            context));
    }

    [Fact]
    public void Exact_claim_write_is_wrong_purpose_until_armed_then_is_consumed_once()
    {
        var claim = new Uri("https://sg-hk4e-api.hoyolab.com/event/sol/sign");
        var authority = new PublisherClaimWriteAuthority();
        using var scope = authority.Arm("gi");

        Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "HoYoLAB",
            PublisherSessionPurpose.Connect,
            "gi",
            claim,
            "POST",
            PublisherWebResourceContext.Fetch,
            authority));
        Assert.True(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "HoYoLAB",
            PublisherSessionPurpose.CheckIn,
            "gi",
            claim,
            "OPTIONS",
            PublisherWebResourceContext.Fetch,
            authority));
        Assert.True(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "HoYoLAB",
            PublisherSessionPurpose.CheckIn,
            "gi",
            claim,
            "POST",
            PublisherWebResourceContext.Fetch,
            authority));
        Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "HoYoLAB",
            PublisherSessionPurpose.CheckIn,
            "gi",
            claim,
            "POST",
            PublisherWebResourceContext.Fetch,
            authority));
        Assert.Throws<InvalidOperationException>(() => authority.Arm("gi"));
    }

    [Fact]
    public void Claim_scope_is_game_bound_and_revoked_even_when_unused()
    {
        var giClaim = new Uri("https://sg-hk4e-api.hoyolab.com/event/sol/sign");
        var authority = new PublisherClaimWriteAuthority();
        using (authority.Arm("hsr"))
        {
            Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
                "HoYoLAB",
                PublisherSessionPurpose.CheckIn,
                "hsr",
                giClaim,
                "POST",
                PublisherWebResourceContext.Fetch,
                authority));
        }

        Assert.False(authority.TryConsume("hsr"));
    }

    [Fact]
    public void Connect_auth_writes_do_not_authorize_claim_or_resource_mutations()
    {
        var accountLogin = new Uri("https://passport-api-eu.hoyoverse.com/account/ma-passport/api/webLoginByPassword");
        var accountLoginBody = Encoding.UTF8.GetBytes(
            """{"account":"encrypted-account","password":"encrypted-password","token_type":2}""");
        var claim = new Uri("https://sg-hk4e-api.hoyolab.com/event/sol/sign");
        var communityMutation = new Uri("https://bbs-api-os.hoyolab.com/community/painter/wapi/post");

        Assert.True(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "HoYoLAB",
            PublisherSessionPurpose.Connect,
            "gi",
            accountLogin,
            "POST",
            PublisherWebResourceContext.XmlHttpRequest,
            requestBody: accountLoginBody,
            contentType: "application/json; charset=utf-8"));
        Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "HoYoLAB",
            PublisherSessionPurpose.Resource,
            "gi",
            accountLogin,
            "POST",
            PublisherWebResourceContext.XmlHttpRequest));
        Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "HoYoLAB",
            PublisherSessionPurpose.Connect,
            "gi",
            claim,
            "POST",
            PublisherWebResourceContext.Fetch));
        Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "HoYoLAB",
            PublisherSessionPurpose.Connect,
            "gi",
            communityMutation,
            "POST",
            PublisherWebResourceContext.Fetch));

        var skportClaim = new Uri("https://zonai.skport.com/web/v1/game/endfield/attendance");
        Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "SKPORT",
            PublisherSessionPurpose.Connect,
            "ae",
            skportClaim,
            "POST",
            PublisherWebResourceContext.Fetch));

        var skportAuthority = new PublisherClaimWriteAuthority();
        using var skportScope = skportAuthority.Arm("ae");
        Assert.True(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "SKPORT",
            PublisherSessionPurpose.CheckIn,
            "ae",
            skportClaim,
            "POST",
            PublisherWebResourceContext.Fetch,
            skportAuthority));
        Assert.False(PublisherAccountCatalog.IsAllowedWebResourceRequest(
            "SKPORT",
            PublisherSessionPurpose.CheckIn,
            "ae",
            skportClaim,
            "POST",
            PublisherWebResourceContext.Fetch,
            skportAuthority));
    }

    [Fact]
    public void Exact_reviewed_connect_inventory_accepts_required_routes_and_json_shapes()
    {
        Assert.True(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/getSwitchStatus?app_id=c9oqaq3s3gu8&platform=4",
            "GET",
            gameId: "gi"));
        Assert.True(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/getSwitchStatus?app_id=ciebhwzprpq8&platform=4",
            "GET",
            gameId: "hsr"));
        Assert.True(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/getSwitchStatus?app_id=cieaz4epd5vk&platform=4",
            "GET",
            gameId: "zzz"));
        Assert.True(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/getConfig",
            "POST",
            "{}"));
        Assert.True(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/webLoginByPassword",
            "POST",
            """{"account":"encrypted-account","password":"encrypted-password","token_type":2}"""));
        Assert.True(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/webLoginByPassword",
            "OPTIONS"));

        Assert.True(AllowsConnect(
            "SKPORT",
            "https://as.gryphline.com/user/auth/v1/token_by_email_password",
            "POST",
            """{"email":"person@example.com","password":"secret"}"""));
        Assert.True(AllowsConnect(
            "SKPORT",
            "https://as.gryphline.com/user/oauth2/v2/grant",
            "POST",
            """{"token":"opaque-token","appCode":"endfield","type":1}"""));
        Assert.True(AllowsConnect(
            "SKPORT",
            "https://web-api.skport.com/cookie_store/account_token",
            "POST",
            """{"content":"opaque-token"}"""));
        Assert.True(AllowsConnect(
            "SKPORT",
            "https://zonai.skport.com/web/v1/user/auth/generate_cred_by_code",
            "POST",
            """{"kind":1,"code":"opaque-code"}"""));
        Assert.True(AllowsConnect(
            "SKPORT",
            "https://as.gryphline.com/user/oauth2/v2/grant",
            "OPTIONS"));
    }

    [Fact]
    public void Connect_rejects_unknown_posts_and_preflights_under_reviewed_prefixes()
    {
        Assert.False(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/getSwitchStatus?app_id=ciebhwzprpq8&platform=4",
            "GET",
            gameId: "gi"));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            "https://account.hoyoverse.com/account/ma-passport/api/getConfig",
            "POST",
            "{}"));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            "https://bbs-api-os.hoyolab.com/community/private/future-account-data",
            "GET"));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            "https://account.hoyoverse.com/login-platform/private/future-account-data",
            "GET"));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            "https://webstatic.hoyoverse.com/dora/private/future-account-data",
            "GET"));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/deleteAccount",
            "POST",
            "{}"));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/deleteAccount",
            "OPTIONS"));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://as.gryphline.com/user/auth/v1/register",
            "POST",
            """{"email":"person@example.com","password":"secret","code":"123456"}"""));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://as.gryphline.com/user/auth/v1/register",
            "OPTIONS"));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://binding-api-account-prod.gryphline.com/account/binding/v1/set_default_role",
            "POST",
            """{"token":"opaque-token","appCode":"endfield","uid":"123"}"""));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://binding-api-account-prod.gryphline.com/account/binding/v1/set_default_role",
            "OPTIONS"));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://static.skport.com/skport-fe-static/skport-game-tools/private-account-data",
            "GET"));
    }

    [Fact]
    public void Connect_rejects_extra_duplicate_missing_and_wrong_typed_body_fields()
    {
        const string hoyoLogin =
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/webLoginByPassword";
        Assert.False(AllowsConnect(
            "HoYoLAB",
            hoyoLogin,
            "POST",
            """{"account":"a","password":"p","token_type":2,"action":"delete"}"""));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            hoyoLogin,
            "POST",
            """{"account":"a","account":"b","password":"p","token_type":2}"""));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            hoyoLogin,
            "POST",
            """{"account":"a","password":"p","token_type":"2"}"""));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            hoyoLogin,
            "POST",
            """{"account":"a","password":"p","token_type":2}""",
            "application/x-www-form-urlencoded"));

        Assert.False(AllowsConnect(
            "SKPORT",
            "https://as.gryphline.com/user/auth/v1/token_by_email_password",
            "POST",
            """{"email":"person@example.com","password":"secret","emailSubscription":true}"""));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://as.gryphline.com/user/oauth2/v2/grant",
            "POST",
            """{"token":"opaque-token","appCode":"arbitrary-app","type":1}"""));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://web-api.skport.com/cookie_store/account_token",
            "POST",
            """{"content":{"token":"opaque-token"}}"""));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://zonai.skport.com/web/v1/user/auth/generate_cred_by_code",
            "POST",
            """{"kind":0,"code":"opaque-code"}"""));
        Assert.False(AllowsConnect(
            "SKPORT",
            "https://as.gryphline.com/user/auth/v1/token_by_email_password",
            "POST",
            """{"email":"","password":"secret"}"""));
    }

    [Fact]
    public void Connect_rejects_missing_malformed_oversized_and_preflight_bodies()
    {
        const string login =
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/webLoginByPassword";
        Assert.False(AllowsConnect("HoYoLAB", login, "POST"));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            login,
            "POST",
            """{"account":"a","password":"p","token_type":2,}"""));

        var oversized = "{\"account\":\""
            + new string('a', PublisherAccountCatalog.MaximumConnectRequestBodyBytes)
            + "\",\"password\":\"p\",\"token_type\":2}";
        Assert.False(AllowsConnect("HoYoLAB", login, "POST", oversized));
        Assert.False(AllowsConnect("HoYoLAB", login, "OPTIONS", "{}"));
        Assert.False(AllowsConnect(
            "HoYoLAB",
            "https://passport-api-eu.hoyoverse.com/account/ma-passport/api/getSwitchStatus?app_id=c9oqaq3s3gu8&platform=4",
            "GET",
            "{}"));
    }

    [Fact]
    public void Hsr_snapshot_retains_reserve_and_recovery_information()
    {
        Assert.True(PublisherAccountCatalog.TryParseResourceResponse(
            "hsr",
            Encoding.UTF8.GetBytes("""{"retcode":0,"data":{"current_stamina":221,"max_stamina":300,"stamina_recover_time":23700,"current_reserve_stamina":840}}"""),
            DateTimeOffset.Parse("2026-07-21T12:00:00Z"),
            out var snapshot));

        Assert.Equal(840, snapshot!.Reserve);
        Assert.Equal(23700, snapshot.RecoverySeconds);
    }

    [Fact]
    public void Claimed_today_projection_expires_on_the_next_calendar_day_without_a_timer()
    {
        var result = new DailyCheckInResult(
            "hsr",
            DailyCheckInState.Claimed,
            "Daily reward claimed.",
            DateTimeOffset.Parse("2026-07-21T23:55:00+02:00"));

        Assert.True(PublisherAccountPresentation.IsCurrentDayCheckIn(
            result,
            DateTimeOffset.Parse("2026-07-21T23:59:00+02:00")));
        Assert.False(PublisherAccountPresentation.IsCurrentDayCheckIn(
            result,
            DateTimeOffset.Parse("2026-07-22T00:01:00+02:00")));
    }

    [Fact]
    public async Task Repeated_clicks_join_one_in_flight_operation()
    {
        var singleFlight = new PublisherSingleFlight<int>();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        async Task<int> Work(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref calls);
            await release.Task.WaitAsync(cancellationToken);
            return 42;
        }

        var first = singleFlight.RunAsync(Work, CancellationToken.None);
        var second = singleFlight.RunAsync(Work, CancellationToken.None);

        Assert.Equal(1, Volatile.Read(ref calls));
        release.SetResult();
        Assert.Equal(42, await first);
        Assert.Equal(42, await second);
    }

    [Fact]
    public async Task Canceling_one_observer_does_not_cancel_shared_publisher_work()
    {
        var singleFlight = new PublisherSingleFlight<int>();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var operationWasCanceled = false;
        async Task<int> Work(CancellationToken cancellationToken)
        {
            try
            {
                await release.Task.WaitAsync(cancellationToken);
                return 7;
            }
            catch (OperationCanceledException)
            {
                operationWasCanceled = true;
                throw;
            }
        }

        var owner = singleFlight.RunAsync(Work, CancellationToken.None);
        using var observerCancellation = new CancellationTokenSource();
        var observer = singleFlight.RunAsync(Work, CancellationToken.None, observerCancellation.Token);
        observerCancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => observer);
        Assert.False(operationWasCanceled);
        release.SetResult();
        Assert.Equal(7, await owner);
    }

    [Fact]
    public async Task Completed_results_are_not_reused_by_a_later_click()
    {
        var singleFlight = new PublisherSingleFlight<int>();
        var calls = 0;
        Task<int> Work(CancellationToken _) => Task.FromResult(Interlocked.Increment(ref calls));

        Assert.Equal(1, await singleFlight.RunAsync(Work, CancellationToken.None));
        Assert.Equal(2, await singleFlight.RunAsync(Work, CancellationToken.None));
        Assert.Equal(2, calls);
    }

    [Fact]
    public void Advanced_or_canceled_generation_cannot_publish()
    {
        var generation = new PublisherGeneration();
        var first = generation.Current;
        Assert.True(generation.CanPublish(first));

        generation.Advance();
        Assert.False(generation.CanPublish(first));
        Assert.True(generation.CanPublish(generation.Current));

        using var canceled = new CancellationTokenSource();
        canceled.Cancel();
        Assert.False(generation.CanPublish(generation.Current, canceled.Token));
    }

    [Theory]
    [InlineData(PublisherConnectionState.NotConnected, PublisherConnectionState.NotConnected)]
    [InlineData(PublisherConnectionState.Connecting, PublisherConnectionState.NotConnected)]
    [InlineData(PublisherConnectionState.Connected, PublisherConnectionState.Connected)]
    [InlineData(PublisherConnectionState.LoginRequired, PublisherConnectionState.LoginRequired)]
    [InlineData(PublisherConnectionState.NeedsReview, PublisherConnectionState.NeedsReview)]
    public void Canceled_connect_has_one_deterministic_non_connecting_terminal_write(
        PublisherConnectionState previous,
        PublisherConnectionState expected)
    {
        var generation = new PublisherGeneration();
        var profile = new PublisherProfileMutationJournal();
        var authority = new PublisherConnectCancellationAuthority(
            generation.Current,
            previous,
            profile.Capture());

        Assert.True(authority.TryConsume(generation.Current, profile.Capture(), out var terminal));
        Assert.Equal(expected, terminal);
        Assert.NotEqual(PublisherConnectionState.Connecting, terminal);
        Assert.False(authority.TryConsume(generation.Current, profile.Capture(), out _));
    }

    [Fact]
    public void Stale_connect_cancellation_cannot_overwrite_a_newer_generation()
    {
        var generation = new PublisherGeneration();
        var profile = new PublisherProfileMutationJournal();
        var stale = new PublisherConnectCancellationAuthority(
            generation.Current,
            PublisherConnectionState.NotConnected,
            profile.Capture());
        generation.Advance();
        var current = new PublisherConnectCancellationAuthority(
            generation.Current,
            PublisherConnectionState.LoginRequired,
            profile.Capture());

        Assert.False(stale.TryConsume(generation.Current, profile.Capture(), out _));
        Assert.True(current.TryConsume(generation.Current, profile.Capture(), out var terminal));
        Assert.Equal(PublisherConnectionState.LoginRequired, terminal);
    }

    [Fact]
    public void Canceled_connect_after_persistent_profile_use_cannot_restore_old_connected_state()
    {
        var generation = new PublisherGeneration();
        var profile = new PublisherProfileMutationJournal();
        var authority = new PublisherConnectCancellationAuthority(
            generation.Current,
            PublisherConnectionState.Connected,
            profile.Capture());

        profile.MarkMayHaveChanged();

        Assert.True(authority.TryConsume(generation.Current, profile.Capture(), out var terminal));
        Assert.Equal(PublisherConnectionState.NeedsReview, terminal);
    }

    [Fact]
    public void Profile_deletion_is_an_irreversible_disconnect_commit_even_after_cancellation()
    {
        var profile = new PublisherProfileMutationJournal();
        var beforeDeletion = profile.Capture();

        Assert.False(PublisherProfileCommitPolicy.MustCommitDeletedProfile(
            beforeDeletion,
            profile.Capture()));
        Assert.False(PublisherProfileCommitPolicy.TryGetInterruptedDisconnectState(
            beforeDeletion,
            profile.Capture(),
            out _));

        profile.MarkDeleted();
        var afterDeletion = profile.Capture();

        Assert.True(PublisherProfileCommitPolicy.MustCommitDeletedProfile(
            beforeDeletion,
            afterDeletion));
        Assert.True(PublisherProfileCommitPolicy.TryGetInterruptedDisconnectState(
            beforeDeletion,
            afterDeletion,
            out var disconnectTerminal));
        Assert.Equal(PublisherConnectionState.NotConnected, disconnectTerminal);
        Assert.Equal(
            PublisherConnectionState.NotConnected,
            PublisherProfileCommitPolicy.ForCanceledConnect(
                PublisherConnectionState.Connected,
                beforeDeletion,
                afterDeletion));
    }

    [Fact]
    public void Partially_changed_profile_cannot_keep_connected_state_after_interrupted_disconnect()
    {
        var profile = new PublisherProfileMutationJournal();
        var beforeChange = profile.Capture();
        profile.MarkMayHaveChanged();
        var afterChange = profile.Capture();

        Assert.True(PublisherProfileCommitPolicy.TryGetInterruptedDisconnectState(
            beforeChange,
            afterChange,
            out var terminal));
        Assert.Equal(PublisherConnectionState.NeedsReview, terminal);
        Assert.False(PublisherProfileCommitPolicy.MustCommitDeletedProfile(beforeChange, afterChange));
    }

    [Fact]
    public void Browser_uses_exact_response_capture_and_never_a_generic_claim_search()
    {
        var browser = ReadAppFile("PublisherSessionWindow.xaml.cs");
        var service = ReadAppFile("PublisherAccountService.cs");

        Assert.Contains("WebResourceResponseReceived", browser, StringComparison.Ordinal);
        Assert.Contains("TryGetResourceBinding", browser, StringComparison.Ordinal);
        Assert.Contains("ParseResourceResponse", browser, StringComparison.Ordinal);
        Assert.Contains("Array.Clear(body)", browser, StringComparison.Ordinal);
        Assert.Contains("Array.Clear(buffer)", browser, StringComparison.Ordinal);
        Assert.Contains("IsExactCheckInResponseUri", browser, StringComparison.Ordinal);
        Assert.Contains("ClassifyCheckInResponse", browser, StringComparison.Ordinal);
        Assert.Contains("ExpectedDate", browser, StringComparison.Ordinal);
        Assert.Contains("IsExactSkportSessionProbeUri", browser, StringComparison.Ordinal);
        Assert.Contains("ClassifySkportSessionResponse", browser, StringComparison.Ordinal);
        Assert.DoesNotContain("IsSuccessfulSkportSessionProbe", browser, StringComparison.Ordinal);
        Assert.Contains("core.Reload()", browser, StringComparison.Ordinal);
        Assert.Contains("AddWebResourceRequestedFilter", browser, StringComparison.Ordinal);
        Assert.Contains("Core_WebResourceRequested", browser, StringComparison.Ordinal);
        Assert.Contains("SensitiveRequestBodyStream", browser, StringComparison.Ordinal);
        Assert.Contains("var requestContent = args.Request.Content", browser, StringComparison.Ordinal);
        Assert.Contains("(hadContent && body is null)", browser, StringComparison.Ordinal);
        Assert.Contains("if (hadContent)", browser, StringComparison.Ordinal);
        Assert.DoesNotContain("IsConnectProfileMutationRequest", browser, StringComparison.Ordinal);
        var connectProfileBoundary = browser.IndexOf(
            "profileMutationJournal!.MarkMayHaveChanged();",
            StringComparison.Ordinal);
        var profileNavigation = browser.IndexOf("await NavigateAsync(initialUri", StringComparison.Ordinal);
        Assert.True(connectProfileBoundary >= 0 && connectProfileBoundary < profileNavigation);
        Assert.DoesNotContain(
            "TryGetBoundedString",
            ReadCoreAccountFile("PublisherAccountContracts.cs"),
            StringComparison.Ordinal);
        Assert.Contains("claimWriteAuthority.Arm", browser, StringComparison.Ordinal);
        Assert.Contains("PublisherSessionPurpose.Resource", browser, StringComparison.Ordinal);
        Assert.Contains("The publisher session purpose is already fixed.", browser, StringComparison.Ordinal);
        Assert.Contains("capture.Authority.TryReserve", browser, StringComparison.Ordinal);
        Assert.Contains("403", browser, StringComparison.Ordinal);
        Assert.Contains("PCCalendarTodayBg.510de0.png", browser, StringComparison.Ordinal);
        Assert.Contains("MobileCalendarTodayBg.5f4677.png", browser, StringComparison.Ordinal);
        Assert.Contains("if (!windowClosed) Close()", browser, StringComparison.Ordinal);
        Assert.DoesNotContain("document.body?.innerText", browser, StringComparison.Ordinal);
        Assert.DoesNotContain("querySelectorAll('button", browser, StringComparison.Ordinal);
        Assert.DoesNotContain("[role=button]", browser, StringComparison.Ordinal);
        Assert.Contains("PublisherSingleFlight", service, StringComparison.Ordinal);
        Assert.Contains("resourceSingleFlights", service, StringComparison.Ordinal);
        Assert.Contains("CanPublish", service, StringComparison.Ordinal);
        Assert.Contains("if (!allProviderWorkStopped) return;", service, StringComparison.Ordinal);
        Assert.Contains("ownsHoyoProfile && !hoyoQuarantined", service, StringComparison.Ordinal);
        Assert.DoesNotContain("checkInGate.WaitAsync(0", service, StringComparison.Ordinal);
        Assert.Contains("RunProviderCheckInsAsync(\"SKPORT\", [\"ae\"]", service, StringComparison.Ordinal);
        Assert.Contains("AcquireProfileOwnership(\"SKPORT\")", service, StringComparison.Ordinal);
        Assert.Contains("resourceRead.Outcome", service, StringComparison.Ordinal);
        Assert.Contains("PublisherAccountStatePolicy.ForResourceRead", service, StringComparison.Ordinal);
        Assert.Contains("TrySetCanceledConnectState", service, StringComparison.Ordinal);
        Assert.Contains("BeginRotatedOperation", service, StringComparison.Ordinal);
        Assert.Contains("ProfileAccessAllowedAfterGate", service, StringComparison.Ordinal);
        Assert.True(CountOccurrences(service, "if (!ProfileAccessAllowedAfterGate(") >= 4);
        Assert.Contains("profileMutations.MarkDeleted", service, StringComparison.Ordinal);
        Assert.Contains("profileMutations.MarkMayHaveChanged", service, StringComparison.Ordinal);
        Assert.Contains("CommitDeletedProfile", service, StringComparison.Ordinal);
        Assert.Contains("CommitInterruptedDisconnectIfNeeded", service, StringComparison.Ordinal);
        Assert.DoesNotContain("operation.Cancellation.Token.ThrowIfCancellationRequested();", service, StringComparison.Ordinal);
        Assert.Contains("DailyCheckInState.LoginNeeded", service, StringComparison.Ordinal);
        Assert.Contains("PublisherConnectionState.LoginRequired", service, StringComparison.Ordinal);
        Assert.Contains("if (provider != \"SKPORT\")", browser, StringComparison.Ordinal);
        Assert.Contains("ResolveProfilePath(provider)", service, StringComparison.Ordinal);
        Assert.True(
            service.IndexOf("var sessionProof = await window.GetSessionProofAsync", StringComparison.Ordinal)
            < service.IndexOf("result = await window.RunCheckInAsync", StringComparison.Ordinal));
    }

    [Fact]
    public void App_shutdown_awaits_secret_bearing_providers_without_blocking_UI_continuations()
    {
        var app = ReadAppFile("App.xaml.cs");

        Assert.Contains("_window.AppWindow.Closing += AppWindow_Closing", app, StringComparison.Ordinal);
        Assert.Contains("private void AppWindow_Closing", app, StringComparison.Ordinal);
        Assert.Contains("args.Cancel = true", app, StringComparison.Ordinal);
        Assert.Contains("DisposeWuWaAccountStatusAsync(_wuwaAccountStatus)", app, StringComparison.Ordinal);
        Assert.Contains("DisposePublisherAccountsAsync(_publisherAccounts)", app, StringComparison.Ordinal);
        Assert.Contains("await Task.WhenAll(wuwaAccountShutdown, publisherAccountShutdown)", app, StringComparison.Ordinal);
        Assert.Contains("_accountShutdownComplete = true", app, StringComparison.Ordinal);
        Assert.DoesNotContain("publisherAccounts.DisposeAsync().AsTask().GetAwaiter().GetResult()", app, StringComparison.Ordinal);
        Assert.DoesNotContain("accountStatus.DisposeAsync().AsTask().GetAwaiter().GetResult()", app, StringComparison.Ordinal);
    }

    private static string ReadAppFile(string fileName) =>
        File.ReadAllText(Path.Combine(FindWorkspaceRoot(), "Desktop", "src", "Nyx.Desktop.App", fileName));

    private static string ReadCoreAccountFile(string fileName) =>
        File.ReadAllText(Path.Combine(
            FindWorkspaceRoot(),
            "Desktop",
            "src",
            "Nyx.Desktop.Core",
            "AccountStatus",
            fileName));

    private static int CountOccurrences(string value, string fragment)
    {
        var count = 0;
        var start = 0;
        while ((start = value.IndexOf(fragment, start, StringComparison.Ordinal)) >= 0)
        {
            count++;
            start += fragment.Length;
        }
        return count;
    }

    private static bool AllowsConnect(
        string provider,
        string value,
        string method,
        string? json = null,
        string contentType = "application/json",
        string? gameId = null) =>
        PublisherAccountCatalog.IsAllowedWebResourceRequest(
            provider,
            PublisherSessionPurpose.Connect,
            gameId ?? (provider == "HoYoLAB" ? "gi" : "ae"),
            new Uri(value),
            method,
            PublisherWebResourceContext.Fetch,
            requestBody: json is null ? null : Encoding.UTF8.GetBytes(json),
            contentType: json is null ? null : contentType);

    private static string FindWorkspaceRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
        {
            if (File.Exists(Path.Combine(current.FullName, "AGENTS.md"))
                && Directory.Exists(Path.Combine(current.FullName, "Desktop")))
                return current.FullName;
        }
        throw new DirectoryNotFoundException("Could not locate the Nyx workspace root.");
    }

    private static PublisherCheckInProof ParseProof(string gameId, string method, string json) =>
        PublisherAccountCatalog.ParseCheckInResponse(
            gameId,
            method,
            Encoding.UTF8.GetBytes(json),
            new DateOnly(2026, 7, 21),
            DateTimeOffset.Parse("2026-07-21T12:00:00Z"));
}
