// Backported from Expo SDK 57 (expo/ios/AppDelegates/ExpoAppSceneDelegate.swift) by
// plugins/withIosSceneLifecycle.js. Remove together with that plugin once on SDK 57+.

import Expo
import React

/**
 `UIWindowSceneDelegate` base class for the app. The iOS 27 SDK asserts at launch unless the app
 adopts the scene life cycle.

 - Creates the `UIWindow` from the connecting `UIWindowScene` and starts React Native into it.
 - Re-feeds scene life-cycle, URL, user-activity and quick-action events to the app delegate.
 */
@available(iOSApplicationExtension, unavailable)
class ExpoAppSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  let forwarder = SceneEventForwarder()

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }
    guard UIApplication.shared.delegate is ExpoAppDelegate,
      let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
      let factory = provider.reactNativeFactory else {
      fatalError(
        "ExpoAppSceneDelegate couldn't start React Native: the app delegate must subclass ExpoAppDelegate, "
        + "conform to ExpoReactNativeFactoryProvider and create its RCTReactNativeFactory in "
        + "application(_:didFinishLaunchingWithOptions:)."
      )
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // Mirrored before React Native starts: expo-dev-launcher waits for this window to become
    // visible (patches/expo-dev-launcher+6.0.20.patch), and code reading
    // `UIApplication.shared.delegate?.window` keeps working.
    provider.window = window

    // Under the scene life cycle a cold-start URL or activity arrives in `connectionOptions`, not in
    // the app delegate's launch options, while `Linking.getInitialURL()` and expo-dev-launcher only
    // read launch options; rebuild them.
    let browsingWebActivity = connectionOptions.userActivities.first {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }
    factory.startReactNative(
      withModuleName: provider.reactNativeFactoryModuleName,
      in: window,
      launchOptions: Self.launchOptions(
        url: connectionOptions.urlContexts.first?.url,
        userActivity: browsingWebActivity
      )
    )

    connectionOptions.urlContexts.forEach {
      forwarder.open(url: $0.url, options: Self.openURLOptions(from: $0.options))
    }
    connectionOptions.userActivities.forEach { forwarder.continue($0) }

    // A quick action that cold-starts the app arrives here, not in
    // `windowScene(_:performActionFor:completionHandler:)`.
    if let shortcutItem = connectionOptions.shortcutItem {
      forwarder.perform(shortcutItem) { _ in }
    }
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    forwarder.didBecomeActive()
  }

  func sceneWillResignActive(_ scene: UIScene) {
    forwarder.willResignActive()
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    forwarder.willEnterForeground()
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    forwarder.didEnterBackground()
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    URLContexts.forEach { forwarder.open(url: $0.url, options: Self.openURLOptions(from: $0.options)) }
  }

  func scene(_ scene: UIScene, willContinueUserActivityWithType userActivityType: String) {
    forwarder.willContinueUserActivity(withType: userActivityType)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    forwarder.continue(userActivity)
  }

  func scene(_ scene: UIScene, didFailToContinueUserActivityWithType userActivityType: String, error: Error) {
    forwarder.didFailToContinueUserActivity(withType: userActivityType, error: error)
  }

  func scene(_ scene: UIScene, didUpdate userActivity: NSUserActivity) {
    forwarder.didUpdate(userActivity)
  }

  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    forwarder.perform(shortcutItem, completionHandler: completionHandler)
  }

  // MARK: - Launch options

  /// The launch options `Linking.getInitialURL()` reads, or `nil` when no URL or browsing-web
  /// activity cold-started the app. The keys are spelled out because their `UIApplication`
  /// accessors are deprecated in favor of the scene APIs.
  static func launchOptions(url: URL?, userActivity: NSUserActivity?) -> [UIApplication.LaunchOptionsKey: Any]? {
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url {
      launchOptions[UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsURLKey")] = url
    }
    if let userActivity {
      launchOptions[UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsUserActivityDictionaryKey")] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity
      ]
    }
    return launchOptions.isEmpty ? nil : launchOptions
  }

  private static func openURLOptions(from sceneOptions: UIScene.OpenURLOptions) -> [UIApplication.OpenURLOptionsKey: Any] {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let sourceApplication = sceneOptions.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    if let annotation = sceneOptions.annotation {
      options[.annotation] = annotation
    }
    options[.openInPlace] = sceneOptions.openInPlace
    return options
  }
}
