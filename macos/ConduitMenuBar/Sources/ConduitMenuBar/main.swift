import AppKit
import Foundation

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
    private let updater = UpdateChecker()
    private var statusMenuItem = NSMenuItem(title: "Status: Starting", action: nil, keyEquivalent: "")
    private var controlToggleItem = NSMenuItem()
    private var daemonToggleItem = NSMenuItem()
    private var controlAppExternalAvailable = false
    private var healthTimer: Timer?
    private var terminationConfirmed = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureStatusItem()
        rebuildMenu()
        refreshControlAppHealth { [weak self] available in
            guard let self else {
                return
            }
            if !available {
                self.startControlApp()
            }
            self.startDaemon()
        }
        healthTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshControlAppHealth()
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
        controlToggleItem.isEnabled = controlApp.isRunning || !controlAppExternalAvailable
        menu.addItem(controlToggleItem)

        let openItem = NSMenuItem(title: "Open Control Panel", action: #selector(openControlPanel), keyEquivalent: "o")
        openItem.target = self
        menu.addItem(openItem)

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
        let daemonState = "daemon \(daemon.statusSummary)"
        return "Status: \(control), \(daemonState)"
    }

    private func refreshMenu() {
        statusMenuItem.title = statusTitle()
        controlToggleItem.title = controlAppToggleTitle()
        controlToggleItem.isEnabled = controlApp.isRunning || !controlAppExternalAvailable
        daemonToggleItem.title = daemon.isRunning ? "Stop Clipboard Daemon" : "Start Clipboard Daemon"
    }

    private func controlAppStatusSummary() -> String {
        if controlApp.isRunning {
            return "running"
        }
        if controlAppExternalAvailable {
            return "available"
        }
        return controlApp.statusSummary
    }

    private func controlAppToggleTitle() -> String {
        if controlApp.isRunning {
            return "Stop Control App"
        }
        if controlAppExternalAvailable {
            return "Control App Already Running"
        }
        return "Start Control App"
    }

    private func refreshControlAppHealth(completion: ((Bool) -> Void)? = nil) {
        guard let url = URL(string: "http://127.0.0.1:47831/api/status") else {
            completion?(false)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.75
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let available = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                if self.controlAppExternalAvailable != available {
                    self.controlAppExternalAvailable = available
                    self.refreshMenu()
                }
                completion?(available)
            }
        }.resume()
    }

    @objc private func toggleControlApp() {
        if controlApp.isRunning {
            controlApp.stop()
        } else if controlAppExternalAvailable {
            openControlPanel()
        } else {
            startControlApp()
        }
        refreshMenu()
    }

    @objc private func openControlPanel() {
        if !controlApp.isRunning && !controlAppExternalAvailable {
            startControlApp()
        }
        if let url = URL(string: "http://127.0.0.1:47831") {
            NSWorkspace.shared.open(url)
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

    private func startDaemon() {
        do {
            try daemon.start(arguments: ["run", "conduit", "--", "daemon", "start", "--interval-ms", "1000"])
        } catch {
            presentError("Could not start the clipboard daemon.", error)
        }
        refreshMenu()
    }

    private func confirmTermination() -> Bool {
        let alert = NSAlert()
        alert.messageText = "Quit Conduit?"
        alert.informativeText = "Quitting stops the clipboard daemon and any control app process started by Conduit. Choose Keep Running if you want Conduit to stay in the menu bar supervising local execution."
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
    static func terminateChildren(of pid: Int32) {
        let pkill = Process()
        pkill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        pkill.arguments = ["-TERM", "-P", String(pid)]
        pkill.standardOutput = FileHandle.nullDevice
        pkill.standardError = FileHandle.nullDevice
        try? pkill.run()
        pkill.waitUntilExit()
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
            .appendingPathComponent("website/releases/conduit-appcast.json")
        return localManifest
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
