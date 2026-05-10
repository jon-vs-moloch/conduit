import AppKit
import Foundation
import UserNotifications

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private lazy var controlApp = ManagedProcess(label: "Control app", logName: "control-app.log") { [weak self] in
        self?.refreshMenu()
    }
    private lazy var daemon = ManagedProcess(label: "Clipboard daemon", logName: "clipboard-daemon.log") { [weak self] in
        self?.refreshMenu()
    }
    private lazy var agentListener = ManagedProcess(label: "Agent listener", logName: "agent-listener.log") { [weak self] in
        self?.refreshMenu()
    }
    private let updater = UpdateChecker()
    private var statusMenuItem = NSMenuItem(title: "Status: Starting", action: nil, keyEquivalent: "")
    private var controlToggleItem = NSMenuItem()
    private var agentListenerToggleItem = NSMenuItem()
    private var daemonToggleItem = NSMenuItem()
    private var controlAppExternalAvailable = false
    private var controlAppSupportsAgentHandshake = false
    private var agentListenerNeedsAttention = false
    private var notifiedTransportIds = Set<String>()
    private var notifiedApprovalIds = Set<String>()
    private var pendingApprovalCount = 0
    private var healthTimer: Timer?
    private var terminationConfirmed = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        requestNotificationAuthorization()
        configureStatusItem()
        rebuildMenu()
        if (try? PortListeners.listenerPids(on: 47831).isEmpty) == true {
            startControlApp()
        } else {
            refreshControlAppHealth()
        }
        startAgentListener()
        startDaemon()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshControlAppHealth()
            self?.refreshApprovalNotifications()
            self?.refreshAgentListenerHealth()
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminationConfirmed {
            return .terminateNow
        }
        return confirmTermination() ? .terminateNow : .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) {
        healthTimer?.invalidate()
        controlApp.stop()
        agentListener.stop()
        daemon.stop()
    }

    private func configureStatusItem() {
        if let button = statusItem.button {
            button.image = ConduitIcon.makeStatusImage()
            button.image?.isTemplate = true
            button.toolTip = "Conduit"
        }
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        statusMenuItem = NSMenuItem(title: statusTitle(), action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(NSMenuItem.separator())

        controlToggleItem = NSMenuItem(
            title: controlAppToggleTitle(),
            action: #selector(toggleControlApp),
            keyEquivalent: ""
        )
        controlToggleItem.target = self
        controlToggleItem.isEnabled = controlAppToggleEnabled()
        menu.addItem(controlToggleItem)

        let openItem = NSMenuItem(title: "Open Control Panel", action: #selector(openControlPanel), keyEquivalent: "o")
        openItem.target = self
        menu.addItem(openItem)

        let handshakeItem = NSMenuItem(title: "Copy Agent Handshake", action: #selector(copyAgentHandshake), keyEquivalent: "h")
        handshakeItem.target = self
        menu.addItem(handshakeItem)

        agentListenerToggleItem = NSMenuItem(
            title: agentListener.isRunning ? "Stop Agent Listener" : "Start Agent Listener",
            action: #selector(toggleAgentListener),
            keyEquivalent: ""
        )
        agentListenerToggleItem.target = self
        menu.addItem(agentListenerToggleItem)

        daemonToggleItem = NSMenuItem(
            title: daemon.isRunning ? "Stop Clipboard Daemon" : "Start Clipboard Daemon",
            action: #selector(toggleDaemon),
            keyEquivalent: ""
        )
        daemonToggleItem.target = self
        menu.addItem(daemonToggleItem)

        menu.addItem(NSMenuItem.separator())

        let updateItem = NSMenuItem(title: "Check for Updates...", action: #selector(checkForUpdates), keyEquivalent: "u")
        updateItem.target = self
        menu.addItem(updateItem)

        let logsItem = NSMenuItem(title: "Open Logs", action: #selector(openLogs), keyEquivalent: "l")
        logsItem.target = self
        menu.addItem(logsItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit Conduit", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func statusTitle() -> String {
        let control = "control \(controlAppStatusSummary())"
        let agentState = agentListenerNeedsAttention ? "agent needs attention" : "agent \(agentListener.statusSummary)"
        let daemonState = "daemon \(daemon.statusSummary)"
        let approvals = pendingApprovalCount > 0 ? ", approvals \(pendingApprovalCount) pending" : ""
        return "Status: \(control), \(agentState), \(daemonState)\(approvals)"
    }

    private func refreshMenu() {
        statusMenuItem.title = statusTitle()
        controlToggleItem.title = controlAppToggleTitle()
        controlToggleItem.isEnabled = controlAppToggleEnabled()
        agentListenerToggleItem.title = agentListener.isRunning ? "Stop Agent Listener" : "Start Agent Listener"
        daemonToggleItem.title = daemon.isRunning ? "Stop Clipboard Daemon" : "Start Clipboard Daemon"
    }

    private func controlAppStatusSummary() -> String {
        if controlApp.isRunning {
            return "running"
        }
        if controlAppExternalAvailable {
            return controlAppSupportsAgentHandshake ? "available" : "stale"
        }
        return controlApp.statusSummary
    }

    private func controlAppToggleTitle() -> String {
        if controlApp.isRunning {
            return "Stop Control App"
        }
        if controlAppExternalAvailable {
            return controlAppSupportsAgentHandshake ? "Control App Already Running" : "Control App Needs Restart"
        }
        return "Start Control App"
    }

    private func controlAppToggleEnabled() -> Bool {
        controlApp.isRunning || !controlAppExternalAvailable || !controlAppSupportsAgentHandshake
    }

    private func refreshControlAppHealth(completion: ((Bool) -> Void)? = nil) {
        guard let url = URL(string: "http://127.0.0.1:47831/api/status") else {
            completion?(false)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.75
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let available = (response as? HTTPURLResponse)?.statusCode == 200
            let supportsAgentHandshake = data.flatMap { try? JSONDecoder().decode(ControlStatusResponse.self, from: $0) }?.capabilities.agentHandshake == true
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                if self.controlAppExternalAvailable != available || self.controlAppSupportsAgentHandshake != supportsAgentHandshake {
                    self.controlAppExternalAvailable = available
                    self.controlAppSupportsAgentHandshake = supportsAgentHandshake
                    self.refreshMenu()
                }
                completion?(available)
            }
        }.resume()
    }

    private func refreshApprovalNotifications() {
        guard controlApp.isRunning || controlAppExternalAvailable, let url = URL(string: "http://127.0.0.1:47831/api/approvals") else {
            if pendingApprovalCount != 0 {
                pendingApprovalCount = 0
                refreshMenu()
            }
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.75
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard
                (response as? HTTPURLResponse)?.statusCode == 200,
                let approvals = data.flatMap({ try? JSONDecoder().decode(ApprovalsResponse.self, from: $0) })
            else {
                return
            }
            let pending = approvals.approvals.filter { approval in
                approval.status == "pending" && approval.executionStatus == nil
            }
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                self.pendingApprovalCount = pending.count
                for approval in pending where !self.notifiedApprovalIds.contains(approval.approvalId) {
                    self.notifiedApprovalIds.insert(approval.approvalId)
                    self.notifyApprovalRequired(approval)
                }
                self.refreshMenu()
            }
        }.resume()
    }

    private func refreshAgentListenerHealth() {
        guard agentListener.isRunning, let url = URL(string: "http://127.0.0.1:3333/health") else {
            if agentListenerNeedsAttention {
                agentListenerNeedsAttention = false
                refreshMenu()
            }
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.75
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let health = data.flatMap { try? JSONDecoder().decode(AgentListenerHealthResponse.self, from: $0) }
            let exhausted = (response as? HTTPURLResponse)?.statusCode == 200 && health?.lastTransportError?.needsAttention == true
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                self.agentListenerNeedsAttention = exhausted
                if exhausted, let error = health?.lastTransportError {
                    self.notifyAgentSendFailure(error)
                }
                self.refreshMenu()
            }
        }.resume()
    }

    private func notifyAgentSendFailure(_ error: AgentTransportError) {
        let transportId = error.transportId ?? "unknown"
        if notifiedTransportIds.contains(transportId) {
            return
        }
        notifiedTransportIds.insert(transportId)
        let content = UNMutableNotificationContent()
        content.title = "Conduit send needs attention"
        content.body = "Agent message \(transportId) could not be sent after retries. Reload the ChatGPT tab or extension, then retry."
        content.sound = .default
        let request = UNNotificationRequest(identifier: "conduit-send-\(transportId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func notifyApprovalRequired(_ approval: ApprovalSummary) {
        let content = UNMutableNotificationContent()
        content.title = approval.action.tool == "conduit.review" ? "Conduit review required" : "Conduit approval required"
        content.body = approval.action.reason ?? approval.policyReason ?? "A local action is waiting for approval."
        content.sound = .default
        content.userInfo = [
            "conduitAction": "openApprovals",
            "approvalId": approval.approvalId
        ]
        let request = UNNotificationRequest(identifier: "conduit-approval-\(approval.approvalId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func requestNotificationAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    @objc private func toggleControlApp() {
        if controlApp.isRunning {
            controlApp.stop()
        } else if controlAppExternalAvailable && !controlAppSupportsAgentHandshake {
            restartStaleControlApp()
        } else if controlAppExternalAvailable {
            openControlPanel()
        } else {
            startControlApp()
        }
        refreshMenu()
    }

    @objc private func openControlPanel() {
        openControlPanelURL(path: "")
    }

    private func openApprovals() {
        openControlPanelURL(path: "#approvals")
    }

    private func openControlPanelURL(path: String) {
        if !controlApp.isRunning && !controlAppExternalAvailable {
            startControlApp()
        }
        if let url = URL(string: "http://127.0.0.1:47831\(path)") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func copyAgentHandshake() {
        if !controlApp.isRunning && !controlAppExternalAvailable {
            startControlApp()
        }
        if !agentListener.isRunning {
            startAgentListener()
        }
        if controlAppExternalAvailable && !controlAppSupportsAgentHandshake {
            restartStaleControlApp { [weak self] restarted in
                guard restarted else {
                    return
                }
                self?.copyAgentHandshake()
            }
            return
        }

        Task {
            do {
                let handshake = try await requestAgentHandshake()
                await MainActor.run {
                    let pasteboard = NSPasteboard.general
                    pasteboard.clearContents()
                    pasteboard.setString(handshake.handshake, forType: .string)
                    refreshControlAppHealth()
                }
            } catch {
                await MainActor.run {
                    presentError("Could not copy the agent handshake.", error)
                }
            }
        }
    }

    @objc private func toggleDaemon() {
        if daemon.isRunning {
            daemon.stop()
        } else {
            startDaemon()
        }
        refreshMenu()
    }

    @objc private func toggleAgentListener() {
        if agentListener.isRunning {
            agentListener.stop()
        } else {
            startAgentListener()
        }
        refreshMenu()
    }

    @objc private func checkForUpdates() {
        Task {
            do {
                let result = try await updater.check()
                await MainActor.run {
                    presentUpdateResult(result)
                }
            } catch {
                await MainActor.run {
                    presentError("Could not check for updates.", error)
                }
            }
        }
    }

    @objc private func openLogs() {
        NSWorkspace.shared.open(LogFiles.logDirectory)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func startControlApp() {
        do {
            try controlApp.start(arguments: ["run", "conduit", "--", "app", "start", "--port", "47831"])
        } catch {
            presentError("Could not start the control app.", error)
        }
        refreshMenu()
    }

    private func restartStaleControlApp(completion: ((Bool) -> Void)? = nil) {
        do {
            let pids = try PortListeners.listenerPids(on: 47831)
            if pids.isEmpty {
                controlAppExternalAvailable = false
                controlAppSupportsAgentHandshake = false
                startControlApp()
                waitForControlAppHealth(completion: completion)
                return
            }
            let unexpectedPids = pids.filter { !PortListeners.isConduitControlListener(pid: $0, repoRoot: RepoLocator.repoRoot()) }
            if !unexpectedPids.isEmpty {
                throw AppError("Port 47831 is in use by a non-Conduit process: \(unexpectedPids.map { String($0) }.joined(separator: ", ")).")
            }

            for pid in pids {
                ProcessTree.terminateTree(of: pid)
            }
            refreshMenu()
            waitForPortToClear(47831) {
                self.controlAppExternalAvailable = false
                self.controlAppSupportsAgentHandshake = false
                self.startControlApp()
                self.waitForControlAppHealth(completion: completion)
            }
        } catch {
            presentError("Could not restart the control app.", error)
            completion?(false)
        }
    }

    private func waitForPortToClear(_ port: Int, completion: @escaping () -> Void) {
        DispatchQueue.global(qos: .utility).async {
            for _ in 0..<30 {
                if (try? PortListeners.listenerPids(on: port).isEmpty) == true {
                    break
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            DispatchQueue.main.async(execute: completion)
        }
    }

    private func waitForControlAppHealth(attemptsRemaining: Int = 30, completion: ((Bool) -> Void)?) {
        refreshControlAppHealth { [weak self] available in
            guard let self else {
                completion?(false)
                return
            }
            if available && self.controlAppSupportsAgentHandshake {
                completion?(true)
                return
            }
            guard attemptsRemaining > 0 else {
                completion?(false)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.waitForControlAppHealth(attemptsRemaining: attemptsRemaining - 1, completion: completion)
            }
        }
    }

    private func startDaemon() {
        do {
            try daemon.start(arguments: ["run", "conduit", "--", "daemon", "start", "--interval-ms", "1000"])
        } catch {
            presentError("Could not start the clipboard daemon.", error)
        }
        refreshMenu()
    }

    private func startAgentListener() {
        do {
            let pids = try PortListeners.listenerPids(on: 3333)
            let unexpectedPids = pids.filter { !PortListeners.isConduitAgentListener(pid: $0, repoRoot: RepoLocator.repoRoot()) }
            if !unexpectedPids.isEmpty {
                throw AppError("Port 3333 is in use by a non-Conduit process: \(unexpectedPids.map { String($0) }.joined(separator: ", ")).")
            }
            for pid in pids {
                ProcessTree.terminateTree(of: pid)
            }
            waitForPortToClear(3333) {
                do {
                    try self.agentListener.start(arguments: ["run", "conduit", "--", "listen", "--project", RepoLocator.repoRoot()])
                } catch {
                    self.presentError("Could not start the agent listener.", error)
                }
                self.refreshMenu()
            }
        } catch {
            presentError("Could not start the agent listener.", error)
        }
        refreshMenu()
    }

    private func requestAgentHandshake() async throws -> AgentHandshakeResponse {
        guard let url = URL(string: "http://127.0.0.1:47831/api/agent-handshake") else {
            throw AppError("Invalid control app URL.")
        }
        let payload: [String: Any] = [
            "label": "Chat agent loop",
            "root": RepoLocator.repoRoot(),
            "profile": "read-only",
            "transport": "extension",
            "copy": false
        ]
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 201 else {
            throw AppError(String(data: data, encoding: .utf8) ?? "Handshake request failed.")
        }
        return try JSONDecoder().decode(AgentHandshakeResponse.self, from: data)
    }

    private func confirmTermination() -> Bool {
        let alert = NSAlert()
        alert.messageText = "Quit Conduit?"
        alert.informativeText = "Quitting stops the control app, agent listener, and clipboard daemon processes started by Conduit. Choose Keep Running if you want Conduit to stay in the menu bar supervising local execution."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Quit and Stop Services")
        alert.addButton(withTitle: "Keep Running")
        let shouldQuit = alert.runModal() == .alertFirstButtonReturn
        terminationConfirmed = shouldQuit
        return shouldQuit
    }

    private func presentUpdateResult(_ result: UpdateCheckResult) {
        let alert = NSAlert()
        alert.messageText = result.isUpdateAvailable ? "Conduit update available" : "Conduit is up to date"
        alert.informativeText = result.message
        if result.isUpdateAvailable, result.downloadURL != nil {
            alert.addButton(withTitle: "Open Download")
            alert.addButton(withTitle: "Later")
            if alert.runModal() == .alertFirstButtonReturn, let downloadURL = result.downloadURL {
                NSWorkspace.shared.open(downloadURL)
            }
        } else {
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    private func presentError(_ title: String, _ error: Error) {
        let alert = NSAlert(error: error)
        alert.messageText = title
        alert.runModal()
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.notification.request.content.userInfo["conduitAction"] as? String == "openApprovals" {
            DispatchQueue.main.async {
                self.openApprovals()
            }
        }
        completionHandler()
    }
}

struct AgentHandshakeResponse: Decodable {
    let handshake: String
}

struct ApprovalsResponse: Decodable {
    let approvals: [ApprovalSummary]
}

struct ApprovalSummary: Decodable {
    let approvalId: String
    let status: String
    let policyReason: String?
    let executionStatus: String?
    let action: ApprovalActionSummary
}

struct ApprovalActionSummary: Decodable {
    let tool: String
    let reason: String?
}

struct ControlStatusResponse: Decodable {
    let capabilities: ControlCapabilities
}

struct ControlCapabilities: Decodable {
    let agentHandshake: Bool?
}

struct AgentListenerHealthResponse: Decodable {
    let lastTransportError: AgentTransportError?
}

struct AgentTransportError: Decodable {
    let transportId: String?
    let needsAttention: Bool?
}

struct AppError: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? {
        message
    }
}

final class ManagedProcess {
    let label: String
    let logName: String
    private(set) var process: Process?
    private var logHandle: FileHandle?
    private let onExit: () -> Void
    private var lastExitSummary: String?

    init(label: String, logName: String, onExit: @escaping () -> Void) {
        self.label = label
        self.logName = logName
        self.onExit = onExit
    }

    var isRunning: Bool {
        process?.isRunning == true
    }

    var statusSummary: String {
        if isRunning {
            return "running"
        }
        return lastExitSummary ?? "stopped"
    }

    func start(arguments: [String]) throws {
        if isRunning {
            return
        }

        let launched = Process()
        let repoRoot = RepoLocator.repoRoot()
        let shellCommand = ShellCommand.npm(arguments: arguments, in: repoRoot)
        launched.executableURL = URL(fileURLWithPath: "/bin/zsh")
        launched.arguments = ["-lc", shellCommand]
        launched.currentDirectoryURL = URL(fileURLWithPath: repoRoot)

        let handle = try LogFiles.openLogHandle(named: logName)
        logHandle = handle
        lastExitSummary = nil
        writeLogLine("Starting \(label): \(shellCommand)")
        launched.standardOutput = handle
        launched.standardError = handle

        launched.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                let status = launched.terminationStatus
                self.lastExitSummary = status == 0 ? "stopped" : "exited \(status)"
                self.writeLogLine("Stopped \(self.label) with exit status \(status).")
                self.logHandle?.closeFile()
                self.logHandle = nil
                self.process = nil
                self.onExit()
            }
        }

        try launched.run()
        process = launched
    }

    func stop() {
        guard let process else {
            return
        }
        writeLogLine("Stop requested for \(label).")
        if process.isRunning {
            ProcessTree.terminateChildren(of: process.processIdentifier)
            process.terminate()
        } else {
            logHandle?.closeFile()
            logHandle = nil
            self.process = nil
            lastExitSummary = "stopped"
            onExit()
        }
    }

    private func writeLogLine(_ text: String) {
        guard let data = "[\(Date())] \(text)\n".data(using: .utf8) else {
            return
        }
        logHandle?.write(data)
    }
}

enum ProcessTree {
    static func terminateTree(of pid: Int32) {
        terminateChildren(of: pid)
        kill(pid, SIGTERM)
    }

    static func terminateChildren(of pid: Int32) {
        for child in childPids(of: pid) {
            terminateTree(of: child)
        }
    }

    private static func childPids(of pid: Int32) -> [Int32] {
        let pkill = Process()
        let output = Pipe()
        pkill.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        pkill.arguments = ["-P", String(pid)]
        pkill.standardOutput = output
        pkill.standardError = FileHandle.nullDevice
        do {
            try pkill.run()
        } catch {
            return []
        }
        pkill.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8) ?? ""
        return text
            .split(whereSeparator: \.isWhitespace)
            .compactMap { Int32($0) }
    }
}

enum PortListeners {
    static func listenerPids(on port: Int) throws -> [Int32] {
        let lsof = Process()
        let output = Pipe()
        lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        lsof.arguments = ["-nP", "-t", "-iTCP:\(port)", "-sTCP:LISTEN"]
        lsof.standardOutput = output
        lsof.standardError = FileHandle.nullDevice
        try lsof.run()
        lsof.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8) ?? ""
        return text
            .split(whereSeparator: \.isWhitespace)
            .compactMap { Int32($0) }
    }

    static func isConduitControlListener(pid: Int32, repoRoot: String) -> Bool {
        let command = commandLine(for: pid)
        return command.contains("src/cli/index.ts app start")
            || command.contains("dist/cli/index.js app start")
            || (command.contains(repoRoot) && command.contains("app start --port 47831"))
    }

    static func isConduitAgentListener(pid: Int32, repoRoot: String) -> Bool {
        let command = commandLine(for: pid)
        return command.contains("src/cli/index.ts listen")
            || command.contains("dist/cli/index.js listen")
            || (command.contains(repoRoot) && command.contains("listen --project"))
    }

    private static func commandLine(for pid: Int32) -> String {
        let ps = Process()
        let output = Pipe()
        ps.executableURL = URL(fileURLWithPath: "/bin/ps")
        ps.arguments = ["-p", String(pid), "-o", "command="]
        ps.standardOutput = output
        ps.standardError = FileHandle.nullDevice
        do {
            try ps.run()
        } catch {
            return ""
        }
        ps.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }
}

enum ShellCommand {
    static func npm(arguments: [String], in repoRoot: String) -> String {
        let command = (["npm"] + arguments).map(quote).joined(separator: " ")
        let pathExports = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "\(NSHomeDirectory())/.nvm/current/bin"
        ].joined(separator: ":")
        return [
            "export PATH=\(quote(pathExports)):$PATH",
            "export CONDUIT_PARENT_PID=\(quote(String(ProcessInfo.processInfo.processIdentifier)))",
            "export NVM_DIR=\"$HOME/.nvm\"",
            "[ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\"",
            "cd \(quote(repoRoot))",
            "exec \(command)"
        ].joined(separator: "; ")
    }

    private static func quote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}

enum LogFiles {
    static let logDirectory = FileManager.default
        .urls(for: .libraryDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Logs/Conduit", isDirectory: true)

    static func openLogHandle(named name: String) throws -> FileHandle {
        try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        let url = logDirectory.appendingPathComponent(name)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
        return handle
    }
}

enum RepoLocator {
    static func repoRoot() -> String {
        if let configured = ProcessInfo.processInfo.environment["CONDUIT_REPO_ROOT"], !configured.isEmpty {
            return configured
        }

        let bundleCandidate = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .path
        if FileManager.default.fileExists(atPath: "\(bundleCandidate)/package.json") {
            return bundleCandidate
        }

        return FileManager.default.currentDirectoryPath
    }
}

enum ConduitIcon {
    static func makeStatusImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18))
        image.lockFocus()
        NSColor.black.setStroke()
        NSColor.black.setFill()

        let outer = NSBezierPath(ovalIn: NSRect(x: 2, y: 2, width: 14, height: 14))
        outer.lineWidth = 1.7
        outer.stroke()

        let path = NSBezierPath()
        path.move(to: NSPoint(x: 9, y: 4))
        path.line(to: NSPoint(x: 13, y: 9))
        path.line(to: NSPoint(x: 9, y: 14))
        path.line(to: NSPoint(x: 5, y: 9))
        path.close()
        path.fill()

        image.unlockFocus()
        image.isTemplate = true
        return image
    }
}

struct UpdateManifest: Decodable {
    let schema: String
    let version: String
    let channel: String
    let releaseNotes: String?
    let publishedAt: String?
    let artifacts: [UpdateArtifact]
}

struct UpdateArtifact: Decodable {
    let platform: String
    let url: String
    let sha256: String?
    let signature: String?
}

struct UpdateCheckResult {
    let isUpdateAvailable: Bool
    let message: String
    let downloadURL: URL?
}

final class UpdateChecker {
    private let currentVersion = "0.0.1"

    func check() async throws -> UpdateCheckResult {
        let manifest = try await loadManifest()
        let artifact = manifest.artifacts.first { $0.platform == "macos-universal" || $0.platform == "macos-arm64" }
        let updateAvailable = compareVersions(manifest.version, currentVersion) == .orderedDescending
        let signatureState = artifact?.signature == nil ? "Unsigned local preview manifest." : "Signature present."
        let notes = manifest.releaseNotes ?? "No release notes."
        let message = updateAvailable
            ? "Version \(manifest.version) is available on \(manifest.channel). \(signatureState)\n\n\(notes)"
            : "Current version \(currentVersion) is at least as new as \(manifest.version). \(signatureState)"

        return UpdateCheckResult(
            isUpdateAvailable: updateAvailable,
            message: message,
            downloadURL: artifact.flatMap { URL(string: $0.url) }
        )
    }

    private func loadManifest() async throws -> UpdateManifest {
        let manifestURL = resolvedManifestURL()
        if manifestURL.isFileURL {
            let data = try Data(contentsOf: manifestURL)
            return try JSONDecoder().decode(UpdateManifest.self, from: data)
        }

        let (data, _) = try await URLSession.shared.data(from: manifestURL)
        return try JSONDecoder().decode(UpdateManifest.self, from: data)
    }

    private func resolvedManifestURL() -> URL {
        if let configured = ProcessInfo.processInfo.environment["CONDUIT_UPDATE_MANIFEST_URL"],
           let url = URL(string: configured) {
            return url
        }

        let localManifest = URL(fileURLWithPath: RepoLocator.repoRoot())
            .appendingPathComponent("dist/macos/conduit-appcast.json")
        if FileManager.default.fileExists(atPath: localManifest.path) {
            return localManifest
        }

        let previewManifest = URL(fileURLWithPath: RepoLocator.repoRoot())
            .appendingPathComponent("website/releases/conduit-appcast.json")
        return previewManifest
    }

    private func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.split(separator: ".").map { Int($0) ?? 0 }
        let right = rhs.split(separator: ".").map { Int($0) ?? 0 }
        let count = max(left.count, right.count)
        for index in 0..<count {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a > b { return .orderedDescending }
            if a < b { return .orderedAscending }
        }
        return .orderedSame
    }
}
