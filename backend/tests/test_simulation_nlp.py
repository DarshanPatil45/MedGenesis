"""Natural-language what-if parser (docs/ARCHITECTURE.md §4.5). Deterministic
by design, so every case here is exact-value, not fuzzy.

Note on FLAG_TOPICS (activity_minutes_delta, smoker_delta): these act on
binary flags in the trained model (see simulation_rules.py, and
docs/ARCHITECTURE.md §13.7 for why — the CDC BRFSS dataset records physical
activity and smoking as yes/no survey answers, not continuous quantities).
Only the SIGN the parser extracts matters for these two; there is no
magnitude to default or convert, unlike weight_kg_delta/bmi_delta."""

from app.agents.simulation_nlp import parse


def test_the_exact_example_phrase_from_the_design_doc():
    result = parse("what if I lost weight and exercised more")
    assert result.recognized
    assert result.hypothesis["weight_kg_delta"] < 0
    assert result.hypothesis["activity_minutes_delta"] > 0
    # Weight has no explicit amount, so its default must be disclosed. There
    # is nothing to default for the flag-style activity topic — the phrase
    # itself ("exercised more") fully specifies the change.
    assert any("weight" in n.lower() and "default" in n.lower() for n in result.notes)


def test_explicit_weight_loss_amount():
    result = parse("what if I lost 6 kg")
    assert result.recognized
    assert result.hypothesis["weight_kg_delta"] == -6.0
    # A default note is still expected for the unspecified horizon — only
    # the weight amount was explicit here.
    assert not any("weight" in n.lower() and "default" in n.lower() for n in result.notes)


def test_explicit_weight_gain_is_positive():
    result = parse("what if I gained 4 kg")
    assert result.recognized
    assert result.hypothesis["weight_kg_delta"] == 4.0


def test_pounds_converted_to_kg():
    result = parse("what if I lost 11 lbs")
    assert result.recognized
    assert result.hypothesis["weight_kg_delta"] == round(-11 * 0.453592, 1)
    assert any("lb" in n.lower() for n in result.notes)


def test_bmi_delta():
    result = parse("what if my bmi dropped by 3")
    assert result.recognized
    assert result.hypothesis["bmi_delta"] == -3.0


def test_smoker_delta_quit():
    result = parse("what if I quit smoking")
    assert result.recognized
    assert result.hypothesis["smoker_delta"] < 0


def test_smoker_delta_start():
    result = parse("what if I started smoking")
    assert result.recognized
    assert result.hypothesis["smoker_delta"] > 0


def test_smoker_delta_via_cigarette_phrasing():
    result = parse("what if I stopped cigarettes")
    assert result.recognized
    assert result.hypothesis["smoker_delta"] < 0


def test_flag_topics_have_no_magnitude_to_default():
    """Unlike weight/BMI, there's nothing to disclose a default for — the
    direction word alone ('quit', 'started') fully specifies the change."""
    result = parse("what if I quit smoking")
    assert not any("smok" in n.lower() and "default" in n.lower() for n in result.notes)


def test_activity_minutes_phrase_only_carries_sign():
    result = parse("what if I exercised 45 more minutes a week")
    assert result.recognized
    assert result.hypothesis["activity_minutes_delta"] > 0


def test_activity_negative_direction():
    result = parse("what if I exercised less")
    assert result.recognized
    assert result.hypothesis["activity_minutes_delta"] < 0


def test_horizon_in_weeks():
    result = parse("what if I lost 5 kg over 8 weeks")
    assert result.hypothesis["horizon_weeks"] == 8


def test_horizon_in_months_converted_to_weeks():
    result = parse("what if I lost 5 kg over 3 months")
    assert result.hypothesis["horizon_weeks"] == round(3 * 4.345)


def test_horizon_defaults_to_12_weeks_when_unspecified():
    result = parse("what if I lost 5 kg")
    assert result.hypothesis["horizon_weeks"] == 12
    assert any("12 weeks" in n for n in result.notes)


def test_horizon_number_is_not_mistaken_for_a_magnitude():
    """Regression guard: the horizon phrase is stripped BEFORE per-clause
    parsing. Without that ordering, "12" here could be misread as part of
    the activity clause instead of a duration."""
    result = parse("what if I exercised more over 12 weeks")
    assert result.recognized
    assert result.hypothesis["horizon_weeks"] == 12
    assert result.hypothesis["activity_minutes_delta"] > 0


def test_multiple_topics_combined():
    result = parse("what if I lost 5 kg and quit smoking over 6 weeks")
    assert result.hypothesis["weight_kg_delta"] == -5.0
    assert result.hypothesis["smoker_delta"] < 0
    assert result.hypothesis["horizon_weeks"] == 6


def test_ambiguous_direction_is_not_guessed():
    """Both a positive and a negative stem appear in the same clause for the
    same topic — the parser must not pick a side."""
    result = parse("what if my weight went up and down")
    assert not result.recognized


def test_topic_with_no_direction_word_is_skipped():
    result = parse("what if I changed my diet")
    assert not result.recognized
    assert "preset" in result.message.lower() or "custom" in result.message.lower()


def test_completely_unrelated_text_is_unrecognized():
    result = parse("what if I became a doctor")
    assert not result.recognized
    assert result.hypothesis == {}


def test_empty_string_is_unrecognized():
    result = parse("")
    assert not result.recognized


def test_whitespace_only_is_unrecognized():
    result = parse("   ")
    assert not result.recognized


def test_case_and_punctuation_do_not_matter():
    a = parse("What if I lost 5kg over 12 weeks?")
    b = parse("what if i lost 5kg over 12 weeks")
    assert a.hypothesis == b.hypothesis


def test_deterministic():
    a = parse("what if I lost weight and exercised more")
    b = parse("what if I lost weight and exercised more")
    assert a.hypothesis == b.hypothesis and a.notes == b.notes


def test_recognized_message_names_the_understood_topics():
    result = parse("what if I lost 5 kg")
    assert result.recognized
    assert "weight" in result.message.lower()
