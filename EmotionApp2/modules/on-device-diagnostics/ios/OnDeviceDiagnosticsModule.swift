import ExpoModulesCore
import Foundation
import CryptoKit
import Darwin
import UIKit

public class OnDeviceDiagnosticsModule: Module {
  private let metricsQueue = DispatchQueue(label: "tw.sabrina.emotiondiary.metrics")
  private var timer: DispatchSourceTimer?
  private var startedAt: UInt64 = 0
  private var baseline: Double = 0
  private var peak: Double = 0
  private var samples: Int = 0
  private var thermalStart = "unknown"
  private var warnings = 0
  private var warningObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("OnDeviceDiagnostics")

    AsyncFunction("selectionHaptic") { () in
      let generator = UISelectionFeedbackGenerator()
      generator.prepare()
      generator.selectionChanged()
    }.runOnQueue(.main)

    OnCreate {
      self.warningObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil
      ) { [weak self] _ in
        guard let self else { return }
        self.metricsQueue.async { if self.timer != nil { self.warnings += 1 } }
      }
    }
    OnDestroy {
      self.timer?.cancel()
      if let observer = self.warningObserver { NotificationCenter.default.removeObserver(observer) }
    }

    AsyncFunction("fileDigest") { (uri: String) -> [String: Any] in
      let url = try self.localModelURL(uri)
      let handle = try FileHandle(forReadingFrom: url)
      defer { try? handle.close() }
      var hash = SHA256()
      var total = 0
      while true {
        // Drain bridged Foundation buffers for every chunk, not only after a multi-GB hash.
        let count = try autoreleasepool { () throws -> Int in
          guard let data = try handle.read(upToCount: 4 * 1024 * 1024), !data.isEmpty else { return 0 }
          hash.update(data: data)
          return data.count
        }
        if count == 0 { break }
        total += count
      }
      return ["bytes": total, "sha256": hash.finalize().map { String(format: "%02x", $0) }.joined()]
    }

    AsyncFunction("excludeFromBackup") { (uri: String) in
      var url = try self.localModelURL(uri)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }

    AsyncFunction("freeDiskBytes") { () -> Double in
      let url = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      let attributes = try FileManager.default.attributesOfFileSystem(forPath: url.path)
      guard let size = attributes[.systemFreeSize] as? NSNumber else { throw self.failure("無法讀取儲存空間") }
      return size.doubleValue
    }

    AsyncFunction("startMeasurement") { () throws -> Void in
      guard self.timer == nil else { throw self.failure("上一個量測仍在進行") }
      self.baseline = try self.footprint()
      self.peak = self.baseline
      self.samples = 1
      self.warnings = 0
      self.thermalStart = self.thermal()
      self.startedAt = DispatchTime.now().uptimeNanoseconds
      let timer = DispatchSource.makeTimerSource(queue: self.metricsQueue)
      timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
      timer.setEventHandler { [weak self] in self?.sample() }
      self.timer = timer
      timer.resume()
    }.runOnQueue(metricsQueue)

    AsyncFunction("stopMeasurement") { () throws -> [String: Any] in
      guard self.timer != nil else { throw self.failure("尚未開始量測") }
      self.sample()
      self.timer?.cancel()
      self.timer = nil
      return [
        "durationMs": Double(DispatchTime.now().uptimeNanoseconds - self.startedAt) / 1_000_000,
        "baselineBytes": self.baseline,
        "sampledPeakBytes": self.peak,
        "sampleCount": self.samples,
        "sampleIntervalMs": 100,
        "memoryWarnings": self.warnings,
        "thermalStart": self.thermalStart,
        "thermalEnd": self.thermal()
      ]
    }.runOnQueue(metricsQueue)
  }

  private func failure(_ message: String) -> NSError {
    NSError(domain: "OnDeviceDiagnostics", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private func localModelURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else { throw failure("只接受 App 內的本機檔案") }
    let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
    let root = documents.standardizedFileURL.resolvingSymlinksInPath().appendingPathComponent("models", isDirectory: true).path
    guard resolved.path == root || resolved.path.hasPrefix(root + "/") else { throw failure("模型必須位於 App 的 models 目錄") }
    return resolved
  }

  private func footprint() throws -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let status = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard status == KERN_SUCCESS else { throw failure("無法取得此 App 的實體記憶體占用") }
    return Double(info.phys_footprint)
  }

  private func sample() {
    if let value = try? footprint() { peak = max(peak, value); samples += 1 }
  }

  private func thermal() -> String {
    switch ProcessInfo.processInfo.thermalState {
      case .nominal: return "nominal"
      case .fair: return "fair"
      case .serious: return "serious"
      case .critical: return "critical"
      @unknown default: return "unknown"
    }
  }
}
