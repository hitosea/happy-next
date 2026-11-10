// Backported from Expo SDK 57 (expo/ios/AppDelegates/SceneEventForwarder.swift) by
// plugins/withIosSceneLifecycle.js. Remove together with that plugin once on SDK 57+.

import Expo
import React

/**
 Re-feeds scene events to the app delegate. Under the scene life cycle UIKit no longer calls the
 app delegate's URL, user-activity, life-cycle and quick-action methods; `ExpoAppDelegate` passes
 every event on to the Expo subscribers (expo-dev-launcher, expo-router, …) and runs the overrides
 in `AppDelegate`, so one call reaches all of them.
 */
@MainActor
@available(iOSApplicationExtension, unavailable)
struct SceneEventForwarder {
  private var appDelegate: ExpoAppDelegate? {
    return UIApplication.shared.delegate as? ExpoAppDelegate
  }

  func open(url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) {
    let application = UIApplication.shared
    let delegate = appDelegate
    notifyLinkingManagerUnlessAlreadyNotified(of: url) {
      _ = delegate?.application(application, open: url, options: options)
    } notify: {
      _ = RCTLinkingManager.application(application, open: url, options: options)
    }
  }

  func `continue`(_ userActivity: NSUserActivity) {
    let application = UIApplication.shared
    let delegate = appDelegate
    // `RCTLinkingManager` only announces browsing-web activities, so other activity types have
    // nothing to dedupe against.
    notifyLinkingManagerUnlessAlreadyNotified(of: userActivity.webpageURL) {
      _ = delegate?.application(application, continue: userActivity, restorationHandler: { _ in })
    } notify: {
      _ = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: { _ in })
    }
  }

  func willContinueUserActivity(withType userActivityType: String) {
    // The scene callback returns nothing; the subscribers still get to prepare.
    _ = appDelegate?.application(UIApplication.shared, willContinueUserActivityWithType: userActivityType)
  }

  func didFailToContinueUserActivity(withType userActivityType: String, error: Error) {
    appDelegate?.application(
      UIApplication.shared,
      didFailToContinueUserActivityWithType: userActivityType,
      error: error
    )
  }

  func didUpdate(_ userActivity: NSUserActivity) {
    appDelegate?.application(UIApplication.shared, didUpdate: userActivity)
  }

  func didBecomeActive() {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func willResignActive() {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func willEnterForeground() {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func didEnterBackground() {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  /// UIKit waits on `completionHandler`, so it has to run exactly once.
  func perform(
    _ shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let delegate = appDelegate else {
      completionHandler(false)
      return
    }
    delegate.application(UIApplication.shared, performActionFor: shortcutItem, completionHandler: completionHandler)
  }

  /// Runs `body`, then `notify` unless `RCTLinkingManager` announced `url` while `body` ran.
  /// The SDK 54 `AppDelegate` already hands links to `RCTLinkingManager` in its overrides; calling it
  /// again would deliver the JS `url` event twice. Always calls `notify` when `url` is `nil`.
  private func notifyLinkingManagerUnlessAlreadyNotified(
    of url: URL?,
    during body: () -> Void,
    notify: () -> Void
  ) {
    guard let url else {
      body()
      notify()
      return
    }
    let observer = LinkingManagerObserver(url: url)
    body()
    if !observer.wasNotified {
      notify()
    }
  }
}

/// Observes the notification `RCTLinkingManager` posts for every link it handles. The name is
/// private to React Native's `RCTLinkingManager.mm`; should it change, a link is delivered twice
/// rather than lost.
private final class LinkingManagerObserver: NSObject {
  private let expectedURL: String
  private(set) var wasNotified = false

  init(url: URL) {
    expectedURL = url.absoluteString
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(linkingManagerDidOpenURL(_:)),
      name: Notification.Name("RCTOpenURLNotification"),
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc
  private func linkingManagerDidOpenURL(_ notification: Notification) {
    wasNotified = wasNotified || notification.userInfo?["url"] as? String == expectedURL
  }
}
