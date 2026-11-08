import Foundation
import CoreML
import CryptoKit

enum PhoneClassifierError: Error, LocalizedError {
  case invalid(String)
  var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
}

func classifierSHA256(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// The exact frozen NFC + GPT-2 byte-level BPE tokenizer, without a server call.
final class ModernBERTTokenizer {
  private let vocabulary: [String: Int]
  private var ranks: [String: Int] = [:]
  private var byteEncoder: [UInt8: String] = [:]
  private let words: NSRegularExpression
  private let addedMatcher: NSRegularExpression
  private var added: [String: (id: Int, lstrip: Bool)] = [:]
  private var cache: [String: [Int]] = [:]

  init(data: Data) throws {
    guard let config = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let model = config["model"] as? [String: Any], model["type"] as? String == "BPE",
          let vocabulary = model["vocab"] as? [String: Int], let merges = model["merges"] as? [[String]],
          let normalizer = config["normalizer"] as? [String: Any], normalizer["type"] as? String == "NFC",
          let pre = config["pre_tokenizer"] as? [String: Any], pre["type"] as? String == "ByteLevel",
          pre["add_prefix_space"] as? Bool == false, pre["use_regex"] as? Bool == true,
          let addedTokens = config["added_tokens"] as? [[String: Any]] else {
      throw PhoneClassifierError.invalid("分類模型 tokenizer 設定不符。")
    }
    self.vocabulary = vocabulary
    for (rank, pair) in merges.enumerated() {
      guard pair.count == 2 else { throw PhoneClassifierError.invalid("分類詞彙合併規則不完整。") }
      ranks[pair[0] + "\0" + pair[1]] = rank
    }
    var bytes = Array(33...126) + Array(161...172) + Array(174...255)
    var codes = bytes; var extra = 0
    for byte in 0...255 where !bytes.contains(byte) { bytes.append(byte); codes.append(256 + extra); extra += 1 }
    for (byte, code) in zip(bytes, codes) { byteEncoder[UInt8(byte)] = String(UnicodeScalar(code)!) }
    for token in addedTokens {
      guard let content = token["content"] as? String, let id = token["id"] as? Int,
            token["rstrip"] as? Bool == false else { throw PhoneClassifierError.invalid("分類特殊詞彙設定不符。") }
      added[content] = (id, token["lstrip"] as? Bool ?? false)
    }
    let addedDefinitions = added
    let pattern = addedDefinitions.keys.sorted { $0.utf16.count > $1.utf16.count }.map {
      (addedDefinitions[$0]!.lstrip ? "\\s*" : "") + NSRegularExpression.escapedPattern(for: $0)
    }.joined(separator: "|")
    addedMatcher = try NSRegularExpression(pattern: pattern)
    words = try NSRegularExpression(pattern: "'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+")
  }

  func encode(_ text: String) throws -> [Int] {
    let normalized = text.precomposedStringWithCanonicalMapping
    let source = normalized as NSString
    var cursor = 0; var result: [Int] = []
    for match in addedMatcher.matches(in: normalized, range: NSRange(location: 0, length: source.length)) {
      let value = source.substring(with: match.range)
      let token = added[value] ?? added.first(where: { $0.value.lstrip && value.hasSuffix($0.key) })?.value
      guard let token else { throw PhoneClassifierError.invalid("分類特殊詞彙未知。") }
      var gap = source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
      if token.lstrip { gap = gap.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) }
      result += try encodeOrdinary(gap); result.append(token.id)
      cursor = NSMaxRange(match.range)
    }
    result += try encodeOrdinary(source.substring(from: cursor))
    return result
  }

  private func encodeOrdinary(_ text: String) throws -> [Int] {
    let source = text as NSString
    var result: [Int] = []
    for match in words.matches(in: text, range: NSRange(location: 0, length: source.length)) {
      let word = source.substring(with: match.range)
      if let cached = cache[word] { result += cached; continue }
      var parts = word.utf8.map { byteEncoder[$0]! }
      while parts.count > 1 {
        var bestRank = Int.max; var best: (String, String)?
        for i in 0..<(parts.count - 1) {
          if let rank = ranks[parts[i] + "\0" + parts[i+1]], rank < bestRank {
            bestRank = rank; best = (parts[i], parts[i+1])
          }
        }
        guard let pair = best else { break }
        var merged: [String] = []; var i = 0
        while i < parts.count {
          if i + 1 < parts.count && parts[i] == pair.0 && parts[i+1] == pair.1 {
            merged.append(parts[i] + parts[i+1]); i += 2
          } else { merged.append(parts[i]); i += 1 }
        }
        parts = merged
      }
      let ids = try parts.map { part -> Int in
        guard let id = vocabulary[part] else { throw PhoneClassifierError.invalid("分類詞彙表缺少字元。") }
        return id
      }
      if cache.count >= 4096 { cache.removeAll(keepingCapacity: true) }
      cache[word] = ids; result += ids
    }
    return result
  }
}

final class PhoneModernBERT {
  let manifest: [String: Any]
  let tokenizer: ModernBERTTokenizer
  private let modelURL: URL
  private static let fixedLabels = ["anger", "anticipation", "disgust", "fear", "joy", "sadness", "surprise", "trust"]
  private var labels: [String] { Self.fixedLabels }
  private var model: MLModel?

  init(assets: URL) throws {
    let manifestData = try Data(contentsOf: assets.appendingPathComponent("modernbert-manifest.json"))
    guard let manifest = try JSONSerialization.jsonObject(with: manifestData) as? [String: Any],
          manifest["labels"] as? [String] == Self.fixedLabels, manifest["max_input_tokens"] as? Int == 128,
          manifest["overlap_tokens"] as? Int == 32,
          let files = manifest["compiled_files"] as? [String: String], !files.isEmpty else {
      throw PhoneClassifierError.invalid("手機分類模型版本不符。")
    }
    let modelURL = assets.appendingPathComponent("ModernBERT.mlmodelc", isDirectory: true)
    for (relative, expected) in files {
      guard !relative.hasPrefix("/"), !relative.split(separator: "/").contains("..") else { throw PhoneClassifierError.invalid("模型路徑不符。") }
      let handle = try FileHandle(forReadingFrom: modelURL.appendingPathComponent(relative))
      defer { try? handle.close() }
      var hash = SHA256()
      while true {
        let count = try autoreleasepool { () throws -> Int in
          guard let data = try handle.read(upToCount: 4 * 1024 * 1024), !data.isEmpty else { return 0 }
          hash.update(data: data); return data.count
        }
        if count == 0 { break }
      }
      guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == expected else {
        throw PhoneClassifierError.invalid("手機分類模型檔案不完整。")
      }
    }
    let tokenData = try Data(contentsOf: assets.appendingPathComponent("modernbert-tokenizer.json"))
    guard classifierSHA256(tokenData) == manifest["tokenizer_sha256"] as? String else { throw PhoneClassifierError.invalid("分類詞彙檔案不完整。") }
    self.modelURL = modelURL; self.manifest = manifest; tokenizer = try ModernBERTTokenizer(data: tokenData)
  }

  func release() { model = nil }

  func classify(_ input: String) throws -> [String: Any] {
    let started = ProcessInfo.processInfo.systemUptime
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text.unicodeScalars.count <= 12000 else { throw PhoneClassifierError.invalid("日記內容長度不符。") }
    let tokens = try tokenizer.encode(text)
    guard !tokens.isEmpty, tokens.count <= 48000 else { throw PhoneClassifierError.invalid("分類 token 數量不符。") }
    var ranges: [(Int, Int)] = []; var start = 0
    while start < tokens.count {
      let end = min(start + 126, tokens.count); ranges.append((start,end))
      if end == tokens.count { break }; start = end - 32
    }
    guard ranges.count <= 512 else { throw PhoneClassifierError.invalid("分類片段數量超出上限。") }
    var coverage = [Int](repeating: 0, count: tokens.count)
    for (start,end) in ranges { for i in start..<end { coverage[i] += 1 } }
    var weights: [Double] = []
    for (start,end) in ranges { weights.append((start..<end).reduce(0.0) { $0 + 1.0 / Double(coverage[$1]) }) }
    let loadStarted = ProcessInfo.processInfo.systemUptime
    if model == nil {
      let config = MLModelConfiguration(); config.computeUnits = .cpuAndGPU
      model = try MLModel(contentsOf: modelURL, configuration: config)
    }
    let loadMS = (ProcessInfo.processInfo.systemUptime - loadStarted) * 1000
    defer { release() } // Keep no classifier weights resident while Qwen generates.
    var probabilities: [[Double]] = []
    for (start,end) in ranges {
      let row: [Double] = try autoreleasepool {
        let ids = try MLMultiArray(shape: [1,128], dataType: .int32)
        let mask = try MLMultiArray(shape: [1,128], dataType: .int32)
        let content = Array(tokens[start..<end]); let sequence = [50281] + content + [50282]
        for i in 0..<128 { ids[i] = NSNumber(value: i < sequence.count ? sequence[i] : 50283); mask[i] = NSNumber(value: i < sequence.count ? 1 : 0) }
        let features = try MLDictionaryFeatureProvider(dictionary: ["input_ids": ids, "attention_mask": mask])
        let output = try model!.prediction(from: features)
        guard let values = output.featureValue(for: "probabilities")?.multiArrayValue, values.count == 8 else { throw PhoneClassifierError.invalid("手機分類輸出不符。") }
        let row = (0..<8).map { values[$0].doubleValue }
        guard row.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }), abs(row.reduce(0,+)-1) < 0.0001 else { throw PhoneClassifierError.invalid("手機分類分布不合法。") }
        return row
      }
      probabilities.append(row)
    }
    var values = (0..<8).map { i in zip(weights,probabilities).reduce(0.0) { $0 + $1.0 * $1.1[i] } / Double(tokens.count) }
    let total = values.reduce(0,+); values = values.map { $0 / total }
    var scores = values.map { Int(floor($0 * 100)) }
    let remainders = (0..<8).sorted { a,b in
      let x = values[a] * 100 - Double(scores[a]), y = values[b] * 100 - Double(scores[b])
      return x == y ? a < b : x > y
    }
    for i in remainders.prefix(100 - scores.reduce(0,+)) { scores[i] += 1 }
    let order = (0..<8).sorted { values[$0] == values[$1] ? $0 < $1 : values[$0] > values[$1] }
    let keys = labels.map { $0.prefix(1).uppercased() + $0.dropFirst() }
    let chunks: [[String: Any]] = ranges.enumerated().map { index, range in
      ["index":index,"start_token":range.0,"end_token":range.1,"effective_tokens":range.1-range.0,
       "input_tokens":128,"aggregation_weight":weights[index],"overlap_tokens":index == 0 ? 0 : 32,
       "new_tokens":range.1 - (index == 0 ? 0 : ranges[index-1].1),
       "probabilities":Dictionary(uniqueKeysWithValues:zip(keys,probabilities[index]))]
    }
    let analysis: [String: Any] = ["probabilities":Dictionary(uniqueKeysWithValues:zip(keys,values)),
      "scores":Dictionary(uniqueKeysWithValues:zip(keys,scores)),
      "top_3":order.prefix(3).map { ["emotion":keys[$0],"probability":values[$0],"score":scores[$0]] as [String:Any] },
      "top_emotion":keys[order[0]],"top_probability":values[order[0]],"labels":labels,
      "token_count":tokens.count,"chunk_count":ranges.count,"chunks":chunks,"truncated":false,
      "aggregation":["method":"overlap_coverage_weighted_mean","overlap_tokens":32,
        "observed_overlap_tokens":ranges.count > 1 ? 32 : 0,"weighting":"inverse_token_coverage",
        "weight_sum":weights.reduce(0,+),"unique_content_tokens":tokens.count,
        "processed_content_tokens":ranges.reduce(0) { $0 + $1.1 - $1.0 },"max_input_tokens":128,
        "special_and_padding_tokens_in_weight":false]]
    let trace: [String: Any] = ["execution":"on-device","runtime":"coreml","model":manifest["model"]!,
      "model_sha256":manifest["model_sha256"]!,"tokenizer_sha256":manifest["tokenizer_sha256"]!,
      "input_sha256":classifierSHA256(Data(text.utf8)),"duration_ms":(ProcessInfo.processInfo.systemUptime-started)*1000,"load_ms":loadMS]
    return ["analysis":analysis,"trace":trace]
  }
}
