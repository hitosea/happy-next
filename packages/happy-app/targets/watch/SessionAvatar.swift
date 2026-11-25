import SwiftUI

/// A session's avatar as the app draws it (AvatarBrutalist, dark): one of its images picked by the
/// hash of the session's machine and folder, tinted on a background of a colour pair picked the
/// same way, with the session's own icon as a badge
struct SessionAvatar: View {
  let session: HappySession
  let size: CGFloat

  private static let imageCount = 422
  private static let colorPairs: [(tint: Color, background: Color)] = [
    (Color(hex: 0x22D3EE), Color(hex: 0x022C22)),
    (Color(hex: 0xA3E635), Color(hex: 0x581C87)),
    (Color(hex: 0xFB7185), Color(hex: 0x1F2937)),
    (Color(hex: 0xFDE047), Color(hex: 0x312E81)),
    (Color(hex: 0x38BDF8), Color(hex: 0x020617)),
    (Color(hex: 0xC084FC), Color(hex: 0x3B0764)),
  ]

  var body: some View {
    let colors = Self.colorPairs[Self.hashCode(session.avatarId + "color") % Self.colorPairs.count]
    ZStack(alignment: .bottomTrailing) {
      Circle()
        .fill(colors.background)
        .overlay {
          Image("avatar-\(Self.hashCode(session.avatarId) % Self.imageCount)")
            .resizable()
            .renderingMode(.template)
            .foregroundStyle(colors.tint)
            .scaledToFit()
            .clipShape(Circle())
            .padding(size * 0.1)
        }
        .frame(width: size, height: size)
      if let icon = session.sessionIcon {
        SessionIconBadge(icon: icon, size: size * 0.5)
          .offset(x: size * 0.1, y: size * 0.1)
      }
    }
  }

  /// `hashCode` from the app: Java's string hash over UTF-16 units in 32 bits, made positive
  static func hashCode(_ string: String) -> Int {
    var hash: Int32 = 0
    for unit in string.utf16 {
      hash = (hash &<< 5) &- hash &+ Int32(unit)
    }
    return Int(hash.magnitude)
  }
}

/// The session's icon: a preset the app ships, an image URL, or an emoji
private struct SessionIconBadge: View {
  let icon: String
  let size: CGFloat

  var body: some View {
    content
      .frame(width: size, height: size)
      .clipShape(Circle())
      .background(Circle().fill(.black).padding(-1))
  }

  @ViewBuilder private var content: some View {
    if icon.hasPrefix("http://") || icon.hasPrefix("https://"), let url = URL(string: icon) {
      AsyncImage(url: url) { image in
        image.resizable().scaledToFill()
      } placeholder: {
        Color.gray
      }
    } else if ["dootask", "github"].contains(icon) {
      Image("session-\(icon)").resizable().scaledToFill()
    } else {
      Text(icon).font(.system(size: size * 0.75))
    }
  }
}

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}

/// A session's model as its agent's CLI names it, with its reasoning effort
enum ModelLabels {
  private static let efforts = [
    "low": "Low", "medium": "Medium", "high": "High", "max": "Max", "xhigh": "XHigh", "ultra": "Ultra", "none": "None",
  ]

  /// "claude-opus-5-5 (High)"
  static func label(model: String?, reasoningEffort: String?) -> String? {
    guard let model, !model.isEmpty else { return nil }
    guard let effort = reasoningEffort, !effort.isEmpty else { return model }
    return "\(model) (\(efforts[effort] ?? effort))"
  }
}
