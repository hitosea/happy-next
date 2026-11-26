import Foundation

public enum HappyError: Error {
  case notSignedIn
  case encryption
  case http(Int)
  case rpc(String)
  case badResponse
}

/// A session as the watch lists it
public struct HappySession: Identifiable, Hashable {
  public enum Status {
    /// The agent waits for a permission to be answered
    case needsApproval
    /// The agent is working on a turn
    case thinking
    /// The turn is over; the agent waits for the next message
    case waiting
  }

  public let id: String
  public let title: String
  /// The host and folder the session runs in
  public let detail: String
  public let flavor: String?
  /// The model the agent runs, as the session's metadata names it, and its reasoning effort
  public let model: String?
  public let reasoningEffort: String?
  /// What the app draws the session's avatar from: the machine and folder, or the session alone
  public let avatarId: String
  /// A preset key, an image URL or an emoji the session is marked with
  public let sessionIcon: String?
  public let thinking: Bool
  public let activeAt: Date
  /// When the conversation last moved, or when the session was created before its first message;
  /// what the app orders its list by
  public let lastMessageAt: Date
  public let requests: [HappyPermissionRequest]
  /// When the session was pinned to the top of the app's list, if it is
  public var pinnedAt: Date? = nil

  public var status: Status {
    if !requests.isEmpty { return .needsApproval }
    return thinking ? .thinking : .waiting
  }

  var isCodex: Bool { flavor == "codex" }

  /// The agent's name, as the app's session card gives it
  public var agentName: String {
    switch flavor {
    case nil, "claude": return "Claude"
    case "codex", "gpt", "openai": return "Codex"
    case "gemini": return "Gemini"
    case "qoder": return "Qoder"
    case "antigravity": return "Antigravity"
    case "deepseek": return "DeepSeek"
    case let other?: return other
    }
  }
}

/// A permission the agent waits on (`agentState.requests`)
public struct HappyPermissionRequest: Identifiable, Hashable {
  public let id: String
  public let tool: String
  /// The command, file or other input the permission is for, short enough for a notification
  public let summary: String
  /// Questions and plans are answered in the app, which shows them in full
  public var answeredInApp: Bool { HappyPermissionRequest.toolsAnsweredInApp.contains(tool) }
  let shellCommand: String?
  let createdAt: Double

  static let toolsAnsweredInApp: Set<String> = ["AskUserQuestion", "ExitPlanMode", "exit_plan_mode"]
  static let shellTools: Set<String> = ["Bash", "execute"]

  init(id: String, record: [String: Any]) {
    self.id = id
    let tool = record["tool"] as? String ?? "?"
    self.tool = tool
    let arguments = record["arguments"] as? [String: Any] ?? [:]
    let command = HappyPermissionRequest.shellCommandOf(arguments)
    shellCommand = HappyPermissionRequest.shellTools.contains(tool) ? command : nil
    summary = command
      ?? (arguments["file_path"] as? String)
      ?? (arguments["path"] as? String)
      ?? (arguments["url"] as? String)
      ?? (arguments["description"] as? String)
      ?? ""
    createdAt = record["createdAt"] as? Double ?? 0
  }

  /// `shellCommandOf` from happy-wire: the command as one line, from a string, an argv, or the title
  /// ACP agents give a tool call
  static func shellCommandOf(_ input: [String: Any]) -> String? {
    var line = ""
    if let parts = input["command"] as? [Any] {
      line = parts.compactMap { $0 as? String }.joined(separator: " ")
    } else if let command = input["command"] as? String {
      line = command
    } else if let title = (input["toolCall"] as? [String: Any])?["title"] as? String {
      line = title.components(separatedBy: " [").first ?? ""
    }
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}

/// A page of a session's transcript, newest records first on the server: the text messages among
/// them, how many records it held, the oldest record's seq (where the page before it ends), and
/// whether there is one
public struct HappyMessagePage {
  public let messages: [HappyMessage]
  public let recordCount: Int
  public let oldestSeq: Int?
  public let hasMore: Bool
}

/// A message of a session's transcript, as text
public struct HappyMessage: Identifiable, Hashable {
  public enum Role { case user, agent }

  public let id: String
  public let seq: Int
  public let role: Role
  public let text: String
  public let createdAt: Date

  /// The text of a decrypted raw record, for the records that carry text: the prompts the user sent
  /// (from the app or typed in the terminal) and the agent's replies, in the formats the CLIs write
  /// them in. Tool calls, results, events, a subagent's work and the prompts Happy hands the agent
  /// itself are left to the app, as a copied session's backfill leaves them out.
  static func text(ofRecord record: [String: Any]) -> (Role, String)? {
    guard let role = record["role"] as? String, let content = record["content"] as? [String: Any] else { return nil }
    let entry: (Role, String)?
    switch role {
    case "user":
      // Claude's summary after compacting the context comes as a prompt of its own
      let meta = record["meta"] as? [String: Any]
      guard meta?["isCompactSummary"] as? Bool != true else { return nil }
      entry = (content["text"] as? String).map { (.user, $0) }
    case "agent":
      entry = agentText(content)
    case "session":
      entry = (content["data"] as? [String: Any]).flatMap(envelopeText)
    default:
      entry = nil
    }
    guard let entry else { return nil }
    if entry.0 == .user {
      guard !isInjectedPrompt(entry.1), !isHiddenPrompt(entry.1) else { return nil }
      return (.user, stripAttachments(entry.1))
    }
    guard !isUsageLimitNotice(entry.1) else { return nil }
    return entry
  }

  /// What the app's list leaves out of the user's prompts (`shouldHideMessageInChatList`): a local
  /// command's output, which marks a compaction, and the text Claude Code writes beside an image
  private static func isHiddenPrompt(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return [
      #"^<local-command-stdout>[\s\S]*</local-command-stdout>$"#,
      #"^\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by [\d.]+ to map to original image\.\]$"#,
    ].contains { trimmed.range(of: $0, options: .regularExpression) != nil }
  }

  /// Claude's usage-limit notice, which the app shows as an event of its own rather than a reply
  private static func isUsageLimitNotice(_ text: String) -> Bool {
    text.range(of: #"^Claude AI usage limit reached\|\d+$"#, options: .regularExpression) != nil
  }

  private static func agentText(_ content: [String: Any]) -> (Role, String)? {
    let data = content["data"] as? [String: Any] ?? [:]
    switch content["type"] as? String {
    case "output":
      guard data["isSidechain"] as? Bool != true else { return nil }
      let message = data["message"] as? [String: Any]
      switch data["type"] as? String {
      case "assistant":
        guard let items = message?["content"] as? [[String: Any]] else { return nil }
        return texts(of: items).map { (.agent, $0) }
      case "user":
        return claudePrompt(data, content: message?["content"]).map { (.user, $0) }
      default:
        return nil
      }
    case "codex", "acp":
      // A plan update is the agent's todo list, which the app draws as one
      guard data["type"] as? String == "message", let text = data["message"] as? String,
            !text.hasPrefix("[Plan Update]") else { return nil }
      return (.agent, text)
    case "session":
      return envelopeText(data)
    default:
      return nil
    }
  }

  private static func texts(of items: [[String: Any]]) -> String? {
    let text = items
      .filter { $0["type"] as? String == "text" }
      .compactMap { $0["text"] as? String }
      .joined(separator: "\n")
    return text.isEmpty ? nil : text
  }

  /// A prompt Claude Code wrote to its transcript, as `isPrompt` in the CLI's backfill tells one:
  /// typed text, not tool results or the records written beside them (meta, a compaction's
  /// summary, a local command's output, an interruption)
  private static func claudePrompt(_ data: [String: Any], content: Any?) -> String? {
    guard data["isMeta"] as? Bool != true, data["isCompactSummary"] as? Bool != true else { return nil }
    if let text = content as? String {
      return text.trimmingCharacters(in: .whitespaces).hasPrefix("<local-command-stdout>") ? nil : text
    }
    guard let items = content as? [[String: Any]],
          !items.contains(where: { $0["type"] as? String == "tool_result" }),
          let text = texts(of: items),
          !text.hasPrefix("[Request interrupted") else { return nil }
    return text
  }

  /// `isInjectedPrompt` from the CLI: a run's terminal callback or a background task's report, which
  /// Happy or the agent handed the agent as a prompt of its own
  private static func isInjectedPrompt(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return ["task-notification", "orchestrator-callback"].contains { tag in
      trimmed.hasPrefix("<\(tag)>") && trimmed.contains("</\(tag)>")
    }
  }

  /// `stripAttachmentsFromPrompt` from the CLI: the prompt as typed, without the files listed after it
  private static func stripAttachments(_ text: String) -> String {
    let typed = text.replacingOccurrences(
      of: #"(^|\n\n)<attached-files>\n[\s\S]*</attached-files>\s*$"#, with: "", options: .regularExpression)
    return typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? text : typed
  }

  /// What a copied session's backfill keeps of a transcript (`selectBackfillTurns`): each prompt,
  /// and of the agent's replies to it only the last, the one its turn ended on (or, while the turn
  /// runs, the latest)
  public static func turns(_ messages: [HappyMessage]) -> [HappyMessage] {
    var kept: [HappyMessage] = []
    for message in messages {
      if message.role == .agent, kept.last?.role == .agent {
        kept[kept.count - 1] = message
      } else {
        kept.append(message)
      }
    }
    return kept
  }

  /// A session-protocol envelope's text, as the app reads one: not a subagent's, not the agent's
  /// thinking, and from the agent only within a turn
  private static func envelopeText(_ envelope: [String: Any]) -> (Role, String)? {
    guard let ev = envelope["ev"] as? [String: Any], ev["t"] as? String == "text",
          ev["thinking"] as? Bool != true,
          envelope["subagent"] as? String == nil,
          let text = ev["text"] as? String else { return nil }
    let role: Role = envelope["role"] as? String == "user" ? .user : .agent
    guard role == .user || envelope["turn"] as? String != nil else { return nil }
    return (role, text)
  }
}

/// The answers the watch and the notifications give a permission
public enum HappyPermissionAnswer {
  case allow
  /// Don't ask again in this session: the command for a shell tool, the tool otherwise
  case allowForSession
  case deny
}
