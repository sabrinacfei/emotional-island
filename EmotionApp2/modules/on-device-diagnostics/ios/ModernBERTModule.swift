import ExpoModulesCore
import Foundation

public class ModernBERTModule: Module {
  private let queue = DispatchQueue(label: "tw.sabrina.emotionalisland.modernbert")
  private var classifier: PhoneModernBERT?

  private func prepared() throws -> PhoneModernBERT {
    if let classifier { return classifier }
    let parent = Bundle(for: ModernBERTModule.self)
    guard let url = parent.url(forResource: "ModernBERTAssets", withExtension: "bundle")
          ?? Bundle.main.url(forResource: "ModernBERTAssets", withExtension: "bundle") else {
      throw PhoneClassifierError.invalid("此 App 尚未包含手機分類模型，請更新原生 App。")
    }
    let classifier = try PhoneModernBERT(assets: url)
    self.classifier = classifier
    return classifier
  }

  public func definition() -> ModuleDefinition {
    Name("ModernBERTClassifier")
    AsyncFunction("prepare") { () -> [String: Any] in
      let classifier = try self.prepared()
      return classifier.manifest
    }.runOnQueue(queue)
    AsyncFunction("classify") { (text: String) -> [String: Any] in
      try autoreleasepool { try self.prepared().classify(text) }
    }.runOnQueue(queue)
    AsyncFunction("release") { () in self.classifier?.release() }.runOnQueue(queue)
  }
}
