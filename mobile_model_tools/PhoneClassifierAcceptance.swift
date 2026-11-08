import XCTest

final class PhoneClassifierAcceptance: XCTestCase {
  let app=XCUIApplication(bundleIdentifier:"com.sabrinacfei.emotionalisland")
  var config:[String:String]=[:]
  override func setUpWithError() throws {
    continueAfterFailure=false; executionTimeAllowance=1200
    config=try JSONSerialization.jsonObject(with:Data(contentsOf:Bundle(for:type(of:self)).url(forResource:"phone-credentials",withExtension:"json")!)) as! [String:String]
    addUIInterruptionMonitor(withDescription:"System permission") { alert in
      for label in ["不允許", "Don’t Allow", "Don't Allow", "稍後", "稍後再說", "Not Now"] {
        if alert.buttons[label].exists { alert.buttons[label].tap();return true }
      }
      return false
    }
  }
  func element(_ id:String)->XCUIElement { app.descendants(matching:.any).matching(identifier:id).firstMatch }
  func wait(_ id:String,_ seconds:TimeInterval=180)->XCUIElement {
    let e=element(id);XCTAssertTrue(e.waitForExistence(timeout:seconds),"Missing \(id)");return e
  }
  func dismissSystemSheets() {
    for owner in [XCUIApplication(bundleIdentifier:"com.apple.springboard"),app] {
      for label in ["稍後再說", "Not Now", "Don’t Save", "Don't Save"] {
        let button=owner.buttons[label]
        if button.exists && button.isHittable {button.tap();return}
      }
    }
  }
  func tap(_ id:String){let e=wait(id);for _ in 0..<5 {dismissSystemSheets();if e.isHittable{break};app.swipeUp()};e.press(forDuration:0.15)}
  func get(_ path:String)throws->Any {
    var req=URLRequest(url:URL(string:config["api"]!+path)!);req.setValue("Bearer "+config["token"]!,forHTTPHeaderField:"Authorization");req.timeoutInterval=110
    let done=DispatchSemaphore(value:0);var outcome:Result<Any,Error>!
    URLSession.shared.dataTask(with:req){data,response,error in
      defer{done.signal()};if let error{outcome = .failure(error);return}
      guard (response as? HTTPURLResponse)?.statusCode==200,let data else{outcome = .failure(NSError(domain:"SyntheticAcceptance",code:1));return}
      outcome=Result{try JSONSerialization.jsonObject(with:data)}
    }.resume()
    XCTAssertEqual(done.wait(timeout:.now()+115),.success);return try outcome.get()
  }
  func testNativeEncoderOnPhone() throws {
    let bundle=Bundle(for:type(of:self))
    let assets=bundle.resourceURL!.appendingPathComponent("Assets")
    let fixtures=try JSONSerialization.jsonObject(with:Data(contentsOf:bundle.url(forResource:"tokenizer-fixtures",withExtension:"json")!)) as! [[String:Any]]
    let tokenizer=try ModernBERTTokenizer(data:Data(contentsOf:assets.appendingPathComponent("modernbert-tokenizer.json")))
    for fixture in fixtures {XCTAssertEqual(try tokenizer.encode(fixture["text"] as! String),fixture["ids"] as! [Int])}
    let classifier=try PhoneModernBERT(assets:assets)
    let texts=["今天林小晴陪我完成報告很開心，但也擔心成績。",String(repeating:"I am happy about finishing the presentation, but worried about tomorrow. ",count:20)]
    let results=try texts.map {try classifier.classify($0)}
    let expected=try JSONSerialization.jsonObject(with:Data(contentsOf:bundle.url(forResource:"phone-reference",withExtension:"json")!)) as! [String:Any]
    let reference=expected["probabilities"] as! [String:Double]
    let actual=(results[1]["analysis"] as! [String:Any])["probabilities"] as! [String:Double]
    for key in reference.keys {XCTAssertEqual(actual[key]!,reference[key]!,accuracy:0.006)}
    let proof:[String:Any]=["synthetic":true,"execution_host":"physical iPhone XCTest runner; production Swift classifier","tokenizer_cases_passed":fixtures.count,"classifications":results]
    let data=try JSONSerialization.data(withJSONObject:proof,options:[.prettyPrinted,.sortedKeys])
    let attachment=XCTAttachment(data:data,uniformTypeIdentifier:"public.json");attachment.name="phone-native-encoder-proof";attachment.lifetime = .keepAlways;add(attachment)
    classifier.release()
  }
  func testPhoneClassificationAndGeneration() throws {
    app.terminate();app.launch()
    tap("welcome-login")
    let email=wait("login-email");email.tap();email.typeText(config["email"]!)
    let password=app.secureTextFields.firstMatch;password.tap();password.typeText(config["password"]!)
    if app.keyboards.count>0{app.swipeUp();if app.keyboards.count>0{app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.22)).tap()}}
    tap("login-submit");_ = wait("write-fragment",300)
    dismissSystemSheets()
    // RN's tab accessibility frame can be {-1,-1} on this iOS version.
    // This is the visible center tab on the verified iPhone layout.
    let tab=app.buttons.matching(NSPredicate(format:"label CONTAINS %@","趨勢")).firstMatch
    print("ACCEPTANCE_LAYOUT app=\(app.frame) window=\(app.windows.firstMatch.frame) tab=\(tab.frame)")
    for _ in 0..<3 {
      app.windows.firstMatch.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.94)).press(forDuration:0.15)
      if element("calendar-"+config["date"]!).waitForExistence(timeout:3) {break}
    }
    _ = wait("calendar-"+config["date"]!,20)
    try finishDailyWorkflow()
  }
  func testResumeKnownSyntheticDiary() throws {
    app.activate()
    let input=app.textViews.matching(identifier:"daily-content").firstMatch
    let expected=String(repeating:"I am happy about finishing the presentation, but worried about tomorrow. ",count:20).trimmingCharacters(in:.whitespacesAndNewlines)
    guard input.exists, (input.value as? String)?.trimmingCharacters(in:.whitespacesAndNewlines)==expected else {throw XCTSkip("Resume only the known pending synthetic fixture; no other diary is touched.")}
    try finishDailyWorkflow(openDate:false)
  }
  private func finishDailyWorkflow(openDate:Bool=true) throws {
    if openDate {tap("calendar-"+config["date"]!)}
    _ = wait("daily-confirm");tap("daily-confirm")
    let result=element("phone-classification-result")
    var previous=""
    for _ in 0..<120 {
      if result.waitForExistence(timeout:5) {break}
      let progress=element("daily-progress").label
      if progress != previous {print("ACCEPTANCE_PHASE \(progress)");previous=progress}
      if progress.contains("尚未完成") {
        XCTFail("Synthetic workflow did not complete: \(progress)");return
      }
    }
    XCTAssertTrue(result.exists,"Missing phone classification result")
    XCTAssertFalse(element("local-analysis-pending-sync").exists,"New backend should accept the native result")
    _ = wait("view-daily-analysis",120)
    let rows=try get("/history") as! [[String:Any]];XCTAssertEqual(rows.count,1)
    let row=rows[0]
    XCTAssertEqual(row["classifier_execution"] as? String,"on-device")
    XCTAssertEqual(row["classifier_provenance"] as? String,"client_reported_native_classifier")
    let trace=row["classifier_trace"] as! [String:Any]
    XCTAssertEqual(trace["runtime"] as? String,"coreml");XCTAssertGreaterThan(trace["duration_ms"] as! Double,0)
    let analysis=row["classifier_analysis"] as! [String:Any]
    XCTAssertGreaterThan(analysis["chunk_count"] as! Int,1)
    let aggregation=analysis["aggregation"] as! [String:Any]
    XCTAssertEqual(aggregation["overlap_tokens"] as? Int,32)
    let scores=analysis["probabilities"] as! [String:Double]
    XCTAssertEqual(scores.values.reduce(0,+),1,accuracy:1e-6)
    let expected=try JSONSerialization.jsonObject(with:Data(contentsOf:Bundle(for:type(of:self)).url(forResource:"phone-reference",withExtension:"json")!)) as! [String:Any]
    let reference=expected["probabilities"] as! [String:Double]
    for key in reference.keys {XCTAssertEqual(scores[key]!,reference[key]!,accuracy:0.006)}
    let generation=row["generation"] as! [String:Any]
    XCTAssertEqual(generation["execution"] as? String,"on-device")
    XCTAssertEqual(generation["model"] as? String,"qwen3.5-4b-q4_k_m")
    XCTAssertGreaterThan(generation["tokens_predicted"] as! Int,0)
    let data=try JSONSerialization.data(withJSONObject:["synthetic":true,"record":row],options:[.prettyPrinted,.sortedKeys])
    let json=XCTAttachment(data:data,uniformTypeIdentifier:"public.json");json.name="phone-classification-proof";json.lifetime = .keepAlways;add(json)
    let screen=XCTAttachment(screenshot:app.screenshot());screen.name="phone-classification-and-feedback";screen.lifetime = .keepAlways;add(screen)
    tap("view-daily-analysis");_ = wait("daily-emotion-chart")
  }
}
