import Foundation

@main struct NativeClassifierCheck {
  static func main() throws {
    let args=CommandLine.arguments
    let assets=URL(fileURLWithPath:args[1])
    let fixtures=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[2]))) as! [[String:Any]]
    let tokenizer=try ModernBERTTokenizer(data:Data(contentsOf:assets.appendingPathComponent("modernbert-tokenizer.json")))
    for fixture in fixtures {
      let actual=try tokenizer.encode(fixture["text"] as! String)
      let expected=fixture["ids"] as! [Int]
      guard actual==expected else {
        throw PhoneClassifierError.invalid("Tokenizer mismatch: \(fixture["name"]!), expected \(expected.prefix(20)), actual \(actual.prefix(20))")
      }
    }
    var results:[String:Any]=["tokenizer_cases_passed":fixtures.count,"synthetic":true]
    if args.count>3 {
      let classifier=try PhoneModernBERT(assets:assets)
      let texts=["今天完成報告很開心，但也擔心成績。",String(repeating:"I am happy about finishing the presentation, but worried about tomorrow. ",count:20)]
      results["classifications"]=try texts.map { try classifier.classify($0) }
    }
    let data=try JSONSerialization.data(withJSONObject:results,options:[.sortedKeys,.prettyPrinted])
    FileHandle.standardOutput.write(data)
  }
}
