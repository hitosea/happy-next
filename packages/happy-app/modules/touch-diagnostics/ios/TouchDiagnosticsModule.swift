import ExpoModulesCore
import ObjectiveC
import UIKit

/**
 * Touch diagnostics: a developer switch that keeps a short in-memory log of every tap (which window
 * and view it landed on, which gesture recognizers took part and how each one ended), of keyboard,
 * text input, window and app lifecycle events, and exports that log together with a snapshot of the
 * windows and the first responder. Built to catch the iOS state where, with the keyboard up and
 * something typed, every first tap anywhere in the app is swallowed. Text content is never recorded.
 *
 * The switch is kept in UserDefaults so recording starts with the app, before any JS runs.
 */
public class TouchDiagnosticsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TouchDiagnostics")

    OnCreate {
      if TouchDiagnostics.storedEnabled {
        DispatchQueue.main.async { TouchDiagnostics.shared.start() }
      }
    }

    Function("isEnabled") { () -> Bool in
      TouchDiagnostics.storedEnabled
    }

    AsyncFunction("setEnabled") { (enabled: Bool) in
      TouchDiagnostics.storedEnabled = enabled
      if enabled {
        TouchDiagnostics.shared.start()
      } else {
        TouchDiagnostics.shared.stop()
      }
    }.runOnQueue(.main)

    AsyncFunction("exportReport") { () -> String in
      TouchDiagnostics.shared.report()
    }.runOnQueue(.main)
  }
}

final class TouchDiagnostics: NSObject {
  static let shared = TouchDiagnostics()

  private static let enabledKey = "happyTouchDiagnosticsEnabled"
  private static let maxEntries = 800

  static var storedEnabled: Bool {
    get { UserDefaults.standard.bool(forKey: enabledKey) }
    set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
  }

  private(set) var isRecording = false
  private var swizzled = false
  private var startedAt: Date?
  private var entries: [String] = []
  private var observers: [NSObjectProtocol] = []
  private var keyboardVisible = false
  private var keyboardFrame: CGRect = .zero
  private var lastTextChangeEntryIndex: Int?
  private var textChangeCount = 0
  private var touchDownTimes: [ObjectIdentifier: TimeInterval] = [:]
  weak var capturedResponder: UIResponder?

  private let timeFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "HH:mm:ss.SSS"
    return f
  }()

  // MARK: - Lifecycle

  func start() {
    guard !isRecording else { return }
    installSwizzleIfNeeded()
    isRecording = true
    if startedAt == nil { startedAt = Date() }
    addObservers()
    log("recording started")
  }

  func stop() {
    guard isRecording else { return }
    log("recording stopped")
    isRecording = false
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }

  private func installSwizzleIfNeeded() {
    guard !swizzled else { return }
    let cls: AnyClass = UIApplication.self
    guard
      let original = class_getInstanceMethod(cls, #selector(UIApplication.sendEvent(_:))),
      let replacement = class_getInstanceMethod(cls, #selector(UIApplication.happyTouchDiag_sendEvent(_:)))
    else { return }
    method_exchangeImplementations(original, replacement)
    swizzled = true
  }

  // MARK: - Log

  private func log(_ message: String) {
    let line = "\(timeFormatter.string(from: Date())) \(message)"
    entries.append(line)
    if entries.count > Self.maxEntries {
      let overflow = entries.count - Self.maxEntries
      entries.removeFirst(overflow)
      if let index = lastTextChangeEntryIndex {
        lastTextChangeEntryIndex = index >= overflow ? index - overflow : nil
      }
    }
    if !message.hasPrefix("text changed") {
      lastTextChangeEntryIndex = nil
    }
  }

  // MARK: - Touches

  func didSend(_ event: UIEvent) {
    guard let touches = event.allTouches else { return }
    for touch in touches {
      switch touch.phase {
      case .began:
        logTouchDown(touch)
      case .ended:
        logTouchUp(touch, kind: "UP")
      case .cancelled:
        logTouchUp(touch, kind: "CANCELLED")
      default:
        break
      }
    }
  }

  private func logTouchDown(_ touch: UITouch) {
    if touchDownTimes.count > 50 { touchDownTimes.removeAll() }
    touchDownTimes[ObjectIdentifier(touch)] = touch.timestamp
    let window = touch.window
    let point = touch.location(in: window)
    let responder = currentFirstResponder()
    var lines: [String] = []
    lines.append("DOWN at (\(Int(point.x)),\(Int(point.y))) window=\(describeWindow(window)) keyWindow=\(describeWindow(keyWindow()))")
    lines.append("  keyboard=\(keyboardVisible ? "visible \(describeRect(keyboardFrame))" : "hidden") firstResponder=\(describeResponder(responder))")
    lines.append("  view chain: \(viewChain(touch.view))")
    lines.append("  recognizers: \(describeRecognizers(touch.gestureRecognizers))")
    if let view = responder as? UIView, let recognizers = view.gestureRecognizers, !recognizers.isEmpty {
      lines.append("  firstResponder recognizers: \(describeRecognizers(recognizers))")
    }
    log(lines.joined(separator: "\n"))
  }

  private func logTouchUp(_ touch: UITouch, kind: String) {
    let id = ObjectIdentifier(touch)
    var held = ""
    if let down = touchDownTimes.removeValue(forKey: id) {
      held = " held=\(Int((touch.timestamp - down) * 1000))ms"
    }
    let point = touch.location(in: touch.window)
    log("\(kind) at (\(Int(point.x)),\(Int(point.y)))\(held) view=\(describeView(touch.view))\n  recognizers: \(describeRecognizers(touch.gestureRecognizers))")
  }

  // MARK: - Notifications

  private func addObservers() {
    let center = NotificationCenter.default
    func observe(_ name: Notification.Name, _ handler: @escaping (Notification) -> Void) {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main, using: handler))
    }

    observe(UIResponder.keyboardWillShowNotification) { [weak self] n in self?.keyboardEvent("keyboard will show", n) }
    observe(UIResponder.keyboardDidShowNotification) { [weak self] n in
      self?.keyboardVisible = true
      self?.keyboardEvent("keyboard did show", n)
    }
    observe(UIResponder.keyboardWillHideNotification) { [weak self] n in self?.keyboardEvent("keyboard will hide", n) }
    observe(UIResponder.keyboardDidHideNotification) { [weak self] n in
      self?.keyboardVisible = false
      self?.keyboardEvent("keyboard did hide", n)
    }

    observe(UITextView.textDidBeginEditingNotification) { [weak self] n in self?.log("text view began editing \(self?.describeObject(n.object) ?? "")") }
    observe(UITextView.textDidEndEditingNotification) { [weak self] n in self?.log("text view ended editing \(self?.describeObject(n.object) ?? "")") }
    observe(UITextField.textDidBeginEditingNotification) { [weak self] n in self?.log("text field began editing \(self?.describeObject(n.object) ?? "")") }
    observe(UITextField.textDidEndEditingNotification) { [weak self] n in self?.log("text field ended editing \(self?.describeObject(n.object) ?? "")") }
    observe(UITextView.textDidChangeNotification) { [weak self] n in self?.textChanged(n.object) }
    observe(UITextField.textDidChangeNotification) { [weak self] n in self?.textChanged(n.object) }

    observe(UIWindow.didBecomeKeyNotification) { [weak self] n in self?.log("window became key \(self?.describeWindow(n.object as? UIWindow) ?? "")") }
    observe(UIWindow.didResignKeyNotification) { [weak self] n in self?.log("window resigned key \(self?.describeWindow(n.object as? UIWindow) ?? "")") }
    observe(UIWindow.didBecomeVisibleNotification) { [weak self] n in self?.log("window became visible \(self?.describeWindow(n.object as? UIWindow) ?? "")") }
    observe(UIWindow.didBecomeHiddenNotification) { [weak self] n in self?.log("window became hidden \(self?.describeWindow(n.object as? UIWindow) ?? "")") }

    observe(UIApplication.willResignActiveNotification) { [weak self] _ in self?.log("app will resign active") }
    observe(UIApplication.didEnterBackgroundNotification) { [weak self] _ in self?.log("app entered background") }
    observe(UIApplication.willEnterForegroundNotification) { [weak self] _ in self?.log("app will enter foreground") }
    observe(UIApplication.didBecomeActiveNotification) { [weak self] _ in self?.log("app became active") }
  }

  private func keyboardEvent(_ name: String, _ notification: Notification) {
    if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
      keyboardFrame = frame
    }
    let local = (notification.userInfo?[UIResponder.keyboardIsLocalUserInfoKey] as? Bool).map { $0 ? "local" : "other app" } ?? "?"
    log("\(name) frame=\(describeRect(keyboardFrame)) \(local) firstResponder=\(describeResponder(currentFirstResponder()))")
  }

  /// Consecutive text changes are folded into one line, so typing does not push the taps out of the log.
  private func textChanged(_ object: Any?) {
    var marked = "?"
    var length = -1
    if let input = object as? UITextInput {
      marked = input.markedTextRange != nil ? "yes" : "no"
      if let range = input.textRange(from: input.beginningOfDocument, to: input.endOfDocument) {
        length = input.offset(from: range.start, to: range.end)
      }
    }
    if let index = lastTextChangeEntryIndex, index < entries.count {
      textChangeCount += 1
      entries[index] = "\(timeFormatter.string(from: Date())) text changed x\(textChangeCount) \(describeObject(object)) length=\(length) markedText=\(marked)"
    } else {
      textChangeCount = 1
      log("text changed x1 \(describeObject(object)) length=\(length) markedText=\(marked)")
      lastTextChangeEntryIndex = entries.count - 1
    }
  }

  // MARK: - Report

  func report() -> String {
    var out: [String] = []
    let info = Bundle.main.infoDictionary
    out.append("=== Happy touch diagnostics ===")
    out.append("exported: \(Date())")
    out.append("app: \(info?["CFBundleShortVersionString"] ?? "?") (\(info?["CFBundleVersion"] ?? "?")) iOS \(UIDevice.current.systemVersion) \(UIDevice.current.model)")
    out.append("recording: \(isRecording ? "on" : "off") since \(startedAt.map { "\($0)" } ?? "never")")
    out.append("keyboard: \(keyboardVisible ? "visible" : "hidden") lastFrame=\(describeRect(keyboardFrame))")
    out.append("")

    out.append("=== First responder ===")
    let responder = currentFirstResponder()
    out.append(describeResponder(responder))
    if let input = responder as? UITextInput {
      out.append("markedText=\(input.markedTextRange != nil ? "yes" : "no")")
    }
    if let r = responder {
      out.append("inputView=\(r.inputView.map { "\(type(of: $0))" } ?? "nil") inputAccessoryView=\(r.inputAccessoryView.map { "\(type(of: $0))" } ?? "nil")")
    }
    if let view = responder as? UIView {
      out.append("ancestors with recognizers:")
      var current: UIView? = view
      while let v = current {
        if let recognizers = v.gestureRecognizers, !recognizers.isEmpty {
          out.append("  \(describeView(v)): \(describeRecognizers(recognizers))")
        }
        current = v.superview
      }
    }
    out.append("")

    out.append("=== Windows (back to front) ===")
    for window in allWindows() {
      out.append(describeWindowDetailed(window))
      if let recognizers = window.gestureRecognizers, !recognizers.isEmpty {
        out.append("  window recognizers: \(describeRecognizers(recognizers))")
      }
      if !window.isHidden {
        appendSubviews(of: window, depth: 1, maxDepth: isAppWindow(window) ? 2 : 4, into: &out)
      }
    }
    out.append("")

    out.append("=== Event log (oldest first, \(entries.count) entries) ===")
    out.append(contentsOf: entries)
    return out.joined(separator: "\n")
  }

  private func appendSubviews(of view: UIView, depth: Int, maxDepth: Int, into out: inout [String]) {
    guard depth <= maxDepth else { return }
    for subview in view.subviews.reversed().prefix(12) {
      let indent = String(repeating: "  ", count: depth + 1)
      var line = "\(indent)\(describeView(subview)) frame=\(describeRect(subview.frame))"
      if subview.isHidden { line += " hidden" }
      if subview.alpha < 0.999 { line += " alpha=\(String(format: "%.2f", subview.alpha))" }
      if !subview.isUserInteractionEnabled { line += " noInteraction" }
      if let recognizers = subview.gestureRecognizers, !recognizers.isEmpty {
        line += " recognizers: \(describeRecognizers(recognizers))"
      }
      out.append(line)
      if !subview.isHidden {
        appendSubviews(of: subview, depth: depth + 1, maxDepth: maxDepth, into: &out)
      }
    }
  }

  // MARK: - Describing

  private func allWindows() -> [UIWindow] {
    var windows: [UIWindow] = []
    for scene in UIApplication.shared.connectedScenes {
      if let windowScene = scene as? UIWindowScene {
        windows.append(contentsOf: windowScene.windows)
      }
    }
    return windows.sorted { $0.windowLevel.rawValue < $1.windowLevel.rawValue }
  }

  private func keyWindow() -> UIWindow? {
    allWindows().first { $0.isKeyWindow }
  }

  private func isAppWindow(_ window: UIWindow) -> Bool {
    window.windowLevel == .normal
  }

  func currentFirstResponder() -> UIResponder? {
    capturedResponder = nil
    UIApplication.shared.sendAction(#selector(UIResponder.happyTouchDiag_captureFirstResponder(_:)), to: nil, from: nil, for: nil)
    return capturedResponder
  }

  private func describeWindow(_ window: UIWindow?) -> String {
    guard let window = window else { return "nil" }
    return "\(type(of: window))(level=\(Int(window.windowLevel.rawValue)))"
  }

  private func describeWindowDetailed(_ window: UIWindow) -> String {
    var parts = ["\(type(of: window))", "level=\(Int(window.windowLevel.rawValue))", "frame=\(describeRect(window.frame))"]
    if window.isKeyWindow { parts.append("KEY") }
    if window.isHidden { parts.append("hidden") }
    if window.alpha < 0.999 { parts.append("alpha=\(String(format: "%.2f", window.alpha))") }
    if !window.isUserInteractionEnabled { parts.append("noInteraction") }
    if let root = window.rootViewController {
      var chain = "\(type(of: root))"
      var presented = root.presentedViewController
      while let p = presented {
        chain += " > presented \(type(of: p))"
        presented = p.presentedViewController
      }
      parts.append("root=\(chain)")
    }
    return parts.joined(separator: " ")
  }

  private func describeView(_ view: UIView?) -> String {
    guard let view = view else { return "nil" }
    var s = "\(type(of: view))"
    if view.tag != 0 { s += "#\(view.tag)" }
    if let id = view.accessibilityIdentifier, !id.isEmpty { s += "[\(id.prefix(40))]" }
    return s
  }

  private func viewChain(_ view: UIView?) -> String {
    var names: [String] = []
    var current = view
    while let v = current, names.count < 10 {
      names.append(describeView(v))
      current = v.superview
    }
    return names.isEmpty ? "nil" : names.joined(separator: " < ")
  }

  private func describeObject(_ object: Any?) -> String {
    if let view = object as? UIView { return describeView(view) }
    if let object = object { return "\(type(of: object))" }
    return "nil"
  }

  private func describeResponder(_ responder: UIResponder?) -> String {
    guard let responder = responder else { return "nil" }
    if let view = responder as? UIView {
      return "\(describeView(view)) in \(describeWindow(view.window))"
    }
    return "\(type(of: responder))"
  }

  private func describeRecognizers(_ recognizers: [UIGestureRecognizer]?) -> String {
    guard let recognizers = recognizers, !recognizers.isEmpty else { return "none" }
    return recognizers.map { g in
      var s = "\(type(of: g))"
      if let name = g.name, !name.isEmpty { s += "(\(name.prefix(30)))" }
      s += "@\(describeView(g.view)) \(stateName(g.state))"
      var flags: [String] = []
      if !g.isEnabled { flags.append("disabled") }
      if g.cancelsTouchesInView { flags.append("cancels") }
      if g.delaysTouchesBegan { flags.append("delaysBegan") }
      if g.delaysTouchesEnded { flags.append("delaysEnded") }
      if let tap = g as? UITapGestureRecognizer, tap.numberOfTapsRequired != 1 { flags.append("taps=\(tap.numberOfTapsRequired)") }
      if let delegate = g.delegate { flags.append("delegate=\(type(of: delegate))") }
      if !flags.isEmpty { s += " {\(flags.joined(separator: ","))}" }
      return s
    }.joined(separator: " | ")
  }

  private func stateName(_ state: UIGestureRecognizer.State) -> String {
    switch state {
    case .possible: return "possible"
    case .began: return "began"
    case .changed: return "changed"
    case .ended: return "ENDED"
    case .cancelled: return "CANCELLED"
    case .failed: return "failed"
    @unknown default: return "state\(state.rawValue)"
    }
  }

  private func describeRect(_ rect: CGRect) -> String {
    "(\(Int(rect.origin.x)),\(Int(rect.origin.y)) \(Int(rect.width))x\(Int(rect.height)))"
  }
}

extension UIApplication {
  /// Exchanged with `sendEvent(_:)`: calling it here runs the original implementation.
  @objc func happyTouchDiag_sendEvent(_ event: UIEvent) {
    happyTouchDiag_sendEvent(event)
    let diagnostics = TouchDiagnostics.shared
    if diagnostics.isRecording, event.type == .touches {
      diagnostics.didSend(event)
    }
  }
}

extension UIResponder {
  @objc func happyTouchDiag_captureFirstResponder(_ sender: Any?) {
    TouchDiagnostics.shared.capturedResponder = self
  }
}
