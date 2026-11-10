// Backported from Expo SDK 57 (expo/ios/AppDelegates/ExpoReactNativeFactoryProvider.swift) by
// plugins/withIosSceneLifecycle.js. Remove together with that plugin once on SDK 57+.

import Expo
import React

/**
 Adopted by the app's `AppDelegate` so the scene delegate can reach the React Native factory it
 created in `application(_:didFinishLaunchingWithOptions:)`. Under the scene life cycle the scene
 delegate creates the window, while the app delegate still owns the factory.

 Internal to the app module, so the members satisfying it stay internal as the template declares them.
 */
@MainActor
protocol ExpoReactNativeFactoryProvider: AnyObject {
  /// The scene delegate assigns the window it creates here, so code reading
  /// `UIApplication.shared.delegate?.window` keeps working (expo-dev-launcher, expo-system-ui).
  var window: UIWindow? { get set }

  /// The factory created in `application(_:didFinishLaunchingWithOptions:)`.
  var reactNativeFactory: RCTReactNativeFactory? { get }

  /// The registered React Native module name.
  var reactNativeFactoryModuleName: String { get }
}

extension ExpoReactNativeFactoryProvider {
  var reactNativeFactoryModuleName: String {
    return "main"
  }
}
