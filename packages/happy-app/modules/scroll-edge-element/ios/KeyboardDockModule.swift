import ExpoModulesCore
import UIKit

/**
 * A composer dock that rides the keyboard the way UIKit's own input bars do: its content sits in a
 * view pinned to `keyboardLayoutGuide` with constraints, so showing, hiding, an interactive
 * dismissal and screen transitions all move it through UIKit's layout and animations. The iOS 26
 * bottom scroll edge effect is registered on that same view, so the effect is shaped by where UIKit
 * lays the composer out rather than by where a transform happens to draw it.
 */
public class KeyboardDockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyboardDock")

    View(KeyboardDockView.self) {
      // How far the dock's bottom may sit below the keyboard's top: the part of the dock's own
      // bottom padding that the keyboard is allowed to cover.
      Prop("keyboardOffset") { (view: KeyboardDockView, offset: Double?) in
        view.keyboardOffset = CGFloat(offset ?? 0)
      }

      // Called as the composer's field is cleared on a send, before it is laid out at its new height.
      AsyncFunction("prepareSendShrink") { (view: KeyboardDockView) in
        view.prepareSendShrink()
      }
    }
  }
}

public final class KeyboardDockView: ExpoView {
  var keyboardOffset: CGFloat = 0 {
    didSet {
      keyboardConstraint?.constant = keyboardOffset
    }
  }

  /// Holds the React Native children. React Native sizes this view (the dock at rest); the dock
  /// view takes the same size and is lifted over the keyboard by its constraints.
  private let dockView = UIView()
  private var keyboardConstraint: NSLayoutConstraint?

  private var interaction: UIInteraction?
  private weak var attachedScrollView: UIScrollView?
  private var watchdog: Timer?
  private var searchLink: CADisplayLink?
  private var searchStartedAt: CFTimeInterval = 0
  private var shrink: ShrinkCapture?
  private var heightConstraint: NSLayoutConstraint?
  private var shrinkAnimation: ShrinkAnimation?
  private var shrinkLink: CADisplayLink?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    dockView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(dockView)

    // With the keyboard down the guide's top is this view's bottom, so the dock rests there; with
    // it up the dock's bottom follows the keyboard's top. Before iOS 17 the guide always rests on the
    // bottom safe area, so there the dock rests above the home indicator.
    if #available(iOS 17.0, *) {
      keyboardLayoutGuide.usesBottomSafeArea = false
    }
    let keyboard = dockView.bottomAnchor.constraint(lessThanOrEqualTo: keyboardLayoutGuide.topAnchor, constant: keyboardOffset)
    let height = dockView.heightAnchor.constraint(equalTo: heightAnchor)
    let resting = dockView.bottomAnchor.constraint(equalTo: bottomAnchor)
    resting.priority = .defaultLow
    NSLayoutConstraint.activate([
      dockView.leadingAnchor.constraint(equalTo: leadingAnchor),
      dockView.trailingAnchor.constraint(equalTo: trailingAnchor),
      height,
      dockView.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor),
      keyboard,
      resting,
    ])
    keyboardConstraint = keyboard
    heightConstraint = height
  }

  deinit {
    stopWatchdog()
    stopSearching()
    shrinkLink?.invalidate()
  }

  // MARK: - Children

  public override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    dockView.insertSubview(childComponentView, at: index)
  }

  public override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  // With the keyboard up the dock sits above this view's own frame, and what the composer opens
  // above itself (the model and mode picker, autocomplete) sits above the dock's: neither this view
  // nor the dock may turn a touch away for being outside its bounds. The React Native children
  // decide, as they account for their own overflowing content.
  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard isUserInteractionEnabled, !isHidden, alpha > 0.01 else { return nil }
    let dockPoint = convert(point, to: dockView)
    for child in dockView.subviews.reversed() {
      if let hit = child.hitTest(dockView.convert(dockPoint, to: child), with: event) {
        return hit
      }
    }
    return nil
  }

  // MARK: - Scroll edge element

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      startWatchdog()
      attachOrSearch()
    } else {
      stopWatchdog()
      stopSearching()
    }
  }

  // Layout runs whenever the dock moves or resizes, which needs nothing (UIKit follows a view it lays
  // out), and when the scroll view beside it can appear or be replaced. The interaction is only
  // re-added for another scroll view: re-adding it rebuilds the effect, which the glass above
  // shows as a flicker.
  public override func layoutSubviews() {
    super.layoutSubviews()
    attach()
    if let animation = shrinkAnimation, abs(bounds.height - animation.height) > 0.5 {
      finishShrinkAnimation()
    }
    animatePendingShrink()
  }

  // MARK: - Send shrink

  /// Where the dock and the views in it were when a send cleared the composer's field.
  private struct ShrinkCapture {
    struct Placement {
      weak var view: UIView?
      let center: CGPoint
      let bounds: CGRect
    }

    let at: CFTimeInterval
    let height: CGFloat
    /// The dock view's frame in window coordinates: this view moves with the dock's top edge.
    let dockFrame: CGRect
    let placements: [Placement]
  }

  private static let shrinkDuration: TimeInterval = 0.3
  /// How long a capture waits for the shrink it was taken for.
  private static let shrinkWait: CFTimeInterval = 0.6

  /**
   * The composer shrinking back after a send is animated here natively, not frame by frame from
   * JS: it lands just as the sent prompt renders and the list scrolls to it, when a height animated
   * through React Native's layout keeps missing frames. Before the field shrinks, its JS side calls
   * this to note where everything is; the shrink then comes as one layout of the composer at its
   * new height, and every view it moved is animated from where it was to where it now is.
   */
  func prepareSendShrink() {
    var placements: [ShrinkCapture.Placement] = []
    var stack: [UIView] = dockView.subviews
    while let view = stack.popLast() {
      // A glass background's effect view resizes with its parent (autoresizing): it follows it,
      // and the private views it draws the glass with are UIKit's to lay out.
      if view is UIVisualEffectView { continue }
      placements.append(.init(view: view, center: view.center, bounds: view.bounds))
      // A text view's own content moves as it scrolls; it is clipped by the field anyway.
      if !(view is UIScrollView) {
        stack.append(contentsOf: view.subviews)
      }
    }
    shrink = ShrinkCapture(
      at: CACurrentMediaTime(),
      height: bounds.height,
      dockFrame: dockView.convert(dockView.bounds, to: nil),
      placements: placements
    )
  }

  /// A shrink being played: the dock's height constraint gives back the height it lost, and the
  /// views in it are put where they were, both eased to nothing frame by frame.
  private struct ShrinkAnimation {
    struct Move {
      weak var view: UIView?
      let from: (center: CGPoint, bounds: CGRect)
      let to: (center: CGPoint, bounds: CGRect)
      /// What the last frame set, to tell when React Native lays the view out again meanwhile.
      var last: (center: CGPoint, bounds: CGRect)
    }

    let startedAt: CFTimeInterval
    /// This view's height the shrink was laid out at.
    let height: CGFloat
    /// How much taller the dock was before the shrink.
    let extra: CGFloat
    var moves: [Move]
  }

  /**
   * Plays the shrink a capture was taken for, once this view has been laid out at the new height.
   * It is played by laying the views out anew every frame rather than by a UIKit animation: one of
   * those puts the views at their final frames at once and only draws them moving, and the glass
   * background, which refracts what is behind it by where its view really is, then draws the
   * content behind the card doubled and offset until it lands.
   */
  private func animatePendingShrink() {
    guard let capture = shrink else { return }
    if CACurrentMediaTime() - capture.at > Self.shrinkWait || bounds.height > capture.height + 0.5 {
      shrink = nil
      return
    }
    // Laid out for something else first (the keyboard, the cleared text): keep waiting.
    guard bounds.height < capture.height - 0.5, window != nil else { return }
    shrink = nil
    finishShrinkAnimation()

    var moves: [ShrinkAnimation.Move] = []
    for placement in capture.placements {
      guard let view = placement.view, view.isDescendant(of: dockView) else { continue }
      if view.center == placement.center && view.bounds == placement.bounds { continue }
      let to = (view.center, view.bounds)
      moves.append(.init(view: view, from: (placement.center, placement.bounds), to: to, last: to))
    }
    shrinkAnimation = ShrinkAnimation(
      startedAt: CACurrentMediaTime(),
      height: bounds.height,
      extra: capture.dockFrame.height - bounds.height,
      moves: moves
    )
    // The first frame is the composer as it was, so nothing is drawn at the new height first.
    applyShrink(progress: 0)

    let link = CADisplayLink(target: self, selector: #selector(shrinkTick(_:)))
    if #available(iOS 15.0, *) {
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    }
    link.add(to: .main, forMode: .common)
    shrinkLink = link
  }

  @objc private func shrinkTick(_ link: CADisplayLink) {
    guard let animation = shrinkAnimation else {
      finishShrinkAnimation()
      return
    }
    let t = min(1, (link.targetTimestamp - animation.startedAt) / Self.shrinkDuration)
    if t >= 1 {
      finishShrinkAnimation()
    } else {
      // Ease out (cubic).
      applyShrink(progress: 1 - pow(1 - t, 3))
    }
  }

  /// Lays the dock and the views in it out `progress` of the way from where they were to where
  /// they now are. A view React Native has laid out again since the last frame is left to it.
  private func applyShrink(progress: CGFloat) {
    guard var animation = shrinkAnimation else { return }
    let remaining = 1 - progress
    UIView.performWithoutAnimation {
      // The dock keeps its bottom (on the keyboard or this view's bottom) and grows upwards. The
      // frame is set as well as the constraint, so this frame draws it rather than the next layout.
      heightConstraint?.constant = animation.extra * remaining
      let dock = dockView.frame
      let height = animation.height + animation.extra * remaining
      dockView.frame = CGRect(x: dock.minX, y: dock.maxY - height, width: dock.width, height: height)

      for index in animation.moves.indices {
        let move = animation.moves[index]
        guard let view = move.view else { continue }
        if view.center != move.last.center || view.bounds != move.last.bounds { continue }
        let center = CGPoint(
          x: move.to.center.x + (move.from.center.x - move.to.center.x) * remaining,
          y: move.to.center.y + (move.from.center.y - move.to.center.y) * remaining
        )
        let size = CGSize(
          width: move.to.bounds.width + (move.from.bounds.width - move.to.bounds.width) * remaining,
          height: move.to.bounds.height + (move.from.bounds.height - move.to.bounds.height) * remaining
        )
        let bounds = CGRect(origin: move.to.bounds.origin, size: size)
        view.center = center
        view.bounds = bounds
        // Read back: UIKit may round what it is given.
        animation.moves[index].last = (view.center, view.bounds)
      }
    }
    shrinkAnimation = animation
  }

  private func finishShrinkAnimation() {
    shrinkLink?.invalidate()
    shrinkLink = nil
    guard shrinkAnimation != nil else { return }
    applyShrink(progress: 1)
    shrinkAnimation = nil
  }

  // The scroll view can be swapped without this view laying out: a chat list mounts a moment
  // after the composer (and replaces the empty state's scroll view), or remounts for another
  // session. A cheap check a few times a second re-attaches once the one it holds has left.
  private func startWatchdog() {
    #if compiler(>=6.2)
    guard #available(iOS 26.0, *) else { return }
    #else
    return
    #endif
    guard watchdog == nil else { return }
    let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
      guard let self, self.window != nil else { return }
      if self.attachedScrollView?.window == nil {
        self.attachOrSearch()
      }
    }
    RunLoop.main.add(timer, forMode: .common)
    watchdog = timer
  }

  private func stopWatchdog() {
    watchdog?.invalidate()
    watchdog = nil
  }

  // The chat list mounts a few frames after the composer, and until it is attached the glass has
  // no effect under it. So while there is none, look again every frame (for a moment, not for good:
  // a screen may have no scroll view at all) rather than waiting for the watchdog.
  private func attachOrSearch() {
    attach()
    if attachedScrollView?.window == nil {
      startSearching()
    }
  }

  private func startSearching() {
    #if compiler(>=6.2)
    guard #available(iOS 26.0, *) else { return }
    #else
    return
    #endif
    searchStartedAt = CACurrentMediaTime()
    guard searchLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(searchTick))
    link.add(to: .main, forMode: .common)
    searchLink = link
  }

  private func stopSearching() {
    searchLink?.invalidate()
    searchLink = nil
  }

  @objc private func searchTick() {
    attach()
    if attachedScrollView?.window != nil || CACurrentMediaTime() - searchStartedAt > 2 {
      stopSearching()
    }
  }

  private func attach() {
    // The interaction and edge-effect APIs only exist in the iOS 26 SDK (Swift 6.2 / Xcode 26).
    #if compiler(>=6.2)
    guard #available(iOS 26.0, *) else { return }
    guard window != nil, let scrollView = findScrollView() else { return }
    if scrollView === attachedScrollView && interaction != nil { return }

    if let old = interaction {
      dockView.removeInteraction(old)
    }
    let edgeInteraction = UIScrollEdgeElementContainerInteraction()
    edgeInteraction.scrollView = scrollView
    edgeInteraction.edge = .bottom
    dockView.addInteraction(edgeInteraction)

    scrollView.bottomEdgeEffect.isHidden = false
    scrollView.bottomEdgeEffect.style = .soft

    interaction = edgeInteraction
    attachedScrollView = scrollView
    #endif
  }

  /// The scroll view this dock floats over: the largest one beside it, found by widening the search
  /// one ancestor at a time. Scroll views inside the dock (a text input) do not count, and the
  /// search does not descend into scroll views, so a list's rows are never walked. It stops at the
  /// screen's own view: before this screen's list has mounted, the screen being pushed over (still
  /// in the window) must not lend it one.
  private func findScrollView() -> UIScrollView? {
    var ancestor = superview
    while let current = ancestor {
      if let found = largestScrollView(in: current) {
        return found
      }
      if current.next is UIViewController {
        return nil
      }
      ancestor = current.superview
    }
    return nil
  }

  private func largestScrollView(in root: UIView) -> UIScrollView? {
    var best: UIScrollView?
    var bestArea: CGFloat = 0
    var stack: [UIView] = [root]
    while let view = stack.popLast() {
      if view === self {
        continue
      }
      if let scrollView = view as? UIScrollView {
        if !(scrollView is UITextView) && scrollView.window != nil {
          let area = scrollView.bounds.width * scrollView.bounds.height
          if area > bestArea {
            best = scrollView
            bestArea = area
          }
        }
        continue
      }
      stack.append(contentsOf: view.subviews)
    }
    return best
  }
}
