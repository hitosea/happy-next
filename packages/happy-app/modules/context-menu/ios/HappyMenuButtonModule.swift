import ExpoModulesCore
import UIKit

/**
 * A clear button laid over a React Native trigger, whose menu is a `UIButton`'s own (as a bar
 * button's is). With `opensOnTap` a tap opens the menu; otherwise a tap sends `onPrimaryAction` and
 * a long press opens it, with a light haptic as it does. Choosing a row sends its `id` through
 * `onSelectAction`; the rows are those of `HappyMenuElements`.
 *
 * The rows keep the order they are given in, whichever way the menu opens: by default iOS orders
 * them outward from the button, so a menu opening upward from the bottom of the screen reads
 * bottom-up. `onMenuOpen` and `onMenuClose` say when the menu shows and when it has gone, so the
 * page can keep the tap that dismisses it from landing on what is under it.
 *
 * The haptic is the one the sessions list's "+" plays (patches/react-native-screens): a deferred
 * element without rows, which UIKit asks for its rows each time the menu opens.
 */
public class HappyMenuButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HappyMenuButton")

    // A binary built before tap menus existed has no such constant; the JS side then falls back.
    Constant("supportsTapMenu") { true }

    View(HappyMenuButtonView.self) {
      Events("onPrimaryAction", "onSelectAction", "onMenuOpen", "onMenuClose")

      Prop("menu") { (view: HappyMenuButtonView, menu: [String: Any]?) in
        view.menu = menu
      }

      Prop("opensOnTap") { (view: HappyMenuButtonView, opensOnTap: Bool?) in
        view.opensOnTap = opensOnTap ?? false
      }
    }
  }
}

/** A button that reports its menu showing and going. */
final class HappyMenuUIButton: UIButton {
  var onMenuOpen: (() -> Void)?
  var onMenuClose: (() -> Void)?

  override func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    super.contextMenuInteraction(interaction, willDisplayMenuFor: configuration, animator: animator)
    onMenuOpen?()
  }

  override func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
    if let animator {
      animator.addCompletion { [weak self] in self?.onMenuClose?() }
    } else {
      onMenuClose?()
    }
  }
}

public final class HappyMenuButtonView: ExpoView {
  let onPrimaryAction = EventDispatcher()
  let onSelectAction = EventDispatcher()
  let onMenuOpen = EventDispatcher()
  let onMenuClose = EventDispatcher()

  var menu: [String: Any]? {
    didSet { updateMenu() }
  }

  var opensOnTap = false {
    didSet {
      guard opensOnTap != oldValue else { return }
      button.showsMenuAsPrimaryAction = opensOnTap
      updateMenu()
    }
  }

  private let button = HappyMenuUIButton(type: .custom)

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    button.frame = bounds
    button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    button.showsMenuAsPrimaryAction = false
    // Before iOS 16 there is no choosing; the rows then go outward from the button.
    if #available(iOS 16.0, *) {
      button.preferredMenuElementOrder = .fixed
    }
    button.addAction(UIAction { [weak self] _ in
      guard let self, !self.opensOnTap else { return }
      self.onPrimaryAction()
    }, for: .primaryActionTriggered)
    button.onMenuOpen = { [weak self] in self?.onMenuOpen() }
    button.onMenuClose = { [weak self] in self?.onMenuClose() }
    addSubview(button)
  }

  private func updateMenu() {
    let specs = (menu?["items"] as? [[String: Any]]) ?? []
    guard !specs.isEmpty else {
      button.menu = nil
      return
    }
    let children = specs.compactMap { spec in
      HappyMenuElements.element(from: spec) { [weak self] id in self?.onSelectAction(["id": id]) }
    }
    // A menu opened by a tap answers the tap itself; only a long press gets the haptic.
    let feedback = opensOnTap ? [] : [UIDeferredMenuElement.uncached { completion in
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      completion([])
    }]
    button.menu = UIMenu(title: (menu?["title"] as? String) ?? "", children: children + feedback)
  }
}
