import unittest
from unittest.mock import AsyncMock, Mock

from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from mobile_feedback import router, digest
from mobile_workflow_api import weekly_summary
from modernbert_chunking import aggregate, LABELS

SCORES = dict(Joy=0, Sadness=60, Anger=10, Fear=30, Anticipation=0, Surprise=0, Disgust=0, Trust=0)
RAW = "今天報告受到批評，覺得有點委屈，現在只想被傾聽。"
CONTEXT = dict(event_context="報告受到批評。", emotional_context="有點委屈。", main_concern="希望被理解。", coping_already_tried="未提及", support_preference="只想被傾聽。")
TRACE = dict(execution="on-device", runtime="llama.rn@0.13.0-rc.9", model="qwen3.5-4b-q4_k_m",
             sha256="a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50",
             tokens_predicted=10, duration_ms=200., tokens_per_second=50., stopped_eos=True, raw_text='{"comfort":"unit test"}')
DAY = "2026-11-06"


class WeeklySummaryTests(unittest.TestCase):
    def test_week_requires_both_sunday_to_finish_and_seven_analyzed_days(self):
        days = [{"date_label": f"2026-05-{day}", "scores": {"Joy": 0.6}} for day in range(11, 18)]
        self.assertFalse(weekly_summary("2026-05-11", days, closed=False)["week_ready"])
        self.assertFalse(weekly_summary("2026-05-11", days[:-1], closed=True)["week_ready"])
        self.assertTrue(weekly_summary("2026-05-11", days, closed=True)["week_ready"])

    def test_legacy_daily_scores_show_up_but_unclassified_days_stay_empty(self):
        review = weekly_summary("2026-05-11", [
            {"date_label": "2026-05-11", "scores": {"Joy": 0.6}},
            {"date_label": "2026-05-12", "scores": {"Joy": 0.7}, "classification_available": True},
            {"date_label": "2026-05-12", "scores": {"Joy": 0.7}, "classification_available": False},
            {"date_label": "2026-05-13", "scores": {"Joy": 0}},
            {"date_label": "2026-05-15", "scores": {"Trust": 1}, "classification_available": True},
        ])
        self.assertEqual(review["analyzed_days"], 2)
        self.assertEqual([day["date"] for day in review["days"] if day["status"] == "analyzed"],
                         ["2026-05-11", "2026-05-15"])
        self.assertEqual(review["days"][0]["analysis"]["scores"], {"Joy": 0.6})


class MobileApiTests(unittest.TestCase):
    def setUp(self):
        self.uid = "test-user-a"
        async def user(authorization: str | None = Header(default=None)):
            if authorization != "Bearer test-session":
                raise HTTPException(401, "Authentication required")
            return self.uid
        self.save = AsyncMock(return_value={"synced": True})
        analysis = aggregate([{"index": 0, "start_token": 0, "end_token": 1, "effective_tokens": 1, "input_ids": [1, 2, 3]}],
                             [[SCORES[k.title()] / 100 for k in LABELS]], list(LABELS))
        self.classifier = Mock(return_value={"backend": "modernbert", "available": True, **analysis})
        self.require_final = AsyncMock(side_effect=lambda uid, day, content: digest(content))
        app = FastAPI()
        app.include_router(router(user, self.save, "unit-test-secret-only", self.classifier, self.require_final))
        self.client = TestClient(app, headers={"Authorization": "Bearer test-session"})

    def prepare(self, text=RAW):
        return self.client.post("/mobile/emotions", json={"content": text, "date_label": DAY})

    def payload(self, text=RAW):
        data = self.prepare(text).json()
        return {"content": text, "entry_id": "phone_test_12345", "kind": "daily", "date_label": DAY,
                "receipt_token": data["receipt_token"], "support": {"status": "completed", "comfort": "這份委屈可以慢慢說。",
                "suggestions": [], "blessing": "", "risk_level": "none", "response_mode": "SUPPORT_MODE", "safety_action": "none", "context": CONTEXT, "generation": TRACE}}

    def test_classification_only_returns_real_provider_scores_and_signed_receipt(self):
        response = self.prepare()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["scores"], SCORES)
        self.assertTrue(response.json()["receipt_token"])
        self.classifier.assert_called_once_with(RAW)
        self.save.assert_not_called()

    def test_fragment_never_classifies_and_syncs_without_a_receipt(self):
        payload = self.payload()
        self.classifier.reset_mock(); self.require_final.reset_mock()
        payload.update(kind="fragment", date_label=None, receipt_token=None)
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 200)
        self.assertIsNone(self.save.await_args.args[2]["scores"])
        self.classifier.assert_not_called(); self.require_final.assert_not_called()
        payload["receipt_token"] = "forbidden"
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 422)

    def test_classification_requires_a_daily_date_and_confirmed_revision(self):
        self.assertEqual(self.client.post("/mobile/emotions", json={"content": RAW}).status_code, 422)
        self.require_final.side_effect = HTTPException(409, "not finalized")
        self.assertEqual(self.prepare().status_code, 409)
        self.classifier.assert_not_called()

    def test_authentication_is_required(self):
        self.assertEqual(self.client.post("/mobile/emotions", json={"content": RAW}, headers={"Authorization": ""}).status_code, 401)
        self.classifier.assert_not_called()

    def test_high_risk_skips_classifier_without_fabricating_scores(self):
        r = self.prepare("這是合成測試：我今晚想結束生命。")
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json()["scores"])
        self.assertEqual(r.json()["risk_floor"], "high")
        self.classifier.assert_not_called()

    def test_invalid_or_unavailable_model_is_not_replaced_with_another_classifier(self):
        for result in [{"available": False}, {"available": True, "backend": "other", "scores": SCORES}, {"available": True, "backend": "modernbert", "scores": {**SCORES, "Joy": 99}}]:
            self.classifier.return_value = result
            self.assertEqual(self.prepare().status_code, 503)

    def test_commit_uses_receipt_scores_and_rejects_score_replacement(self):
        payload = self.payload()
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 200)
        self.assertEqual(self.save.await_args.args[2]["scores"], SCORES)
        payload["scores"] = {**SCORES, "Joy": 100}
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 422)

    def test_commit_records_2b_and_rejects_another_models_digest(self):
        payload = self.payload()
        payload["support"]["generation"] = {**TRACE, "model": "qwen3.5-2b-q4_k_m"}
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 422)
        self.save.assert_not_called()

        payload["support"]["generation"]["sha256"] = "20cb277f0967ace47b0b5d5658e5e494a88937f7378b74b5a266496400938f4c"
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 200)
        saved = self.save.await_args.args[2]
        self.assertEqual(saved["inference_source"], "phone-qwen3.5-2b")
        self.assertEqual(saved["generation"]["model"], "qwen3.5-2b-q4_k_m")

    def test_receipt_is_bound_to_the_original_diary_and_user(self):
        payload = self.payload(); payload["content"] += "內容改了"
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 409)
        payload = self.payload(); self.uid = "test-user-b"
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 409)
        self.save.assert_not_called()

    def test_rule_risk_cannot_be_downgraded_by_phone(self):
        self.assertEqual(self.client.post("/mobile/diaries", json=self.payload("今天我覺得我很沒用。想把經過記下來。")).status_code, 422)
        self.save.assert_not_called()

    def test_high_risk_commit_uses_fixed_support_and_no_classifier_scores(self):
        payload = self.payload("這是合成測試：我今晚想結束生命。")
        payload["support"].update(status="local_safety", risk_level="high", response_mode="SAFE_MODE", safety_action="urgent_help", context=None, generation=None, comfort="untrusted generated response")
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 200)
        result = self.save.await_args.args[2]
        self.assertIsNone(result["scores"])
        self.assertNotIn("untrusted", result["comfort"])
        self.assertEqual(result["inference_source"], "fixed-safety")

    def test_failed_check_cannot_be_committed_as_completed(self):
        payload = self.payload(); payload["support"]["status"] = "unavailable"
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 422)
        payload = self.payload(); payload["receipt_token"] = None
        self.assertEqual(self.client.post("/mobile/diaries", json=payload).status_code, 409)
        self.save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
