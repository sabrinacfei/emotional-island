import unittest
from modernbert_chunking import LABELS, aggregate, tokenize_chunks


class FakeTokenizer:
    def num_special_tokens_to_add(self, pair=False):
        return 2

    def __call__(self, text, add_special_tokens=True, **kwargs):
        tokens = list(range(len(text)))
        if not add_special_tokens:
            return {"input_ids": tokens}
        stride = kwargs.get("stride", 0)
        starts = [0]
        while starts[-1] + 126 < len(tokens):
            starts.append(starts[-1] + 126 - stride)
        groups = [tokens[i:i + 126] for i in starts]
        return {"input_ids": [[1000] + g + [1001] for g in groups],
                "attention_mask": [[1] * (len(g) + 2) for g in groups],
                "special_tokens_mask": [[1] + [0] * len(g) + [1] for g in groups]}


class ChunkTests(unittest.TestCase):
    def test_overlap_counts_each_original_token_once_in_aggregation(self):
        chunks = tokenize_chunks("字" * 253, FakeTokenizer())
        result = aggregate(chunks, [[1.] + [0.] * 7] * len(chunks), list(LABELS))
        self.assertEqual([(c["start_token"], c["end_token"]) for c in chunks], [(0,126),(94,220),(188,253)])
        self.assertAlmostEqual(sum(c['aggregation_weight'] for c in result['chunks']),253)
        self.assertEqual(result['scores']['Anger'],100)

    def test_all_tokens_covered_without_overlap_and_special_tokens_excluded(self):
        chunks = tokenize_chunks("字" * 253, FakeTokenizer(), overlap_tokens=0)
        self.assertEqual([c["effective_tokens"] for c in chunks], [126, 126, 1])
        self.assertEqual([(c["start_token"], c["end_token"]) for c in chunks], [(0, 126), (126, 252), (252, 253)])
        self.assertTrue(all(len(c["input_ids"]) <= 128 for c in chunks))

    def test_boundary_lengths_and_empty_input(self):
        for size, count in [(1, 1), (126, 1), (127, 2), (252, 2)]:
            self.assertEqual(len(tokenize_chunks("字" * size, FakeTokenizer(), overlap_tokens=0)), count)
        with self.assertRaises(ValueError):
            tokenize_chunks(" ", FakeTokenizer(), overlap_tokens=0)

    def test_token_weighted_mean_is_not_unweighted_chunk_mean(self):
        chunks = tokenize_chunks("字" * 127, FakeTokenizer(), overlap_tokens=0)
        result = aggregate(chunks, [[1.] + [0.] * 7, [0., 1.] + [0.] * 6], list(LABELS))
        self.assertAlmostEqual(result["probabilities"]["Anger"], 126 / 127)
        self.assertAlmostEqual(result["probabilities"]["Anticipation"], 1 / 127)
        self.assertEqual(sum(result["scores"].values()), 100)
        self.assertEqual(len(result["top_3"]), 3)
        self.assertEqual(result["chunks"][1]["effective_tokens"], 1)
        self.assertFalse(result["truncated"])

    def test_single_chunk_preserves_the_model_probabilities(self):
        row = [.01, .02, .03, .04, .5, .2, .1, .1]
        result = aggregate(tokenize_chunks("短文", FakeTokenizer(), overlap_tokens=0), [row], list(LABELS))
        self.assertAlmostEqual(result["probabilities"]["Joy"], .5)
        self.assertEqual(result["top_emotion"], "Joy")

    def test_wrong_labels_nan_and_invalid_distributions_are_rejected(self):
        chunks = tokenize_chunks("短文", FakeTokenizer(), overlap_tokens=0)
        for labels, row in [(list(reversed(LABELS)), [.125] * 8), (list(LABELS), [float('nan')] * 8), (list(LABELS), [1.] * 8)]:
            with self.assertRaises(ValueError):
                aggregate(chunks, [row], labels)


if __name__ == '__main__':
    unittest.main()
